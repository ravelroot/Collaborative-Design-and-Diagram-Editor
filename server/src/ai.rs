use std::fmt;
use std::net::SocketAddr;
use std::sync::OnceLock;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use anyhow::{anyhow, bail};
use axum::extract::{ConnectInfo, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::metrics::{self, METRICS};
use crate::security::client_ip;
use crate::state::Shared;

pub const MAX_RESPONSE_BYTES: usize = 4 * 1024 * 1024;
pub const MAX_REQUEST_BYTES: usize = 256 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AiKind {
    Anthropic,
    OpenAi,
}

impl AiKind {
    pub fn as_str(self) -> &'static str {
        match self {
            AiKind::Anthropic => "anthropic",
            AiKind::OpenAi => "openai",
        }
    }
}

struct Preset {
    id: &'static str,
    name: &'static str,
    kind: AiKind,
    base: &'static str,
    model: &'static str,
    needs_key: bool,
}

const PRESETS: [Preset; 6] = [
    Preset {
        id: "anthropic",
        name: "Anthropic (Claude)",
        kind: AiKind::Anthropic,
        base: "https://api.anthropic.com",
        model: "claude-sonnet-5-5",
        needs_key: true,
    },
    Preset {
        id: "openai",
        name: "OpenAI",
        kind: AiKind::OpenAi,
        base: "https://api.openai.com/v1",
        model: "gpt-4.1-mini",
        needs_key: true,
    },
    Preset {
        id: "gemini",
        name: "Google Gemini",
        kind: AiKind::OpenAi,
        base: "https://generativelanguage.googleapis.com/v1beta/openai",
        model: "gemini-2.5-flash",
        needs_key: true,
    },
    Preset {
        id: "openrouter",
        name: "OpenRouter",
        kind: AiKind::OpenAi,
        base: "https://openrouter.ai/api/v1",
        model: "openrouter/auto",
        needs_key: true,
    },
    Preset {
        id: "ollama",
        name: "Ollama",
        kind: AiKind::OpenAi,
        base: "http://localhost:11434/v1",
        model: "llama3.1",
        needs_key: false,
    },
    Preset {
        id: "lmstudio",
        name: "LM Studio",
        kind: AiKind::OpenAi,
        base: "http://localhost:1234/v1",
        model: "",
        needs_key: false,
    },
];

#[derive(Clone)]
pub struct AiConfig {
    pub provider: String,
    pub name: String,
    pub kind: AiKind,
    pub base: String,
    pub model: String,
    pub key: Option<String>,
    pub max_tokens: u64,
    pub per_hour: u64,
}

impl fmt::Debug for AiConfig {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("AiConfig")
            .field("provider", &self.provider)
            .field("base", &self.base)
            .field("model", &self.model)
            .field("key", &self.key.as_ref().map(|_| "***"))
            .field("max_tokens", &self.max_tokens)
            .field("per_hour", &self.per_hour)
            .finish()
    }
}

impl AiConfig {
    pub fn from_vars(get: impl Fn(&str) -> Option<String>) -> anyhow::Result<Option<Self>> {
        let Some(provider) = get("GRAFO_AI_PROVIDER") else {
            return Ok(None);
        };
        let provider = provider.to_lowercase();
        let preset = PRESETS.iter().find(|p| p.id == provider).ok_or_else(|| {
            anyhow!("GRAFO_AI_PROVIDER inválido: use anthropic, openai, gemini, openrouter, ollama ou lmstudio")
        })?;
        let key = get("GRAFO_AI_API_KEY");
        if preset.needs_key && key.is_none() {
            bail!("GRAFO_AI_API_KEY é obrigatório para o provedor {provider}");
        }
        let base = get("GRAFO_AI_BASE_URL")
            .unwrap_or_else(|| preset.base.to_string())
            .trim_end_matches('/')
            .to_string();
        if !(base.starts_with("https://") || base.starts_with("http://")) {
            bail!("GRAFO_AI_BASE_URL precisa começar com https:// ou http://");
        }
        let model = get("GRAFO_AI_MODEL").unwrap_or_else(|| preset.model.to_string());
        if model.is_empty() {
            bail!("defina GRAFO_AI_MODEL para o provedor {provider}");
        }
        let max_tokens = get("GRAFO_AI_MAX_TOKENS")
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(8192)
            .clamp(256, 32_000);
        let per_hour = get("GRAFO_AI_RATE_LIMIT")
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(30)
            .max(1);
        Ok(Some(Self {
            provider,
            name: preset.name.to_string(),
            kind: preset.kind,
            base,
            model,
            key,
            max_tokens,
            per_hour,
        }))
    }

