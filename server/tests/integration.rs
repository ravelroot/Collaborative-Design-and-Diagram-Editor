use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use futures::{SinkExt, StreamExt};
use grafo_server::ai::AiConfig;
use grafo_server::config::Config;
use grafo_server::state::AppState;
use tokio::sync::{mpsc, oneshot};
use tokio::task::JoinHandle;
use tokio_tungstenite::tungstenite::Message as WsMessage;
use uuid::Uuid;
use yrs::encoding::read::Cursor;
use yrs::sync::{Message, MessageReader, SyncMessage};
use yrs::updates::decoder::{Decode, DecoderV1};
use yrs::updates::encoder::Encode;
use yrs::{Doc, Map, ReadTxn, StateVector, Transact, Update};

struct TestServer {
    addr: SocketAddr,
    stop: Option<oneshot::Sender<()>>,
    handle: JoinHandle<()>,
}

impl TestServer {
    async fn start(max_update_bytes: usize) -> Self {
        Self::start_with_ai(max_update_bytes, None).await
    }

    async fn start_with_ai(max_update_bytes: usize, ai: Option<AiConfig>) -> Self {
        let cfg = Config {
            bind: "127.0.0.1:0".parse().unwrap(),
            database_url: None,
            redis_url: None,
            nats_url: None,
            static_dir: PathBuf::from("/nonexistent"),
            api_token: None,
            max_update_bytes,
            snapshot_every: 200,
            rate_limit: 120,
            room_idle_secs: 60,
            trust_proxy: false,
            ai,
        };
        let app = AppState::connect(cfg).await;
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let (stop_tx, stop_rx) = oneshot::channel::<()>();
        let handle = tokio::spawn(async move {
            let _ = grafo_server::serve(app, listener, async {
                let _ = stop_rx.await;
            })
            .await;
        });
        TestServer {
            addr,
            stop: Some(stop_tx),
            handle,
        }
    }

    async fn stop(mut self) {
        if let Some(stop) = self.stop.take() {
            let _ = stop.send(());
        }
        let _ = tokio::time::timeout(Duration::from_secs(5), &mut self.handle).await;
    }
}

struct Client {
    doc: Arc<Mutex<Doc>>,
    tx: mpsc::UnboundedSender<WsMessage>,
    reader: JoinHandle<()>,
    writer: JoinHandle<()>,
}

impl Client {
    async fn connect(addr: SocketAddr, room: Uuid) -> Client {
        Client::connect_with(addr, room, Arc::new(Mutex::new(Doc::new()))).await
    }

    async fn connect_with(addr: SocketAddr, room: Uuid, doc: Arc<Mutex<Doc>>) -> Client {
        let (ws, _) = tokio_tungstenite::connect_async(format!("ws://{addr}/ws/{room}"))
            .await
            .expect("conexão");
        let (mut sink, mut stream) = ws.split();
        let (tx, mut rx) = mpsc::unbounded_channel::<WsMessage>();
        let writer = tokio::spawn(async move {
            while let Some(msg) = rx.recv().await {
                if sink.send(msg).await.is_err() {
                    break;
                }
            }
            let _ = sink.close().await;
        });
        let reader_doc = doc.clone();
        let reply = tx.clone();
        let reader = tokio::spawn(async move {
            while let Some(Ok(msg)) = stream.next().await {
                let WsMessage::Binary(data) = msg else {
                    continue;
                };
                let mut decoder = DecoderV1::new(Cursor::new(&data));
                for parsed in MessageReader::new(&mut decoder).flatten() {
                    match parsed {
                        Message::Sync(SyncMessage::SyncStep1(sv)) => {
                            let diff = {
                                let d = reader_doc.lock().unwrap();
                                let out = d.transact().encode_state_as_update_v1(&sv);
                                out
                            };
                            let msg = Message::Sync(SyncMessage::SyncStep2(diff)).encode_v1();
                            let _ = reply.send(WsMessage::Binary(msg.into()));
                        }
                        Message::Sync(SyncMessage::SyncStep2(u))
                        | Message::Sync(SyncMessage::Update(u)) => {
                            let d = reader_doc.lock().unwrap();
                            let mut txn = d.transact_mut();
                            if let Ok(update) = Update::decode_v1(&u) {
                                let _ = txn.apply_update(update);
                            }
                        }
                        _ => {}
                    }
                }
            }
        });
        let sv = {
            let d = doc.lock().unwrap();
            let sv = d.transact().state_vector();
            sv
        };
        let step1 = Message::Sync(SyncMessage::SyncStep1(sv)).encode_v1();
        tx.send(WsMessage::Binary(step1.into())).unwrap();
        Client {
            doc,
            tx,
            reader,
            writer,
        }
    }

