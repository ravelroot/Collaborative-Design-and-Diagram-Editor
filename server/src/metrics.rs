use std::fmt::Write as _;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::OnceLock;
use std::time::Instant;

use crate::state::Shared;

pub struct Metrics {
    pub ws_connections_total: AtomicU64,
    pub updates_applied_total: AtomicU64,
    pub update_bytes_total: AtomicU64,
    pub frames_rejected_total: AtomicU64,
    pub rate_limited_total: AtomicU64,
}

pub static METRICS: Metrics = Metrics {
    ws_connections_total: AtomicU64::new(0),
    updates_applied_total: AtomicU64::new(0),
    update_bytes_total: AtomicU64::new(0),
    frames_rejected_total: AtomicU64::new(0),
    rate_limited_total: AtomicU64::new(0),
};

static STARTED: OnceLock<Instant> = OnceLock::new();

pub fn mark_started() {
    STARTED.get_or_init(Instant::now);
}

pub fn inc(counter: &AtomicU64) {
    counter.fetch_add(1, Ordering::Relaxed);
}

pub fn add(counter: &AtomicU64, v: u64) {
    counter.fetch_add(v, Ordering::Relaxed);
}

fn line(out: &mut String, name: &str, kind: &str, help: &str, value: impl std::fmt::Display) {
    let _ = writeln!(out, "# HELP {name} {help}");
    let _ = writeln!(out, "# TYPE {name} {kind}");
    let _ = writeln!(out, "{name} {value}");
}

pub fn render(app: &Shared) -> String {
    let uptime = STARTED.get().map(|s| s.elapsed().as_secs()).unwrap_or(0);
    let mut connections = 0usize;
    let mut participants = 0usize;
    for room in app.rooms.iter() {
        connections += room.conns.load(Ordering::Relaxed);
        participants += room.awareness_count();
    }
    let m = &METRICS;
    let mut out = String::with_capacity(2048);
    let _ = writeln!(out, "# HELP grafo_info Versão do servidor");
    let _ = writeln!(out, "# TYPE grafo_info gauge");
    let _ = writeln!(
        out,
        "grafo_info{{version=\"{}\"}} 1",
        env!("CARGO_PKG_VERSION")
    );
    line(
        &mut out,
        "grafo_uptime_seconds",
        "gauge",
        "Segundos desde a inicialização",
        uptime,
    );
    line(
        &mut out,
        "grafo_rooms",
        "gauge",
        "Salas carregadas em memória",
        app.rooms.len(),
    );
    line(
        &mut out,
        "grafo_ws_connections",
        "gauge",
        "Conexões WebSocket abertas",
        connections,
    );
    line(
        &mut out,
        "grafo_participants",
        "gauge",
        "Pessoas presentes nas salas",
        participants,
    );
    line(
        &mut out,
        "grafo_ws_connections_total",
        "counter",
        "Conexões WebSocket aceitas",
        m.ws_connections_total.load(Ordering::Relaxed),
    );
    line(
        &mut out,
        "grafo_updates_applied_total",
        "counter",
        "Updates aplicados nas salas",
        m.updates_applied_total.load(Ordering::Relaxed),
    );
    line(
        &mut out,
        "grafo_update_bytes_total",
        "counter",
        "Bytes de updates aplicados",
        m.update_bytes_total.load(Ordering::Relaxed),
    );
    line(
        &mut out,
        "grafo_frames_rejected_total",
        "counter",
        "Mensagens WebSocket recusadas",
        m.frames_rejected_total.load(Ordering::Relaxed),
    );
    line(
        &mut out,
        "grafo_rate_limited_total",
        "counter",
        "Requisições recusadas pelo limite de taxa",
        m.rate_limited_total.load(Ordering::Relaxed),
    );
    let _ = writeln!(
        out,
        "# HELP grafo_dependency_up Serviço externo configurado e disponível"
    );
    let _ = writeln!(out, "# TYPE grafo_dependency_up gauge");
    let pg = app.db.as_ref().map(|p| !p.is_closed()).unwrap_or(false);
    let redis = app.redis.is_some();
    let nats = app
        .nats
        .as_ref()
        .map(|n| n.client.connection_state() == async_nats::connection::State::Connected)
        .unwrap_or(false);
    for (service, up) in [("postgres", pg), ("redis", redis), ("nats", nats)] {
        let _ = writeln!(
            out,
            "grafo_dependency_up{{service=\"{service}\"}} {}",
            u8::from(up)
        );
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counters_only_grow() {
        let before = METRICS.updates_applied_total.load(Ordering::Relaxed);
        inc(&METRICS.updates_applied_total);
        add(&METRICS.update_bytes_total, 10);
        assert!(METRICS.updates_applied_total.load(Ordering::Relaxed) > before);
        assert!(METRICS.update_bytes_total.load(Ordering::Relaxed) >= 10);
    }
}