    pub fn endpoint(&self) -> String {
        match self.kind {
            AiKind::Anthropic => format!("{}/v1/messages", self.base),
            AiKind::OpenAi => format!("{}/chat/completions", self.base),
        }
    }

    pub fn prepare(&self, body: Value) -> Option<Vec<u8>> {
        let Value::Object(mut map) = body else {
            return None;
        };
        if !map.get("messages").is_some_and(Value::is_array) {
            return None;
        }
        let asked = map
            .get("max_tokens")
            .and_then(Value::as_u64)
            .unwrap_or(self.max_tokens);
        map.insert("model".into(), Value::String(self.model.clone()));
        map.insert("max_tokens".into(), json!(asked.clamp(1, self.max_tokens)));
        map.remove("stream");
        serde_json::to_vec(&Value::Object(map)).ok()
    }
}

fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        let _ = rustls::crypto::ring::default_provider().install_default();
        reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(170))
            .user_agent(concat!("grafo-server/", env!("CARGO_PKG_VERSION")))
            .build()
            .expect("cliente HTTP da IA")
    })
}

fn message(status: StatusCode, text: &str) -> Response {
    (status, Json(json!({ "error": { "message": text } }))).into_response()
}

pub fn allow(app: &Shared, ip: &str, per_hour: u64) -> bool {
    let hour = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() / 3600)
        .unwrap_or(0);
    if app.ai_rate.len() > 10_000 {
        app.ai_rate.retain(|_, (h, _)| *h == hour);
    }
    let mut entry = app.ai_rate.entry(ip.to_string()).or_insert((hour, 0));
    if entry.0 != hour {
        *entry = (hour, 0);
    }
    entry.1 += 1;
    entry.1 <= per_hour
}

pub async fn status(State(app): State<Shared>) -> Json<Value> {
    match &app.cfg.ai {
        Some(c) => Json(json!({
            "enabled": true,
            "provider": c.name,
            "kind": c.kind.as_str(),
            "model": c.model,
        })),
        None => Json(json!({ "enabled": false })),
    }
}

#[derive(Deserialize)]
pub struct AiRequest {
    body: Value,
}

