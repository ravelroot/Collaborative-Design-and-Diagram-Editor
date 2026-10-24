use std::sync::atomic::Ordering;
use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use base64::Engine as _;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use uuid::Uuid;

use crate::error::{ApiError, ApiResult};
use crate::room::{self, get_room, Room};
use crate::state::Shared;

const KINDS: [&str; 3] = ["design", "diagram", "board"];
const MAX_ASSET_BYTES: usize = 20 * 1024 * 1024;

fn db(app: &Shared) -> ApiResult<&PgPool> {
    app.db.as_ref().ok_or(ApiError::Unavailable)
}

fn parse_id(raw: &str) -> ApiResult<Uuid> {
    Uuid::parse_str(raw).map_err(|_| ApiError::BadRequest("identificador inválido".to_string()))
}

fn clean_name(raw: &str, max: usize) -> ApiResult<String> {
    let name: String = raw
        .chars()
        .filter(|c| !c.is_control())
        .collect::<String>()
        .trim()
        .to_string();
    if name.is_empty() {
        return Err(ApiError::BadRequest(
            "o nome não pode ficar vazio".to_string(),
        ));
    }
    if name.chars().count() > max {
        return Err(ApiError::BadRequest(format!(
            "o nome passa de {max} caracteres"
        )));
    }
    Ok(name)
}

fn release_if_idle(app: &Shared, room: &Arc<Room>) {
    if room.conns.load(Ordering::SeqCst) == 0 {
        room::schedule_unload(app.clone(), room.clone());
    }
}

pub async fn health(State(app): State<Shared>) -> Json<Value> {
    let postgres = match &app.db {
        Some(pool) => sqlx::query("SELECT 1").execute(pool).await.is_ok(),
        None => false,
    };
    let redis = match &app.redis {
        Some(r) => {
            let mut con = r.clone();
            redis::cmd("PING")
                .query_async::<String>(&mut con)
                .await
                .is_ok()
        }
        None => false,
    };
    let nats = app
        .nats
        .as_ref()
        .map(|n| n.client.connection_state() == async_nats::connection::State::Connected)
        .unwrap_or(false);
    Json(json!({
        "status": "ok",
        "version": env!("CARGO_PKG_VERSION"),
        "postgres": postgres,
        "redis": redis,
        "nats": nats,
        "rooms": app.rooms.len(),
    }))
}

