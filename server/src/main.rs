use grafo_server::config::Config;
use grafo_server::state::AppState;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("info,tower_http=warn")),
        )
        .init();
    let cfg = Config::from_env()?;
    let bind = cfg.bind;
    let app = AppState::connect(cfg).await;
    let listener = tokio::net::TcpListener::bind(bind).await?;
    tracing::info!(
        "Grafo {} ouvindo em http://{}",
        env!("CARGO_PKG_VERSION"),
        bind
    );
    grafo_server::serve(app, listener, shutdown_signal()).await
}

async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    #[cfg(unix)]
    let terminate = async {
        if let Ok(mut s) = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        {
            s.recv().await;
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
    tracing::info!("encerrando: gravando as salas abertas");
}
