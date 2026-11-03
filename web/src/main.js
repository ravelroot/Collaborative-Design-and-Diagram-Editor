import { Store } from './doc.js';
import { Renderer } from './render.js';
import { Editor } from './editor.js';
import { UI } from './panels.js';
import { Engine } from './engine/index.js';
import { uuid, storage, applyPalette, canvasColor } from './util.js';
import { seedDocument } from './seed.js';
import { startTutorial, tutorialPending } from './tutorial.js';
import { buildBoard, applyBoard, aulaStart, findTemplate } from './templates.js';
import { fitText } from './geom.js';

const $ = (id) => document.getElementById(id);

const fileFromHash = () => {
  const m = location.hash.match(/#\/arquivo\/([0-9a-f-]{36})/i);
  return m ? m[1].toLowerCase() : null;
};

class App {
  constructor() {
    this.dom = {
      app: $('app'),
      tools: $('tools'),
      menus: $('menus'),
      logo: $('logo'),
      loadingLogo: $('loadingLogo'),
      mainMenuBtn: $('mainMenuBtn'),
      fileName: Object.assign(document.createElement('input'), { className: 'file-name', id: 'fileName', spellcheck: false, ariaLabel: 'Nome do arquivo' }),
      avatars: $('avatars'),
      conn: $('conn'),
      presentBtn: $('presentBtn'),
      shareBtn: $('shareBtn'),
      zoomBtn: $('zoomBtn'),
      themeBtn: $('themeBtn'),
      paletteBtn: $('paletteBtn'),
      leftPanel: $('leftPanel'),
      rightPanel: $('rightPanel'),
      canvasWrap: $('canvasWrap'),
      stageHost: $('stageHost'),
      overlay: $('overlay'),
      htmlLayer: $('htmlLayer'),
      rulerX: $('rulerX'),
      rulerY: $('rulerY'),
      minimap: $('minimap'),
      toasts: $('toasts'),
      statusbar: $('statusbar'),
    };
    this.engineMode = 'JS';
  }

  async start() {
    const theme = storage.get('theme', matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.dataset.theme = theme;
    applyPalette(storage.get('palette', 'grafo'));
    const wasm = window.GRAFO_ENGINE_WASM || new URL('assets/engine.wasm', document.baseURI).href;
    const ok = await Engine.load(typeof wasm === 'string' && wasm.startsWith('data:') ? base64ToBytes(wasm) : wasm).catch(() => false);
    this.engineMode = ok ? 'WASM' : 'JS';
    let id = fileFromHash();
    const isNew = !id;
    if (!id) {
      id = storage.get('lastFile', null) || uuid();
      history.replaceState(null, '', `#/arquivo/${id}`);
    }
    await this.open(id, isNew && !storage.get('lastFile', null));
    addEventListener('hashchange', () => {
      const h = fileFromHash();
      if (h && h !== this.store.fileId) this.openFileId(h);
    });
    $('loading').classList.add('done');
    setTimeout(() => $('loading').remove(), 400);
    addEventListener('pagehide', () => this.store && this.store.saveLocal.flush());
    if (window.grafoDesktop) {
      window.__grafoBeforeClose = () => this.store && this.store.persist();
      addEventListener('keydown', (e) => {
        if (e.key === 'F11') {
          e.preventDefault();
          window.grafoDesktop.toggleFullscreen();
        }
      }, true);
    }
    if (tutorialPending()) setTimeout(() => startTutorial({ welcome: true }), 450);
  }

  async open(id, seed = false, data = null) {
    if (this.store) {
      if (this.ui) this.ui.destroy();
      if (this.editor) this.editor.destroy();
      this.dom.presentBtn.innerHTML = '';
      this.dom.avatars.innerHTML = '';
      this.store.destroy();
      this.renderer.destroy();
      this.dom.leftPanel.innerHTML = '';
      this.dom.rightPanel.innerHTML = '';
      this.dom.htmlLayer.innerHTML = '';
      this.dom.tools.innerHTML = '';
      this.dom.menus.innerHTML = '';
      this.dom.logo.innerHTML = '';
    }
    const store = new Store(id);
    this.store = store;
    const had = await store.loadLocal();
    await store.connect();
    if (store.mode === 'server') await waitSynced(store);
    if (data) store.loadJSON(data);
    else if (!had && store.pages.length === 0 && seed) seedDocument(store);
    store.ensureDefaults();
    storage.set('lastFile', id);
    this.renderer = new Renderer(store);
    await this.renderer.init(this.dom.stageHost);
    this.renderer.onAsync = () => this.editor && this.editor.invalidate();
    this.editor = new Editor(store, this.renderer, this.dom);
    store.transact(() => this.editor.relayout(), 'init');
    this.ui = new UI(this);
    this.applyTheme();
    this.editor.saveSettings();
    this.editor.setPage(store.pages.get(0));
    store.on((info) => {
      if (info.structure) this.applyTheme();
    });
    this.dom.overlay.focus({ preventScroll: true });
    window.grafo = this;
  }

  async openFileId(id) {
    history.replaceState(null, '', `#/arquivo/${id}`);
    await this.open(id);
  }

  async newFile(data = null) {
    const id = uuid();
    history.replaceState(null, '', `#/arquivo/${id}`);
    await this.open(id, false, data);
    if (!data) this.store.name = 'Sem título';
  }

  openTemplate(id, lesson = false) {
    const t = findTemplate(id);
    return t ? this.newFromTemplate(t, lesson) : null;
  }

  async newFromTemplate(t, lesson = false) {
    await this.newFile();
    const store = this.store;
    const ed = this.editor;
    const aula = t.cat === 'aula' || lesson;
    const items = buildBoard(t.cat === 'aula' ? aulaStart(t.dir) : lesson ? t.lesson : t.build);
    store.transact(() => {
      applyBoard(store, ed.page, items, { measure: (n) => fitText(n, store) });
      const info = store.pageInfo.get(ed.page) || {};
      store.pageInfo.set(ed.page, { ...info, name: aula ? 'Aula' : t.name, ...(aula ? { aula: t.dir || 'down' } : {}) });
      ed.relayout();
    }, 'template');
    store.name = t.cat === 'aula' ? 'Aula' : lesson ? `Aula · ${t.name}` : t.name;
    ed.select([]);
    ed.zoomToFit(false);
    this.ui.updateTop();
    this.ui.renderAll();
    return store;
  }

  applyTheme() {
    const info = this.store.pageInfo.get(this.editor?.page) || {};
    this.renderer.setBackground(info.bg || canvasColor());
    this.renderer.labelBg = '#FAF6EF';
    if (this.editor) this.editor.invalidate();
  }

  setPalette(id) {
    storage.set('palette', applyPalette(id));
    this.applyTheme();
    this.ui.updateTop();
    this.ui.renderAll();
  }

  toggleTheme() {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    storage.set('theme', next);
    this.applyTheme();
    this.ui.updateTop();
    this.ui.renderAll();
  }
}

const waitSynced = (store) => new Promise((resolve) => {
  if (!store.provider) return resolve();
  if (store.provider.synced) return resolve();
  const t = setTimeout(resolve, 2500);
  store.provider.once('sync', () => {
    clearTimeout(t);
    resolve();
  });
});

const base64ToBytes = (s) => {
  const b = atob(s.slice(s.indexOf(',') + 1));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
};

const app = new App();
app.start().catch((err) => {
  console.error(err);
  const l = $('loading');
  if (l) l.lastChild.textContent = 'Não foi possível iniciar: ' + (err && err.message ? err.message : err);
});