#[derive(Serialize, sqlx::FromRow)]
pub struct FileRow {
    id: Uuid,
    name: String,
    kind: String,
    project_id: Option<Uuid>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

macro_rules! file_cols {
    () => {
        "id, name, kind::text AS kind, project_id, created_at, updated_at"
    };
}

#[derive(Deserialize)]
pub struct ListQuery {
    limit: Option<i64>,
}

pub async fn list_files(
    State(app): State<Shared>,
    Query(q): Query<ListQuery>,
) -> ApiResult<Json<Vec<FileRow>>> {
    let limit = q.limit.unwrap_or(100).clamp(1, 500);
    if app.db.is_none() {
        return Ok(Json(Vec::new()));
    }
    let rows = sqlx::query_as::<_, FileRow>(concat!(
        "SELECT ",
        file_cols!(),
        " FROM files WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT $1"
    ))
    .bind(limit)
    .fetch_all(db(&app)?)
    .await?;
    Ok(Json(rows))
}

#[derive(Deserialize)]
pub struct NewFile {
    id: Option<String>,
    name: Option<String>,
    kind: Option<String>,
    project_id: Option<Uuid>,
}

pub async fn create_file(
    State(app): State<Shared>,
    Json(body): Json<NewFile>,
) -> ApiResult<(StatusCode, Json<FileRow>)> {
    let id = match body.id.as_deref() {
        Some(raw) => parse_id(raw)?,
        None => Uuid::new_v4(),
    };
    let name = clean_name(body.name.as_deref().unwrap_or("Sem título"), 160)?;
    let kind = body.kind.unwrap_or_else(|| "design".to_string());
    if !KINDS.contains(&kind.as_str()) {
        return Err(ApiError::BadRequest(
            "tipo deve ser design, diagram ou board".to_string(),
        ));
    }
    let Some(pool) = &app.db else {
        let now = Utc::now();
        return Ok((
            StatusCode::CREATED,
            Json(FileRow {
                id,
                name,
                kind,
                project_id: body.project_id,
                created_at: now,
                updated_at: now,
            }),
        ));
    };
    let inserted = sqlx::query_as::<_, FileRow>(concat!(
        "INSERT INTO files (id, name, kind, project_id) VALUES ($1, $2, $3::file_kind, $4) ON CONFLICT (id) DO NOTHING RETURNING ",
        file_cols!()
    ))
    .bind(id)
    .bind(&name)
    .bind(&kind)
    .bind(body.project_id)
    .fetch_optional(pool)
    .await?;
    if let Some(row) = inserted {
        return Ok((StatusCode::CREATED, Json(row)));
    }
    let row = sqlx::query_as::<_, FileRow>(concat!(
        "UPDATE files SET deleted_at = NULL, name = CASE WHEN name = 'Sem título' THEN $2 ELSE name END WHERE id = $1 RETURNING ",
        file_cols!()
    ))
    .bind(id)
    .bind(&name)
    .fetch_one(pool)
    .await?;
    Ok((StatusCode::OK, Json(row)))
}

pub async fn get_file(
    State(app): State<Shared>,
    Path(id): Path<String>,
) -> ApiResult<Json<FileRow>> {
    let id = parse_id(&id)?;
    let row = sqlx::query_as::<_, FileRow>(concat!(
        "SELECT ",
        file_cols!(),
        " FROM files WHERE id = $1 AND deleted_at IS NULL"
    ))
    .bind(id)
    .fetch_one(db(&app)?)
    .await?;
    Ok(Json(row))
}

#[derive(Deserialize)]
pub struct PatchFile {
    name: Option<String>,
    kind: Option<String>,
}

pub async fn patch_file(
    State(app): State<Shared>,
    Path(id): Path<String>,
    Json(body): Json<PatchFile>,
) -> ApiResult<Json<FileRow>> {
    let id = parse_id(&id)?;
    let name = match body.name.as_deref() {
        Some(n) => Some(clean_name(n, 160)?),
        None => None,
    };
    if let Some(kind) = &body.kind {
        if !KINDS.contains(&kind.as_str()) {
            return Err(ApiError::BadRequest(
                "tipo deve ser design, diagram ou board".to_string(),
            ));
        }
    }
    let row = sqlx::query_as::<_, FileRow>(concat!("UPDATE files SET name = COALESCE($2, name), kind = COALESCE($3::file_kind, kind), updated_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING ", file_cols!()))
    .bind(id)
    .bind(name)
    .bind(body.kind)
    .fetch_one(db(&app)?)
    .await?;
    Ok(Json(row))
}

pub async fn delete_file(
    State(app): State<Shared>,
    Path(id): Path<String>,
) -> ApiResult<StatusCode> {
    let id = parse_id(&id)?;
    let res =
        sqlx::query("UPDATE files SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL")
            .bind(id)
            .execute(db(&app)?)
            .await?;
    if res.rows_affected() == 0 {
        return Err(ApiError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Serialize, sqlx::FromRow)]
pub struct VersionRow {
    id: Uuid,
    label: String,
    seq: i64,
    size_bytes: i32,
    created_at: DateTime<Utc>,
}

pub async fn list_versions(
    State(app): State<Shared>,
    Path(id): Path<String>,
) -> ApiResult<Json<Vec<VersionRow>>> {
    let id = parse_id(&id)?;
    let rows = sqlx::query_as::<_, VersionRow>(
        "SELECT id, label, seq, octet_length(state) AS size_bytes, created_at FROM versions WHERE file_id = $1 ORDER BY created_at DESC LIMIT 200",
    )
    .bind(id)
    .fetch_all(db(&app)?)
    .await?;
    Ok(Json(rows))
}

#[derive(Deserialize)]
pub struct NewVersion {
    label: Option<String>,
}

pub async fn create_version(
    State(app): State<Shared>,
    Path(id): Path<String>,
    Json(body): Json<NewVersion>,
) -> ApiResult<(StatusCode, Json<VersionRow>)> {
    let id = parse_id(&id)?;
    let pool = db(&app)?.clone();
    let label = clean_name(body.label.as_deref().unwrap_or("Versão salva"), 120)?;
    let room = get_room(&app, id).await?;
    let (state, _) = room.encode_state();
    release_if_idle(&app, &room);
    let seq: i64 = sqlx::query_scalar(
        "SELECT COALESCE((SELECT last_seq FROM document_states WHERE file_id = $1), 0)",
    )
    .bind(id)
    .fetch_one(&pool)
    .await?;
    let row = sqlx::query_as::<_, VersionRow>(
        "INSERT INTO versions (file_id, label, state, seq) VALUES ($1, $2, $3, $4) RETURNING id, label, seq, octet_length(state) AS size_bytes, created_at",
    )
    .bind(id)
    .bind(label)
    .bind(state)
    .bind(seq)
    .fetch_one(&pool)
    .await?;
    Ok((StatusCode::CREATED, Json(row)))
}

pub async fn get_version(
    State(app): State<Shared>,
    Path((id, vid)): Path<(String, String)>,
) -> ApiResult<Response> {
    let id = parse_id(&id)?;
    let vid = parse_id(&vid)?;
    let state: Vec<u8> =
        sqlx::query_scalar("SELECT state FROM versions WHERE id = $1 AND file_id = $2")
            .bind(vid)
            .bind(id)
            .fetch_one(db(&app)?)
            .await?;
    Ok(([(header::CONTENT_TYPE, "application/octet-stream")], state).into_response())
}

pub async fn restore_version(
    State(app): State<Shared>,
    Path((id, vid)): Path<(String, String)>,
) -> ApiResult<Json<Value>> {
    let id = parse_id(&id)?;
    let vid = parse_id(&vid)?;
    let state: Vec<u8> =
        sqlx::query_scalar("SELECT state FROM versions WHERE id = $1 AND file_id = $2")
            .bind(vid)
            .bind(id)
            .fetch_one(db(&app)?)
            .await?;
    let room = get_room(&app, id).await?;
    let diff = crate::restore::restore(&room, &state)?;
    if !diff.is_empty() {
        room.broadcast_update(room::SERVER_ORIGIN, &diff);
        let _ = room.persist.send(room::PersistCmd::Update(diff.clone()));
        room::publish_update(&app, id, diff);
    }
    release_if_idle(&app, &room);
    Ok(Json(json!({ "restored": vid })))
}

#[derive(Serialize, sqlx::FromRow)]
pub struct CommentRow {
    id: Uuid,
    parent_id: Option<Uuid>,
    page_id: String,
    node_id: Option<String>,
    x: f64,
    y: f64,
    author_name: String,
    body: String,
    resolved: bool,
    created_at: DateTime<Utc>,
}

macro_rules! comment_cols {
    () => {
        "id, parent_id, page_id, node_id, x, y, author_name, body, resolved, created_at"
    };
}

pub async fn list_comments(
    State(app): State<Shared>,
    Path(id): Path<String>,
) -> ApiResult<Json<Vec<CommentRow>>> {
    let id = parse_id(&id)?;
    let rows = sqlx::query_as::<_, CommentRow>(concat!(
        "SELECT ",
        comment_cols!(),
        " FROM comments WHERE file_id = $1 ORDER BY created_at LIMIT 2000"
    ))
    .bind(id)
    .fetch_all(db(&app)?)
    .await?;
    Ok(Json(rows))
}

#[derive(Deserialize)]
pub struct NewComment {
    parent_id: Option<Uuid>,
    page_id: String,
    node_id: Option<String>,
    x: Option<f64>,
    y: Option<f64>,
    author_name: Option<String>,
    body: String,
}

fn short_id(raw: &str) -> ApiResult<String> {
    if raw.is_empty()
        || raw.len() > 64
        || !raw
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == ':')
    {
        return Err(ApiError::BadRequest(
            "identificador de página ou nó inválido".to_string(),
        ));
    }
    Ok(raw.to_string())
}

pub async fn create_comment(
    State(app): State<Shared>,
    Path(id): Path<String>,
    Json(body): Json<NewComment>,
) -> ApiResult<(StatusCode, Json<CommentRow>)> {
    let id = parse_id(&id)?;
    let page = short_id(&body.page_id)?;
    let node = match body.node_id.as_deref() {
        Some(n) if !n.is_empty() => Some(short_id(n)?),
        _ => None,
    };
    let text = body.body.trim().to_string();
    if text.is_empty() || text.chars().count() > 4000 {
        return Err(ApiError::BadRequest(
            "o comentário precisa ter de 1 a 4000 caracteres".to_string(),
        ));
    }
    let author = clean_name(body.author_name.as_deref().unwrap_or("Anônimo"), 80)?;
    let x = body.x.unwrap_or(0.0);
    let y = body.y.unwrap_or(0.0);
    if !x.is_finite() || !y.is_finite() {
        return Err(ApiError::BadRequest("posição inválida".to_string()));
    }
    let row = sqlx::query_as::<_, CommentRow>(concat!("INSERT INTO comments (file_id, parent_id, page_id, node_id, x, y, author_name, body) SELECT $1, $2, $3, $4, $5, $6, $7, $8 WHERE $2::uuid IS NULL OR EXISTS (SELECT 1 FROM comments WHERE id = $2 AND file_id = $1) RETURNING ", comment_cols!()))
    .bind(id)
    .bind(body.parent_id)
    .bind(page)
    .bind(node)
    .bind(x)
    .bind(y)
    .bind(author)
    .bind(text)
    .fetch_one(db(&app)?)
    .await?;
    Ok((StatusCode::CREATED, Json(row)))
}

#[derive(Deserialize)]
pub struct PatchComment {
    resolved: Option<bool>,
    body: Option<String>,
}

pub async fn patch_comment(
    State(app): State<Shared>,
    Path((id, cid)): Path<(String, String)>,
    Json(body): Json<PatchComment>,
) -> ApiResult<Json<CommentRow>> {
    let id = parse_id(&id)?;
    let cid = parse_id(&cid)?;
    let text = match body.body.as_deref().map(str::trim) {
        Some(t) if t.is_empty() || t.chars().count() > 4000 => {
            return Err(ApiError::BadRequest(
                "o comentário precisa ter de 1 a 4000 caracteres".to_string(),
            ))
        }
        Some(t) => Some(t.to_string()),
        None => None,
    };
    let row = sqlx::query_as::<_, CommentRow>(concat!("UPDATE comments SET resolved = COALESCE($3, resolved), body = COALESCE($4, body) WHERE id = $2 AND file_id = $1 RETURNING ", comment_cols!()))
    .bind(id)
    .bind(cid)
    .bind(body.resolved)
    .bind(text)
    .fetch_one(db(&app)?)
    .await?;
    Ok(Json(row))
}

fn sniff_mime(data: &[u8]) -> Option<&'static str> {
    if data.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        return Some("image/png");
    }
    if data.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return Some("image/jpeg");
    }
    if data.len() > 12 && &data[0..4] == b"RIFF" && &data[8..12] == b"WEBP" {
        return Some("image/webp");
    }
    if data.starts_with(b"GIF87a") || data.starts_with(b"GIF89a") {
        return Some("image/gif");
    }
    let head = String::from_utf8_lossy(&data[..data.len().min(512)]).to_ascii_lowercase();
    let trimmed = head.trim_start_matches('\u{feff}').trim_start();
    if (trimmed.starts_with("<svg") || trimmed.starts_with("<?xml")) && head.contains("<svg") {
        return Some("image/svg+xml");
    }
    None
}

