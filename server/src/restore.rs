use std::collections::HashMap;

use yrs::types::ToJson;
use yrs::updates::decoder::Decode;
use yrs::{Any, Array, ArrayPrelim, Doc, Map, MapPrelim, Out, ReadTxn, Transact, Update};

use crate::room::Room;

pub const MAP_ROOTS: [&str; 6] = [
    "meta",
    "pageInfo",
    "nodes",
    "comments",
    "styles",
    "dataSources",
];
pub const ARRAY_ROOTS: [&str; 1] = ["pages"];

fn to_any<T: ReadTxn>(value: &Out, txn: &T) -> Any {
    value.to_json(txn)
}

pub fn restore(room: &Room, version_state: &[u8]) -> anyhow::Result<Vec<u8>> {
    let src = Doc::new();
    let src_maps: Vec<_> = MAP_ROOTS
        .iter()
        .map(|n| src.get_or_insert_map(*n))
        .collect();
    let src_arrays: Vec<_> = ARRAY_ROOTS
        .iter()
        .map(|n| src.get_or_insert_array(*n))
        .collect();
    {
        let mut txn = src.transact_mut();
        txn.apply_update(Update::decode_v1(version_state)?)?;
    }
    let awareness = room.awareness.lock().unwrap_or_else(|p| p.into_inner());
    let doc = awareness.doc();
    let maps: Vec<_> = MAP_ROOTS
        .iter()
        .map(|n| doc.get_or_insert_map(*n))
        .collect();
    let arrays: Vec<_> = ARRAY_ROOTS
        .iter()
        .map(|n| doc.get_or_insert_array(*n))
        .collect();
    let before = doc.transact().state_vector();
    {
        let src_txn = src.transact();
        let mut txn = doc.transact_mut();
        for (target, source) in maps.iter().zip(src_maps.iter()) {
            target.clear(&mut txn);
            for (key, value) in source.iter(&src_txn) {
                match &value {
                    Out::YMap(inner) => {
                        let entries: HashMap<String, Any> = inner
                            .iter(&src_txn)
                            .map(|(k, v)| (k.to_string(), to_any(&v, &src_txn)))
                            .collect();
                        target.insert(&mut txn, key, MapPrelim::from_iter(entries));
                    }
                    Out::YArray(inner) => {
                        let items: Vec<Any> =
                            inner.iter(&src_txn).map(|v| to_any(&v, &src_txn)).collect();
                        target.insert(&mut txn, key, ArrayPrelim::from_iter(items));
                    }
                    other => {
                        target.insert(&mut txn, key, to_any(other, &src_txn));
                    }
                }
            }
        }
        for (target, source) in arrays.iter().zip(src_arrays.iter()) {
            let len = target.len(&txn);
            if len > 0 {
                target.remove_range(&mut txn, 0, len);
            }
            for value in source.iter(&src_txn) {
                target.push_back(&mut txn, to_any(&value, &src_txn));
            }
        }
    }
    let diff = doc.transact().encode_diff_v1(&before);
    Ok(diff)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::room::Room;
    use std::sync::atomic::{AtomicU64, AtomicUsize};
    use std::sync::Mutex;
    use tokio::sync::{broadcast, mpsc};
    use yrs::sync::Awareness;
    use yrs::StateVector;

    #[test]
    fn restore_brings_back_old_content_and_drops_new_content() {
        let (tx, _) = broadcast::channel(4);
        let (persist, _) = mpsc::unbounded_channel();
        let room = Room {
            id: uuid::Uuid::new_v4(),
            awareness: Mutex::new(Awareness::new(Doc::new())),
            tx,
            conns: AtomicUsize::new(0),
            persist,
            clients_by_conn: Mutex::new(HashMap::new()),
            generation: AtomicU64::new(0),
        };
        let version = {
            let aw = room.awareness.lock().unwrap();
            let doc = aw.doc();
            let nodes = doc.get_or_insert_map("nodes");
            let pages = doc.get_or_insert_array("pages");
            {
                let mut txn = doc.transact_mut();
                nodes.insert(
                    &mut txn,
                    "n1",
                    MapPrelim::from_iter([("x".to_string(), Any::from(10))]),
                );
                pages.push_back(&mut txn, "p1");
            }
            let v = doc
                .transact()
                .encode_state_as_update_v1(&StateVector::default());
            {
                let mut txn = doc.transact_mut();
                nodes.insert(
                    &mut txn,
                    "n2",
                    MapPrelim::from_iter([("x".to_string(), Any::from(20))]),
                );
                pages.push_back(&mut txn, "p2");
            }
            v
        };
        let diff = restore(&room, &version).unwrap();
        assert!(!diff.is_empty());
        let aw = room.awareness.lock().unwrap();
        let doc = aw.doc();
        let nodes = doc.get_or_insert_map("nodes");
        let pages = doc.get_or_insert_array("pages");
        let txn = doc.transact();
        assert!(nodes.get(&txn, "n1").is_some());
        assert!(nodes.get(&txn, "n2").is_none());
        assert_eq!(pages.len(&txn), 1);
    }
}
