import * as Y from 'yjs';
import { Awareness, encodeAwarenessUpdate, applyAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';
import { WebsocketProvider } from 'y-websocket';
import { uid, debounce, storage, randomUser } from './util.js';

export const LOCAL = Symbol('local');
const REMOTE_BC = 'bc';

const idb = (() => {
  let dbp = null;
  const open = () => {
    if (dbp) return dbp;
    dbp = new Promise((resolve) => {
      try {
        const req = indexedDB.open('grafo', 2);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('docs')) db.createObjectStore('docs');
          if (!db.objectStoreNames.contains('versions')) db.createObjectStore('versions', { keyPath: 'id' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    return dbp;
  };
  const run = async (store, mode, fn) => {
    const db = await open();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(store, mode);
        const req = fn(tx.objectStore(store));
        tx.oncomplete = () => resolve(req ? req.result : null);
        tx.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  };
  return {
    get: (store, key) => run(store, 'readonly', (s) => s.get(key)),
    put: (store, value, key) => run(store, 'readwrite', (s) => (key === undefined ? s.put(value) : s.put(value, key))),
    del: (store, key) => run(store, 'readwrite', (s) => s.delete(key)),
    all: (store) => run(store, 'readonly', (s) => s.getAll()),
    keys: (store) => run(store, 'readonly', (s) => s.getAllKeys()),
  };
})();

export const NODE_DEFAULTS = {
  rotation: 0,
  opacity: 1,
  visible: true,
  locked: false,
  blend: 'normal',
};

export class Store {
  constructor(fileId) {
    this.fileId = fileId;
    this.doc = new Y.Doc();
    this.meta = this.doc.getMap('meta');
    this.pages = this.doc.getArray('pages');
    this.pageInfo = this.doc.getMap('pageInfo');
    this.nodesY = this.doc.getMap('nodes');
    this.commentsY = this.doc.getMap('comments');
    this.stylesY = this.doc.getMap('styles');
    this.dataY = this.doc.getMap('dataSources');
    this.assetsY = this.doc.getMap('assets');
    this.nodes = new Map();
    this.ver = new Map();
    this.kidIndex = null;
    this.listeners = new Set();
    this.structureVersion = 0;
    this.version = 0;
    this.user = storage.get('user', null) || randomUser();
    storage.set('user', this.user);
    this.awareness = new Awareness(this.doc);
    this.awareness.setLocalStateField('user', this.user);
    this.provider = null;
    this.online = false;
    this.mode = 'local';
    this.nodesY.observeDeep((events) => this.onNodes(events));
    const touch = () => this.emit({ structure: true });
    this.pages.observe(touch);
    this.pageInfo.observeDeep(touch);
    this.commentsY.observeDeep(() => this.emit({ comments: true }));
    this.stylesY.observeDeep(() => this.emit({ styles: true }));
    this.dataY.observeDeep(() => this.emit({ data: true }));
    this.assetsY.observe(() => this.emit({ assets: true }));
    this.meta.observe(() => this.emit({ meta: true }));
    this.undo = new Y.UndoManager([this.nodesY, this.pages, this.pageInfo, this.commentsY, this.stylesY, this.dataY], { trackedOrigins: new Set([LOCAL]), captureTimeout: 400 });
    this.saveLocal = debounce(() => this.persist(), 500);
    this.doc.on('update', () => this.saveLocal());
  }

  onNodes(events) {
    let structure = false;
    const changed = new Set();
    for (const e of events) {
      if (e.target === this.nodesY) {
        for (const [key, change] of e.changes.keys) {
          structure = true;
          if (change.action === 'delete') this.nodes.delete(key);
          else this.nodes.set(key, this.nodesY.get(key).toJSON());
          this.touch(key, true);
          changed.add(key);
        }
      } else {
        const ymap = e.target;
        const id = ymap.get('id');
        if (!id) continue;
        this.nodes.set(id, ymap.toJSON());
        changed.add(id);
        let st = false;
        for (const k of e.keysChanged) if (k === 'parent' || k === 'z' || k === 'page' || k === 'type') st = true;
        if (st) structure = true;
        this.touch(id, st);
      }
    }
    if (structure) this.structureVersion++;
    this.version++;
    this.emit({ nodes: changed, structure });
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(info) {
    for (const fn of this.listeners) fn(info);
  }

  transact(fn, origin = LOCAL) {
    let result;
    this.doc.transact(() => {
      result = fn();
    }, origin);
    return result;
  }

  get(id) {
    return id ? this.nodes.get(id) : undefined;
  }

  add(node) {
    const n = { ...NODE_DEFAULTS, ...node };
    if (!n.id) n.id = uid();
    if (n.z === undefined) n.z = this.nextZ(n.parent || null, n.page);
    const m = new Y.Map();
    for (const [k, v] of Object.entries(n)) if (v !== undefined) m.set(k, v);
    this.nodesY.set(n.id, m);
    const clean = {};
    for (const [k, v] of Object.entries(n)) if (v !== undefined) clean[k] = v;
    this.nodes.set(n.id, clean);
    this.touch(n.id, true);
    return n.id;
  }

  update(id, patch) {
    const m = this.nodesY.get(id);
    if (!m) return;
    const mirror = this.nodes.get(id);
    const next = mirror ? { ...mirror } : null;
    for (const [k, v] of Object.entries(patch)) {
      if (next) {
        if (v === undefined) delete next[k];
        else next[k] = v;
      }
      if (v === undefined) {
        if (m.has(k)) m.delete(k);
        continue;
      }
      const cur = m.get(k);
      if (cur === v) continue;
      if (typeof v === 'object' && v !== null && JSON.stringify(cur) === JSON.stringify(v)) continue;
      m.set(k, v);
    }
    if (next) this.nodes.set(id, next);
    this.touch(id, 'parent' in patch || 'z' in patch || 'page' in patch || 'type' in patch);
  }

  remove(ids) {
    const all = new Set();
    const walk = (id) => {
      if (all.has(id)) return;
      all.add(id);
      for (const c of this.childrenOf(id)) walk(c.id);
    };
    for (const id of ids) walk(id);
    for (const n of this.nodes.values()) {
      if (n.type !== 'connector' || all.has(n.id)) continue;
      for (const end of ['from', 'to']) {
        const e = n[end];
        if (e && e.node && all.has(e.node)) {
          const p = this.anchorPoint ? this.anchorPoint(e) : { x: e.x || 0, y: e.y || 0 };
          this.update(n.id, { [end]: { x: p.x, y: p.y } });
        }
      }
    }
    for (const id of all) {
      this.nodesY.delete(id);
      this.nodes.delete(id);
      this.touch(id, true);
    }
  }

  childrenOf(parent, page) {
    if (!parent && page === undefined) {
      const out = [];
      for (const n of this.nodes.values()) if (!n.parent) out.push(n);
      return out.sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : 1));
    }
    if (!this.kidIndex) {
      const idx = new Map();
      for (const n of this.nodes.values()) {
        const key = n.parent && this.nodes.has(n.parent) ? n.parent : n.parent ? n.parent : 'root:' + n.page;
        let arr = idx.get(key);
        if (!arr) idx.set(key, (arr = []));
        arr.push(n);
      }
      for (const arr of idx.values()) arr.sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : 1));
      this.kidIndex = new Map([...idx].map(([k, arr]) => [k, arr.map((n) => n.id)]));
    }
    const ids = this.kidIndex.get(parent ? parent : 'root:' + page) || [];
    const out = [];
    for (const id of ids) {
      const n = this.nodes.get(id);
      if (n) out.push(n);
    }
    return out;
  }

  touch(id, structural) {
    this.ver.set(id, (this.ver.get(id) || 0) + 1);
    if (structural) {
      this.kidIndex = null;
      this.stamp = (this.stamp || 0) + 1;
    }
  }

  nextZ(parent, page) {
    let z = 0;
    for (const n of this.nodes.values()) if ((n.parent || null) === (parent || null) && (parent || n.page === page)) z = Math.max(z, n.z || 0);
    return z + 1;
  }

  pageList() {
    return this.pages.toArray().map((id) => ({ id, ...(this.pageInfo.get(id) || { name: 'Página' }) }));
  }

  addPage(name) {
    const id = 'p' + uid(8);
    this.transact(() => {
      this.pageInfo.set(id, { id, name: name || `Página ${this.pages.length + 1}`, bg: '' });
      this.pages.push([id]);
    });
    return id;
  }

  descendants(id) {
    const out = [];
    const walk = (pid) => {
      for (const c of this.childrenOf(pid)) {
        out.push(c);
        walk(c.id);
      }
    };
    walk(id);
    return out;
  }

  ancestors(id) {
    const out = [];
    let n = this.get(id);
    const seen = new Set();
    while (n && n.parent && !seen.has(n.parent)) {
      seen.add(n.parent);
      n = this.get(n.parent);
      if (n) out.push(n);
    }
    return out;
  }

  ensureDefaults() {
    if (this.pages.length === 0) {
      this.transact(() => {
        this.meta.set('name', this.meta.get('name') || 'Sem título');
        this.meta.set('format', 1);
        const id = 'p' + uid(8);
        this.pageInfo.set(id, { id, name: 'Página 1', bg: '' });
        this.pages.push([id]);
      }, 'init');
    }
  }

  get name() {
    return this.meta.get('name') || 'Sem título';
  }

  set name(v) {
    this.transact(() => this.meta.set('name', String(v || 'Sem título').slice(0, 160)));
  }

  async loadLocal() {
    const rec = await idb.get('docs', this.fileId);
    if (rec && rec.update) {
      try {
        Y.applyUpdate(this.doc, rec.update instanceof Uint8Array ? rec.update : new Uint8Array(rec.update), 'idb');
      } catch {}
    }
    return !!rec;
  }

  async persist() {
    const update = Y.encodeStateAsUpdate(this.doc);
    await idb.put('docs', { id: this.fileId, name: this.name, update, updatedAt: Date.now(), size: update.byteLength }, this.fileId);
  }

  static async recent() {
    const keys = (await idb.keys('docs')) || [];
    const out = [];
    for (const k of keys) {
      const r = await idb.get('docs', k);
      if (r) out.push({ id: k, name: r.name || 'Sem título', updatedAt: r.updatedAt || 0, size: r.size || 0 });
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  static async removeLocal(id) {
    await idb.del('docs', id);
  }

  async saveVersion(label) {
    const state = Y.encodeStateAsUpdate(this.doc);
    const v = { id: uid(), fileId: this.fileId, label: label || new Date().toLocaleString('pt-BR'), createdAt: Date.now(), author: this.user.name, state };
    await idb.put('versions', v);
    if (this.mode === 'server') {
      fetch(`/api/files/${this.fileId}/versions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label: v.label }) }).catch(() => {});
    }
    return v;
  }

  async versions() {
    const all = (await idb.all('versions')) || [];
    return all.filter((v) => v.fileId === this.fileId).sort((a, b) => b.createdAt - a.createdAt);
  }

  restoreVersion(v) {
    const tmp = new Y.Doc();
    Y.applyUpdate(tmp, v.state);
    this.transact(() => {
      const copyMap = (name) => {
        const src = tmp.getMap(name);
        const dst = this.doc.getMap(name);
        for (const k of [...dst.keys()]) if (!src.has(k)) dst.delete(k);
        for (const [k, val] of src.entries()) {
          if (val instanceof Y.Map) {
            const m = new Y.Map();
            for (const [kk, vv] of val.entries()) m.set(kk, vv);
            dst.set(k, m);
          } else dst.set(k, val);
        }
      };
      ['pageInfo', 'nodes', 'comments', 'styles', 'dataSources', 'assets'].forEach(copyMap);
      this.pages.delete(0, this.pages.length);
      this.pages.push(tmp.getArray('pages').toArray());
      this.meta.set('name', tmp.getMap('meta').get('name') || this.name);
    });
    tmp.destroy();
  }

  toJSON() {
    return {
      format: 'grafo',
      version: 1,
      name: this.name,
      pages: this.pages.toArray(),
      pageInfo: this.pageInfo.toJSON(),
      nodes: Object.fromEntries([...this.nodes.entries()]),
      comments: this.commentsY.toJSON(),
      styles: this.stylesY.toJSON(),
      dataSources: this.dataY.toJSON(),
      assets: this.assetsY.toJSON(),
    };
  }

  loadJSON(data) {
    if (!data || data.format !== 'grafo' || !Array.isArray(data.pages)) throw new Error('Arquivo .grafo inválido');
    this.transact(() => {
      for (const k of [...this.nodesY.keys()]) this.nodesY.delete(k);
      for (const k of [...this.pageInfo.keys()]) this.pageInfo.delete(k);
      this.pages.delete(0, this.pages.length);
      for (const [k, v] of Object.entries(data.pageInfo || {})) this.pageInfo.set(k, v);
      this.pages.push(data.pages.filter((p) => typeof p === 'string'));
      for (const n of Object.values(data.nodes || {})) {
        if (!n || typeof n.id !== 'string' || typeof n.type !== 'string') continue;
        const m = new Y.Map();
        for (const [k, v] of Object.entries(n)) m.set(k, v);
        this.nodesY.set(n.id, m);
      }
      for (const [name, map] of [['comments', this.commentsY], ['styles', this.stylesY], ['dataSources', this.dataY], ['assets', this.assetsY]]) {
        for (const k of [...map.keys()]) map.delete(k);
        for (const [k, v] of Object.entries(data[name] || {})) map.set(k, v);
      }
      this.meta.set('name', String(data.name || 'Sem título'));
    });
  }

  async connect() {
    let health = null;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 1500);
      if (location.protocol.startsWith('http')) {
        const r = await fetch('/api/health', { signal: ctrl.signal, headers: { Accept: 'application/json' } });
        if (r.ok && (r.headers.get('content-type') || '').includes('json')) health = await r.json();
      }
      clearTimeout(t);
    } catch {}
    if (health && health.status) {
      this.mode = 'server';
      const base = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
      this.provider = new WebsocketProvider(base, this.fileId, this.doc, { awareness: this.awareness, maxBackoffTime: 4000 });
      this.provider.on('status', (e) => {
        this.online = e.status === 'connected';
        this.emit({ connection: true });
      });
      fetch('/api/files', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: this.fileId, name: this.name }) }).catch(() => {});
    } else {
      this.mode = 'local';
      this.connectTabs();
    }
    this.emit({ connection: true });
  }

  connectTabs() {
    if (typeof BroadcastChannel === 'undefined') return;
    const bc = new BroadcastChannel('grafo:' + this.fileId);
    this.bc = bc;
    this.doc.on('update', (update, origin) => {
      if (origin !== REMOTE_BC) bc.postMessage({ t: 'u', d: update });
    });
    this.awareness.on('update', ({ added, updated, removed }, origin) => {
      if (origin === REMOTE_BC) return;
      const changed = added.concat(updated, removed);
      bc.postMessage({ t: 'a', d: encodeAwarenessUpdate(this.awareness, changed) });
    });
    bc.onmessage = (e) => {
      const m = e.data;
      if (!m) return;
      if (m.t === 'u') Y.applyUpdate(this.doc, m.d, REMOTE_BC);
      else if (m.t === 'a') applyAwarenessUpdate(this.awareness, m.d, REMOTE_BC);
      else if (m.t === 'sv') bc.postMessage({ t: 'u', d: Y.encodeStateAsUpdate(this.doc, m.d) });
      else if (m.t === 'q') bc.postMessage({ t: 'a', d: encodeAwarenessUpdate(this.awareness, [this.doc.clientID]) });
    };
    bc.postMessage({ t: 'sv', d: Y.encodeStateVector(this.doc) });
    bc.postMessage({ t: 'q' });
    this.online = true;
    addEventListener('beforeunload', () => removeAwarenessStates(this.awareness, [this.doc.clientID], 'unload'));
  }

  setUser(u) {
    this.user = { ...this.user, ...u };
    storage.set('user', this.user);
    this.awareness.setLocalStateField('user', this.user);
    this.emit({ user: true });
  }

  destroy() {
    try {
      this.saveLocal.flush();
    } catch {}
    if (this.provider) this.provider.destroy();
    if (this.bc) this.bc.close();
    this.awareness.destroy();
    this.doc.destroy();
  }
}