pub async fn upload_asset(
    State(app): State<Shared>,
    Path(id): Path<String>,
    body: Bytes,
) -> ApiResult<(StatusCode, Json<Value>)> {
    let id = parse_id(&id)?;
    if body.is_empty() {
        return Err(ApiError::BadRequest("arquivo vazio".to_string()));
    }
    if body.len() > MAX_ASSET_BYTES {
        return Err(ApiError::PayloadTooLarge);
    }
    let mime = sniff_mime(&body)
        .ok_or_else(|| ApiError::BadRequest("formato de imagem não aceito".to_string()))?;
    let sha = hex::encode(Sha256::digest(&body));
    let (aid,): (Uuid,) = sqlx::query_as(
        "INSERT INTO assets (file_id, sha256, mime, size_bytes, data) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (file_id, sha256) DO UPDATE SET mime = EXCLUDED.mime RETURNING id",
    )
    .bind(id)
    .bind(&sha)
    .bind(mime)
    .bind(body.len() as i32)
    .bind(body.to_vec())
    .fetch_one(db(&app)?)
    .await?;
    Ok((
        StatusCode::CREATED,
        Json(
            json!({ "id": aid, "sha256": sha, "mime": mime, "size": body.len(), "url": format!("/api/assets/{aid}") }),
        ),
    ))
}

