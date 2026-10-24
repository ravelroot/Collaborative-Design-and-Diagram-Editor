use futures::StreamExt;
use uuid::Uuid;
use yrs::encoding::read::Cursor;
use yrs::sync::{Message, MessageReader};
use yrs::updates::decoder::DecoderV1;

use crate::room::SERVER_ORIGIN;
use crate::state::{Shared, INSTANCE_HEADER};

fn file_from_subject(subject: &str) -> Option<Uuid> {
    let mut parts = subject.split('.');
    if parts.next()? != "grafo" || parts.next()? != "docs" {
        return None;
    }
    Uuid::parse_str(parts.next()?).ok()
}

pub fn spawn(app: Shared) {
    let Some(nats) = app.nats.clone() else { return };
    let updates_app = app.clone();
    let updates_client = nats.client.clone();
    tokio::spawn(async move {
        let mut sub = match updates_client.subscribe("grafo.docs.*.updates").await {
            Ok(sub) => sub,
            Err(err) => {
                tracing::error!(%err, "não foi possível assinar os updates no NATS");
                return;
            }
        };
        while let Some(msg) = sub.next().await {
            if is_own(&updates_app, &msg) {
                continue;
            }
            let Some(file) = file_from_subject(msg.subject.as_str()) else {
                continue;
            };
            let Some(room) = updates_app.rooms.get(&file).map(|r| r.clone()) else {
                continue;
            };
            match room.apply_update(&msg.payload) {
                Ok(()) => room.broadcast_update(SERVER_ORIGIN, &msg.payload),
                Err(err) => tracing::warn!(%err, %file, "update remoto inválido"),
            }
        }
    });
    let aw_app = app;
    tokio::spawn(async move {
        let mut sub = match nats.client.subscribe("grafo.docs.*.awareness").await {
            Ok(sub) => sub,
            Err(err) => {
                tracing::error!(%err, "não foi possível assinar a presença no NATS");
                return;
            }
        };
        while let Some(msg) = sub.next().await {
            if is_own(&aw_app, &msg) {
                continue;
            }
            let Some(file) = file_from_subject(msg.subject.as_str()) else {
                continue;
            };
            let Some(room) = aw_app.rooms.get(&file).map(|r| r.clone()) else {
                continue;
            };
            let mut decoder = DecoderV1::new(Cursor::new(&msg.payload));
            let reader = MessageReader::new(&mut decoder);
            let mut has_states = false;
            let mut queried = false;
            for parsed in reader.flatten() {
                match parsed {
                    Message::Awareness(update) => {
                        let mut aw = room.awareness.lock().unwrap_or_else(|p| p.into_inner());
                        let _ = aw.apply_update(update);
                        has_states = true;
                    }
                    Message::AwarenessQuery => queried = true,
                    _ => {}
                }
            }
            if has_states {
                room.broadcast_raw(SERVER_ORIGIN, msg.payload.to_vec());
            }
            if queried {
                if let Some(snapshot) = room.awareness_snapshot() {
                    crate::room::publish_awareness(&aw_app, file, snapshot);
                }
            }
        }
    });
}

fn is_own(app: &Shared, msg: &async_nats::Message) -> bool {
    msg.headers
        .as_ref()
        .and_then(|h| h.get(INSTANCE_HEADER))
        .map(|v| v.as_str() == app.instance_id)
        .unwrap_or(false)
}
