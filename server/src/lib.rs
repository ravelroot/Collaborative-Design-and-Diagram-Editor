pub mod api;
pub mod bus;
pub mod config;
pub mod error;
pub mod restore;
pub mod room;
pub mod security;
pub mod state;
pub mod ws;

use std::net::SocketAddr;
use std::time::Duration;

use axum::extract::DefaultBodyLimit;
use axum::http::StatusCode;
use axum::routing::{get, patch, post};
use axum::{middleware, Router};
use tower_http::compression::CompressionLayer;
use tower_http::services::{ServeDir, ServeFile};
use tower_http::timeout::TimeoutLayer;
use tower_http::trace::TraceLayer;

use crate::state::Shared;

pub fn router(app: Shared) -> Router {
    let api = Router::new()
        .route("/health", get(api::health))
        .route("/files", get(api::list_files).post(api::create_file))
        .route(
            "/files/{id}",
            get(api::get_file)
                .patch(api::patch_file)
                .delete(api::delete_file),
        )
        .route(
            "/files/{id}/versions",
            get(api::list_versions).post(api::create_version),
        )
        .route("/files/{id}/versions/{vid}", get(api::get_version))
        .route(
            "/files/{id}/versions/{vid}/restore",
            post(api::restore_version),
        )
        .route(
            "/files/{id}/comments",
            get(api::list_comments).post(api::create_comment),
        )
        .route("/files/{id}/comments/{cid}", patch(api::patch_comment))
        .route(
            "/files/{id}/assets",
            post(api::upload_asset).layer(DefaultBodyLimit::max(20 * 1024 * 1024 + 1024)),
        )
        .route("/assets/{aid}", get(api::get_asset))
        .route(
            "/files/{id}/data-sources",
            get(api::get_data_sources).put(api::put_data_sources),
        )
        .route("/files/{id}/share-links", post(api::create_share_link))
        .route("/files/{id}/presence", get(api::presence))
        .layer(DefaultBodyLimit::max(2 * 1024 * 1024))
        .layer(middleware::from_fn_with_state(app.clone(), security::auth))
        .layer(middleware::from_fn_with_state(
            app.clone(),
            security::rate_limit,
        ))
        .layer(TimeoutLayer::with_status_code(
            StatusCode::REQUEST_TIMEOUT,
            Duration::from_secs(30),
        ));

    let index = app.cfg.static_dir.join("index.html");
    let static_files = ServeDir::new(&app.cfg.static_dir)
        .append_index_html_on_directories(true)
        .fallback(ServeFile::new(index));

    Router::new()
        .nest("/api", api)
        .route("/ws/{file}", get(ws::handler))
        .fallback_service(static_files)
        .layer(middleware::from_fn(security::headers))
        .layer(CompressionLayer::new())
        .layer(TraceLayer::new_for_http())
        .with_state(app)
}

pub async fn serve(
    app: Shared,
    listener: tokio::net::TcpListener,
    shutdown: impl std::future::Future<Output = ()> + Send + 'static,
) -> anyhow::Result<()> {
    bus::spawn(app.clone());
    let service = router(app.clone()).into_make_service_with_connect_info::<SocketAddr>();
    axum::serve(listener, service)
        .with_graceful_shutdown(shutdown)
        .await?;
    room::flush_all(&app).await;
    Ok(())
}