pub async fn get_asset(State(app): State<Shared>, Path(aid): Path<String>) -> ApiResult<Response> {
    let aid = parse_id(&aid)?;
    let (mime, data): (String, Vec<u8>) =
        sqlx::query_as("SELECT mime, data FROM assets WHERE id = $1")
            .bind(aid)
            .fetch_one(db(&app)?)
            .await?;
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(&mime).map_err(|e| ApiError::Internal(e.to_string()))?,
    );
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=31536000, immutable"),
    );
    headers.insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_static("inline"),
    );
    Ok((headers, data).into_response())
}

#[derive(Serialize, Deserialize, sqlx::FromRow)]
pub struct DataSource {
    name: String,
    columns: Value,
    rows: Value,
}

pub async fn get_data_sources(
    State(app): State<Shared>,
    Path(id): Path<String>,
) -> ApiResult<Json<Vec<DataSource>>> {
    let id = parse_id(&id)?;
    let rows = sqlx::query_as::<_, DataSource>(
        "SELECT name, columns, rows FROM data_sources WHERE file_id = $1 ORDER BY name",
    )
    .bind(id)
    .fetch_all(db(&app)?)
    .await?;
    Ok(Json(rows))
}

pub async fn put_data_sources(
    State(app): State<Shared>,
    Path(id): Path<String>,
    Json(body): Json<Vec<DataSource>>,
) -> ApiResult<Json<Vec<DataSource>>> {
    let id = parse_id(&id)?;
    if body.len() > 50 {
        return Err(ApiError::BadRequest(
            "no máximo 50 fontes de dados por arquivo".to_string(),
        ));
    }
    for source in &body {
        clean_name(&source.name, 120)?;
        let cols = source
            .columns
            .as_array()
            .ok_or_else(|| ApiError::BadRequest("columns precisa ser uma lista".to_string()))?;
        let rows = source
            .rows
            .as_array()
            .ok_or_else(|| ApiError::BadRequest("rows precisa ser uma lista".to_string()))?;
        if cols.len() > 200 || rows.len() > 10_000 {
            return Err(ApiError::BadRequest(
                "fonte de dados grande demais".to_string(),
            ));
        }
    }
    let pool = db(&app)?;
    let mut tx = pool.begin().await?;
    sqlx::query("DELETE FROM data_sources WHERE file_id = $1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    for source in &body {
        sqlx::query(
            "INSERT INTO data_sources (file_id, name, columns, rows) VALUES ($1, $2, $3, $4)",
        )
        .bind(id)
        .bind(clean_name(&source.name, 120)?)
        .bind(&source.columns)
        .bind(&source.rows)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(Json(body))
}

#[derive(Deserialize)]
pub struct NewShareLink {
    role: Option<String>,
    expires_in_hours: Option<i64>,
}

pub async fn create_share_link(
    State(app): State<Shared>,
    Path(id): Path<String>,
    Json(body): Json<NewShareLink>,
) -> ApiResult<(StatusCode, Json<Value>)> {
    let id = parse_id(&id)?;
    let role = body.role.unwrap_or_else(|| "viewer".to_string());
    if !["viewer", "commenter", "editor"].contains(&role.as_str()) {
        return Err(ApiError::BadRequest(
            "papel deve ser viewer, commenter ou editor".to_string(),
        ));
    }
    let hours = body.expires_in_hours.map(|h| h.clamp(1, 24 * 365));
    let mut raw = [0u8; 32];
    raw[..16].copy_from_slice(Uuid::new_v4().as_bytes());
    raw[16..].copy_from_slice(Uuid::new_v4().as_bytes());
    let token = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(raw);
    let (expires_at,): (Option<DateTime<Utc>>,) = sqlx::query_as(
        "INSERT INTO share_links (file_id, token, role, expires_at) VALUES ($1, $2, $3::member_role, CASE WHEN $4::bigint IS NULL THEN NULL ELSE now() + make_interval(hours => $4::int) END) RETURNING expires_at",
    )
    .bind(id)
    .bind(&token)
    .bind(&role)
    .bind(hours)
    .fetch_one(db(&app)?)
    .await?;
    Ok((
        StatusCode::CREATED,
        Json(
            json!({ "token": token, "role": role, "expires_at": expires_at, "url": format!("/?file={id}&token={token}") }),
        ),
    ))
}

pub async fn presence(State(app): State<Shared>, Path(id): Path<String>) -> ApiResult<Json<Value>> {
    let id = parse_id(&id)?;
    let local = app.rooms.get(&id).map(|r| r.awareness_count()).unwrap_or(0);
    let mut shared = None;
    if let Some(redis) = &app.redis {
        let mut con = redis.clone();
        let count: Result<u64, _> = redis::cmd("HLEN")
            .arg(room::presence_key(&id))
            .query_async(&mut con)
            .await;
        shared = count.ok();
    }
    Ok(Json(
        json!({ "file": id, "here": local, "total": shared.unwrap_or(local as u64) }),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_id_accepts_only_uuids() {
        assert!(parse_id("7b0c2f5e-3d0a-4b8e-9a51-2a1f0c9d4e11").is_ok());
        assert!(parse_id("7b0c2f5e3d0a4b8e9a512a1f0c9d4e11").is_ok());
        assert!(parse_id("../../etc/passwd").is_err());
        assert!(parse_id("").is_err());
        assert!(parse_id("7b0c2f5e-3d0a-4b8e-9a51-2a1f0c9d4e1").is_err());
    }

    #[test]
    fn clean_name_trims_strips_controls_and_limits_length() {
        assert_eq!(
            clean_name("  Tela\u{0007} inicial  ", 160).unwrap(),
            "Tela inicial"
        );
        assert!(clean_name("   ", 160).is_err());
        assert!(clean_name(&"a".repeat(161), 160).is_err());
        assert!(clean_name(&"ç".repeat(160), 160).is_ok());
    }

    #[test]
    fn short_id_rejects_unsafe_characters() {
        assert!(short_id("page-1").is_ok());
        assert!(short_id("n:42_a").is_ok());
        assert!(short_id("<script>").is_err());
        assert!(short_id(&"x".repeat(65)).is_err());
    }

    #[test]
    fn sniff_mime_detects_images_by_content() {
        assert_eq!(
            sniff_mime(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0]),
            Some("image/png")
        );
        assert_eq!(sniff_mime(&[0xFF, 0xD8, 0xFF, 0xE0]), Some("image/jpeg"));
        assert_eq!(sniff_mime(b"GIF89a....."), Some("image/gif"));
        assert_eq!(
            sniff_mime(b"RIFF\x00\x00\x00\x00WEBPVP8 "),
            Some("image/webp")
        );
        assert_eq!(
            sniff_mime(b"<svg xmlns='http://www.w3.org/2000/svg'></svg>"),
            Some("image/svg+xml")
        );
        assert_eq!(sniff_mime(b"<html><script>alert(1)</script>"), None);
        assert_eq!(sniff_mime(b"MZ\x90\x00"), None);
    }
}
