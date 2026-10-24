use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use bytes::Bytes;
use futures::StreamExt;
use redis::AsyncCommands;
use tokio::sync::{broadcast, mpsc, oneshot};
use uuid::Uuid;
use yrs::sync::{Awareness, Message, SyncMessage};
use yrs::updates::decoder::Decode;
use yrs::updates::encoder::Encode;
use yrs::{Doc, ReadTxn, StateVector, Transact, Update};

use crate::state::{Shared, INSTANCE_HEADER, STREAM_NAME};

pub const SERVER_ORIGIN: u64 = 0;

#[derive(Clone)]
pub struct Outgoing {
    pub from: u64,
    pub data: Arc<[u8]>,
}

pub enum PersistCmd {
    Update(Vec<u8>),
    Flush(oneshot::Sender<()>),
}

pub struct Room {
    pub id: Uuid,
    pub awareness: Mutex<Awareness>,
    pub tx: broadcast::Sender<Outgoing>,
    pub conns: AtomicUsize,
    pub persist: mpsc::UnboundedSender<PersistCmd>,
    pub clients_by_conn: Mutex<HashMap<u64, HashSet<yrs::ClientID>>>,
    pub generation: AtomicU64,
}

static NEXT_CONN: AtomicU64 = AtomicU64::new(1);

pub fn next_conn_id() -> u64 {
    NEXT_CONN.fetch_add(1, Ordering::Relaxed)
}

pub fn state_key(id: &Uuid) -> String {
    format!("grafo:state:{id}")
}

pub fn presence_key(id: &Uuid) -> String {
    format!("grafo:presence:{id}")
}

pub fn updates_subject(id: &Uuid) -> String {
    format!("grafo.docs.{id}.updates")
}

pub fn awareness_subject(id: &Uuid) -> String {
    format!("grafo.docs.{id}.awareness")
}

impl Room {
    pub fn encode_state(&self) -> (Vec<u8>, Vec<u8>) {
        let awareness = self.awareness.lock().unwrap_or_else(|p| p.into_inner());
        let txn = awareness.doc().transact();
        let state = txn.encode_state_as_update_v1(&StateVector::default());
        let sv = txn.state_vector().encode_v1();
        (state, sv)
    }

    pub fn state_vector(&self) -> StateVector {
        let awareness = self.awareness.lock().unwrap_or_else(|p| p.into_inner());
        let sv = awareness.doc().transact().state_vector();
        sv
    }

    pub fn diff(&self, sv: &StateVector) -> Vec<u8> {
        let awareness = self.awareness.lock().unwrap_or_else(|p| p.into_inner());
        let diff = awareness.doc().transact().encode_state_as_update_v1(sv);
        diff
    }

    pub fn apply_update(&self, payload: &[u8]) -> anyhow::Result<()> {
        let update = Update::decode_v1(payload)?;
        let awareness = self.awareness.lock().unwrap_or_else(|p| p.into_inner());
        let mut txn = awareness.doc().transact_mut();
        txn.apply_update(update)?;
        Ok(())
    }

    pub fn broadcast_update(&self, from: u64, payload: &[u8]) {
        let msg = Message::Sync(SyncMessage::Update(payload.to_vec())).encode_v1();
        let _ = self.tx.send(Outgoing {
            from,
            data: msg.into(),
        });
    }

    pub fn broadcast_raw(&self, from: u64, data: Vec<u8>) {
        let _ = self.tx.send(Outgoing {
            from,
            data: data.into(),
        });
    }

    pub fn awareness_snapshot(&self) -> Option<Vec<u8>> {
        let awareness = self.awareness.lock().unwrap_or_else(|p| p.into_inner());
        let update = awareness.update().ok()?;
        if update.clients.is_empty() {
            return None;
        }
        Some(Message::Awareness(update).encode_v1())
    }

    pub fn awareness_count(&self) -> usize {
        let awareness = self.awareness.lock().unwrap_or_else(|p| p.into_inner());
        awareness
            .iter()
            .filter(|(_, state)| state.data.is_some())
            .count()
    }
}

pub async fn get_room(app: &Shared, id: Uuid) -> anyhow::Result<Arc<Room>> {
    if let Some(room) = app.rooms.get(&id) {
        return Ok(room.clone());
    }
    let _guard = app.room_load.lock().await;
    if let Some(room) = app.rooms.get(&id) {
        return Ok(room.clone());
    }
    let doc = Doc::new();
    let mut last_seq = 0i64;
    let loaded = load_into(app, &id, &doc, &mut last_seq).await;
    if let Err(err) = loaded {
        tracing::error!(%err, file = %id, "falha ao carregar o documento");
        return Err(err);
    }
    let (tx, _) = broadcast::channel(1024);
    let (persist_tx, persist_rx) = mpsc::unbounded_channel();
    let room = Arc::new(Room {
        id,
        awareness: Mutex::new(Awareness::new(doc)),
        tx,
        conns: AtomicUsize::new(0),
        persist: persist_tx,
        clients_by_conn: Mutex::new(HashMap::new()),
        generation: AtomicU64::new(0),
    });
    tokio::spawn(persist_worker(
        app.clone(),
        room.clone(),
        persist_rx,
        last_seq,
    ));
    app.rooms.insert(id, room.clone());
    publish_awareness(app, id, Message::AwarenessQuery.encode_v1());
    tracing::info!(file = %id, "sala carregada");
    Ok(room)
}

