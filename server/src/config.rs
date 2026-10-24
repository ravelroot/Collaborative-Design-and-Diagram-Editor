use std::env;
use std::net::SocketAddr;
use std::path::PathBuf;

#[derive(Clone, Debug)]
pub struct Config {
    pub bind: SocketAddr,
    pub database_url: Option<String>,
    pub redis_url: Option<String>,
    pub nats_url: Option<String>,
    pub static_dir: PathBuf,
    pub api_token: Option<String>,
    pub max_update_bytes: usize,
    pub snapshot_every: i64,
    pub rate_limit: u64,
    pub room_idle_secs: u64,
    pub trust_proxy: bool,
}

fn non_empty(key: &str) -> Option<String> {
    env::var(key)
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

fn parse_or<T: std::str::FromStr>(key: &str, default: T) -> T {
    non_empty(key)
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let bind = non_empty("GRAFO_BIND").unwrap_or_else(|| "0.0.0.0:8080".to_string());
        let bind: SocketAddr = bind
            .parse()
            .map_err(|_| anyhow::anyhow!("GRAFO_BIND inválido: {bind}"))?;
        let api_token = non_empty("GRAFO_API_TOKEN");
        if let Some(token) = &api_token {
            if token.len() < 24 {
                anyhow::bail!("GRAFO_API_TOKEN precisa ter pelo menos 24 caracteres");
            }
        }
        let max_update_bytes =
            parse_or("GRAFO_MAX_UPDATE_BYTES", 8_388_608usize).clamp(65_536, 67_108_864);
        Ok(Self {
            bind,
            database_url: non_empty("DATABASE_URL"),
            redis_url: non_empty("REDIS_URL"),
            nats_url: non_empty("NATS_URL"),
            static_dir: PathBuf::from(
                non_empty("GRAFO_STATIC_DIR").unwrap_or_else(|| "web/dist".to_string()),
            ),
            api_token,
            max_update_bytes,
            snapshot_every: parse_or("GRAFO_SNAPSHOT_EVERY", 200i64).clamp(10, 100_000),
            rate_limit: parse_or("GRAFO_RATE_LIMIT", 120u64).max(1),
            room_idle_secs: parse_or("GRAFO_ROOM_IDLE_SECS", 60u64).max(1),
            trust_proxy: parse_or("GRAFO_TRUST_PROXY", false),
        })
    }
}
