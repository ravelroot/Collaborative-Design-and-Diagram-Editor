use std::net::SocketAddr;
use std::time::{SystemTime, UNIX_EPOCH};

use axum::body::Body;
use axum::extract::{ConnectInfo, Request, State};
use axum::http::{header, HeaderMap, HeaderValue, Method, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use redis::AsyncCommands;

use crate::error::ApiError;
use crate::state::Shared;

pub const APP_CSP: &str = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws: wss:; worker-src 'self' blob:; font-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
pub const ASSET_CSP: &str =
    "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox";

pub fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

pub fn client_ip(app: &Shared, headers: &HeaderMap, addr: SocketAddr) -> String {
    if app.cfg.trust_proxy {
        if let Some(forwarded) = headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()) {
            if let Some(last) = forwarded.split(',').map(str::trim).rfind(|s| !s.is_empty()) {
                if last.parse::<std::net::IpAddr>().is_ok() {
                    return last.to_string();
                }
            }
        }
    }
    addr.ip().to_string()
}

pub async fn headers(req: Request, next: Next) -> Response {
    let is_asset = req.uri().path().starts_with("/api/assets/");
    let mut res = next.run(req).await;
    let h = res.headers_mut();
    h.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    h.insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("no-referrer"),
    );
    h.insert(header::X_FRAME_OPTIONS, HeaderValue::from_static("DENY"));
    h.insert(
        "cross-origin-opener-policy",
        HeaderValue::from_static("same-origin"),
    );
    h.insert(
        "cross-origin-resource-policy",
        HeaderValue::from_static("same-origin"),
    );
    h.insert(
        "permissions-policy",
        HeaderValue::from_static("camera=(), microphone=(), geolocation=(), payment=(), usb=()"),
    );
    let csp = if is_asset { ASSET_CSP } else { APP_CSP };
    h.insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static(csp),
    );
    res
}

fn is_write(method: &Method) -> bool {
    matches!(
        *method,
        Method::POST | Method::PUT | Method::PATCH | Method::DELETE
    )
}

pub async fn auth(State(app): State<Shared>, req: Request, next: Next) -> Response {
    if let Some(expected) = &app.cfg.api_token {
        if is_write(req.method()) {
            let provided = req
                .headers()
                .get(header::AUTHORIZATION)
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.strip_prefix("Bearer "))
                .unwrap_or("");
            if !constant_time_eq(provided.as_bytes(), expected.as_bytes()) {
                return ApiError::Unauthorized.into_response();
            }
        }
    }
    next.run(req).await
}

pub async fn rate_limit(
    State(app): State<Shared>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    req: Request<Body>,
    next: Next,
) -> Response {
    if !is_write(req.method()) {
        return next.run(req).await;
    }
    let ip = client_ip(&app, req.headers(), addr);
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let minute = now / 60;
    let retry_after = 60 - (now % 60);
    let limit = app.cfg.rate_limit;
    let count = match &app.redis {
        Some(redis) => {
            let mut con = redis.clone();
            let key = format!("grafo:rl:{ip}:{minute}");
            let counted: Result<u64, _> = con.incr(&key, 1u64).await;
            match counted {
                Ok(n) => {
                    if n == 1 {
                        let _: Result<(), _> = con.expire(&key, 70).await;
                    }
                    n
                }
                Err(_) => local_count(&app, &ip, minute),
            }
        }
        None => local_count(&app, &ip, minute),
    };
    if count > limit {
        let mut res = (
            StatusCode::TOO_MANY_REQUESTS,
            axum::Json(
                serde_json::json!({"error": "muitas requisições; tente de novo em instantes"}),
            ),
        )
            .into_response();
        if let Ok(v) = HeaderValue::from_str(&retry_after.to_string()) {
            res.headers_mut().insert(header::RETRY_AFTER, v);
        }
        return res;
    }
    next.run(req).await
}

fn local_count(app: &Shared, ip: &str, minute: u64) -> u64 {
    if app.local_rate.len() > 10_000 {
        app.local_rate.retain(|_, (m, _)| *m == minute);
    }
    let mut entry = app.local_rate.entry(ip.to_string()).or_insert((minute, 0));
    if entry.0 != minute {
        *entry = (minute, 0);
    }
    entry.1 += 1;
    entry.1
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::Config;
    use crate::state::AppState;
    use std::path::PathBuf;

    fn cfg(limit: u64) -> Config {
        Config {
            bind: "127.0.0.1:0".parse().unwrap(),
            database_url: None,
            redis_url: None,
            nats_url: None,
            static_dir: PathBuf::from("."),
            api_token: None,
            max_update_bytes: 65_536,
            snapshot_every: 200,
            rate_limit: limit,
            room_idle_secs: 60,
            trust_proxy: false,
        }
    }

    #[test]
    fn constant_time_eq_matches_only_equal_inputs() {
        assert!(constant_time_eq(b"abcdef", b"abcdef"));
        assert!(!constant_time_eq(b"abcdef", b"abcdeg"));
        assert!(!constant_time_eq(b"abc", b"abcd"));
        assert!(constant_time_eq(b"", b""));
    }

    #[tokio::test]
    async fn local_rate_limit_counts_per_ip_and_resets_each_minute() {
        let app = AppState::connect(cfg(3)).await;
        assert_eq!(local_count(&app, "10.0.0.1", 100), 1);
        assert_eq!(local_count(&app, "10.0.0.1", 100), 2);
        assert_eq!(local_count(&app, "10.0.0.2", 100), 1);
        assert_eq!(local_count(&app, "10.0.0.1", 100), 3);
        assert_eq!(local_count(&app, "10.0.0.1", 101), 1);
    }

    #[tokio::test]
    async fn local_rate_limit_table_is_bounded() {
        let app = AppState::connect(cfg(3)).await;
        for i in 0..10_050u32 {
            local_count(&app, &format!("ip-{i}"), 1);
        }
        local_count(&app, "novo", 2);
        assert!(app.local_rate.len() < 10_050);
    }

    #[tokio::test]
    async fn forwarded_header_is_ignored_unless_proxy_is_trusted() {
        let mut c = cfg(3);
        let addr: SocketAddr = "192.168.0.9:5000".parse().unwrap();
        let mut headers = HeaderMap::new();
        headers.insert(
            "x-forwarded-for",
            HeaderValue::from_static("1.2.3.4, 5.6.7.8"),
        );
        let app = AppState::connect(c.clone()).await;
        assert_eq!(client_ip(&app, &headers, addr), "192.168.0.9");
        c.trust_proxy = true;
        let app = AppState::connect(c).await;
        assert_eq!(client_ip(&app, &headers, addr), "5.6.7.8");
        headers.insert("x-forwarded-for", HeaderValue::from_static("lixo"));
        assert_eq!(client_ip(&app, &headers, addr), "192.168.0.9");
    }
}