pub async fn request(
    State(app): State<Shared>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(req): Json<AiRequest>,
) -> Response {
    let Some(cfg) = &app.cfg.ai else {
        return message(
            StatusCode::SERVICE_UNAVAILABLE,
            "A IA não está configurada neste servidor",
        );
    };
    let ip = client_ip(&app, &headers, addr);
    if !allow(&app, &ip, cfg.per_hour) {
        metrics::inc(&METRICS.rate_limited_total);
        let mut res = message(
            StatusCode::TOO_MANY_REQUESTS,
            "Limite de pedidos à IA por hora atingido neste servidor",
        );
        res.headers_mut()
            .insert(header::RETRY_AFTER, HeaderValue::from_static("600"));
        return res;
    }
    let Some(payload) = cfg.prepare(req.body) else {
        return message(StatusCode::BAD_REQUEST, "Pedido à IA inválido");
    };
    metrics::inc(&METRICS.ai_requests_total);
    let mut call = client()
        .post(cfg.endpoint())
        .header(header::CONTENT_TYPE, "application/json")
        .body(payload);
    call = match (cfg.kind, &cfg.key) {
        (AiKind::Anthropic, Some(key)) => call
            .header("x-api-key", key)
            .header("anthropic-version", "2023-06-01"),
        (AiKind::Anthropic, None) => call.header("anthropic-version", "2023-06-01"),
        (AiKind::OpenAi, Some(key)) => call.bearer_auth(key),
        (AiKind::OpenAi, None) => call,
    };
    let res = match call.send().await {
        Ok(res) => res,
        Err(err) => {
            metrics::inc(&METRICS.ai_failures_total);
            tracing::warn!(error = %err, "falha ao falar com o provedor de IA");
            return message(
                StatusCode::BAD_GATEWAY,
                "Não foi possível falar com o provedor de IA",
            );
        }
    };
    let status = StatusCode::from_u16(res.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    if res
        .content_length()
        .is_some_and(|n| n as usize > MAX_RESPONSE_BYTES)
    {
        metrics::inc(&METRICS.ai_failures_total);
        return message(StatusCode::BAD_GATEWAY, "Resposta da IA grande demais");
    }
    let bytes = match res.bytes().await {
        Ok(b) if b.len() <= MAX_RESPONSE_BYTES => b,
        _ => {
            metrics::inc(&METRICS.ai_failures_total);
            return message(
                StatusCode::BAD_GATEWAY,
                "Resposta da IA incompleta ou grande demais",
            );
        }
    };
    if !status.is_success() {
        metrics::inc(&METRICS.ai_failures_total);
    }
    let mut out = (status, bytes).into_response();
    out.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/json"),
    );
    out.headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn vars(list: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
        let map: HashMap<String, String> = list
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        move |k: &str| map.get(k).cloned()
    }

    #[test]
    fn disabled_without_provider() {
        assert!(AiConfig::from_vars(vars(&[])).unwrap().is_none());
    }

    #[test]
    fn presets_defaults_and_validation() {
        let c = AiConfig::from_vars(vars(&[
            ("GRAFO_AI_PROVIDER", "Anthropic"),
            ("GRAFO_AI_API_KEY", "k"),
        ]))
        .unwrap()
        .unwrap();
        assert_eq!(c.kind, AiKind::Anthropic);
        assert_eq!(c.endpoint(), "https://api.anthropic.com/v1/messages");
        assert_eq!(c.max_tokens, 8192);
        assert!(!format!("{c:?}").contains("\"k\""));
        let o = AiConfig::from_vars(vars(&[
            ("GRAFO_AI_PROVIDER", "ollama"),
            ("GRAFO_AI_BASE_URL", "http://ia:11434/v1/"),
            ("GRAFO_AI_MAX_TOKENS", "999999"),
        ]))
        .unwrap()
        .unwrap();
        assert_eq!(o.endpoint(), "http://ia:11434/v1/chat/completions");
        assert_eq!(o.max_tokens, 32_000);
        assert!(AiConfig::from_vars(vars(&[("GRAFO_AI_PROVIDER", "openai")])).is_err());
        assert!(AiConfig::from_vars(vars(&[
            ("GRAFO_AI_PROVIDER", "outro"),
            ("GRAFO_AI_API_KEY", "k")
        ]))
        .is_err());
        assert!(AiConfig::from_vars(vars(&[("GRAFO_AI_PROVIDER", "lmstudio")])).is_err());
        assert!(AiConfig::from_vars(vars(&[
            ("GRAFO_AI_PROVIDER", "openai"),
            ("GRAFO_AI_API_KEY", "k"),
            ("GRAFO_AI_BASE_URL", "ftp://x")
        ]))
        .is_err());
    }

    #[test]
    fn prepare_forces_model_and_caps_tokens() {
        let c = AiConfig::from_vars(vars(&[
            ("GRAFO_AI_PROVIDER", "openai"),
            ("GRAFO_AI_API_KEY", "k"),
            ("GRAFO_AI_MODEL", "m1"),
            ("GRAFO_AI_MAX_TOKENS", "1000"),
        ]))
        .unwrap()
        .unwrap();
        let out: Value = serde_json::from_slice(
            &c.prepare(
                json!({ "model": "caro", "max_tokens": 50000, "stream": true, "messages": [] }),
            )
            .unwrap(),
        )
        .unwrap();
        assert_eq!(out["model"], "m1");
        assert_eq!(out["max_tokens"], 1000);
        assert!(out.get("stream").is_none());
        assert!(c.prepare(json!([1, 2])).is_none());
        assert!(c.prepare(json!({})).is_none());
    }
}
