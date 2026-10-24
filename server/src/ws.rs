use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;

use axum::extract::ws::{CloseFrame, Message as WsMessage, WebSocket, WebSocketUpgrade};
use axum::extract::{ConnectInfo, Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use futures::{SinkExt, StreamExt};
use redis::AsyncCommands;
use serde::Deserialize;
use tokio::sync::{broadcast, mpsc};
use uuid::Uuid;
use yrs::encoding::read::Cursor;
use yrs::sync::{Message, MessageReader, SyncMessage};
use yrs::updates::decoder::DecoderV1;
use yrs::updates::encoder::Encode;
use yrs::ClientID;

use crate::room::{self, get_room, presence_key, Room};
use crate::security::{client_ip, constant_time_eq};
use crate::state::Shared;

#[derive(Deserialize)]
pub struct WsQuery {
    token: Option<String>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Access {
    Edit,
    Read,
}

async fn resolve_access(app: &Shared, file: &Uuid, token: Option<&str>) -> Option<Access> {
    let Some(expected) = &app.cfg.api_token else {
        return Some(Access::Edit);
    };
    let token = token?;
    if constant_time_eq(token.as_bytes(), expected.as_bytes()) {
        return Some(Access::Edit);
    }
    let db = app.db.as_ref()?;
    let row: Option<(String,)> = sqlx::query_as(
        "SELECT role::text FROM share_links WHERE file_id = $1 AND token = $2 AND (expires_at IS NULL OR expires_at > now())",
    )
    .bind(file)
    .bind(token)
    .fetch_optional(db)
    .await
    .ok()?;
    match row?.0.as_str() {
        "editor" => Some(Access::Edit),
        _ => Some(Access::Read),
    }
}

pub async fn handler(
    State(app): State<Shared>,
    Path(file): Path<String>,
    Query(query): Query<WsQuery>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Response {
    let Ok(file) = Uuid::parse_str(&file) else {
        return (StatusCode::BAD_REQUEST, "identificador de arquivo inválido").into_response();
    };
    let Some(access) = resolve_access(&app, &file, query.token.as_deref()).await else {
        return (StatusCode::UNAUTHORIZED, "token ausente ou inválido").into_response();
    };
    let ip = client_ip(&app, &headers, addr);
    let room = match get_room(&app, file).await {
        Ok(room) => room,
        Err(_) => {
            return (StatusCode::SERVICE_UNAVAILABLE, "documento indisponível").into_response()
        }
    };
    let max = app.cfg.max_update_bytes;
    ws.max_message_size(max)
        .max_frame_size(max)
        .on_upgrade(move |socket| run(app, room, socket, access, ip))
}

async fn run(app: Shared, room: Arc<Room>, socket: WebSocket, access: Access, ip: String) {
    let conn = room::next_conn_id();
    room.conns.fetch_add(1, Ordering::SeqCst);
    room.generation.fetch_add(1, Ordering::SeqCst);
    tracing::debug!(file = %room.id, conn, %ip, "conexão aberta");
    let (mut sink, mut stream) = socket.split();
    let (out_tx, mut out_rx) = mpsc::channel::<WsMessage>(256);
    let mut rx = room.tx.subscribe();

    let writer = tokio::spawn(async move {
        loop {
            tokio::select! {
                direct = out_rx.recv() => {
                    match direct {
                        Some(msg) => {
                            let closing = matches!(msg, WsMessage::Close(_));
                            if sink.send(msg).await.is_err() || closing { break; }
                        }
                        None => break,
                    }
                }
                shared = rx.recv() => {
                    match shared {
                        Ok(out) => {
                            if out.from == conn { continue; }
                            if sink.send(WsMessage::Binary(out.data.to_vec().into())).await.is_err() { break; }
                        }
                        Err(broadcast::error::RecvError::Lagged(_)) => {
                            let _ = sink.send(WsMessage::Close(Some(CloseFrame { code: 4000, reason: "sincronização atrasada".into() }))).await;
                            break;
                        }
                        Err(broadcast::error::RecvError::Closed) => break,
                    }
                }
            }
        }
        let _ = sink.close().await;
    });

    let step1 = Message::Sync(SyncMessage::SyncStep1(room.state_vector())).encode_v1();
    let _ = out_tx.send(WsMessage::Binary(step1.into())).await;
    if let Some(aw) = room.awareness_snapshot() {
        let _ = out_tx.send(WsMessage::Binary(aw.into())).await;
    }

    let idle = Duration::from_secs(120);
    loop {
        let next = tokio::time::timeout(idle, stream.next()).await;
        let msg = match next {
            Ok(Some(Ok(msg))) => msg,
            _ => break,
        };
        match msg {
            WsMessage::Binary(data) => {
                if let Err(err) = handle_frame(&app, &room, conn, access, &data, &out_tx).await {
                    tracing::debug!(%err, conn, "mensagem recusada");
                }
            }
            WsMessage::Ping(p) => {
                let _ = out_tx.send(WsMessage::Pong(p)).await;
            }
            WsMessage::Close(_) => break,
            _ => {}
        }
    }

    drop(out_tx);
    let _ = writer.await;
    disconnect(&app, &room, conn).await;
}

async fn handle_frame(
    app: &Shared,
    room: &Arc<Room>,
    conn: u64,
    access: Access,
    data: &[u8],
    out: &mpsc::Sender<WsMessage>,
) -> anyhow::Result<()> {
    let mut decoder = DecoderV1::new(Cursor::new(data));
    let reader = MessageReader::new(&mut decoder);
    for msg in reader {
        match msg? {
            Message::Sync(SyncMessage::SyncStep1(sv)) => {
                let diff = room.diff(&sv);
                let reply = Message::Sync(SyncMessage::SyncStep2(diff)).encode_v1();
                out.send(WsMessage::Binary(reply.into())).await?;
            }
            Message::Sync(SyncMessage::SyncStep2(update))
            | Message::Sync(SyncMessage::Update(update)) => {
                if access != Access::Edit {
                    continue;
                }
                if update.len() > app.cfg.max_update_bytes {
                    anyhow::bail!("update grande demais");
                }
                if is_empty_update(&update) {
                    continue;
                }
                room.apply_update(&update)?;
                room.broadcast_update(conn, &update);
                let _ = room.persist.send(room::PersistCmd::Update(update.clone()));
                room::publish_update(app, room.id, update);
            }
            Message::Awareness(update) => {
                let ids: Vec<ClientID> = update.clients.keys().copied().collect();
                let encoded = Message::Awareness(update.clone()).encode_v1();
                {
                    let mut aw = room.awareness.lock().unwrap_or_else(|p| p.into_inner());
                    aw.apply_update(update.clone())?;
                }
                {
                    let mut map = room
                        .clients_by_conn
                        .lock()
                        .unwrap_or_else(|p| p.into_inner());
                    let entry = map.entry(conn).or_default();
                    for (id, entry_state) in &update.clients {
                        if entry_state.json.as_ref() == "null" {
                            entry.remove(id);
                        } else {
                            entry.insert(*id);
                        }
                    }
                }
                room.broadcast_raw(conn, encoded.clone());
                room::publish_awareness(app, room.id, encoded);
                record_presence(app, room, &update.clients, &ids).await;
            }
            Message::AwarenessQuery => {
                if let Some(aw) = room.awareness_snapshot() {
                    out.send(WsMessage::Binary(aw.into())).await?;
                }
            }
            Message::Auth(_) | Message::Custom(_, _) => {}
        }
    }
    Ok(())
}

fn is_empty_update(update: &[u8]) -> bool {
    update == [0, 0]
}

async fn record_presence(
    app: &Shared,
    room: &Room,
    clients: &HashMap<ClientID, yrs::sync::awareness::AwarenessUpdateEntry>,
    ids: &[ClientID],
) {
    let Some(redis) = &app.redis else { return };
    let mut con = redis.clone();
    let key = presence_key(&room.id);
    for id in ids {
        if let Some(entry) = clients.get(id) {
            let field = id.to_string();
            if entry.json.as_ref() == "null" {
                let _: Result<(), _> = con.hdel(&key, &field).await;
            } else {
                let _: Result<(), _> = con.hset(&key, &field, entry.json.as_ref()).await;
            }
        }
    }
    let _: Result<(), _> = con.expire(&key, 60).await;
}

async fn disconnect(app: &Shared, room: &Arc<Room>, conn: u64) {
    let ids: Vec<ClientID> = {
        let mut map = room
            .clients_by_conn
            .lock()
            .unwrap_or_else(|p| p.into_inner());
        map.remove(&conn)
            .map(|s| s.into_iter().collect())
            .unwrap_or_default()
    };
    if !ids.is_empty() {
        let removal = {
            let mut aw = room.awareness.lock().unwrap_or_else(|p| p.into_inner());
            for id in &ids {
                aw.remove_state(*id);
            }
            aw.update_with_clients(ids.clone()).ok()
        };
        if let Some(update) = removal {
            let clients = update.clients.clone();
            let encoded = Message::Awareness(update).encode_v1();
            room.broadcast_raw(conn, encoded.clone());
            room::publish_awareness(app, room.id, encoded);
            record_presence(app, room, &clients, &ids).await;
        }
    }
    let left = room.conns.fetch_sub(1, Ordering::SeqCst) - 1;
    tracing::debug!(file = %room.id, conn, left, "conexão fechada");
    if left == 0 {
        room::schedule_unload(app.clone(), room.clone());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use yrs::{Doc, Map, ReadTxn, StateVector, Transact};

    #[test]
    fn empty_update_is_detected() {
        assert!(is_empty_update(&[0, 0]));
        assert!(!is_empty_update(&[0, 0, 1]));
    }

    #[test]
    fn sync_messages_round_trip() {
        let doc = Doc::new();
        let map = doc.get_or_insert_map("nodes");
        map.insert(&mut doc.transact_mut(), "n1", 7);
        let sv = doc.transact().state_vector();
        let update = doc
            .transact()
            .encode_state_as_update_v1(&StateVector::default());
        for msg in [
            Message::Sync(SyncMessage::SyncStep1(sv)),
            Message::Sync(SyncMessage::SyncStep2(update.clone())),
            Message::Sync(SyncMessage::Update(update)),
            Message::AwarenessQuery,
        ] {
            let encoded = msg.encode_v1();
            let decoded = yrs::updates::decoder::Decode::decode_v1(&encoded).unwrap();
            assert_eq!(msg, decoded);
        }
    }

    #[test]
    fn several_messages_in_one_frame_are_all_read() {
        let mut frame = Message::AwarenessQuery.encode_v1();
        frame.extend(Message::Sync(SyncMessage::SyncStep1(StateVector::default())).encode_v1());
        let mut decoder = DecoderV1::new(Cursor::new(&frame));
        let parsed: Vec<_> = MessageReader::new(&mut decoder).collect();
        assert_eq!(parsed.len(), 2);
        assert!(parsed.iter().all(|m| m.is_ok()));
    }

    #[test]
    fn garbage_frames_produce_errors_not_panics() {
        for frame in [
            vec![0xFF, 0xFF, 0xFF, 0xFF, 0x0F],
            vec![0, 7, 1],
            vec![1, 200, 1],
            vec![0, 2, 50, 1],
        ] {
            let mut decoder = DecoderV1::new(Cursor::new(&frame));
            let parsed: Vec<_> = MessageReader::new(&mut decoder).collect();
            assert!(parsed.iter().any(|m| m.is_err()) || parsed.is_empty());
        }
    }
}
