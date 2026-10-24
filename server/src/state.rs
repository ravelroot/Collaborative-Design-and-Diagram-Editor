use std::sync::Arc;
use std::time::Duration;

use dashmap::DashMap;
use redis::aio::ConnectionManager;
use sqlx::postgres::{PgPool, PgPoolOptions};
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::config::Config;
use crate::room::Room;

pub const STREAM_NAME: &str = "GRAFO_DOCS";
pub const INSTANCE_HEADER: &str = "Grafo-Instance";

#[derive(Clone)]
pub struct Nats {
    pub client: async_nats::Client,
    pub jetstream: async_nats::jetstream::Context,
}

pub struct AppState {
    pub cfg: Config,
    pub db: Option<PgPool>,
    pub redis: Option<ConnectionManager>,
    pub nats: Option<Nats>,
    pub rooms: DashMap<Uuid, Arc<Room>>,
    pub room_load: Mutex<()>,
    pub instance_id: String,
    pub local_rate: DashMap<String, (u64, u64)>,
}

pub type Shared = Arc<AppState>;

impl AppState {
    pub async fn connect(cfg: Config) -> Shared {
        let db = match &cfg.database_url {
            Some(url) => connect_postgres(url).await,
            None => {
                tracing::warn!("DATABASE_URL não definido: documentos ficam só na memória");
                None
            }
        };
        let redis = match &cfg.redis_url {
            Some(url) => connect_redis(url).await,
            None => {
                tracing::warn!(
                    "REDIS_URL não definido: presença e limite de taxa ficam na memória"
                );
                None
            }
        };
        let nats = match &cfg.nats_url {
            Some(url) => connect_nats(url).await,
            None => {
                tracing::warn!("NATS_URL não definido: sem distribuição entre instâncias");
                None
            }
        };
        Arc::new(AppState {
            cfg,
            db,
            redis,
            nats,
            rooms: DashMap::new(),
            room_load: Mutex::new(()),
            instance_id: Uuid::new_v4().simple().to_string(),
            local_rate: DashMap::new(),
        })
    }
}

async fn connect_postgres(url: &str) -> Option<PgPool> {
    let pool = PgPoolOptions::new()
        .max_connections(16)
        .acquire_timeout(Duration::from_secs(5))
        .connect(url)
        .await;
    match pool {
        Ok(pool) => match sqlx::migrate!("./migrations").run(&pool).await {
            Ok(()) => {
                tracing::info!("PostgreSQL conectado e migrações aplicadas");
                Some(pool)
            }
            Err(err) => {
                tracing::error!(%err, "falha ao aplicar as migrações; seguindo sem PostgreSQL");
                None
            }
        },
        Err(err) => {
            tracing::warn!(%err, "PostgreSQL indisponível; seguindo só na memória");
            None
        }
    }
}

async fn connect_redis(url: &str) -> Option<ConnectionManager> {
    let client = match redis::Client::open(url) {
        Ok(client) => client,
        Err(err) => {
            tracing::warn!(%err, "REDIS_URL inválido");
            return None;
        }
    };
    match tokio::time::timeout(Duration::from_secs(5), client.get_connection_manager()).await {
        Ok(Ok(manager)) => {
            tracing::info!("Redis conectado");
            Some(manager)
        }
        Ok(Err(err)) => {
            tracing::warn!(%err, "Redis indisponível");
            None
        }
        Err(_) => {
            tracing::warn!("Redis não respondeu a tempo");
            None
        }
    }
}

async fn connect_nats(url: &str) -> Option<Nats> {
    let connected = tokio::time::timeout(
        Duration::from_secs(5),
        async_nats::ConnectOptions::new()
            .name("grafo-server")
            .connect(url),
    )
    .await;
    let client = match connected {
        Ok(Ok(client)) => client,
        Ok(Err(err)) => {
            tracing::warn!(%err, "NATS indisponível");
            return None;
        }
        Err(_) => {
            tracing::warn!("NATS não respondeu a tempo");
            return None;
        }
    };
    let jetstream = async_nats::jetstream::new(client.clone());
    let stream = jetstream
        .get_or_create_stream(async_nats::jetstream::stream::Config {
            name: STREAM_NAME.to_string(),
            subjects: vec!["grafo.docs.*.updates".to_string()],
            max_age: Duration::from_secs(7 * 24 * 3600),
            max_bytes: 2 * 1024 * 1024 * 1024,
            max_message_size: 16 * 1024 * 1024,
            duplicate_window: Duration::from_secs(120),
            ..Default::default()
        })
        .await;
    match stream {
        Ok(_) => {
            tracing::info!("NATS JetStream conectado (stream {STREAM_NAME})");
            Some(Nats { client, jetstream })
        }
        Err(err) => {
            tracing::warn!(%err, "JetStream indisponível (o servidor NATS precisa rodar com -js)");
            None
        }
    }
}