async fn load_into(app: &Shared, id: &Uuid, doc: &Doc, last_seq: &mut i64) -> anyhow::Result<()> {
    let mut updates: Vec<Vec<u8>> = Vec::new();
    if let Some(db) = &app.db {
        sqlx::query(
            "INSERT INTO files (id, name) VALUES ($1, 'Sem título') ON CONFLICT (id) DO NOTHING",
        )
        .bind(id)
        .execute(db)
        .await?;
        let mut from_cache = false;
        if let Some(redis) = &app.redis {
            let mut con = redis.clone();
            let cached: Option<Vec<u8>> = con.get(state_key(id)).await.unwrap_or(None);
            if let Some(cached) = cached {
                if cached.len() > 8 {
                    let mut seq_bytes = [0u8; 8];
                    seq_bytes.copy_from_slice(&cached[..8]);
                    *last_seq = i64::from_be_bytes(seq_bytes);
                    updates.push(cached[8..].to_vec());
                    from_cache = true;
                }
            }
        }
        if !from_cache {
            let row: Option<(Vec<u8>, i64)> =
                sqlx::query_as("SELECT state, last_seq FROM document_states WHERE file_id = $1")
                    .bind(id)
                    .fetch_optional(db)
                    .await?;
            if let Some((state, seq)) = row {
                *last_seq = seq;
                updates.push(state);
            }
        }
        let rows: Vec<(i64, Vec<u8>)> =
            sqlx::query_as("SELECT seq, payload FROM document_updates WHERE file_id = $1 AND seq > $2 ORDER BY seq")
                .bind(id)
                .bind(*last_seq)
                .fetch_all(db)
                .await?;
        for (seq, payload) in rows {
            *last_seq = (*last_seq).max(seq);
            updates.push(payload);
        }
    } else if let Some(redis) = &app.redis {
        let mut con = redis.clone();
        let cached: Option<Vec<u8>> = con.get(state_key(id)).await.unwrap_or(None);
        if let Some(cached) = cached {
            if cached.len() > 8 {
                updates.push(cached[8..].to_vec());
            }
        }
    }
    if app.db.is_none() {
        if let Some(nats) = &app.nats {
            match replay_stream(nats, id).await {
                Ok(mut replayed) => updates.append(&mut replayed),
                Err(err) => tracing::warn!(%err, file = %id, "não foi possível reler o JetStream"),
            }
        }
    }
    let mut txn = doc.transact_mut();
    for payload in updates {
        match Update::decode_v1(&payload) {
            Ok(update) => {
                if let Err(err) = txn.apply_update(update) {
                    tracing::warn!(%err, file = %id, "update inválido ignorado ao carregar");
                }
            }
            Err(err) => tracing::warn!(%err, file = %id, "update ilegível ignorado ao carregar"),
        }
    }
    Ok(())
}

async fn replay_stream(nats: &crate::state::Nats, id: &Uuid) -> anyhow::Result<Vec<Vec<u8>>> {
    use async_nats::jetstream::consumer::{pull, AckPolicy, DeliverPolicy};
    let stream = nats.jetstream.get_stream(STREAM_NAME).await?;
    let consumer = stream
        .create_consumer(pull::Config {
            filter_subject: updates_subject(id),
            deliver_policy: DeliverPolicy::All,
            ack_policy: AckPolicy::None,
            inactive_threshold: Duration::from_secs(30),
            ..Default::default()
        })
        .await?;
    let mut out = Vec::new();
    loop {
        let mut batch = consumer
            .batch()
            .max_messages(500)
            .expires(Duration::from_millis(500))
            .messages()
            .await?;
        let mut received = 0usize;
        let mut pending = 0u64;
        while let Some(msg) = batch.next().await {
            let msg = msg.map_err(|e| anyhow::anyhow!(e.to_string()))?;
            received += 1;
            if let Ok(info) = msg.info() {
                pending = info.pending;
            }
            out.push(msg.payload.to_vec());
        }
        if received == 0 || pending == 0 {
            break;
        }
    }
    Ok(out)
}

