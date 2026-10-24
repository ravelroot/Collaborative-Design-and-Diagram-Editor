use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;

#[derive(Debug)]
pub enum ApiError {
    BadRequest(String),
    Unauthorized,
    NotFound,
    PayloadTooLarge,
    Unavailable,
    Internal(String),
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, message) = match self {
            ApiError::BadRequest(m) => (StatusCode::BAD_REQUEST, m),
            ApiError::Unauthorized => (
                StatusCode::UNAUTHORIZED,
                "token ausente ou inválido".to_string(),
            ),
            ApiError::NotFound => (StatusCode::NOT_FOUND, "não encontrado".to_string()),
            ApiError::PayloadTooLarge => (
                StatusCode::PAYLOAD_TOO_LARGE,
                "conteúdo grande demais".to_string(),
            ),
            ApiError::Unavailable => (
                StatusCode::SERVICE_UNAVAILABLE,
                "banco de dados indisponível".to_string(),
            ),
            ApiError::Internal(m) => {
                tracing::error!(error = %m, "erro interno");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "erro interno".to_string(),
                )
            }
        };
        (status, Json(serde_json::json!({ "error": message }))).into_response()
    }
}

impl From<sqlx::Error> for ApiError {
    fn from(err: sqlx::Error) -> Self {
        match err {
            sqlx::Error::RowNotFound => ApiError::NotFound,
            sqlx::Error::Database(db) if db.code().as_deref() == Some("23503") => {
                ApiError::NotFound
            }
            sqlx::Error::Database(db) if db.code().as_deref() == Some("23514") => {
                ApiError::BadRequest("dados fora das regras do banco".to_string())
            }
            sqlx::Error::Database(db) if db.code().as_deref() == Some("23505") => {
                ApiError::BadRequest("já existe um registro com esses dados".to_string())
            }
            other => ApiError::Internal(other.to_string()),
        }
    }
}

impl From<anyhow::Error> for ApiError {
    fn from(err: anyhow::Error) -> Self {
        ApiError::Internal(err.to_string())
    }
}

pub type ApiResult<T> = Result<T, ApiError>;