    fn insert(&self, key: &str, value: i64) {
        let diff = {
            let d = self.doc.lock().unwrap();
            let map = d.get_or_insert_map("nodes");
            let before = d.transact().state_vector();
            {
                let mut txn = d.transact_mut();
                map.insert(&mut txn, key, value);
            }
            let diff = d.transact().encode_diff_v1(&before);
            diff
        };
        let msg = Message::Sync(SyncMessage::Update(diff)).encode_v1();
        let _ = self.tx.send(WsMessage::Binary(msg.into()));
    }

    fn send_raw(&self, data: Vec<u8>) {
        let _ = self.tx.send(WsMessage::Binary(data.into()));
    }

    fn keys(&self) -> Vec<String> {
        let d = self.doc.lock().unwrap();
        let map = d.get_or_insert_map("nodes");
        let txn = d.transact();
        let mut keys: Vec<String> = map.keys(&txn).map(|k| k.to_string()).collect();
        keys.sort();
        keys
    }

    fn is_closed(&self) -> bool {
        self.reader.is_finished()
    }

    async fn close(self) -> Arc<Mutex<Doc>> {
        let _ = self.tx.send(WsMessage::Close(None));
        self.reader.abort();
        let _ = self.reader.await;
        drop(self.tx);
        let _ = tokio::time::timeout(Duration::from_secs(2), self.writer).await;
        self.doc
    }
}