async fn insert_update(db: &sqlx::PgPool, id: &Uuid, payload: &[u8]) -> anyhow::Result<i64> {
    let mut last_err = None;
    for _ in 0..4 {
        let res: Result<(i64,), sqlx::Error> = sqlx::query_as(
            "INSERT INTO document_updates (file_id, seq, payload) VALUES ($1, GREATEST(COALESCE((SELECT MAX(seq) FROM document_updates WHERE file_id = $1), 0), COALESCE((SELECT last_seq FROM document_states WHERE file_id = $1), 0)) + 1, $2) RETURNING seq",
        )
        .bind(id)
        .bind(payload)
        .fetch_one(db)
        .await;
        match res {
            Ok((seq,)) => return Ok(seq),
            Err(err) => {
                let unique = err
                    .as_database_error()
                    .map(|e| e.code().as_deref() == Some("23505"))
                    .unwrap_or(false);
                if !unique {
                    return Err(err.into());
                }
                last_err = Some(err);
            }
        }
    }
    Err(last_err
        .map(Into::into)
        .unwrap_or_else(|| anyhow::anyhow!("sequência em conflito")))
}

pub async fn snapshot(app: &Shared, room: &Room, last_seq: i64) -> anyhow::Result<()> {
    let (state, sv) = room.encode_state();
    if let Some(db) = &app.db {
        let mut tx = db.begin().await?;
        sqlx::query(
            "INSERT INTO document_states (file_id, state, state_vector, last_seq, updated_at) VALUES ($1, $2, $3, $4, now()) ON CONFLICT (file_id) DO UPDATE SET state = EXCLUDED.state, state_vector = EXCLUDED.state_vector, last_seq = GREATEST(document_states.last_seq, EXCLUDED.last_seq), updated_at = now()",
        )
        .bind(room.id)
        .bind(&state)
        .bind(&sv)
        .bind(last_seq)
        .execute(&mut *tx)
        .await?;
        sqlx::query("DELETE FROM document_updates WHERE file_id = $1 AND seq <= $2")
            .bind(room.id)
            .bind(last_seq)
            .execute(&mut *tx)
            .await?;
        sqlx::query("UPDATE files SET updated_at = now() WHERE id = $1")
            .bind(room.id)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
    }
    if let Some(redis) = &app.redis {
        let mut value = Vec::with_capacity(state.len() + 8);
        value.extend_from_slice(&last_seq.to_be_bytes());
        value.extend_from_slice(&state);
        let mut con = redis.clone();
        let _: Result<(), _> = con.set_ex(state_key(&room.id), value, 600).await;
    }
    Ok(())
}

async fn persist_worker(
    app: Shared,
    room: Arc<Room>,
    mut rx: mpsc::UnboundedReceiver<PersistCmd>,
    mut last_seq: i64,
) {
    let mut pending = 0i64;
    while let Some(cmd) = rx.recv().await {
        match cmd {
            PersistCmd::Update(payload) => {
                if let Some(db) = &app.db {
                    match insert_update(db, &room.id, &payload).await {
                        Ok(seq) => last_seq = last_seq.max(seq),
                        Err(err) => {
                            tracing::error!(%err, file = %room.id, "falha ao gravar update")
                        }
                    }
                }
                pending += 1;
                if pending >= app.cfg.snapshot_every {
                    match snapshot(&app, &room, last_seq).await {
                        Ok(()) => pending = 0,
                        Err(err) => tracing::error!(%err, file = %room.id, "falha ao compactar"),
                    }
                }
            }
            PersistCmd::Flush(done) => {
                if pending > 0 {
                    match snapshot(&app, &room, last_seq).await {
                        Ok(()) => pending = 0,
                        Err(err) => tracing::error!(%err, file = %room.id, "falha ao compactar"),
                    }
                }
                let _ = done.send(());
            }
        }
    }
}

pub fn publish_update(app: &Shared, id: Uuid, payload: Vec<u8>) {
    let Some(nats) = app.nats.clone() else { return };
    let instance = app.instance_id.clone();
    tokio::spawn(async move {
        let mut headers = async_nats::HeaderMap::new();
        headers.insert(INSTANCE_HEADER, instance.as_str());
        match nats
            .jetstream
            .publish_with_headers(updates_subject(&id), headers, Bytes::from(payload))
            .await
        {
            Ok(ack) => {
                if let Err(err) = ack.await {
                    tracing::warn!(%err, file = %id, "JetStream não confirmou o update");
                }
            }
            Err(err) => tracing::warn!(%err, file = %id, "falha ao publicar no JetStream"),
        }
    });
}

pub fn publish_awareness(app: &Shared, id: Uuid, payload: Vec<u8>) {
    let Some(nats) = app.nats.clone() else { return };
    let instance = app.instance_id.clone();
    tokio::spawn(async move {
        let mut headers = async_nats::HeaderMap::new();
        headers.insert(INSTANCE_HEADER, instance.as_str());
        if let Err(err) = nats
            .client
            .publish_with_headers(awareness_subject(&id), headers, Bytes::from(payload))
            .await
        {
            tracing::debug!(%err, file = %id, "falha ao publicar presença");
        }
    });
}

pub fn schedule_unload(app: Shared, room: Arc<Room>) {
    let generation = room.generation.fetch_add(1, Ordering::SeqCst) + 1;
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_secs(app.cfg.room_idle_secs)).await;
        if room.conns.load(Ordering::SeqCst) > 0
            || room.generation.load(Ordering::SeqCst) != generation
        {
            return;
        }
        let (done_tx, done_rx) = oneshot::channel();
        if room.persist.send(PersistCmd::Flush(done_tx)).is_ok() {
            let _ = tokio::time::timeout(Duration::from_secs(30), done_rx).await;
        }
        let _guard = app.room_load.lock().await;
        if room.conns.load(Ordering::SeqCst) == 0
            && room.generation.load(Ordering::SeqCst) == generation
        {
            app.rooms.remove(&room.id);
            tracing::info!(file = %room.id, "sala descarregada");
        }
    });
}

pub async fn flush_all(app: &Shared) {
    let rooms: Vec<Arc<Room>> = app.rooms.iter().map(|r| r.value().clone()).collect();
    for room in rooms {
        let (done_tx, done_rx) = oneshot::channel();
        if room.persist.send(PersistCmd::Flush(done_tx)).is_ok() {
            let _ = tokio::time::timeout(Duration::from_secs(10), done_rx).await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use yrs::Map;

    fn room() -> Room {
        let (tx, _) = broadcast::channel(16);
        let (persist, _) = mpsc::unbounded_channel();
        Room {
            id: Uuid::new_v4(),
            awareness: Mutex::new(Awareness::new(Doc::new())),
            tx,
            conns: AtomicUsize::new(0),
            persist,
            clients_by_conn: Mutex::new(HashMap::new()),
            generation: AtomicU64::new(0),
        }
    }

    fn update_with(key: &str, value: i64) -> Vec<u8> {
        let doc = Doc::new();
        let map = doc.get_or_insert_map("nodes");
        map.insert(&mut doc.transact_mut(), key, value);
        let update = doc
            .transact()
            .encode_state_as_update_v1(&StateVector::default());
        update
    }

    #[test]
    fn applying_updates_is_idempotent_and_order_independent() {
        let a = room();
        let b = room();
        let u1 = update_with("x", 1);
        let u2 = update_with("y", 2);
        a.apply_update(&u1).unwrap();
        a.apply_update(&u2).unwrap();
        a.apply_update(&u1).unwrap();
        b.apply_update(&u2).unwrap();
        b.apply_update(&u1).unwrap();
        assert_eq!(a.state_vector(), b.state_vector());
    }

    #[test]
    fn diff_against_own_state_vector_is_empty() {
        let r = room();
        r.apply_update(&update_with("x", 1)).unwrap();
        let sv = r.state_vector();
        let diff = r.diff(&sv);
        let empty = Update::decode_v1(&diff).unwrap();
        assert!(empty.state_vector().is_empty());
    }

    #[test]
    fn invalid_update_is_rejected() {
        let r = room();
        assert!(r.apply_update(&[9, 9, 9]).is_err());
        assert!(r.apply_update(&update_with("ok", 1)).is_ok());
    }

    #[test]
    fn broadcast_reaches_subscribers_with_origin() {
        let r = room();
        let mut rx = r.tx.subscribe();
        r.broadcast_update(42, &update_with("z", 3));
        let out = rx.try_recv().unwrap();
        assert_eq!(out.from, 42);
        assert!(!out.data.is_empty());
    }

    #[test]
    fn subjects_and_keys_are_scoped_by_file() {
        let id = Uuid::parse_str("7b0c2f5e-3d0a-4b8e-9a51-2a1f0c9d4e11").unwrap();
        assert_eq!(
            updates_subject(&id),
            "grafo.docs.7b0c2f5e-3d0a-4b8e-9a51-2a1f0c9d4e11.updates"
        );
        assert_eq!(
            awareness_subject(&id),
            "grafo.docs.7b0c2f5e-3d0a-4b8e-9a51-2a1f0c9d4e11.awareness"
        );
        assert_eq!(
            state_key(&id),
            "grafo:state:7b0c2f5e-3d0a-4b8e-9a51-2a1f0c9d4e11"
        );
        assert_eq!(
            presence_key(&id),
            "grafo:presence:7b0c2f5e-3d0a-4b8e-9a51-2a1f0c9d4e11"
        );
    }
}