async fn wait_until<F: Fn() -> bool>(timeout: Duration, check: F) -> bool {
    let start = Instant::now();
    while start.elapsed() < timeout {
        if check() {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    check()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn two_clients_converge() {
    let server = TestServer::start(1 << 20).await;
    let room = Uuid::new_v4();
    let a = Client::connect(server.addr, room).await;
    let b = Client::connect(server.addr, room).await;
    tokio::time::sleep(Duration::from_millis(100)).await;
    a.insert("a", 1);
    b.insert("b", 2);
    let expected = vec!["a".to_string(), "b".to_string()];
    assert!(
        wait_until(Duration::from_secs(5), || a.keys() == expected
            && b.keys() == expected)
        .await
    );
    a.close().await;
    b.close().await;
    server.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn reconnecting_client_catches_up_both_ways() {
    let server = TestServer::start(1 << 20).await;
    let room = Uuid::new_v4();
    let a = Client::connect(server.addr, room).await;
    let b = Client::connect(server.addr, room).await;
    a.insert("first", 1);
    assert!(
        wait_until(Duration::from_secs(5), || b.keys()
            == vec!["first".to_string()])
        .await
    );
    let b_doc = b.close().await;
    for i in 0..25 {
        a.insert(&format!("missed-{i:02}"), i);
    }
    {
        let d = b_doc.lock().unwrap();
        let map = d.get_or_insert_map("nodes");
        let mut txn = d.transact_mut();
        map.insert(&mut txn, "offline-edit", 99);
    }
    let b = Client::connect_with(server.addr, room, b_doc).await;
    assert!(
        wait_until(Duration::from_secs(5), || b.keys().len() == 27
            && a.keys().len() == 27)
        .await,
        "a={:?} b={:?}",
        a.keys().len(),
        b.keys().len()
    );
    assert_eq!(a.keys(), b.keys());
    a.close().await;
    b.close().await;
    server.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn malformed_and_oversized_messages_do_not_break_the_room() {
    let max = 65_536;
    let server = TestServer::start(max).await;
    let room = Uuid::new_v4();
    let a = Client::connect(server.addr, room).await;
    let b = Client::connect(server.addr, room).await;
    a.insert("before", 1);
    assert!(wait_until(Duration::from_secs(5), || b.keys().len() == 1).await);

    let attacker = Client::connect(server.addr, room).await;
    attacker.send_raw(vec![0xFF, 0xFF, 0xFF, 0xFF, 0x0F]);
    attacker.send_raw(vec![0, 2, 50, 1, 2, 3]);
    attacker.send_raw(vec![0, 7, 1, 1]);
    attacker.send_raw(vec![1, 200, 1, 9]);
    attacker.send_raw(Vec::new());
    let mut garbage_update = Message::Sync(SyncMessage::Update(vec![9; 64])).encode_v1();
    garbage_update.truncate(40);
    attacker.send_raw(garbage_update);
    tokio::time::sleep(Duration::from_millis(200)).await;

    let oversized = Client::connect(server.addr, room).await;
    oversized.send_raw(Message::Sync(SyncMessage::Update(vec![0; max * 2])).encode_v1());
    assert!(
        wait_until(Duration::from_secs(5), || oversized.is_closed()).await,
        "conexão com mensagem grande demais deveria ser fechada"
    );

    b.insert("after", 2);
    let late = Client::connect(server.addr, room).await;
    let expected = vec!["after".to_string(), "before".to_string()];
    assert!(
        wait_until(Duration::from_secs(5), || a.keys() == expected
            && b.keys() == expected
            && late.keys() == expected)
        .await
    );
    let health = reqwest_like_health(server.addr).await;
    assert!(health.contains("\"status\":\"ok\""), "{health}");
    for c in [a, b, attacker, oversized, late] {
        c.close().await;
    }
    server.stop().await;
}

async fn reqwest_like_health(addr: SocketAddr) -> String {
    raw_get(addr, "/api/health").await
}

async fn raw_post(addr: SocketAddr, path: &str, body: &str) -> String {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let mut stream = tokio::net::TcpStream::connect(addr).await.unwrap();
    let req = format!(
        "POST {path} HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    stream.write_all(req.as_bytes()).await.unwrap();
    let mut buf = Vec::new();
    stream.read_to_end(&mut buf).await.unwrap();
    String::from_utf8_lossy(&buf).to_string()
}

async fn raw_get(addr: SocketAddr, path: &str) -> String {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let mut stream = tokio::net::TcpStream::connect(addr).await.unwrap();
    let req = format!("GET {path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
    stream.write_all(req.as_bytes()).await.unwrap();
    let mut buf = Vec::new();
    stream.read_to_end(&mut buf).await.unwrap();
    String::from_utf8_lossy(&buf).to_string()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn load_fifty_clients_in_one_room() {
    let server = TestServer::start(1 << 20).await;
    let room = Uuid::new_v4();
    let clients_n = 50;
    let started = Instant::now();
    let mut clients = Vec::with_capacity(clients_n);
    for _ in 0..clients_n {
        clients.push(Client::connect(server.addr, room).await);
    }
    let connected = started.elapsed();
    tokio::time::sleep(Duration::from_millis(200)).await;
    let edits = Instant::now();
    for (i, c) in clients.iter().enumerate() {
        c.insert(&format!("k{i:03}"), i as i64);
    }
    let ok = wait_until(Duration::from_secs(30), || {
        clients.iter().all(|c| c.keys().len() == clients_n)
    })
    .await;
    let converged = edits.elapsed();
    println!(
        "carga sala única: {clients_n} clientes conectados em {:?}; {clients_n} updates ({} entregas) convergiram em {:?}",
        connected,
        clients_n * (clients_n - 1),
        converged
    );
    assert!(ok, "nem todos os clientes convergiram");
    let reference = clients[0].keys();
    assert!(clients.iter().all(|c| c.keys() == reference));
    for c in clients {
        c.close().await;
    }
    server.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn load_twenty_parallel_rooms() {
    let server = TestServer::start(1 << 20).await;
    let rooms_n = 20;
    let per_room = 5;
    let edits_per_client = 10;
    let started = Instant::now();
    let mut tasks = Vec::new();
    for _ in 0..rooms_n {
        let addr = server.addr;
        tasks.push(tokio::spawn(async move {
            let room = Uuid::new_v4();
            let mut clients = Vec::new();
            for _ in 0..per_room {
                clients.push(Client::connect(addr, room).await);
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
            for (ci, c) in clients.iter().enumerate() {
                for e in 0..edits_per_client {
                    c.insert(&format!("c{ci}-e{e}"), e as i64);
                }
            }
            let total = per_room * edits_per_client;
            let ok = wait_until(Duration::from_secs(30), || {
                clients.iter().all(|c| c.keys().len() == total)
            })
            .await;
            let converged = started.elapsed();
            let same = clients.iter().all(|c| c.keys() == clients[0].keys());
            for c in clients {
                c.close().await;
            }
            (ok && same, converged)
        }));
    }
    let mut all_ok = true;
    let mut elapsed = Duration::ZERO;
    for t in tasks {
        let (ok, converged) = t.await.unwrap();
        all_ok &= ok;
        elapsed = elapsed.max(converged);
    }
    println!(
        "carga salas paralelas: {rooms_n} salas x {per_room} clientes x {edits_per_client} updates ({} updates, {} entregas) convergiram em {:?}",
        rooms_n * per_room * edits_per_client,
        rooms_n * per_room * edits_per_client * (per_room - 1),
        elapsed
    );
    assert!(all_ok, "alguma sala não convergiu");
    server.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn invalid_room_id_is_rejected() {
    let server = TestServer::start(1 << 20).await;
    let res = tokio_tungstenite::connect_async(format!("ws://{}/ws/nao-e-uuid", server.addr)).await;
    assert!(res.is_err());
    let doc = Doc::new();
    let sv = doc.transact().state_vector();
    assert_eq!(sv, StateVector::default());
    server.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn metrics_report_rooms_connections_and_updates() {
    let server = TestServer::start(1 << 20).await;
    let room = Uuid::new_v4();
    let a = Client::connect(server.addr, room).await;
    let b = Client::connect(server.addr, room).await;
    a.insert("k", 1);
    assert!(
        wait_until(Duration::from_secs(5), || b
            .keys()
            .contains(&"k".to_string()))
        .await
    );
    let body = raw_get(server.addr, "/api/metrics").await;
    assert!(body.contains("200 OK"), "{body}");
    assert!(body.contains("text/plain; version=0.0.4"));
    assert!(body.contains("grafo_rooms 1"));
    assert!(body.contains("grafo_ws_connections 2"));
    let applied = body
        .lines()
        .find_map(|l| l.strip_prefix("grafo_updates_applied_total "))
        .and_then(|v| v.trim().parse::<u64>().ok())
        .unwrap_or(0);
    assert!(applied >= 1);
    assert!(body.contains("grafo_dependency_up{service=\"postgres\"} 0"));
    a.close().await;
    b.close().await;
    server.stop().await;
}

async fn mock_provider() -> (SocketAddr, Arc<Mutex<Vec<(String, serde_json::Value)>>>) {
    use axum::routing::post;
    let seen: Arc<Mutex<Vec<(String, serde_json::Value)>>> = Arc::new(Mutex::new(Vec::new()));
    let log = seen.clone();
    let app = axum::Router::new().route(
        "/v1/messages",
        post(move |headers: axum::http::HeaderMap, body: axum::Json<serde_json::Value>| {
            let log = log.clone();
            async move {
                let key = headers.get("x-api-key").and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
                log.lock().unwrap().push((key, body.0.clone()));
                axum::Json(serde_json::json!({
                    "content": [{ "type": "tool_use", "name": "criar_diagrama", "input": { "title": "Banco", "nodes": [{ "id": "a", "shape": "umlClass" }], "edges": [] } }],
                    "model": body.0["model"],
                    "max_tokens_seen": body.0["max_tokens"]
                }))
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });
    (addr, seen)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn ai_proxy_injects_key_forces_model_and_limits_rate() {
    let off = TestServer::start(1 << 20).await;
    assert!(raw_get(off.addr, "/api/ai/status")
        .await
        .contains("\"enabled\":false"));
    let refused = raw_post(off.addr, "/api/ai/request", r#"{"body":{"messages":[]}}"#).await;
    assert!(refused.starts_with("HTTP/1.1 503"), "{refused}");
    off.stop().await;

    let (provider, seen) = mock_provider().await;
    let ai = AiConfig::from_vars(|k| match k {
        "GRAFO_AI_PROVIDER" => Some("anthropic".to_string()),
        "GRAFO_AI_API_KEY" => Some("chave-secreta".to_string()),
        "GRAFO_AI_BASE_URL" => Some(format!("http://{provider}")),
        "GRAFO_AI_MODEL" => Some("modelo-do-servidor".to_string()),
        "GRAFO_AI_MAX_TOKENS" => Some("1000".to_string()),
        "GRAFO_AI_RATE_LIMIT" => Some("2".to_string()),
        _ => None,
    })
    .unwrap();
    let server = TestServer::start_with_ai(1 << 20, ai).await;
    let status = raw_get(server.addr, "/api/ai/status").await;
    assert!(status.contains("\"enabled\":true"), "{status}");
    assert!(status.contains("modelo-do-servidor"));
    assert!(!status.contains("chave-secreta"));
    let bad = raw_post(server.addr, "/api/ai/request", r#"{"body":[1,2]}"#).await;
    assert!(bad.starts_with("HTTP/1.1 400"), "{bad}");
    let ok = raw_post(server.addr, "/api/ai/request", r#"{"body":{"model":"outro","max_tokens":99999,"messages":[{"role":"user","content":"banco"}]}}"#).await;
    assert!(ok.starts_with("HTTP/1.1 200"), "{ok}");
    assert!(ok.contains("tool_use"));
    assert!(!ok.contains("chave-secreta"));
    {
        let log = seen.lock().unwrap();
        assert_eq!(log.len(), 1);
        assert_eq!(log[0].0, "chave-secreta");
        assert_eq!(log[0].1["model"], "modelo-do-servidor");
        assert_eq!(log[0].1["max_tokens"], 1000);
    }
    let limited = raw_post(
        server.addr,
        "/api/ai/request",
        r#"{"body":{"messages":[]}}"#,
    )
    .await;
    assert!(limited.starts_with("HTTP/1.1 429"), "{limited}");
    let metrics = raw_get(server.addr, "/api/metrics").await;
    assert!(metrics.contains("grafo_ai_enabled 1"));
    server.stop().await;
}
