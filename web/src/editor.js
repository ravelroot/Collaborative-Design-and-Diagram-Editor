import { uid, clamp, round, rgba, debounce, storage, hexToNum, toHex } from './util.js';
import { SHAPES, shapeDef, flattenD, nodeParts } from './shapes.js';
import { corners, aabb, union, intersects, contains, toLocal, rotatePoint, hitNode, isContainer, hasText, nodeBounds, anchorOf, nearestAnchor, connectorRoute, fitText, layoutText, fontCss, textBox, resolveText } from './geom.js';
import { Engine } from './engine/index.js';
import { LOCAL } from './doc.js';
import { layoutTree } from './templates.js';

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const HANDLE_POS = { nw: [0, 0], n: [0.5, 0], ne: [1, 0], e: [1, 0.5], se: [1, 1], s: [0.5, 1], sw: [0, 1], w: [0, 0.5] };
const CURSOR_FOR = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' };

export const TOOLS = [
  { id: 'select', name: 'Mover', key: 'V', icon: 'move' },
  { id: 'scale', name: 'Escala', key: 'K', icon: 'scale' },
  { sep: true },
  { id: 'frame', name: 'Frame', key: 'F', icon: 'frame' },
  { id: 'section', name: 'Seção', key: 'Shift+S', icon: 'section' },
  { sep: true },
  { id: 'rect', name: 'Retângulo', key: 'R', icon: 'rect' },
  { id: 'ellipse', name: 'Elipse', key: 'O', icon: 'ellipse' },
  { id: 'line', name: 'Linha', key: 'L', icon: 'line' },
  { id: 'arrow', name: 'Seta', key: 'Shift+L', icon: 'arrow' },
  { id: 'polygon', name: 'Polígono', key: 'Shift+Y', icon: 'polygon' },
  { id: 'star', name: 'Estrela', key: '*', icon: 'star' },
  { id: 'image', name: 'Imagem', key: 'Ctrl+Shift+K', icon: 'image' },
  { sep: true },
  { id: 'pen', name: 'Caneta', key: 'P', icon: 'pen' },
  { id: 'pencil', name: 'Lápis', key: 'Shift+P', icon: 'pencil' },
  { id: 'text', name: 'Texto', key: 'T', icon: 'text' },
  { sep: true },
  { id: 'sticky', name: 'Nota adesiva', key: 'S', icon: 'sticky' },
  { id: 'connector', name: 'Conector', key: 'X', icon: 'connector' },
  { sep: true },
  { id: 'hand', name: 'Mão', key: 'H', icon: 'hand' },
  { id: 'comment', name: 'Comentário', key: 'C', icon: 'comment' },
  { id: 'eyedropper', name: 'Conta-gotas', key: 'I', icon: 'eyedropper' },
];

const DEFAULT_FILL = { type: 'solid', color: '#D6BDB8', alpha: 1 };
const FRAME_FILL = { type: 'solid', color: '#FFFFFF', alpha: 1 };
const DIAGRAM_FILL = { type: 'solid', color: '#FAF6EF', alpha: 1 };
const DIAGRAM_STROKE = { color: '#5C4034', alpha: 1 };
const STICKY_COLORS = ['#F6E4A6', '#D6BDB8', '#A3B4BE', '#C9D3A8', '#E6DDCE'];
const FLIPPABLE = new Set(['rect', 'ellipse', 'polygon', 'star', 'shape', 'image']);
const SIDE_FLIP = { h: { left: 'right', right: 'left' }, v: { top: 'bottom', bottom: 'top' } };
export const STYLE_KEYS = ['fill', 'fillStyle', 'stroke', 'strokeWidth', 'strokeAlign', 'dash', 'radius', 'opacity', 'blend', 'effects', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'textDecoration', 'lineHeight', 'letterSpacing', 'textColor', 'align', 'valign', 'textStyle', 'textCase'];
const TEXT_KEYS = new Set(['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'textDecoration', 'lineHeight', 'letterSpacing', 'textColor', 'align', 'valign', 'textStyle', 'textCase']);

export const measureGaps = (a, b) => {
  const out = [];
  const inside = a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
  const cy = a.y + a.h / 2;
  const cx = a.x + a.w / 2;
  if (inside) {
    out.push({ axis: 'x', from: b.x, to: a.x, at: cy }, { axis: 'x', from: a.x + a.w, to: b.x + b.w, at: cy });
    out.push({ axis: 'y', from: b.y, to: a.y, at: cx }, { axis: 'y', from: a.y + a.h, to: b.y + b.h, at: cx });
    return out.filter((m) => m.to - m.from > 0.001);
  }
  const ys = Math.max(a.y, b.y);
  const ye = Math.min(a.y + a.h, b.y + b.h);
  const xs = Math.max(a.x, b.x);
  const xe = Math.min(a.x + a.w, b.x + b.w);
  const atY = ye > ys ? (ys + ye) / 2 : cy;
  const atX = xe > xs ? (xs + xe) / 2 : cx;
  const sepX = a.x + a.w <= b.x || b.x + b.w <= a.x;
  const sepY = a.y + a.h <= b.y || b.y + b.h <= a.y;
  if (a.x + a.w <= b.x) out.push({ axis: 'x', from: a.x + a.w, to: b.x, at: atY, ext: ye > ys ? null : b.y + b.h / 2 });
  else if (b.x + b.w <= a.x) out.push({ axis: 'x', from: b.x + b.w, to: a.x, at: atY, ext: ye > ys ? null : b.y + b.h / 2 });
  if (a.y + a.h <= b.y) out.push({ axis: 'y', from: a.y + a.h, to: b.y, at: atX, ext: xe > xs ? null : b.x + b.w / 2 });
  else if (b.y + b.h <= a.y) out.push({ axis: 'y', from: b.y + b.h, to: a.y, at: atX, ext: xe > xs ? null : b.x + b.w / 2 });
  if (!sepX && !sepY) {
    for (const [p, q] of [[a.x, b.x], [a.x + a.w, b.x + b.w]]) if (Math.abs(p - q) > 0.001) out.push({ axis: 'x', from: Math.min(p, q), to: Math.max(p, q), at: atY });
    for (const [p, q] of [[a.y, b.y], [a.y + a.h, b.y + b.h]]) if (Math.abs(p - q) > 0.001) out.push({ axis: 'y', from: Math.min(p, q), to: Math.max(p, q), at: atX });
  }
  return out;
};

export const gridLayout = (boxes, gap = 20) => {
  const n = boxes.length;
  if (!n) return [];
  const items = boxes.map((b, i) => ({ i, b, cx: b.x + b.w / 2, cy: b.y + b.h / 2 }));
  const medH = [...boxes].map((b) => b.h).sort((p, q) => p - q)[Math.floor(n / 2)] || 1;
  const byY = [...items].sort((p, q) => p.cy - q.cy || p.cx - q.cx);
  let rows = [];
  for (const it of byY) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(row.cy - it.cy) <= medH / 2) {
      row.items.push(it);
      row.cy = row.items.reduce((s, r) => s + r.cy, 0) / row.items.length;
    } else rows.push({ cy: it.cy, items: [it] });
  }
  const widest = Math.max(...rows.map((r) => r.items.length));
  const cols = rows.length === 1 ? n : rows.length === n ? 1 : widest;
  if (rows.length > 1 && rows.length < n && rows.some((r) => r.items.length !== widest && r !== rows[rows.length - 1])) {
    const c = Math.ceil(Math.sqrt(n));
    const ordered = rows.flatMap((r) => r.items.sort((p, q) => p.cx - q.cx));
    rows = [];
    for (let i = 0; i < ordered.length; i += c) rows.push({ items: ordered.slice(i, i + c) });
  } else {
    const ordered = rows.flatMap((r) => r.items.sort((p, q) => p.cx - q.cx));
    rows = [];
    for (let i = 0; i < ordered.length; i += cols) rows.push({ items: ordered.slice(i, i + cols) });
  }
  const ncols = Math.max(...rows.map((r) => r.items.length));
  const colW = Array.from({ length: ncols }, (_, c) => Math.max(...rows.map((r) => (r.items[c] ? r.items[c].b.w : 0))));
  const rowH = rows.map((r) => Math.max(...r.items.map((it) => it.b.h)));
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const out = new Array(n);
  let y = y0;
  rows.forEach((r, ri) => {
    let x = x0;
    r.items.forEach((it, ci) => {
      out[it.i] = { x: Math.round(x), y: Math.round(y) };
      x += colW[ci] + gap;
    });
    y += rowH[ri] + gap;
  });
  return out;
};

export class Editor {
  constructor(store, renderer, dom) {
    this.store = store;
    this.r = renderer;
    this.dom = dom;
    this.page = store.pages.get(0);
    this.sel = new Set();
    this.tool = 'select';
    this.zoom = 1;
    this.camX = -80;
    this.camY = -60;
    this.hover = null;
    this.drag = null;
    this.guides = [];
    this.pen = null;
    this.entered = null;
    this.spaceDown = false;
    this.dirty = true;
    this.listeners = new Set();
    this.mouse = { x: 0, y: 0, sx: 0, sy: 0 };
    this.settings = { rulers: true, minimap: true, pixelSnap: true, snap: true, grid: false, outlines: false, guides: true, ...storage.get('settings', {}) };
    this.clipboard = null;
    this.tween = null;
    this.editing = null;
    this.stickyIdx = 0;
    this.measuring = false;
    this.lastDup = null;
    this.propClipboard = null;
    this.lastClick = { t: 0, x: 0, y: 0 };
    this.sendCursor = debounce(() => this.pushPresence(), 30);
    this.overlay = dom.overlay;
    this.octx = this.overlay.getContext('2d');
    this.store.anchorPoint = (end) => {
      const n = this.store.get(end.node);
      return n ? anchorOf(n, end.side && end.side !== 'auto' ? end.side : 'center') : { x: end.x || 0, y: end.y || 0 };
    };
    store.on((info) => {
      if (info.nodes) {
        for (const id of [...this.sel]) if (!store.get(id)) this.sel.delete(id);
        if (info.structure && this.page && !store.pageInfo.get(this.page)) this.page = store.pages.get(0);
      }
      if (info.structure && !store.pageInfo.get(this.page)) this.page = store.pages.get(0);
      this.invalidate();
      this.emit(info);
    });
    store.awareness.on('change', () => {
      this.invalidate();
      this.emit({ presence: true });
    });
    store.undo.on('stack-item-added', (e) => {
      this.lastAddedItem = e.stackItem;
      if (!e.stackItem.meta.has('before')) {
        e.stackItem.meta.set('before', this.pendingBefore || [...this.sel]);
        queueMicrotask(() => e.stackItem.meta.set('after', [...this.sel]));
      }
    });
    store.undo.on('stack-item-popped', (e) => {
      const m = e.stackItem.meta;
      if (this.lastAddedItem && this.lastAddedItem !== e.stackItem) for (const [k, v] of m) this.lastAddedItem.meta.set(k, v);
      const ids = (e.type === 'undo' ? m.get('before') : m.get('after')) || [];
      this.select(ids.filter((id) => this.store.get(id)));
    });
    this.bind();
    this.loop();
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(info) {
    for (const fn of this.listeners) fn(info);
  }

  invalidate() {
    this.dirty = true;
  }

  saveSettings() {
    storage.set('settings', this.settings);
    this.dom.canvasWrap.classList.toggle('no-rulers', !this.settings.rulers);
    this.dom.minimap.classList.toggle('off', !this.settings.minimap);
    this.resize();
    this.invalidate();
  }

  get selection() {
    return [...this.sel].map((id) => this.store.get(id)).filter(Boolean);
  }

  setPage(id) {
    if (!this.store.pageInfo.get(id)) return;
    this.finishText();
    this.page = id;
    this.sel.clear();
    this.entered = null;
    const views = storage.get('view:' + this.store.fileId + ':' + id, null);
    if (views) {
      this.camX = views.x;
      this.camY = views.y;
      this.zoom = views.z;
    } else this.zoomToFit(false);
    this.invalidate();
    this.emit({ page: true, selection: true });
    this.pushPresence();
  }

  select(ids, additive = false) {
    if (!additive) this.sel.clear();
    for (const id of ids) if (this.store.get(id)) this.sel.add(id);
    this.invalidate();
    this.emit({ selection: true });
    this.pushPresence();
  }

  toggle(id) {
    if (this.sel.has(id)) this.sel.delete(id);
    else this.sel.add(id);
    this.invalidate();
    this.emit({ selection: true });
  }

  setTool(t) {
    if (this.pen) this.finishPen();
    this.finishText();
    this.tool = t;
    this.overlay.style.cursor = t === 'hand' ? 'grab' : t === 'select' || t === 'scale' ? 'default' : 'crosshair';
    this.invalidate();
    this.emit({ tool: true });
    if (t === 'image') {
      this.emit({ pickImage: true });
      this.tool = 'select';
    }
  }

  async pickScreenColor() {
    if (typeof window === 'undefined' || !window.EyeDropper) return false;
    try {
      const r = await new window.EyeDropper().open();
      if (r && r.sRGBHex) this.applyPickedColor(r.sRGBHex);
    } catch {}
    return true;
  }

  sampleColorAt(wx, wy) {
    const order = this.drawOrder();
    for (let i = order.length - 1; i >= 0; i--) {
      const n = order[i];
      if (!this.isVisible(n) || n.type === 'group') continue;
      if (!hitNode(n, wx, wy, 2 / this.zoom, this.store)) continue;
      if (n.type === 'text') return n.fill?.color || '#2B1D17';
      if (n.fill && n.fill.type === 'solid' && n.fill.color) return n.fill.color;
      if (n.fill && n.fill.type === 'linear' && n.fill.stops?.length) return n.fill.stops[0].color;
      if (n.stroke && n.stroke.color && (n.type === 'connector' || n.type === 'path')) return n.stroke.color;
      if (n.fill === null && n.stroke) return n.stroke.color;
    }
    return null;
  }

  applyPickedColor(raw) {
    const hex = toHex(raw);
    if (!hex) return;
    const ids = [...this.sel].filter((id) => !this.isLocked(this.store.get(id) || {}));
    if (ids.length) {
      this.setProp((n) => {
        if (n.type === 'text') return { fill: { type: 'solid', color: hex, alpha: n.fill?.alpha ?? 1 } };
        if (n.type === 'connector' || (n.type === 'path' && !n.fill)) return { stroke: { ...(n.stroke || { alpha: 1 }), color: hex } };
        if (n.type === 'group') return null;
        return { fill: { type: 'solid', color: hex, alpha: n.fill?.type === 'solid' ? n.fill.alpha ?? 1 : 1 }, fillStyle: undefined };
      }, ids);
      this.emit({ toast: `Cor ${hex} aplicada` });
    } else {
      try {
        navigator.clipboard && navigator.clipboard.writeText(hex).catch(() => {});
      } catch {}
      this.emit({ toast: `Cor ${hex} copiada` });
    }
    this.lastPicked = hex;
  }

  stopCapture() {
    this.store.undo.stopCapturing();
    this.captureOpen = false;
  }

  commit(fn) {
    let r;
    if (!this.captureOpen) {
      this.pendingBefore = [...this.sel];
      this.captureOpen = true;
    }
    this.store.transact(() => {
      r = fn();
      this.relayout();
    });
    if (!this.drag && !this.editing && !this.animating) this.stopCapture();
    return r;
  }

  toWorld(sx, sy) {
    return { x: this.camX + sx / this.zoom, y: this.camY + sy / this.zoom };
  }

  toScreen(wx, wy) {
    return { x: (wx - this.camX) * this.zoom, y: (wy - this.camY) * this.zoom };
  }

  pageNodes() {
    const out = [];
    for (const n of this.store.nodes.values()) if (n.page === this.page) out.push(n);
    return out;
  }

  drawOrder() {
    const key = this.page + ':' + (this.store.stamp || 0);
    if (this.orderCache && this.orderCache.key === key) return this.orderCache.list;
    const out = [];
    const walk = (parent) => {
      for (const c of this.store.childrenOf(parent, this.page)) {
        if (c.page !== this.page) continue;
        out.push(c);
        if (c.type !== 'instance') walk(c.id);
      }
    };
    walk(null);
    this.orderCache = { key, list: out };
    return out;
  }

  isLocked(n) {
    if (n.locked) return true;
    return this.store.ancestors(n.id).some((a) => a.locked);
  }

  isVisible(n) {
    if (n.visible === false) return false;
    return !this.store.ancestors(n.id).some((a) => a.visible === false);
  }

  hitTest(wx, wy, { deep = false, skip = null } = {}) {
    const order = this.drawOrder();
    const tol = 4 / this.zoom;
    for (let i = order.length - 1; i >= 0; i--) {
      const n = order[i];
      if (skip && skip.has(n.id)) continue;
      if (!this.isVisible(n) || this.isLocked(n)) continue;
      const anc = this.store.ancestors(n.id);
      if (anc.some((a) => a.type === 'boolean') && !deep) continue;
      const clipper = anc.find((a) => (a.type === 'frame' || a.type === 'component') && a.clip !== false);
      if (clipper && !hitNode({ ...clipper, fill: FRAME_FILL }, wx, wy, 0, this.store)) continue;
      if (hitNode(n, wx, wy, tol, this.store)) {
        if (n.type === 'frame' || n.type === 'component' || n.type === 'section') {
          const kidsHit = false;
          if (!kidsHit && n.parent === null && n.type !== 'section') {
            const l = toLocal(n, wx, wy);
            if (l.y < 0 || l.y > n.h) continue;
          }
        }
        return n;
      }
    }
    for (let i = order.length - 1; i >= 0; i--) {
      const n = order[i];
      if ((n.type === 'frame' || n.type === 'component') && !n.parent && this.isVisible(n) && !this.isLocked(n)) {
        const label = this.frameLabelRect(n);
        if (wx >= label.x && wx <= label.x + label.w && wy >= label.y && wy <= label.y + label.h) return n;
      }
    }
    return null;
  }

  frameLabelRect(n) {
    const h = 16 / this.zoom;
    return { x: n.x, y: n.y - h - 2 / this.zoom, w: Math.max(40 / this.zoom, Math.min(n.w, (String(n.name || '').length * 7 + 10) / this.zoom)), h };
  }

  selectable(n) {
    if (!n) return null;
    let cur = n;
    const anc = this.store.ancestors(n.id);
    for (const a of anc) {
      if ((a.type === 'group' || a.type === 'boolean' || a.type === 'instance') && a.id !== this.entered && !this.store.ancestors(this.entered || '').some((x) => x.id === a.id) && this.entered !== a.id) cur = a;
    }
    if (this.entered && anc.some((a) => a.id === this.entered)) {
      let c = n;
      while (c && c.parent && c.parent !== this.entered) {
        const p = this.store.get(c.parent);
        if (!p) break;
        if (p.type === 'group' || p.type === 'boolean') c = p;
        else break;
      }
      return c;
    }
    return cur;
  }

  selectionBox() {
    const sel = this.selection;
    if (!sel.length) return null;
    return union(sel.map((n) => nodeBounds(n, this.store)));
  }

  movingSet(ids) {
    const set = new Set();
    for (const id of ids) {
      set.add(id);
      for (const d of this.store.descendants(id)) set.add(d.id);
    }
    return set;
  }

  pageGuides() {
    const info = this.store.pageInfo.get(this.page);
    return info && Array.isArray(info.guides) ? info.guides : [];
  }

  setGuides(list) {
    const info = this.store.pageInfo.get(this.page);
    if (!info) return;
    this.commit(() => this.store.pageInfo.set(this.page, { ...info, guides: list }));
  }

  clearGuides() {
    if (this.pageGuides().length) this.setGuides([]);
  }

  guideAt(sx, sy) {
    if (!this.settings.guides) return null;
    for (const g of this.pageGuides()) {
      const s = g.axis === 'x' ? this.toScreen(g.v, 0).x : this.toScreen(0, g.v).y;
      if (Math.abs((g.axis === 'x' ? sx : sy) - s) <= 3) return g;
    }
    return null;
  }

  startGuide(e, axis, guide = null) {
    e.preventDefault();
    const g = guide ? { ...guide } : { id: 'g' + uid(8), axis, v: 0 };
    this.guideDrag = g;
    const host = this.dom.stageHost.getBoundingClientRect();
    const move = (ev) => {
      const sx = ev.clientX - host.left;
      const sy = ev.clientY - host.top;
      const w = this.toWorld(sx, sy);
      let v = g.axis === 'x' ? w.x : w.y;
      v = this.settings.pixelSnap || this.zoom < 4 ? Math.round(v) : round(v, 10);
      g.v = v;
      g.out = g.axis === 'x' ? sx < 0 : sy < 0;
      g.sx = sx;
      g.sy = sy;
      this.invalidate();
    };
    const up = (ev) => {
      removeEventListener('pointermove', move, true);
      removeEventListener('pointerup', up, true);
      move(ev);
      this.guideDrag = null;
      const rest = this.pageGuides().filter((x) => x.id !== g.id);
      if (g.out) {
        if (guide) this.setGuides(rest);
      } else this.setGuides([...rest, { id: g.id, axis: g.axis, v: g.v }]);
      if (!this.settings.guides) {
        this.settings.guides = true;
        this.saveSettings();
      }
      this.invalidate();
    };
    addEventListener('pointermove', move, true);
    addEventListener('pointerup', up, true);
    move(e);
  }

  snapCandidates(exclude) {
    const xs = [];
    const ys = [];
    const vp = this.r.viewport();
    if (this.settings.guides) {
      for (const g of this.pageGuides()) {
        if (g.axis === 'x') xs.push({ v: g.v, b: { x: g.v, y: vp.y, w: 0, h: vp.h } });
        else ys.push({ v: g.v, b: { x: vp.x, y: g.v, w: vp.w, h: 0 } });
      }
    }
    for (const n of this.pageNodes()) {
      if (exclude.has(n.id) || n.type === 'connector' || !this.isVisible(n)) continue;
      const b = nodeBounds(n, this.store);
      if (!intersects(b, { x: vp.x - vp.w, y: vp.y - vp.h, w: vp.w * 3, h: vp.h * 3 })) continue;
      xs.push({ v: b.x, b }, { v: b.x + b.w / 2, b }, { v: b.x + b.w, b });
      ys.push({ v: b.y, b }, { v: b.y + b.h / 2, b }, { v: b.y + b.h, b });
    }
    return { xs, ys };
  }

  snapBox(box, cand, axes = { x: [0, 0.5, 1], y: [0, 0.5, 1] }) {
    const th = 6 / this.zoom;
    let dx = 0;
    let dy = 0;
    let bestX = th;
    let bestY = th;
    const guides = [];
    if (this.settings.snap) {
      for (const f of axes.x) {
        const v = box.x + box.w * f;
        for (const c of cand.xs) {
          const d = c.v - v;
          if (Math.abs(d) < bestX) {
            bestX = Math.abs(d);
            dx = d;
          }
        }
      }
      for (const f of axes.y) {
        const v = box.y + box.h * f;
        for (const c of cand.ys) {
          const d = c.v - v;
          if (Math.abs(d) < bestY) {
            bestY = Math.abs(d);
            dy = d;
          }
        }
      }
      const nb = { x: box.x + dx, y: box.y + dy, w: box.w, h: box.h };
      if (bestX < th) for (const f of axes.x) {
        const v = nb.x + nb.w * f;
        for (const c of cand.xs) if (Math.abs(c.v - v) < 0.5) guides.push({ axis: 'x', v, a: Math.min(nb.y, c.b.y), b: Math.max(nb.y + nb.h, c.b.y + c.b.h) });
      }
      if (bestY < th) for (const f of axes.y) {
        const v = nb.y + nb.h * f;
        for (const c of cand.ys) if (Math.abs(c.v - v) < 0.5) guides.push({ axis: 'y', v, a: Math.min(nb.x, c.b.x), b: Math.max(nb.x + nb.w, c.b.x + c.b.w) });
      }
    }
    return { dx: bestX < th ? dx : 0, dy: bestY < th ? dy : 0, guides };
  }

  px(v) {
    return this.settings.pixelSnap ? Math.round(v) : round(v);
  }

  containerAt(wx, wy, exclude) {
    const order = this.drawOrder();
    for (let i = order.length - 1; i >= 0; i--) {
      const n = order[i];
      if (exclude && exclude.has(n.id)) continue;
      if (!isContainer(n) || !this.isVisible(n) || this.isLocked(n)) continue;
      const l = toLocal(n, wx, wy);
      if (l.x >= 0 && l.y >= 0 && l.x <= n.w && l.y <= n.h) return n;
    }
    return null;
  }

  bind() {
    const o = this.overlay;
    this.abort = new AbortController();
    const signal = this.abort.signal;
    o.addEventListener('pointerdown', (e) => this.onDown(e), { signal });
    o.addEventListener('pointermove', (e) => this.onMove(e), { signal });
    o.addEventListener('pointerup', (e) => this.onUp(e), { signal });
    o.addEventListener('pointercancel', (e) => this.onUp(e), { signal });
    o.addEventListener('pointerleave', () => {
      this.hover = null;
      this.store.awareness.setLocalStateField('cursor', null);
      this.invalidate();
    }, { signal });
    o.addEventListener('wheel', (e) => this.onWheel(e), { passive: false, signal });
    o.addEventListener('dblclick', (e) => this.onDouble(e), { signal });
    o.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const p = this.local(e);
      const w = this.toWorld(p.x, p.y);
      const hit = this.selectable(this.hitTest(w.x, w.y));
      if (hit && !this.sel.has(hit.id)) this.select([hit.id]);
      if (!hit) this.select([]);
      this.emit({ contextMenu: { x: e.clientX, y: e.clientY, world: w } });
    }, { signal });
    this.dom.rulerX.addEventListener('pointerdown', (e) => e.button === 0 && this.startGuide(e, 'y'), { signal });
    this.dom.rulerY.addEventListener('pointerdown', (e) => e.button === 0 && this.startGuide(e, 'x'), { signal });
    o.addEventListener('dragover', (e) => e.preventDefault(), { signal });
    o.addEventListener('drop', (e) => {
      e.preventDefault();
      const p = this.local(e);
      const w = this.toWorld(p.x, p.y);
      const shape = e.dataTransfer.getData('application/x-grafo-shape');
      const comp = e.dataTransfer.getData('application/x-grafo-component');
      if (shape) this.insertShape(shape, w.x, w.y);
      else if (comp) this.insertInstance(comp, w.x, w.y);
      else if (e.dataTransfer.files.length) this.emit({ dropFiles: { files: [...e.dataTransfer.files], world: w } });
    }, { signal });
    const alt = (e) => {
      const on = e.type === 'keydown' ? e.key === 'Alt' || e.altKey : e.key === 'Alt' ? false : e.altKey;
      if (on === this.measuring || this.drag) return;
      this.measuring = on && this.sel.size > 0;
      this.invalidate();
      if (e.key === 'Alt' && e.type === 'keyup' && this.sel.size && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '')) e.preventDefault();
    };
    addEventListener('keydown', alt, { signal });
    addEventListener('keyup', alt, { signal });
    addEventListener('blur', () => {
      if (this.measuring) {
        this.measuring = false;
        this.invalidate();
      }
    }, { signal });
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.dom.stageHost);
    this.resize();
  }

  local(e) {
    const r = this.overlay.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const host = this.dom.stageHost;
    const w = host.clientWidth;
    const h = host.clientHeight;
    for (const c of [this.overlay]) {
      c.width = Math.max(1, w * dpr);
      c.height = Math.max(1, h * dpr);
    }
    for (const [c, cw, ch] of [[this.dom.rulerX, w, 20], [this.dom.rulerY, 20, h]]) {
      c.width = Math.max(1, cw * dpr);
      c.height = Math.max(1, ch * dpr);
      c.style.width = cw + 'px';
      c.style.height = ch + 'px';
    }
    this.dpr = dpr;
    this.invalidate();
  }

  onWheel(e) {
    e.preventDefault();
    const p = this.local(e);
    if (e.ctrlKey || e.metaKey) {
      const factor = Math.exp(-clamp(e.deltaY, -60, 60) * (e.deltaMode === 1 ? 0.05 : 0.0085));
      this.zoomAt(p.x, p.y, this.zoom * factor);
    } else {
      const k = e.deltaMode === 1 ? 16 : 1;
      const dx = (e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) * k;
      const dy = e.shiftKey && !e.deltaX ? 0 : e.deltaY * k;
      this.camX += dx / this.zoom;
      this.camY += dy / this.zoom;
      this.viewChanged();
    }
  }

  zoomAt(sx, sy, z) {
    z = clamp(z, 0.02, 256);
    const w = this.toWorld(sx, sy);
    this.zoom = z;
    this.camX = w.x - sx / z;
    this.camY = w.y - sy / z;
    this.viewChanged();
  }

  animateView(camX, camY, zoom, ms = 220) {
    const from = { x: this.camX, y: this.camY, z: this.zoom };
    const t0 = performance.now();
    this.tween = (now) => {
      const t = clamp((now - t0) / ms, 0, 1);
      const e = 1 - Math.pow(1 - t, 3);
      const lz = Math.exp(Math.log(from.z) + (Math.log(zoom) - Math.log(from.z)) * e);
      const sw = this.dom.stageHost.clientWidth;
      const sh = this.dom.stageHost.clientHeight;
      const fcx = from.x + sw / 2 / from.z;
      const fcy = from.y + sh / 2 / from.z;
      const tcx = camX + sw / 2 / zoom;
      const tcy = camY + sh / 2 / zoom;
      const cx = fcx + (tcx - fcx) * e;
      const cy = fcy + (tcy - fcy) * e;
      this.zoom = lz;
      this.camX = cx - sw / 2 / lz;
      this.camY = cy - sh / 2 / lz;
      this.viewChanged();
      if (t >= 1) this.tween = null;
    };
  }

  zoomStep(dir) {
    const sw = this.dom.stageHost.clientWidth;
    const sh = this.dom.stageHost.clientHeight;
    const steps = [0.02, 0.05, 0.1, 0.125, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 32, 64, 128, 256];
    let z = this.zoom;
    if (dir > 0) z = steps.find((s) => s > this.zoom * 1.001) || 256;
    else z = [...steps].reverse().find((s) => s < this.zoom * 0.999) || 0.02;
    const c = this.toWorld(sw / 2, sh / 2);
    this.animateView(c.x - sw / 2 / z, c.y - sh / 2 / z, z);
  }

  zoomTo(box, animate = true, maxZoom = 1) {
    const sw = this.dom.stageHost.clientWidth || 800;
    const sh = this.dom.stageHost.clientHeight || 600;
    if (!box || box.w <= 0 || box.h <= 0) {
      const z = 1;
      if (animate) this.animateView(-sw / 2 / z, -sh / 2 / z, z);
      else {
        this.zoom = z;
        this.camX = -80;
        this.camY = -60;
        this.viewChanged();
      }
      return;
    }
    const pad = 60;
    const z = clamp(Math.min((sw - pad * 2) / box.w, (sh - pad * 2) / box.h), 0.02, maxZoom);
    const cx = box.x + box.w / 2 - sw / 2 / z;
    const cy = box.y + box.h / 2 - sh / 2 / z;
    if (animate) this.animateView(cx, cy, z);
    else {
      this.zoom = z;
      this.camX = cx;
      this.camY = cy;
      this.viewChanged();
    }
  }

  zoomToFit(animate = true) {
    const nodes = this.pageNodes().filter((n) => !n.parent);
    this.zoomTo(union(nodes.map((n) => nodeBounds(n, this.store))), animate, 1);
  }

  zoomToSelection() {
    this.zoomTo(this.selectionBox(), true, 8);
  }

  viewChanged() {
    this.invalidate();
    this.emit({ view: true });
    this.saveView();
  }

  saveView = debounce(() => storage.set('view:' + this.store.fileId + ':' + this.page, { x: this.camX, y: this.camY, z: this.zoom }), 400);

  onDown(e) {
    this.overlay.focus({ preventScroll: true });
    if (this.editing && e.target === this.overlay) this.finishText();
    const p = this.local(e);
    const w = this.toWorld(p.x, p.y);
    this.mouse = { x: w.x, y: w.y, sx: p.x, sy: p.y };
    this.overlay.setPointerCapture(e.pointerId);
    if (e.button === 1 || this.spaceDown || this.tool === 'hand') {
      this.drag = { type: 'pan', sx: p.x, sy: p.y, cx: this.camX, cy: this.camY };
      this.overlay.style.cursor = 'grabbing';
      return;
    }
    if (e.button === 2) return;
    const tool = this.tool;
    if (tool === 'select' || tool === 'scale') return this.downSelect(e, p, w);
    if (tool === 'pen') return this.downPen(e, w);
    if (tool === 'pencil') {
      this.drag = { type: 'pencil', pts: [w] };
      return;
    }
    if (tool === 'text') {
      const id = this.createText(w.x, w.y);
      this.setTool('select');
      this.select([id]);
      requestAnimationFrame(() => this.editText(id));
      return;
    }
    if (tool === 'sticky') {
      const color = STICKY_COLORS[this.stickyIdx++ % STICKY_COLORS.length];
      const parent = this.containerAt(w.x, w.y);
      const id = this.commit(() => this.store.add({ type: 'sticky', page: this.page, parent: parent?.id || null, name: 'Nota', x: this.px(w.x - 100), y: this.px(w.y - 100), w: 200, h: 200, fill: { type: 'solid', color, alpha: 1 }, text: '', fontSize: 18, effects: [{ type: 'shadow', x: 0, y: 3, blur: 10, color: '#5C4034', alpha: 0.25 }] }));
      this.setTool('select');
      this.select([id]);
      requestAnimationFrame(() => this.editText(id));
      return;
    }
    if (tool === 'comment') {
      this.emit({ newComment: { x: w.x, y: w.y } });
      this.setTool('select');
      return;
    }
    if (tool === 'eyedropper') {
      this.setTool('select');
      if (typeof window !== 'undefined' && window.EyeDropper) {
        this.pickScreenColor();
        return;
      }
      const color = this.sampleColorAt(w.x, w.y);
      if (color) this.applyPickedColor(color);
      else this.emit({ toast: 'Nenhuma cor encontrada nesse ponto' });
      return;
    }
    if (tool === 'connector' || tool === 'line' || tool === 'arrow') {
      const attach = tool === 'connector';
      const hit = attach ? this.hitTest(w.x, w.y) : null;
      const target = hit && hit.type !== 'connector' && !isContainer(hit) ? hit : hit && isContainer(hit) && tool === 'connector' ? hit : null;
      const from = target ? { node: target.id, side: nearestAnchor(target, w.x, w.y).side } : { x: this.px(w.x), y: this.px(w.y) };
      this.drag = { type: 'connect', from, start: w, tool, moved: false };
      return;
    }
    this.drag = { type: 'create', tool, start: { x: this.px(w.x), y: this.px(w.y) }, id: null, moved: false };
  }

  handleAt(sx, sy) {
    const sel = this.selection;
    if (!sel.length) return null;
    if (sel.length === 1 && sel[0].type === 'connector') {
      const r = connectorRoute(sel[0], this.store);
      for (const [end, pt] of [['from', r.points[0]], ['to', r.points[r.points.length - 1]]]) {
        const s = this.toScreen(pt.x, pt.y);
        if (Math.hypot(s.x - sx, s.y - sy) < 8) return { kind: 'end', end };
      }
      return null;
    }
    if (sel.every((n) => this.isLocked(n))) return null;
    const single = sel.length === 1 ? sel[0] : null;
    const box = single ? { ...single } : { ...this.selectionBox(), rotation: 0 };
    const pts = corners({ x: box.x, y: box.y, w: box.w, h: box.h, rotation: box.rotation || 0 });
    const a = ((box.rotation || 0) * Math.PI) / 180;
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    for (const h of HANDLES) {
      const [fx, fy] = HANDLE_POS[h];
      const wp = rotatePoint(box.x + box.w * fx, box.y + box.h * fy, cx, cy, a);
      const s = this.toScreen(wp.x, wp.y);
      if (Math.abs(s.x - sx) <= 6 && Math.abs(s.y - sy) <= 6) {
        if ((box.w * this.zoom < 14 || box.h * this.zoom < 14) && h.length === 1) continue;
        return { kind: 'resize', h };
      }
    }
    if (!single || single.type !== 'text' || true) {
      for (let i = 0; i < 4; i++) {
        const s = this.toScreen(pts[i].x, pts[i].y);
        const d = Math.hypot(s.x - sx, s.y - sy);
        if (d > 6 && d < 18) {
          const sc = this.toScreen(cx, cy);
          const out = (sx - sc.x) * (s.x - sc.x) + (sy - sc.y) * (s.y - sc.y) > 0;
          const l = toLocal({ x: box.x, y: box.y, w: box.w, h: box.h, rotation: box.rotation || 0 }, ...Object.values(this.toWorld(sx, sy)));
          const inside = l.x > 0 && l.y > 0 && l.x < box.w && l.y < box.h;
          if (out && !inside) return { kind: 'rotate' };
        }
      }
    }
    return null;
  }

  anchorHover(sx, sy) {
    if (!this.hover || this.tool !== 'select') return null;
    const n = this.store.get(this.hover);
    if (!n || n.type === 'connector' || n.type === 'text' || n.type === 'group' || isContainer(n) && n.type !== 'shape') return null;
    if (this.sel.size > 1) return null;
    for (const side of ['top', 'right', 'bottom', 'left']) {
      const a = anchorOf(n, side);
      const off = 16 / this.zoom;
      const dirs = { top: [0, -off], right: [off, 0], bottom: [0, off], left: [-off, 0] };
      const ax = a.x + dirs[side][0];
      const ay = a.y + dirs[side][1];
      const s = this.toScreen(ax, ay);
      if (Math.hypot(s.x - sx, s.y - sy) < 7) return { node: n.id, side };
    }
    return null;
  }

  downSelect(e, p, w) {
    const handle = this.handleAt(p.x, p.y);
    if (handle) {
      const sel = this.selection;
      if (handle.kind === 'end') {
        this.drag = { type: 'end', end: handle.end, id: sel[0].id };
        return;
      }
      const ids = new Set(sel.map((n) => n.id));
      const desc = this.movingSet(ids);
      const start = new Map([...desc].map((id) => [id, structuredClone(this.store.get(id))]));
      const box = sel.length === 1 ? { ...sel[0] } : { ...this.selectionBox(), rotation: 0 };
      if (handle.kind === 'resize') {
        this.drag = { type: 'resize', h: handle.h, box, start, ids, cand: this.snapCandidates(desc), scale: this.tool === 'scale' || e.altKey && false };
      } else {
        const c = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
        this.drag = { type: 'rotate', box, start, ids, c, a0: Math.atan2(w.y - c.y, w.x - c.x) };
      }
      return;
    }
    const anchor = this.anchorHover(p.x, p.y);
    if (anchor) {
      this.drag = { type: 'connect', from: { node: anchor.node, side: anchor.side }, start: w, tool: 'connector', moved: false };
      return;
    }
    const guide = !(e.ctrlKey || e.metaKey) && this.guideAt(p.x, p.y);
    if (guide) {
      try {
        this.overlay.releasePointerCapture(e.pointerId);
      } catch {}
      this.startGuide(e, guide.axis, guide);
      return;
    }
    const raw = this.hitTest(w.x, w.y, { deep: e.ctrlKey || e.metaKey });
    let hit = e.ctrlKey || e.metaKey ? raw : this.selectable(raw);
    if (hit && this.sel.size && !this.sel.has(hit.id)) {
      const selBox = this.selectionBox();
      const inSel = [...this.sel].some((id) => raw && (raw.id === id || this.store.ancestors(raw.id).some((a) => a.id === id)));
      if (inSel && selBox) hit = this.store.get([...this.sel][0]);
    }
    if (hit) {
      if (e.shiftKey) this.toggle(hit.id);
      else if (!this.sel.has(hit.id)) this.select([hit.id]);
      if (!this.sel.has(hit.id)) return;
      let ids = new Set(this.sel);
      if (e.altKey) ids = new Set(this.duplicate([...ids], 0, 0));
      const movers = this.movingSet(ids);
      for (const n of this.pageNodes()) {
        if (n.type === 'connector' && ids.has(n.id)) movers.add(n.id);
      }
      const start = new Map([...movers].map((id) => [id, structuredClone(this.store.get(id))]));
      this.drag = { type: 'move', start, ids, w0: w, box: this.selectionBox(), cand: this.snapCandidates(movers), moved: false, movers };
      return;
    }
    if (!e.shiftKey) this.select([]);
    this.entered = null;
    this.drag = { type: 'marquee', a: w, b: w, base: new Set(this.sel) };
  }

  downPen(e, w) {
    if (!this.pen) this.pen = { points: [] };
    const pts = this.pen.points;
    if (pts.length >= 2) {
      const s0 = this.toScreen(pts[0].x, pts[0].y);
      const p = this.toScreen(w.x, w.y);
      if (Math.hypot(s0.x - p.x, s0.y - p.y) < 8) {
        this.finishPen(true);
        return;
      }
    }
    const pt = { x: this.px(w.x), y: this.px(w.y) };
    pts.push(pt);
    this.drag = { type: 'penhandle', pt };
    this.invalidate();
  }

  finishPen(closed = false) {
    const pen = this.pen;
    this.pen = null;
    this.drag = null;
    if (!pen || pen.points.length < 2) {
      this.invalidate();
      return;
    }
    const all = [];
    for (const p of pen.points) {
      all.push({ x: p.x, y: p.y });
      if (p.ix !== undefined) all.push({ x: p.ix, y: p.iy }, { x: p.ox, y: p.oy });
    }
    const b = aabb(all);
    const pts = pen.points.map((p) => {
      const q = { x: p.x - b.x, y: p.y - b.y };
      if (p.ix !== undefined) Object.assign(q, { ix: p.ix - b.x, iy: p.iy - b.y, ox: p.ox - b.x, oy: p.oy - b.y });
      return q;
    });
    const id = this.commit(() => this.store.add({ type: 'path', page: this.page, parent: this.containerAt(b.x + b.w / 2, b.y + b.h / 2)?.id || null, name: 'Vetor', x: b.x, y: b.y, w: Math.max(1, b.w), h: Math.max(1, b.h), points: pts, closed, fill: closed ? { ...DEFAULT_FILL } : null, stroke: { color: '#2B1D17', alpha: 1 }, strokeWidth: 2 }));
    this.select([id]);
    this.setTool('select');
  }

  onMove(e) {
    const p = this.local(e);
    const w = this.toWorld(p.x, p.y);
    this.mouse = { x: w.x, y: w.y, sx: p.x, sy: p.y };
    this.sendCursor();
    const d = this.drag;
    if (this.measuring !== (e.altKey && !d)) {
      this.measuring = e.altKey && !d;
      this.invalidate();
    }
    if (!d) {
      if (this.tool === 'select' || this.tool === 'scale' || this.tool === 'connector') {
        const handle = this.tool !== 'connector' ? this.handleAt(p.x, p.y) : null;
        const prevHover = this.hover;
        const hit = this.hitTest(w.x, w.y, { deep: e.ctrlKey || e.metaKey });
        const target = this.tool === 'connector' ? hit : this.selectable(hit);
        this.hover = target ? target.id : null;
        let cursor = this.tool === 'connector' ? 'crosshair' : 'default';
        if (handle) cursor = handle.kind === 'rotate' ? 'alias' : handle.kind === 'end' ? 'move' : CURSOR_FOR[handle.h] || 'default';
        else if (this.anchorHover(p.x, p.y)) cursor = 'copy';
        else if (this.tool !== 'connector' && this.guideAt(p.x, p.y)) cursor = this.guideAt(p.x, p.y).axis === 'x' ? 'ew-resize' : 'ns-resize';
        this.overlay.style.cursor = cursor;
        if (prevHover !== this.hover) this.emit({ hover: true });
      }
      if (this.pen) this.invalidate();
      if (this.hover || this.pen || this.tool !== 'select') this.invalidate();
      return;
    }
    if (d.type === 'pan') {
      this.camX = d.cx - (p.x - d.sx) / this.zoom;
      this.camY = d.cy - (p.y - d.sy) / this.zoom;
      this.viewChanged();
      return;
    }
    if (d.type === 'marquee') {
      d.b = w;
      const box = aabb([d.a, d.b]);
      const ids = new Set(d.base);
      for (const n of this.drawOrder()) {
        if (!this.isVisible(n) || this.isLocked(n)) continue;
        const sel = this.selectable(n);
        if (!sel || (sel.id !== n.id)) continue;
        if (n.parent && !this.entered) {
          const par = this.store.get(n.parent);
          if (par && (par.type === 'frame' || par.type === 'component') && !par.parent) {
            const pb = nodeBounds(par, this.store);
            if (contains(box, pb)) continue;
          } else if (par && par.type !== 'section') continue;
        }
        const b = nodeBounds(n, this.store);
        if (isContainer(n) ? contains(box, b) : intersects(box, b) && (n.type !== 'connector' || contains(box, b))) ids.add(n.id);
      }
      this.sel = ids;
      this.invalidate();
      this.emit({ selection: true });
      return;
    }
    if (d.type === 'move') return this.moveDrag(d, w, e);
    if (d.type === 'resize') return this.resizeDrag(d, w, e);
    if (d.type === 'rotate') {
      let a = ((Math.atan2(w.y - d.c.y, w.x - d.c.x) - d.a0) * 180) / Math.PI;
      if (e.shiftKey) a = Math.round(a / 15) * 15;
      this.commit(() => {
        for (const id of d.ids) {
          const s = d.start.get(id);
          if (!s) continue;
          const c0 = { x: s.x + s.w / 2, y: s.y + s.h / 2 };
          const c1 = d.ids.size > 1 ? rotatePoint(c0.x, c0.y, d.c.x, d.c.y, (a * Math.PI) / 180) : c0;
          let rot = ((s.rotation || 0) + a) % 360;
          if (rot > 180) rot -= 360;
          if (rot < -180) rot += 360;
          this.store.update(id, { rotation: round(rot, 100), x: round(c1.x - s.w / 2), y: round(c1.y - s.h / 2) });
        }
      });
      this.rotHint = a;
      return;
    }
    if (d.type === 'create') return this.createDrag(d, w, e);
    if (d.type === 'connect') {
      d.moved = d.moved || Math.hypot(w.x - d.start.x, w.y - d.start.y) * this.zoom > 3;
      d.cur = w;
      const hit = d.tool === 'connector' ? this.hitTest(w.x, w.y) : null;
      d.target = hit && hit.id !== d.from.node && hit.type !== 'connector' ? hit : null;
      if (e.shiftKey && d.tool !== 'connector') {
        const s = d.from.node ? anchorOf(this.store.get(d.from.node), d.from.side) : d.from;
        const ang = Math.round(Math.atan2(w.y - s.y, w.x - s.x) / (Math.PI / 4)) * (Math.PI / 4);
        const len = Math.hypot(w.x - s.x, w.y - s.y);
        d.cur = { x: s.x + Math.cos(ang) * len, y: s.y + Math.sin(ang) * len };
      }
      this.invalidate();
      return;
    }
    if (d.type === 'end') {
      const n = this.store.get(d.id);
      if (!n) return;
      const hit = this.hitTest(w.x, w.y, { skip: new Set([d.id]) });
      const end = hit && hit.type !== 'connector' ? { node: hit.id, side: nearestAnchor(hit, w.x, w.y).side } : { x: this.px(w.x), y: this.px(w.y) };
      this.commit(() => this.store.update(d.id, { [d.end]: end }));
      return;
    }
    if (d.type === 'penhandle') {
      const pt = d.pt;
      if (Math.hypot(w.x - pt.x, w.y - pt.y) * this.zoom > 3) {
        pt.ox = w.x;
        pt.oy = w.y;
        pt.ix = pt.x * 2 - w.x;
        pt.iy = pt.y * 2 - w.y;
      }
      this.invalidate();
      return;
    }
    if (d.type === 'pencil') {
      const last = d.pts[d.pts.length - 1];
      if (Math.hypot(w.x - last.x, w.y - last.y) * this.zoom > 1.5) d.pts.push(w);
      this.invalidate();
    }
  }

  moveDrag(d, w, e) {
    let dx = w.x - d.w0.x;
    let dy = w.y - d.w0.y;
    if (!d.moved && Math.hypot(dx, dy) * this.zoom < 3) return;
    d.moved = true;
    if (e.shiftKey) {
      if (Math.abs(dx) > Math.abs(dy)) dy = 0;
      else dx = 0;
    }
    const b = d.box;
    let nb = { x: b.x + dx, y: b.y + dy, w: b.w, h: b.h };
    if (this.settings.pixelSnap) {
      nb.x = Math.round(nb.x);
      nb.y = Math.round(nb.y);
    }
    const snap = e.ctrlKey || e.metaKey ? { dx: 0, dy: 0, guides: [] } : this.snapBox(nb, d.cand);
    dx = nb.x + snap.dx - b.x;
    dy = nb.y + snap.dy - b.y;
    this.guides = snap.guides;
    this.commit(() => {
      for (const [id, s] of d.start) {
        if (s.type === 'connector') {
          const patch = {};
          for (const end of ['from', 'to']) if (s[end] && !s[end].node) patch[end] = { x: s[end].x + dx, y: s[end].y + dy };
          if (Object.keys(patch).length) this.store.update(id, patch);
          continue;
        }
        this.store.update(id, { x: round(s.x + dx), y: round(s.y + dy) });
      }
    });
    d.dx = dx;
    d.dy = dy;
  }

  resizeDrag(d, w, e) {
    const h = d.h;
    const box = d.box;
    const rot = ((box.rotation || 0) * Math.PI) / 180;
    const [fx, fy] = HANDLE_POS[h];
    const ax = 1 - fx;
    const ay = 1 - fy;
    const c0 = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
    const anchorW = rotatePoint(box.x + box.w * ax, box.y + box.h * ay, c0.x, c0.y, rot);
    const lp = rotatePoint(w.x, w.y, anchorW.x, anchorW.y, -rot);
    let nx0 = 0;
    let ny0 = 0;
    let nw = box.w;
    let nh = box.h;
    const relX = lp.x - anchorW.x;
    const relY = lp.y - anchorW.y;
    if (h.includes('e') || h.includes('w')) nw = fx === 1 ? relX : -relX;
    if (h.includes('n') || h.includes('s')) nh = fy === 1 ? relY : -relY;
    const keepRatio = e.shiftKey || (d.ids.size === 1 && !!d.start.get([...d.ids][0])?.lockRatio);
    if (keepRatio && h.length === 2) {
      const r = box.w / Math.max(box.h, 0.01);
      if (Math.abs(nw / r) > Math.abs(nh)) nh = Math.sign(nh || 1) * Math.abs(nw / r);
      else nw = Math.sign(nw || 1) * Math.abs(nh * r);
    } else if (keepRatio && h.length === 1) {
      const r = box.w / Math.max(box.h, 0.01);
      if (h === 'e' || h === 'w') nh = Math.abs(nw / r);
      else nw = Math.abs(nh * r);
    }
    const centered = e.altKey;
    if (!rot && !centered) {
      let left = fx === 1 ? anchorW.x : anchorW.x - nw;
      let top = fy === 1 ? anchorW.y : anchorW.y - nh;
      if (h === 'n' || h === 's') left = box.x;
      if (h === 'e' || h === 'w') top = box.y;
      let nbx = { x: Math.min(left, left + nw), y: Math.min(top, top + nh), w: Math.abs(nw), h: Math.abs(nh) };
      if (this.settings.pixelSnap) nbx = { x: Math.round(nbx.x), y: Math.round(nbx.y), w: Math.round(nbx.w), h: Math.round(nbx.h) };
      if (!(e.ctrlKey || e.metaKey)) {
        const axes = { x: h.includes('w') ? [0] : h.includes('e') ? [1] : [], y: h.includes('n') ? [0] : h.includes('s') ? [1] : [] };
        const s = this.snapBox(nbx, d.cand, axes);
        if (axes.x[0] === 0) { nbx.x += s.dx; nbx.w -= s.dx; }
        if (axes.x[0] === 1) nbx.w += s.dx;
        if (axes.y[0] === 0) { nbx.y += s.dy; nbx.h -= s.dy; }
        if (axes.y[0] === 1) nbx.h += s.dy;
        this.guides = s.guides;
      }
      return this.applyResize(d, nbx, nw < 0, nh < 0);
    }
    if (centered) {
      nw = Math.abs(h.includes('e') || h.includes('w') ? (lp.x - (c0.x - anchorW.x + anchorW.x)) * 2 : box.w);
      const lc = rotatePoint(w.x, w.y, c0.x, c0.y, -rot);
      if (h.includes('e') || h.includes('w')) nw = Math.abs(lc.x - c0.x) * 2;
      if (h.includes('n') || h.includes('s')) nh = Math.abs(lc.y - c0.y) * 2;
      return this.applyResize(d, { x: c0.x - nw / 2, y: c0.y - nh / 2, w: nw, h: nh }, false, false);
    }
    const lx = fx === 1 ? 0 : -nw;
    const ly = fy === 1 ? 0 : -nh;
    let localCx = lx + nw / 2;
    let localCy = ly + nh / 2;
    if (h === 'n' || h === 's') localCx = (0.5 - ax) * box.w;
    if (h === 'e' || h === 'w') localCy = (0.5 - ay) * box.h;
    const cw = rotatePoint(anchorW.x + localCx, anchorW.y + localCy, anchorW.x, anchorW.y, rot);
    nw = Math.abs(nw);
    nh = Math.abs(nh);
    return this.applyResize(d, { x: cw.x - nw / 2, y: cw.y - nh / 2, w: nw, h: nh }, false, false);
  }

  applyResize(d, nb, flipX, flipY) {
    const box = d.box;
    nb.w = Math.max(nb.w, 1);
    nb.h = Math.max(nb.h, 1);
    const sx = nb.w / Math.max(box.w, 0.01);
    const sy = nb.h / Math.max(box.h, 0.01);
    this.commit(() => {
      const single = d.ids.size === 1 ? [...d.ids][0] : null;
      for (const [id, s] of d.start) {
        if (s.type === 'connector') continue;
        const isTop = d.ids.has(id);
        const parentStart = s.parent ? d.start.get(s.parent) : null;
        if (single && id === single) {
          const patch = { x: round(nb.x), y: round(nb.y), w: round(nb.w), h: round(nb.h) };
          if (s.type === 'path') patch.points = s.points.map((p) => scalePt(p, sx, sy, flipX ? s.w : 0, flipY ? s.h : 0, flipX, flipY));
          if (s.type === 'text') {
            if (d.scale) patch.fontSize = round((s.fontSize || 16) * Math.min(sx, sy), 10);
            else if (s.autoSize !== 'none' && d.h !== 'n' && d.h !== 's') patch.autoSize = d.h.length === 1 ? 'height' : 'none';
            else patch.autoSize = 'none';
          }
          if (d.scale) {
            if (s.strokeWidth) patch.strokeWidth = round(s.strokeWidth * Math.min(sx, sy), 100);
            if (s.radius) patch.radius = round(s.radius * Math.min(sx, sy), 100);
            if (s.fontSize && s.type !== 'text') patch.fontSize = round(s.fontSize * Math.min(sx, sy), 10);
          }
          this.store.update(id, patch);
          continue;
        }
        if (single && !isTop && isContainer(d.start.get(single)) && s.parent === single && !d.scale) {
          const fr = d.start.get(single);
          const c = s.constraints || { h: 'left', v: 'top' };
          const patch = {};
          const relX = s.x - fr.x;
          const relY = s.y - fr.y;
          if (c.h === 'right') patch.x = nb.x + nb.w - (fr.w - relX);
          else if (c.h === 'center') patch.x = nb.x + nb.w / 2 - (fr.w / 2 - relX);
          else if (c.h === 'scale') { patch.x = nb.x + relX * sx; patch.w = s.w * sx; }
          else if (c.h === 'stretch') { patch.x = nb.x + relX; patch.w = nb.w - (fr.w - s.w); }
          else patch.x = nb.x + relX;
          if (c.v === 'bottom') patch.y = nb.y + nb.h - (fr.h - relY);
          else if (c.v === 'center') patch.y = nb.y + nb.h / 2 - (fr.h / 2 - relY);
          else if (c.v === 'scale') { patch.y = nb.y + relY * sy; patch.h = s.h * sy; }
          else if (c.v === 'stretch') { patch.y = nb.y + relY; patch.h = Math.max(1, nb.h - (fr.h - s.h)); }
          else patch.y = nb.y + relY;
          const ddx = patch.x - s.x;
          const ddy = patch.y - s.y;
          for (const k of Object.keys(patch)) patch[k] = round(patch[k]);
          this.store.update(id, patch);
          for (const desc of this.store.descendants(id)) {
            const ds = d.start.get(desc.id);
            if (ds) this.store.update(desc.id, { x: round(ds.x + ddx), y: round(ds.y + ddy) });
          }
          continue;
        }
        if (single && isContainer(d.start.get(single)) && !d.scale) continue;
        if (!isTop && !(parentStart || d.ids.size > 1 || single)) continue;
        const patch = { x: round(nb.x + (s.x - box.x) * sx), y: round(nb.y + (s.y - box.y) * sy), w: round(Math.max(1, s.w * sx)), h: round(Math.max(1, s.h * sy)) };
        if (s.type === 'path') patch.points = s.points.map((p) => scalePt(p, sx, sy, 0, 0, false, false));
        if (d.scale || s.type === 'text') {
          if (s.fontSize) patch.fontSize = round(s.fontSize * Math.min(sx, sy), 10);
          if (s.strokeWidth && d.scale) patch.strokeWidth = round(s.strokeWidth * Math.min(sx, sy), 100);
        }
        this.store.update(id, patch);
      }
    });
  }

  createDrag(d, w, e) {
    const s = d.start;
    let x1 = this.px(w.x);
    let y1 = this.px(w.y);
    if (!d.moved && Math.hypot(x1 - s.x, y1 - s.y) * this.zoom < 3) return;
    d.moved = true;
    let dw = x1 - s.x;
    let dh = y1 - s.y;
    if (e.shiftKey) {
      const m = Math.max(Math.abs(dw), Math.abs(dh));
      dw = Math.sign(dw || 1) * m;
      dh = Math.sign(dh || 1) * m;
    }
    let box = e.altKey ? { x: s.x - Math.abs(dw), y: s.y - Math.abs(dh), w: Math.abs(dw) * 2, h: Math.abs(dh) * 2 } : { x: Math.min(s.x, s.x + dw), y: Math.min(s.y, s.y + dh), w: Math.abs(dw), h: Math.abs(dh) };
    const snap = this.snapBox(box, d.cand || (d.cand = this.snapCandidates(new Set(d.id ? [d.id] : []))), { x: [dw < 0 ? 0 : 1], y: [dh < 0 ? 0 : 1] });
    if (dw < 0) { box.x += snap.dx; box.w -= snap.dx; } else box.w += snap.dx;
    if (dh < 0) { box.y += snap.dy; box.h -= snap.dy; } else box.h += snap.dy;
    this.guides = snap.guides;
    box.w = Math.max(1, box.w);
    box.h = Math.max(1, box.h);
    this.commit(() => {
      if (!d.id) d.id = this.store.add(this.newShape(d.tool, box));
      else this.store.update(d.id, box);
    });
    if (!this.sel.has(d.id)) this.select([d.id]);
  }

  newShape(tool, box) {
    const parent = this.containerAt(box.x + 1, box.y + 1);
    const base = { page: this.page, parent: parent?.id || null, ...box };
    const count = (t) => this.pageNodes().filter((n) => n.type === t).length + 1;
    switch (tool) {
      case 'frame':
        return { ...base, type: 'frame', name: `Frame ${count('frame')}`, fill: { ...FRAME_FILL }, clip: true, radius: 0 };
      case 'section':
        return { ...base, parent: null, type: 'section', name: `Seção ${count('section')}`, text: `Seção ${count('section')}`, fill: { type: 'solid', color: '#E6DDCE', alpha: 0.6 }, stroke: { color: '#A8977F', alpha: 1 }, strokeWidth: 1, radius: 6, fontSize: 14, fontWeight: 600 };
      case 'ellipse':
        return { ...base, type: 'ellipse', name: `Elipse ${count('ellipse')}`, fill: { ...DEFAULT_FILL } };
      case 'polygon':
        return { ...base, type: 'polygon', name: `Polígono ${count('polygon')}`, sides: 3, fill: { ...DEFAULT_FILL } };
      case 'star':
        return { ...base, type: 'star', name: `Estrela ${count('star')}`, sides: 5, inner: 0.45, fill: { type: 'solid', color: '#F6E4A6', alpha: 1 } };
      default:
        return { ...base, type: 'rect', name: `Retângulo ${count('rect')}`, fill: { ...DEFAULT_FILL }, radius: 0 };
    }
  }

  createText(x, y, text = '') {
    const parent = this.containerAt(x, y);
    return this.commit(() => this.store.add({ type: 'text', page: this.page, parent: parent?.id || null, name: 'Texto', x: this.px(x), y: this.px(y - 10), w: 10, h: 20, text, fontSize: 16, fontWeight: 400, lineHeight: 1.25, fontFamily: 'Sistema', autoSize: 'width', fill: { type: 'solid', color: '#2B1D17', alpha: 1 } }));
  }

  onUp(e) {
    const d = this.drag;
    try {
      this.overlay.releasePointerCapture(e.pointerId);
    } catch {}
    if (!d) return;
    this.drag = null;
    this.stopCapture();
    this.guides = [];
    this.rotHint = null;
    if (d.type === 'pan') {
      this.overlay.style.cursor = this.tool === 'hand' ? 'grab' : 'default';
    } else if (d.type === 'move' && d.moved) {
      this.reparentAfterMove(d);
    } else if (d.type === 'move' && !d.moved) {
      const now = performance.now();
      this.lastClick = { t: now, x: d.w0.x, y: d.w0.y };
    } else if (d.type === 'create') {
      if (!d.id) {
        const sz = d.tool === 'frame' ? { w: 360, h: 640 } : d.tool === 'section' ? { w: 600, h: 400 } : { w: 100, h: 100 };
        const box = { x: d.start.x - (d.tool === 'frame' || d.tool === 'section' ? 0 : sz.w / 2), y: d.start.y - (d.tool === 'frame' || d.tool === 'section' ? 0 : sz.h / 2), ...sz };
        const id = this.commit(() => this.store.add(this.newShape(d.tool, box)));
        this.select([id]);
      }
      if (d.tool === 'frame' || d.tool === 'section') this.adoptInto(d.id || [...this.sel][0]);
      if (!e.shiftKey || true) this.setTool('select');
    } else if (d.type === 'connect') {
      const end = d.cur || d.start;
      if (!d.moved && d.tool !== 'connector') {
        this.setTool('select');
        return;
      }
      let to;
      if (d.target) to = { node: d.target.id, side: nearestAnchor(d.target, end.x, end.y).side };
      else to = { x: this.px(end.x), y: this.px(end.y) };
      if (!d.moved) {
        const src = this.store.get(d.from.node);
        if (!src) return;
        const side = d.from.side;
        const off = { top: [0, -1], right: [1, 0], bottom: [0, 1], left: [-1, 0] }[side];
        const nx = src.x + off[0] * (src.w + 80);
        const ny = src.y + off[1] * (src.h + 60);
        const id = this.commit(() => {
          const nid = this.store.add({ ...structuredClone(src), id: undefined, z: undefined, x: nx, y: ny, text: '', name: src.name });
          this.store.add(this.newConnector({ node: src.id, side }, { node: nid, side: { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }[side] }, 'connector'));
          return nid;
        });
        this.select([id]);
        return;
      }
      const id = this.commit(() => this.store.add(this.newConnector(d.from, to, d.tool)));
      this.select([id]);
      if (d.tool !== 'connector') this.setTool('select');
    } else if (d.type === 'pencil') {
      if (d.pts.length > 1) this.finishPencil(d.pts);
    } else if (d.type === 'marquee') {
      this.emit({ selection: true });
    }
    this.invalidate();
    this.pushPresence();
  }

  newConnector(from, to, tool) {
    const routing = tool === 'connector' ? 'elbow' : 'straight';
    return { type: 'connector', page: this.page, parent: null, name: tool === 'connector' ? 'Conector' : tool === 'arrow' ? 'Seta' : 'Linha', x: 0, y: 0, w: 0, h: 0, from, to, routing, startCap: 'none', endCap: tool === 'line' ? 'none' : tool === 'arrow' ? 'arrow' : 'triangle', stroke: { color: '#2B1D17', alpha: 1 }, strokeWidth: tool === 'connector' ? 1.6 : 2, text: '' };
  }

  finishPencil(pts) {
    let simple = pts;
    try {
      simple = Engine.simplify(pts, 1.2 / this.zoom);
    } catch {}
    let curve = null;
    try {
      curve = Engine.smooth(simple);
    } catch {}
    const nodePts = [];
    if (curve && curve.length >= 2) {
      for (let i = 0; i < curve.length; i++) {
        const c = curve[i];
        const prev = curve[i - 1];
        const q = { x: c.x, y: c.y };
        if (prev) {
          q.ix = prev.c2x;
          q.iy = prev.c2y;
        }
        if (i < curve.length - 1) {
          q.ox = c.c1x;
          q.oy = c.c1y;
        }
        nodePts.push(q);
      }
    } else for (const p of simple) nodePts.push({ x: p.x, y: p.y });
    const all = [];
    for (const p of nodePts) {
      all.push({ x: p.x, y: p.y });
      if (p.ix !== undefined) all.push({ x: p.ix, y: p.iy });
      if (p.ox !== undefined) all.push({ x: p.ox, y: p.oy });
    }
    const b = aabb(all);
    const rel = nodePts.map((p) => {
      const q = { x: p.x - b.x, y: p.y - b.y };
      if (p.ix !== undefined) { q.ix = p.ix - b.x; q.iy = p.iy - b.y; }
      if (p.ox !== undefined) { q.ox = p.ox - b.x; q.oy = p.oy - b.y; }
      return q;
    });
    const id = this.commit(() => this.store.add({ type: 'path', page: this.page, parent: this.containerAt(pts[0].x, pts[0].y)?.id || null, name: 'Desenho', x: b.x, y: b.y, w: Math.max(1, b.w), h: Math.max(1, b.h), points: rel, closed: false, fill: null, stroke: { color: '#5D1C16', alpha: 1 }, strokeWidth: 3 }));
    this.select([id]);
  }

  adoptInto(frameId) {
    const fr = this.store.get(frameId);
    if (!fr) return;
    this.commit(() => {
      for (const n of this.pageNodes()) {
        if (n.id === fr.id || (n.parent || null) !== (fr.parent || null) || n.type === 'connector') continue;
        if (fr.type === 'section' && n.type === 'section') continue;
        if (contains(fr, nodeBounds(n, this.store)) && n.z < fr.z + 1e9) {
          this.store.update(n.id, { parent: fr.id, z: this.store.nextZ(fr.id) });
        }
      }
    });
  }

  reparentAfterMove(d) {
    const tops = [...d.ids].map((id) => this.store.get(id)).filter((n) => n && n.type !== 'connector');
    const exclude = d.movers;
    this.commit(() => {
      for (const n of tops) {
        const parent = n.parent ? this.store.get(n.parent) : null;
        if (parent && (parent.type === 'group' || parent.type === 'boolean')) continue;
        const b = nodeBounds(n, this.store);
        const cx = b.x + b.w / 2;
        const cy = b.y + b.h / 2;
        let target = this.containerAt(this.mouse.x, this.mouse.y, exclude);
        if (!target) target = this.containerAt(cx, cy, exclude);
        if (n.type === 'section' && target && target.type !== 'section') target = null;
        const tid = target ? target.id : null;
        if (target && target.layout && target.layout.mode && target.layout.mode !== 'none' && tid === (n.parent || null)) {
          const kids = this.store.childrenOf(tid).filter((k) => k.id !== n.id);
          const horiz = target.layout.mode === 'h';
          let idx = kids.findIndex((k) => (horiz ? this.mouse.x < k.x + k.w / 2 : this.mouse.y < k.y + k.h / 2));
          if (idx < 0) idx = kids.length;
          const before = kids[idx - 1];
          const after = kids[idx];
          const z = before && after ? (before.z + after.z) / 2 : before ? before.z + 1 : after ? after.z - 1 : 1;
          this.store.update(n.id, { z });
          continue;
        }
        if (tid !== (n.parent || null)) this.store.update(n.id, { parent: tid, z: this.store.nextZ(tid, this.page) });
      }
    });
  }

  onDouble(e) {
    const p = this.local(e);
    const w = this.toWorld(p.x, p.y);
    if (this.pen) {
      this.finishPen(false);
      return;
    }
    const raw = this.hitTest(w.x, w.y, { deep: true });
    if (!raw) return;
    const cur = this.selection[0];
    if (cur && (cur.type === 'group' || cur.type === 'boolean') && raw.id !== cur.id && this.store.ancestors(raw.id).some((a) => a.id === cur.id)) {
      this.entered = cur.id;
      const inner = this.selectable(raw);
      this.select([inner.id]);
      return;
    }
    const n = this.selectable(raw);
    if (n.type === 'instance') {
      const comp = this.store.get(n.componentId);
      if (comp) this.emit({ toast: 'Instância: edite pelo painel Design ou desanexe para alterar a estrutura' });
      return;
    }
    if (hasText(n) || n.type === 'connector') {
      this.select([n.id]);
      this.editText(n.id);
    }
  }

  editText(id) {
    const n = this.store.get(id);
    if (!n) return;
    this.finishText();
    const layer = this.dom.htmlLayer;
    const ta = document.createElement('textarea');
    ta.className = 'text-editor';
    ta.spellcheck = false;
    ta.value = n.text || '';
    layer.append(ta);
    this.editing = { id, ta, orig: n.text || '' };
    this.r.editingText = id;
    this.positionEditor();
    ta.addEventListener('input', () => {
      const cur = this.store.get(id);
      if (!cur) return;
      this.commit(() => {
        const patch = { text: ta.value };
        if (cur.type === 'text') {
          const fit = fitText({ ...cur, text: ta.value }, this.store);
          if (fit) Object.assign(patch, fit);
        }
        this.store.update(id, patch);
      });
      this.positionEditor();
    });
    ta.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Escape' || (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey))) {
        ev.preventDefault();
        this.finishText();
        this.overlay.focus();
      }
    });
    ta.addEventListener('blur', () => setTimeout(() => this.editing && this.editing.ta === ta && this.finishText(), 0));
    ta.focus();
    ta.select();
    this.invalidate();
  }

  positionEditor() {
    const ed = this.editing;
    if (!ed) return;
    const n = this.store.get(ed.id);
    if (!n) return this.finishText();
    const ta = ed.ta;
    const z = this.zoom;
    let box = n.type === 'connector' ? null : textBox(n);
    let x;
    let y;
    let wpx;
    let hpx;
    if (n.type === 'connector') {
      const r = connectorRoute(n, this.store);
      const pts = r.points;
      const mid = pts[Math.floor(pts.length / 2)];
      const s = this.toScreen(mid.x, mid.y);
      x = s.x - 60;
      y = s.y - 10;
      wpx = 120;
      hpx = 22;
      ta.style.textAlign = 'center';
      ta.style.font = `${13 * z}px system-ui`;
    } else {
      const s = this.toScreen(n.x + box.x, n.y + box.y);
      x = s.x;
      y = s.y;
      wpx = Math.max(box.w * z, 20);
      const t = layoutText({ ...n, text: ta.value || ' ' }, this.store);
      hpx = Math.max(t.height * z, (n.fontSize || 16) * 1.3 * z);
      const valign = n.type === 'text' || n.type === 'sticky' ? 'top' : 'middle';
      if (valign === 'middle' && !box.below) y += Math.max(0, (box.h * z - hpx) / 2);
      if (n.type === 'text' && (n.autoSize || 'width') === 'width') wpx = Math.max(t.width * z + 24, 40);
      const def = n.type === 'shape' ? shapeDef(n.shape) : null;
      ta.style.font = fontCss({ ...n, fontSize: (n.fontSize || 16) * z });
      ta.style.lineHeight = (n.fontSize || 16) * (n.lineHeight || 1.25) * z + 'px';
      ta.style.letterSpacing = (n.letterSpacing || 0) * z + 'px';
      ta.style.textAlign = n.align || (def && def.align) || (n.type === 'text' || n.type === 'sticky' ? 'left' : 'center');
      ta.style.color = n.textColor || (n.type === 'text' ? (n.fill && n.fill.color) || '#2B1D17' : def && def.invertText ? '#FAF3E6' : '#2B1D17');
    }
    ta.style.left = x + 'px';
    ta.style.top = y + 'px';
    ta.style.width = wpx + 'px';
    ta.style.height = hpx + 'px';
    ta.style.transform = n.rotation && n.type !== 'connector' ? `rotate(${n.rotation}deg)` : '';
    ta.style.transformOrigin = n.type !== 'connector' ? `${(n.w * z) / 2 - (box ? box.x * z : 0)}px ${(n.h * z) / 2 - (box ? box.y * z : 0)}px` : '';
  }

  finishText() {
    const ed = this.editing;
    if (!ed) return;
    this.editing = null;
    this.r.editingText = null;
    const n = this.store.get(ed.id);
    ed.ta.remove();
    this.stopCapture();
    if (n && n.type === 'text' && !String(n.text || '').trim()) this.commit(() => this.store.remove([n.id]));
    this.invalidate();
  }

  relayout() {
    const s = this.store;
    const touched = [];
    for (const n of s.nodes.values()) {
      if (n.layout && n.layout.mode && n.layout.mode !== 'none' && isContainer(n)) touched.push(n);
    }
    touched.sort((a, b) => s.ancestors(b.id).length - s.ancestors(a.id).length);
    for (const fr of touched) {
      const cur = s.get(fr.id);
      const L = cur.layout;
      const kids = s.childrenOf(cur.id).filter((k) => k.visible !== false && !k.absolute && k.type !== 'connector');
      const pad = L.padding ?? 16;
      const gap = L.gap ?? 10;
      const horiz = L.mode === 'h';
      let main = 0;
      let cross = 0;
      for (let i = 0; i < kids.length; i++) {
        let k = kids[i];
        if (k.type === 'text' && (k.autoSize || 'width') !== 'none') {
          const fit = fitText(L.align === 'stretch' ? { ...k, [horiz ? 'h' : 'w']: (horiz ? cur.h : cur.w) - (L.padding ?? 16) * 2, autoSize: horiz ? k.autoSize : 'height' } : k, s);
          if (fit && (fit.w !== k.w || fit.h !== k.h)) {
            s.update(k.id, fit);
            kids[i] = k = s.get(k.id);
          }
        }
        main += horiz ? k.w : k.h;
        cross = Math.max(cross, horiz ? k.h : k.w);
      }
      main += gap * Math.max(0, kids.length - 1);
      const hugMain = L.hug !== false;
      const hugCross = L.hugCross !== false;
      let fw = cur.w;
      let fh = cur.h;
      if (horiz) {
        if (hugMain) fw = main + pad * 2;
        if (hugCross) fh = cross + pad * 2;
      } else {
        if (hugMain) fh = main + pad * 2;
        if (hugCross) fw = cross + pad * 2;
      }
      fw = Math.max(1, round(fw));
      fh = Math.max(1, round(fh));
      if (fw !== cur.w || fh !== cur.h) s.update(cur.id, { w: fw, h: fh });
      const innerMain = (horiz ? fw : fh) - pad * 2;
      const innerCross = (horiz ? fh : fw) - pad * 2;
      let off = pad;
      if (!hugMain && L.justify === 'center') off = pad + (innerMain - main) / 2;
      else if (!hugMain && L.justify === 'end') off = pad + innerMain - main;
      let g = gap;
      if (!hugMain && L.justify === 'between' && kids.length > 1) {
        g = (innerMain - (main - gap * (kids.length - 1))) / (kids.length - 1);
        off = pad;
      }
      for (let k of kids) {
        k = s.get(k.id);
        if (L.align === 'stretch') {
          const want = round(innerCross);
          if (horiz ? k.h !== want : k.w !== want) {
            s.update(k.id, horiz ? { h: want } : { w: want, ...(k.type === 'text' && (k.autoSize || 'width') === 'width' ? { autoSize: 'height' } : {}) });
            k = s.get(k.id);
          }
        }
        if (k.type === 'text' && (k.autoSize || 'width') !== 'none') {
          const fit = fitText(k, s);
          if (fit && (fit.w !== k.w || fit.h !== k.h)) {
            s.update(k.id, fit);
            k = s.get(k.id);
          }
        }
        const size = horiz ? k.h : k.w;
        let c = pad;
        if (L.align === 'center') c = pad + (innerCross - size) / 2;
        else if (L.align === 'end') c = pad + innerCross - size;
        const patch = {};
        if (L.align === 'stretch') {
          if (horiz) patch.h = round(innerCross);
          else patch.w = round(innerCross);
        }
        const nx = round(cur.x + (horiz ? off : c));
        const ny = round(cur.y + (horiz ? c : off));
        if (nx !== k.x || ny !== k.y) {
          const ddx = nx - k.x;
          const ddy = ny - k.y;
          patch.x = nx;
          patch.y = ny;
          for (const d of s.descendants(k.id)) s.update(d.id, { x: round(d.x + ddx), y: round(d.y + ddy) });
        }
        if (Object.keys(patch).length) s.update(k.id, patch);
        off += (horiz ? k.w : k.h) + g;
      }
    }
    const groups = [];
    for (const n of s.nodes.values()) if (n.type === 'group' || n.type === 'boolean') groups.push(n);
    groups.sort((a, b) => s.ancestors(b.id).length - s.ancestors(a.id).length);
    for (const gNode of groups) {
      const kids = s.childrenOf(gNode.id);
      if (!kids.length) {
        s.remove([gNode.id]);
        continue;
      }
      const b = union(kids.map((k) => nodeBounds(k, s)));
      if (b && (round(b.x) !== gNode.x || round(b.y) !== gNode.y || round(b.w) !== gNode.w || round(b.h) !== gNode.h)) s.update(gNode.id, { x: round(b.x), y: round(b.y), w: round(b.w), h: round(b.h) });
    }
  }

  destroy() {
    this.dead = true;
    this.finishText();
    if (this.abort) this.abort.abort();
    if (this.ro) this.ro.disconnect();
    this.listeners.clear();
  }

  loop() {
    const tick = (now) => {
      if (this.dead) return;
      if (this.tween) this.tween(now);
      if (this.dirty) {
        this.dirty = false;
        try {
          this.r.setView(this.camX, this.camY, this.zoom);
          this.r.render(this.page);
          this.drawOverlay();
          this.drawRulers();
          this.drawMinimap();
          this.positionEditor();
          this.emit({ frame: true });
        } catch (err) {
          console.error(err);
        }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  pushPresence() {
    const a = this.store.awareness;
    a.setLocalStateField('cursor', { x: round(this.mouse.x), y: round(this.mouse.y), page: this.page });
    a.setLocalStateField('selection', [...this.sel].slice(0, 50));
  }

  theme() {
    const cs = getComputedStyle(document.documentElement);
    return { accent: cs.getPropertyValue('--accent').trim() || '#5D1C16', text: cs.getPropertyValue('--text').trim(), dark: document.documentElement.dataset.theme === 'dark', surface: cs.getPropertyValue('--surface').trim(), faint: cs.getPropertyValue('--text-faint').trim(), border: cs.getPropertyValue('--border').trim(), muted: cs.getPropertyValue('--text-muted').trim(), surface2: cs.getPropertyValue('--surface-2').trim(), accentText: cs.getPropertyValue('--accent-text').trim() };
  }

  drawOverlay() {
    const c = this.octx;
    const dpr = this.dpr || 1;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, this.overlay.width, this.overlay.height);
    const th = this.theme();
    const sel = th.accent;
    const z = this.zoom;
    const S = (x, y) => this.toScreen(x, y);
    const polyPath = (pts) => {
      c.beginPath();
      pts.forEach((p, i) => {
        const s = S(p.x, p.y);
        if (i) c.lineTo(s.x, s.y);
        else c.moveTo(s.x, s.y);
      });
      c.closePath();
    };
    c.font = '11px system-ui, sans-serif';
    for (const n of this.drawOrder()) {
      if ((n.type === 'frame' || n.type === 'component') && !n.parent && this.isVisible(n)) {
        const s = S(n.x, n.y);
        c.fillStyle = n.type === 'component' ? '#6B4E71' : this.sel.has(n.id) ? sel : th.faint;
        c.fillText((n.type === 'component' ? '❖ ' : '') + (n.name || 'Frame'), s.x, s.y - 5);
      }
      if (this.settings.outlines && n.type !== 'connector') {
        c.strokeStyle = th.faint;
        c.lineWidth = 0.5;
        polyPath(corners(n));
        c.stroke();
      }
      if (n.link && n.link.to && this.emitLinks) {
        const tgt = this.store.get(n.link.to);
        if (tgt) {
          const a = S(n.x + n.w, n.y + n.h / 2);
          const b = S(tgt.x, tgt.y + 20);
          c.strokeStyle = '#3F6A80';
          c.lineWidth = 1.5;
          c.beginPath();
          c.moveTo(a.x, a.y);
          c.bezierCurveTo(a.x + 60, a.y, b.x - 60, b.y, b.x, b.y);
          c.stroke();
          c.fillStyle = '#3F6A80';
          c.beginPath();
          c.arc(a.x, a.y, 4, 0, Math.PI * 2);
          c.fill();
        }
      }
    }
    if (this.hover && !this.sel.has(this.hover) && !this.drag) {
      const n = this.store.get(this.hover);
      if (n && n.page === this.page) {
        c.strokeStyle = sel;
        c.lineWidth = 1.5;
        if (n.type === 'connector') {
          const r = connectorRoute(n, this.store);
          c.beginPath();
          r.points.forEach((p, i) => {
            const s = S(p.x, p.y);
            if (i) c.lineTo(s.x, s.y);
            else c.moveTo(s.x, s.y);
          });
          c.stroke();
        } else {
          polyPath(corners(n));
          c.stroke();
          if (this.tool === 'select' && n.type !== 'text' && n.type !== 'group' && (!isContainer(n) || n.type === 'shape') && this.sel.size <= 1) {
            for (const side of ['top', 'right', 'bottom', 'left']) {
              const a = anchorOf(n, side);
              const off = 16 / z;
              const dirs = { top: [0, -off], right: [off, 0], bottom: [0, off], left: [-off, 0] };
              const s = S(a.x + dirs[side][0], a.y + dirs[side][1]);
              c.fillStyle = th.dark ? th.surface2 : '#FFFFFF';
              c.strokeStyle = sel;
              c.lineWidth = 1.5;
              c.beginPath();
              c.arc(s.x, s.y, 5, 0, Math.PI * 2);
              c.fill();
              c.stroke();
            }
          }
        }
      }
    }
    for (const [cid, st] of this.store.awareness.getStates()) {
      if (cid === this.store.doc.clientID || !st.selection || !st.user || !st.cursor || st.cursor.page !== this.page) continue;
      c.strokeStyle = st.user.color;
      c.lineWidth = 2;
      for (const id of st.selection) {
        const n = this.store.get(id);
        if (!n || n.page !== this.page || n.type === 'connector') continue;
        polyPath(corners(n));
        c.stroke();
      }
    }
    const selNodes = this.selection.filter((n) => n.page === this.page);
    if (selNodes.length) {
      c.strokeStyle = sel;
      c.lineWidth = 1;
      for (const n of selNodes) {
        if (n.type === 'connector') {
          const r = connectorRoute(n, this.store);
          c.lineWidth = 2;
          c.beginPath();
          r.points.forEach((p, i) => {
            const s = S(p.x, p.y);
            if (i) c.lineTo(s.x, s.y);
            else c.moveTo(s.x, s.y);
          });
          c.stroke();
          for (const p of [r.points[0], r.points[r.points.length - 1]]) {
            const s = S(p.x, p.y);
            c.fillStyle = '#FFFFFF';
            c.beginPath();
            c.arc(s.x, s.y, 5, 0, Math.PI * 2);
            c.fill();
            c.stroke();
          }
          continue;
        }
        polyPath(corners(n));
        c.stroke();
      }
      const single = selNodes.length === 1 ? selNodes[0] : null;
      if (!(single && single.type === 'connector')) {
        const box = single ? single : { ...this.selectionBox(), rotation: 0 };
        const pts = corners(box);
        if (!single) {
          c.setLineDash([4, 3]);
          polyPath(pts);
          c.stroke();
          c.setLineDash([]);
        }
        const a = ((box.rotation || 0) * Math.PI) / 180;
        const cx = box.x + box.w / 2;
        const cy = box.y + box.h / 2;
        const locked = selNodes.every((n) => this.isLocked(n));
        if (!locked) {
          for (const h of HANDLES) {
            const [fx, fy] = HANDLE_POS[h];
            if ((box.w * z < 14 || box.h * z < 14) && h.length === 1) continue;
            const wp = rotatePoint(box.x + box.w * fx, box.y + box.h * fy, cx, cy, a);
            const s = S(wp.x, wp.y);
            c.fillStyle = '#FFFFFF';
            c.strokeStyle = sel;
            c.lineWidth = 1.2;
            c.fillRect(s.x - 4, s.y - 4, 8, 8);
            c.strokeRect(s.x - 4, s.y - 4, 8, 8);
          }
        }
        if (!this.measuring || this.drag) {
          const b = aabb(pts);
          const bs = S(b.x + b.w / 2, b.y + b.h);
          const label = this.rotHint !== null && this.rotHint !== undefined ? `${Math.round(single ? single.rotation || 0 : this.rotHint)}°` : `${round(box.w, 10)} × ${round(box.h, 10)}`;
          const tw = c.measureText(label).width + 10;
          c.fillStyle = sel;
          roundRect(c, bs.x - tw / 2, bs.y + 8, tw, 18, 4);
          c.fill();
          c.fillStyle = th.accentText;
          c.textAlign = 'center';
          c.fillText(label, bs.x, bs.y + 21);
          c.textAlign = 'left';
        }
      }
    }
    if (this.drag && this.drag.type === 'marquee') {
      const a = S(this.drag.a.x, this.drag.a.y);
      const b = S(this.drag.b.x, this.drag.b.y);
      c.fillStyle = rgba(sel, 0.08);
      c.strokeStyle = sel;
      c.lineWidth = 1;
      c.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(a.x - b.x), Math.abs(a.y - b.y));
      c.strokeRect(Math.min(a.x, b.x) + 0.5, Math.min(a.y, b.y) + 0.5, Math.abs(a.x - b.x), Math.abs(a.y - b.y));
    }
    if (this.measuring && selNodes.length && !this.drag) this.drawMeasure(c, S, selNodes);
    if (this.settings.guides || this.guideDrag) this.drawGuides(c, th, sel);
    if (this.guides.length) {
      c.strokeStyle = '#D9480F';
      c.lineWidth = 1;
      for (const g of this.guides) {
        c.beginPath();
        if (g.axis === 'x') {
          const a = S(g.v, g.a);
          const b = S(g.v, g.b);
          c.moveTo(Math.round(a.x) + 0.5, a.y);
          c.lineTo(Math.round(b.x) + 0.5, b.y);
        } else {
          const a = S(g.a, g.v);
          const b = S(g.b, g.v);
          c.moveTo(a.x, Math.round(a.y) + 0.5);
          c.lineTo(b.x, Math.round(b.y) + 0.5);
        }
        c.stroke();
      }
    }
    const d = this.drag;
    if (d && d.type === 'connect') {
      const from = d.from.node ? anchorOf(this.store.get(d.from.node), d.from.side) : d.from;
      const to = d.target ? anchorOf(d.target, nearestAnchor(d.target, d.cur.x, d.cur.y).side) : d.cur || d.start;
      const a = S(from.x, from.y);
      const b = S(to.x, to.y);
      c.strokeStyle = sel;
      c.lineWidth = 2;
      c.setLineDash(d.tool === 'connector' ? [6, 4] : []);
      c.beginPath();
      if (d.tool === 'connector' && Math.abs(a.x - b.x) > 1 && Math.abs(a.y - b.y) > 1) {
        const mx = (a.x + b.x) / 2;
        c.moveTo(a.x, a.y);
        c.lineTo(mx, a.y);
        c.lineTo(mx, b.y);
        c.lineTo(b.x, b.y);
      } else {
        c.moveTo(a.x, a.y);
        c.lineTo(b.x, b.y);
      }
      c.stroke();
      c.setLineDash([]);
      if (d.target) {
        c.strokeStyle = sel;
        polyPath(corners(d.target));
        c.stroke();
      }
    }
    if (d && d.type === 'pencil') {
      c.strokeStyle = '#5D1C16';
      c.lineWidth = 3 * z;
      c.lineCap = 'round';
      c.lineJoin = 'round';
      c.beginPath();
      d.pts.forEach((p, i) => {
        const s = S(p.x, p.y);
        if (i) c.lineTo(s.x, s.y);
        else c.moveTo(s.x, s.y);
      });
      c.stroke();
    }
    if (this.pen && this.pen.points.length) {
      const pts = this.pen.points;
      c.strokeStyle = sel;
      c.lineWidth = 1.5;
      c.beginPath();
      const s0 = S(pts[0].x, pts[0].y);
      c.moveTo(s0.x, s0.y);
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1];
        const b = pts[i];
        const c1 = S(a.ox ?? a.x, a.oy ?? a.y);
        const c2 = S(b.ix ?? b.x, b.iy ?? b.y);
        const e = S(b.x, b.y);
        c.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, e.x, e.y);
      }
      const last = pts[pts.length - 1];
      const m = S(this.mouse.x, this.mouse.y);
      const lo = S(last.ox ?? last.x, last.oy ?? last.y);
      c.bezierCurveTo(lo.x, lo.y, m.x, m.y, m.x, m.y);
      c.stroke();
      for (const p of pts) {
        const s = S(p.x, p.y);
        if (p.ox !== undefined) {
          const o = S(p.ox, p.oy);
          const ii = S(p.ix, p.iy);
          c.strokeStyle = th.faint;
          c.beginPath();
          c.moveTo(ii.x, ii.y);
          c.lineTo(o.x, o.y);
          c.stroke();
          c.fillStyle = sel;
          c.beginPath();
          c.arc(o.x, o.y, 3, 0, 7);
          c.arc(ii.x, ii.y, 3, 0, 7);
          c.fill();
        }
        c.fillStyle = '#FFFFFF';
        c.strokeStyle = sel;
        c.fillRect(s.x - 4, s.y - 4, 8, 8);
        c.strokeRect(s.x - 4, s.y - 4, 8, 8);
      }
    }
    if (this.settings.grid && z >= 4) {
      const vp = this.r.viewport();
      c.strokeStyle = rgba(th.text, 0.08);
      c.lineWidth = 1;
      c.beginPath();
      for (let x = Math.floor(vp.x); x <= vp.x + vp.w; x++) {
        const s = Math.round((x - this.camX) * z) + 0.5;
        c.moveTo(s, 0);
        c.lineTo(s, vp.h * z);
      }
      for (let y = Math.floor(vp.y); y <= vp.y + vp.h; y++) {
        const s = Math.round((y - this.camY) * z) + 0.5;
        c.moveTo(0, s);
        c.lineTo(vp.w * z, s);
      }
      c.stroke();
    }
  }

  drawGuides(c, th, col) {
    const list = this.settings.guides ? this.pageGuides().filter((g) => !this.guideDrag || g.id !== this.guideDrag.id) : [];
    if (this.guideDrag) list.push(this.guideDrag);
    if (!list.length) return;
    const W = this.overlay.width / (this.dpr || 1);
    const H = this.overlay.height / (this.dpr || 1);
    c.save();
    c.font = '600 10px system-ui, sans-serif';
    for (const g of list) {
      const active = this.guideDrag && g.id === this.guideDrag.id;
      if (active && g.out) continue;
      c.strokeStyle = rgba(col, active ? 1 : 0.75);
      c.lineWidth = 1;
      c.beginPath();
      if (g.axis === 'x') {
        const x = Math.round(this.toScreen(g.v, 0).x) + 0.5;
        c.moveTo(x, 0);
        c.lineTo(x, H);
      } else {
        const y = Math.round(this.toScreen(0, g.v).y) + 0.5;
        c.moveTo(0, y);
        c.lineTo(W, y);
      }
      c.stroke();
      if (active) {
        const label = String(g.v);
        const tw = c.measureText(label).width + 8;
        const lx = g.axis === 'x' ? this.toScreen(g.v, 0).x + 4 : (g.sx ?? 0) + 10;
        const ly = g.axis === 'x' ? (g.sy ?? 0) + 10 : this.toScreen(0, g.v).y + 4;
        c.fillStyle = col;
        roundRect(c, lx, ly, tw, 16, 3);
        c.fill();
        c.fillStyle = th.accentText;
        c.fillText(label, lx + 4, ly + 12);
      }
    }
    c.restore();
  }

  measureTarget(selNodes) {
    const ids = new Set(selNodes.map((n) => n.id));
    if (this.hover && !ids.has(this.hover)) {
      const h = this.store.get(this.hover);
      if (h && h.page === this.page && h.type !== 'connector' && !selNodes.some((n) => this.store.ancestors(h.id).some((a) => a.id === n.id))) return h;
    }
    const first = selNodes[0];
    const parent = first && first.parent ? this.store.get(first.parent) : null;
    if (parent && selNodes.every((n) => n.parent === parent.id)) return parent;
    return null;
  }

  drawMeasure(c, S, selNodes) {
    const target = this.measureTarget(selNodes);
    if (!target) return;
    const a = selNodes.length === 1 ? nodeBounds(selNodes[0], this.store) : this.selectionBox();
    const b = nodeBounds(target, this.store);
    const col = '#D9480F';
    c.save();
    c.strokeStyle = col;
    c.lineWidth = 1;
    c.setLineDash([3, 3]);
    const tb = [S(b.x, b.y), S(b.x + b.w, b.y + b.h)];
    c.strokeRect(Math.round(tb[0].x) + 0.5, Math.round(tb[0].y) + 0.5, Math.round(tb[1].x - tb[0].x), Math.round(tb[1].y - tb[0].y));
    c.setLineDash([]);
    c.font = '600 11px system-ui, sans-serif';
    c.textAlign = 'center';
    for (const m of measureGaps(a, b)) {
      const p0 = m.axis === 'x' ? S(m.from, m.at) : S(m.at, m.from);
      const p1 = m.axis === 'x' ? S(m.to, m.at) : S(m.at, m.to);
      c.strokeStyle = col;
      c.beginPath();
      if (m.axis === 'x') {
        const y = Math.round(p0.y) + 0.5;
        c.moveTo(p0.x, y);
        c.lineTo(p1.x, y);
        c.moveTo(p0.x + 0.5, y - 4);
        c.lineTo(p0.x + 0.5, y + 4);
        c.moveTo(p1.x - 0.5, y - 4);
        c.lineTo(p1.x - 0.5, y + 4);
      } else {
        const x = Math.round(p0.x) + 0.5;
        c.moveTo(x, p0.y);
        c.lineTo(x, p1.y);
        c.moveTo(x - 4, p0.y + 0.5);
        c.lineTo(x + 4, p0.y + 0.5);
        c.moveTo(x - 4, p1.y - 0.5);
        c.lineTo(x + 4, p1.y - 0.5);
      }
      c.stroke();
      if (m.ext !== null && m.ext !== undefined) {
        const end = m.axis === 'x' ? S(m.to > a.x ? m.to : m.from, m.ext) : S(m.ext, m.to > a.y ? m.to : m.from);
        const start = m.axis === 'x' ? S(m.to > a.x ? m.to : m.from, m.at) : S(m.at, m.to > a.y ? m.to : m.from);
        c.setLineDash([2, 3]);
        c.beginPath();
        c.moveTo(start.x, start.y);
        c.lineTo(end.x, end.y);
        c.stroke();
        c.setLineDash([]);
      }
      const label = String(round(m.to - m.from, 10));
      const tw = c.measureText(label).width + 8;
      const mx = (p0.x + p1.x) / 2;
      const my = (p0.y + p1.y) / 2;
      const lx = m.axis === 'x' ? mx : mx + tw / 2 + 4;
      const ly = m.axis === 'x' ? my - 12 : my;
      c.fillStyle = col;
      roundRect(c, lx - tw / 2, ly - 8, tw, 16, 3);
      c.fill();
      c.fillStyle = '#FFFFFF';
      c.fillText(label, lx, ly + 4);
    }
    c.restore();
  }

  drawRulers() {
    if (!this.settings.rulers) return;
    const th = this.theme();
    const dpr = this.dpr || 1;
    const z = this.zoom;
    const steps = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];
    const step = steps.find((s) => s * z >= 50) || 10000;
    const box = this.selectionBox();
    for (const axis of ['x', 'y']) {
      const cv = axis === 'x' ? this.dom.rulerX : this.dom.rulerY;
      const c = cv.getContext('2d');
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      const len = axis === 'x' ? cv.width / dpr : cv.height / dpr;
      c.fillStyle = th.surface;
      c.fillRect(0, 0, axis === 'x' ? len : 20, axis === 'x' ? 20 : len);
      if (box) {
        const a = ((axis === 'x' ? box.x : box.y) - (axis === 'x' ? this.camX : this.camY)) * z;
        const b = a + (axis === 'x' ? box.w : box.h) * z;
        c.fillStyle = rgba(th.accent, 0.16);
        if (axis === 'x') c.fillRect(a, 0, b - a, 20);
        else c.fillRect(0, a, 20, b - a);
      }
      c.strokeStyle = th.faint;
      c.fillStyle = th.faint;
      c.font = '9px system-ui, sans-serif';
      c.lineWidth = 1;
      const cam = axis === 'x' ? this.camX : this.camY;
      const start = Math.floor(cam / step) * step;
      c.beginPath();
      for (let v = start; (v - cam) * z < len; v += step / 5) {
        const s = Math.round((v - cam) * z) + 0.5;
        const major = Math.abs(v / step - Math.round(v / step)) < 1e-6;
        const tick = major ? 8 : 4;
        if (axis === 'x') {
          c.moveTo(s, 20);
          c.lineTo(s, 20 - tick);
          if (major) c.fillText(String(Math.round(v)), s + 3, 9);
        } else {
          c.moveTo(20, s);
          c.lineTo(20 - tick, s);
          if (major) {
            c.save();
            c.translate(9, s - 3);
            c.rotate(-Math.PI / 2);
            c.fillText(String(Math.round(v)), 0, 0);
            c.restore();
          }
        }
      }
      c.stroke();
    }
  }

  drawMinimap() {
    if (!this.settings.minimap) return;
    const now = performance.now();
    if (this.lastMini && now - this.lastMini < 120 && !this.miniForce) {
      clearTimeout(this.miniTimer);
      this.miniTimer = setTimeout(() => this.invalidate(), 130);
      return;
    }
    this.lastMini = now;
    const cv = this.dom.minimap;
    const c = cv.getContext('2d');
    const W = cv.width;
    const H = cv.height;
    const th = this.theme();
    c.clearRect(0, 0, W, H);
    const nodes = this.pageNodes().filter((n) => !n.parent && n.type !== 'connector');
    const vp = this.r.viewport();
    const all = union([...nodes.map((n) => nodeBounds(n, this.store)), vp]);
    if (!all) return;
    const pad = 8;
    const k = Math.min((W - pad * 2) / Math.max(all.w, 1), (H - pad * 2) / Math.max(all.h, 1));
    const ox = pad + (W - pad * 2 - all.w * k) / 2 - all.x * k;
    const oy = pad + (H - pad * 2 - all.h * k) / 2 - all.y * k;
    this.minimapT = { k, ox, oy };
    for (const n of nodes) {
      const b = nodeBounds(n, this.store);
      c.fillStyle = n.fill && n.fill.color ? rgba(n.fill.color, 0.85) : rgba(th.dark ? th.text : th.muted, 0.4);
      c.fillRect(ox + b.x * k, oy + b.y * k, Math.max(1, b.w * k), Math.max(1, b.h * k));
    }
    c.strokeStyle = th.accent;
    c.lineWidth = 1.5;
    c.strokeRect(ox + vp.x * k, oy + vp.y * k, vp.w * k, vp.h * k);
  }

  minimapJump(mx, my) {
    const t = this.minimapT;
    if (!t) return;
    const wx = (mx - t.ox) / t.k;
    const wy = (my - t.oy) / t.k;
    const vp = this.r.viewport();
    this.camX = wx - vp.w / 2;
    this.camY = wy - vp.h / 2;
    this.viewChanged();
  }

  insertShape(shapeId, wx, wy) {
    const def = shapeDef(shapeId);
    const parent = this.containerAt(wx, wy);
    const id = this.commit(() => this.store.add({
      type: 'shape',
      shape: shapeId,
      page: this.page,
      parent: parent?.id || null,
      name: def.name,
      x: this.px(wx - def.w / 2),
      y: this.px(wy - def.h / 2),
      w: def.w,
      h: def.h,
      fill: def.lib === 'ui' && shapeId === 'uiPhone' ? { type: 'solid', color: '#FFFFFF', alpha: 1 } : { ...DIAGRAM_FILL },
      stroke: { ...DIAGRAM_STROKE },
      strokeWidth: 1.5,
      text: def.defaults?.text ?? (def.noText ? '' : def.labelBelow || def.container ? def.name : ''),
      fontSize: def.table ? 13 : def.container ? 14 : 14,
      fontWeight: def.container ? 600 : 400,
    }));
    this.select([id]);
    return id;
  }

  insertInstance(componentId, wx, wy) {
    const comp = this.store.get(componentId);
    if (!comp) return null;
    const parent = this.containerAt(wx, wy);
    const id = this.commit(() => this.store.add({ type: 'instance', componentId, page: this.page, parent: parent?.id || null, name: comp.name, x: this.px(wx - comp.w / 2), y: this.px(wy - comp.h / 2), w: comp.w, h: comp.h, fill: comp.fill ? { ...comp.fill } : null, stroke: comp.stroke || null, strokeWidth: comp.strokeWidth || 0, radius: comp.radius || 0, effects: comp.effects || [], overrides: {} }));
    this.select([id]);
    return id;
  }

  insertImage(src, natW, natH, wx, wy, name = 'Imagem') {
    const assetId = 'a' + uid(10);
    const max = 800;
    const k = Math.min(1, max / Math.max(natW, natH));
    const w = Math.round(natW * k);
    const h = Math.round(natH * k);
    const vp = this.r.viewport();
    const x = wx ?? vp.x + vp.w / 2;
    const y = wy ?? vp.y + vp.h / 2;
    const parent = this.containerAt(x, y);
    const id = this.commit(() => {
      this.store.assetsY.set(assetId, src);
      return this.store.add({ type: 'image', page: this.page, parent: parent?.id || null, name, x: this.px(x - w / 2), y: this.px(y - h / 2), w, h, src: assetId, fit: 'fill', radius: 0 });
    });
    this.select([id]);
    return id;
  }

  viewportCenter() {
    const vp = this.r.viewport();
    return { x: vp.x + vp.w / 2, y: vp.y + vp.h / 2 };
  }

  remove(ids = [...this.sel]) {
    if (!ids.length) return;
    this.commit(() => this.store.remove(ids));
    this.select([]);
  }

  duplicate(ids = [...this.sel], dx = 20, dy = 20) {
    const data = this.serialize(ids);
    const newIds = this.paste(data, dx, dy, true);
    return newIds;
  }

  serialize(ids) {
    const set = this.movingSet(ids);
    const nodes = [...set].map((id) => structuredClone(this.store.get(id))).filter(Boolean);
    const assets = {};
    for (const n of nodes) {
      const a = n.type === 'image' ? n.src : n.fill && n.fill.type === 'image' ? n.fill.src : null;
      if (a && this.store.assetsY.get(a)) assets[a] = this.store.assetsY.get(a);
    }
    const tops = ids.filter((id) => !this.store.ancestors(id).some((a) => set.has(a.id) && a.id !== id));
    return { kind: 'grafo-nodes', version: 1, tops, nodes, assets };
  }

  paste(data, dx = 20, dy = 20, keepParent = false, at = null) {
    if (!data || data.kind !== 'grafo-nodes' || !Array.isArray(data.nodes)) return [];
    const map = new Map(data.nodes.map((n) => [n.id, uid()]));
    let ox = dx;
    let oy = dy;
    if (at) {
      const b = union(data.nodes.filter((n) => data.tops.includes(n.id)).map((n) => ({ x: n.x, y: n.y, w: n.w, h: n.h })));
      if (b) {
        ox = Math.round(at.x - (b.x + b.w / 2));
        oy = Math.round(at.y - (b.y + b.h / 2));
      }
    }
    const out = [];
    this.commit(() => {
      for (const [k, v] of Object.entries(data.assets || {})) if (!this.store.assetsY.get(k)) this.store.assetsY.set(k, v);
      for (const n of data.nodes) {
        const c = structuredClone(n);
        c.id = map.get(n.id);
        c.page = this.page;
        const isTop = data.tops.includes(n.id);
        if (isTop) {
          c.parent = keepParent && n.page === this.page && n.parent && this.store.get(n.parent) ? n.parent : null;
          c.z = this.store.nextZ(c.parent, this.page) + out.length * 0.001;
        } else c.parent = map.get(n.parent) || null;
        if (c.type === 'connector') {
          for (const end of ['from', 'to']) {
            const e = c[end];
            if (e && e.node) c[end] = map.has(e.node) ? { ...e, node: map.get(e.node) } : this.store.get(e.node) && n.page === this.page ? e : { x: (e.x || 0) + ox, y: (e.y || 0) + oy };
            else if (e) c[end] = { x: e.x + ox, y: e.y + oy };
          }
        } else {
          c.x += ox;
          c.y += oy;
        }
        if (c.link && c.link.to && map.has(c.link.to)) c.link = { ...c.link, to: map.get(c.link.to) };
        this.store.add(c);
        if (isTop) out.push(c.id);
      }
    });
    this.select(out);
    return out;
  }

  copy(cut = false) {
    const ids = [...this.sel];
    if (!ids.length) return null;
    const data = this.serialize(ids);
    this.clipboard = data;
    const text = 'GRAFO:' + JSON.stringify(data);
    try {
      navigator.clipboard && navigator.clipboard.writeText(text).catch(() => {});
    } catch {}
    if (cut) this.remove(ids);
    return text;
  }

  group(ids = [...this.sel]) {
    const nodes = ids.map((id) => this.store.get(id)).filter((n) => n && n.type !== 'connector');
    if (!nodes.length) return null;
    const parent = nodes[0].parent || null;
    const b = union(nodes.map((n) => nodeBounds(n, this.store)));
    const z = Math.max(...nodes.map((n) => n.z));
    const id = this.commit(() => {
      const gid = this.store.add({ type: 'group', page: this.page, parent, z, name: `Grupo ${this.pageNodes().filter((n) => n.type === 'group').length + 1}`, x: b.x, y: b.y, w: b.w, h: b.h });
      nodes.sort((a, b2) => a.z - b2.z).forEach((n, i) => this.store.update(n.id, { parent: gid, z: i + 1 }));
      return gid;
    });
    this.select([id]);
    return id;
  }

  ungroup(ids = [...this.sel]) {
    const out = [];
    this.commit(() => {
      for (const id of ids) {
        const g = this.store.get(id);
        if (!g || !['group', 'boolean', 'frame', 'section', 'component'].includes(g.type)) continue;
        const kids = this.store.childrenOf(g.id);
        kids.forEach((k, i) => {
          this.store.update(k.id, { parent: g.parent || null, z: g.z + (i + 1) * 0.001 });
          out.push(k.id);
        });
        this.store.remove([g.id]);
      }
    });
    this.select(out);
  }

  frameSelection(ids = [...this.sel]) {
    const nodes = ids.map((id) => this.store.get(id)).filter((n) => n && n.type !== 'connector');
    if (!nodes.length) return null;
    const b = union(nodes.map((n) => nodeBounds(n, this.store)));
    const parent = nodes[0].parent || null;
    const id = this.commit(() => {
      const fid = this.store.add({ type: 'frame', page: this.page, parent, z: Math.max(...nodes.map((n) => n.z)), name: `Frame ${this.pageNodes().filter((n) => n.type === 'frame').length + 1}`, x: Math.floor(b.x), y: Math.floor(b.y), w: Math.ceil(b.w), h: Math.ceil(b.h), fill: { ...FRAME_FILL }, clip: true });
      nodes.sort((a, c) => a.z - c.z).forEach((n, i) => this.store.update(n.id, { parent: fid, z: i + 1 }));
      return fid;
    });
    this.select([id]);
    return id;
  }

  makeComponent() {
    const sel = this.selection.filter((n) => n.type !== 'connector');
    if (!sel.length) return null;
    let id;
    if (sel.length === 1 && (sel[0].type === 'frame' || sel[0].type === 'group')) {
      id = sel[0].id;
      this.commit(() => this.store.update(id, { type: 'component', fill: sel[0].fill === undefined ? null : sel[0].fill, clip: sel[0].type === 'frame' ? sel[0].clip : false }));
    } else {
      id = this.frameSelection(sel.map((n) => n.id));
      this.commit(() => this.store.update(id, { type: 'component', fill: null, name: sel.length === 1 ? sel[0].name : 'Componente' }));
    }
    this.select([id]);
    this.emit({ toast: 'Componente criado. Arraste instâncias pela aba Formas → Componentes.' });
    return id;
  }

  detachInstance(id) {
    const inst = this.store.get(id);
    if (!inst || inst.type !== 'instance') return;
    const comp = this.store.get(inst.componentId);
    if (!comp) {
      this.commit(() => this.store.update(id, { type: 'frame', componentId: undefined }));
      return;
    }
    const sx = inst.w / Math.max(1, comp.w);
    const sy = inst.h / Math.max(1, comp.h);
    const ov = inst.overrides || {};
    this.commit(() => {
      this.store.update(id, { type: 'frame', componentId: undefined, overrides: undefined, clip: true });
      const map = new Map([[comp.id, id]]);
      for (const d of this.store.descendants(comp.id)) {
        const nid = uid();
        map.set(d.id, nid);
        const c = { ...structuredClone(d), ...(ov[d.id] || {}), id: nid, parent: map.get(d.parent), page: inst.page, x: inst.x + (d.x - comp.x) * sx, y: inst.y + (d.y - comp.y) * sy, w: d.w * sx, h: d.h * sy };
        this.store.add(c);
      }
    });
    this.select([id]);
  }

  booleanOp(op) {
    const sel = this.selection.filter((n) => !['connector', 'text', 'group', 'frame', 'section', 'component', 'instance', 'image'].includes(n.type));
    if (sel.length < 2) {
      this.emit({ toast: 'Selecione duas ou mais formas para a operação booleana' });
      return;
    }
    const names = { union: 'União', subtract: 'Subtração', intersect: 'Interseção', exclude: 'Exclusão' };
    const parent = sel[0].parent || null;
    const id = this.commit(() => {
      const ordered = sel.sort((a, b) => a.z - b.z);
      const bid = this.store.add({ type: 'boolean', op, page: this.page, parent, z: Math.max(...sel.map((n) => n.z)), name: names[op], x: 0, y: 0, w: 1, h: 1, fill: ordered[0].fill || { ...DEFAULT_FILL }, stroke: ordered[0].stroke || null, strokeWidth: ordered[0].strokeWidth || 0 });
      ordered.forEach((n, i) => this.store.update(n.id, { parent: bid, z: i + 1 }));
      return bid;
    });
    this.select([id]);
  }

  arrange(where) {
    const sel = this.selection;
    if (!sel.length) return;
    this.commit(() => {
      for (const n of sel) {
        const sib = this.store.childrenOf(n.parent || null, this.page).filter((s) => s.page === this.page);
        const i = sib.findIndex((s) => s.id === n.id);
        let z = n.z;
        if (where === 'front') z = sib[sib.length - 1].z + 1;
        else if (where === 'back') z = sib[0].z - 1;
        else if (where === 'forward' && i < sib.length - 1) z = sib[i + 2] ? (sib[i + 1].z + sib[i + 2].z) / 2 : sib[i + 1].z + 1;
        else if (where === 'backward' && i > 0) z = sib[i - 2] ? (sib[i - 1].z + sib[i - 2].z) / 2 : sib[i - 1].z - 1;
        this.store.update(n.id, { z });
      }
    });
  }

  align(how) {
    const sel = this.selection.filter((n) => n.type !== 'connector');
    if (!sel.length) return;
    let ref = this.selectionBox();
    if (sel.length === 1) {
      const p = sel[0].parent && this.store.get(sel[0].parent);
      if (!p) return;
      ref = nodeBounds(p, this.store);
    }
    this.commit(() => {
      for (const n of sel) {
        const b = nodeBounds(n, this.store);
        let dx = 0;
        let dy = 0;
        if (how === 'left') dx = ref.x - b.x;
        if (how === 'right') dx = ref.x + ref.w - (b.x + b.w);
        if (how === 'centerH') dx = ref.x + ref.w / 2 - (b.x + b.w / 2);
        if (how === 'top') dy = ref.y - b.y;
        if (how === 'bottom') dy = ref.y + ref.h - (b.y + b.h);
        if (how === 'centerV') dy = ref.y + ref.h / 2 - (b.y + b.h / 2);
        this.translate(n, dx, dy);
      }
    });
  }

  translate(n, dx, dy) {
    if (!dx && !dy) return;
    this.store.update(n.id, { x: round(n.x + dx), y: round(n.y + dy) });
    for (const d of this.store.descendants(n.id)) this.store.update(d.id, { x: round(d.x + dx), y: round(d.y + dy) });
  }

  distribute(axis) {
    const sel = this.selection.filter((n) => n.type !== 'connector');
    if (sel.length < 3) return;
    const items = sel.map((n) => ({ n, b: nodeBounds(n, this.store) })).sort((a, b) => (axis === 'h' ? a.b.x - b.b.x : a.b.y - b.b.y));
    const first = items[0].b;
    const last = items[items.length - 1].b;
    const total = items.reduce((s, it) => s + (axis === 'h' ? it.b.w : it.b.h), 0);
    const span = axis === 'h' ? last.x + last.w - first.x : last.y + last.h - first.y;
    const gap = (span - total) / (items.length - 1);
    let pos = axis === 'h' ? first.x : first.y;
    this.commit(() => {
      for (const it of items) {
        if (axis === 'h') this.translate(it.n, pos - it.b.x, 0);
        else this.translate(it.n, 0, pos - it.b.y);
        pos += (axis === 'h' ? it.b.w : it.b.h) + gap;
      }
    });
  }

  flip(axis) {
    const sel = this.selection.filter((n) => !this.isLocked(n));
    if (!sel.length) return;
    const box = this.selectionBox();
    const h = axis === 'h';
    const mid = h ? box.x * 2 + box.w : box.y * 2 + box.h;
    const touched = new Set();
    this.commit(() => {
      for (const top of sel) {
        for (const n of [top, ...this.store.descendants(top.id)]) {
          if (touched.has(n.id)) continue;
          touched.add(n.id);
          if (n.type === 'connector') {
            const patch = {};
            for (const end of ['from', 'to']) if (n[end] && !n[end].node) patch[end] = h ? { ...n[end], x: round(mid - n[end].x) } : { ...n[end], y: round(mid - n[end].y) };
            if (Object.keys(patch).length) this.store.update(n.id, patch);
            continue;
          }
          const patch = h ? { x: round(mid - n.x - n.w) } : { y: round(mid - n.y - n.h) };
          if (n.rotation) patch.rotation = round(-n.rotation, 100);
          if (n.type === 'path' && n.points) patch.points = n.points.map((p) => scalePt(p, h ? -1 : 1, h ? 1 : -1, h ? n.w : 0, h ? 0 : n.h, h, !h, true));
          else if (FLIPPABLE.has(n.type)) {
            const k = h ? 'flipX' : 'flipY';
            patch[k] = n[k] ? undefined : true;
          }
          if (n.fill && n.fill.type === 'linear') patch.fill = { ...n.fill, angle: round(h ? 180 - (n.fill.angle ?? 90) : -(n.fill.angle ?? 90), 100) };
          this.store.update(n.id, patch);
        }
      }
      for (const c of this.pageNodes()) {
        if (c.type !== 'connector') continue;
        const patch = {};
        for (const end of ['from', 'to']) {
          const e = c[end];
          if (e && e.node && touched.has(e.node) && SIDE_FLIP[axis][e.side]) patch[end] = { ...e, side: SIDE_FLIP[axis][e.side] };
        }
        if (Object.keys(patch).length) this.store.update(c.id, patch);
      }
    });
  }

  swapFillStroke() {
    const sel = this.selection.filter((n) => !['group', 'text', 'connector', 'boolean', 'instance'].includes(n.type) && !this.isLocked(n));
    if (!sel.length) return;
    this.setProp((n) => {
      const fillColor = n.fill && n.fill.type === 'solid' ? n.fill.color : n.fill && n.fill.type === 'linear' ? n.fill.stops?.[0]?.color : null;
      const strokeColor = n.stroke ? n.stroke.color : null;
      if (!fillColor && !strokeColor) return null;
      return {
        fill: strokeColor ? { type: 'solid', color: strokeColor, alpha: n.stroke.alpha ?? 1 } : null,
        stroke: fillColor ? { color: fillColor, alpha: n.fill.alpha ?? 1 } : null,
        strokeWidth: fillColor ? n.strokeWidth || 1 : 0,
        fillStyle: undefined,
      };
    }, sel.map((n) => n.id));
  }

  copyProps() {
    const n = this.selection[0];
    if (!n) return null;
    const props = {};
    for (const k of STYLE_KEYS) if (n[k] !== undefined) props[k] = structuredClone(n[k]);
    if (!('fill' in props)) props.fill = null;
    if (!('stroke' in props)) props.stroke = null;
    this.propClipboard = { from: n.type, props };
    try {
      storage.set('props', this.propClipboard);
    } catch {}
    this.emit({ toast: 'Propriedades copiadas' });
    return this.propClipboard;
  }

  pasteProps() {
    const clip = this.propClipboard || storage.get('props', null);
    if (!clip || !clip.props || !this.sel.size) return;
    const src = clip.props;
    this.setProp((n) => {
      if (this.isLocked(n)) return null;
      const p = {};
      for (const [k, v] of Object.entries(src)) {
        if (TEXT_KEYS.has(k) && !hasText(n)) continue;
        if (n.type === 'group' && (k === 'fill' || k === 'stroke')) continue;
        if (n.type === 'connector' && k === 'fill') continue;
        if (n.type === 'text' && k === 'fill' && v && v.type !== 'solid') continue;
        if (k === 'textColor' && n.type === 'text') continue;
        p[k] = structuredClone(v);
      }
      if (n.type === 'text' && clip.from !== 'text' && src.textColor) p.fill = { type: 'solid', color: src.textColor, alpha: 1 };
      if (n.type !== 'text' && clip.from === 'text' && src.fill) {
        p.textColor = src.fill.color;
        delete p.fill;
      }
      return p;
    });
    this.emit({ toast: 'Propriedades coladas' });
  }

  selectSibling(dir) {
    const cur = this.selection[0];
    const parent = cur ? cur.parent || null : this.entered || null;
    const sib = this.store.childrenOf(parent, this.page).filter((n) => n.page === this.page && this.isVisible(n) && !this.isLocked(n));
    if (!sib.length) return;
    const i = cur ? sib.findIndex((n) => n.id === cur.id) : -1;
    const next = sib[(i + (dir > 0 ? 1 : -1) + sib.length) % sib.length];
    if (next.parent && this.store.get(next.parent)?.type === 'group') this.entered = next.parent;
    this.select([next.id]);
  }

  fitToContent(ids = [...this.sel]) {
    const targets = ids.map((id) => this.store.get(id)).filter((n) => n && (n.type === 'frame' || n.type === 'component' || n.type === 'section') && !this.isLocked(n));
    let done = 0;
    this.commit(() => {
      for (const n of targets) {
        const kids = this.store.childrenOf(n.id).filter((k) => k.type !== 'connector' && k.visible !== false);
        if (!kids.length) continue;
        const b = union(kids.map((k) => nodeBounds(k, this.store)));
        const x = Math.floor(b.x);
        const y = Math.floor(b.y);
        const patch = { x, y, w: Math.max(1, Math.ceil(b.x + b.w) - x), h: Math.max(1, Math.ceil(b.y + b.h) - y) };
        if (n.layout && n.layout.mode && n.layout.mode !== 'none') {
          this.store.update(n.id, { layout: { ...n.layout, hug: true, hugCross: true } });
          done++;
          continue;
        }
        if (n.rotation) continue;
        this.store.update(n.id, patch);
        done++;
      }
    });
    if (!done) this.emit({ toast: 'Selecione um frame ou seção com conteúdo' });
  }

  async originalSize(id) {
    const n = this.store.get(id);
    if (!n || n.type !== 'image') return;
    const src = this.store.assetsY.get(n.src) || n.src;
    const img = new Image();
    img.src = src;
    try {
      await img.decode();
    } catch {
      return;
    }
    const w = img.naturalWidth || n.w;
    const h = img.naturalHeight || n.h;
    this.commit(() => this.store.update(id, { x: round(n.x + n.w / 2 - w / 2), y: round(n.y + n.h / 2 - h / 2), w, h }));
  }

  aulaDir() {
    const info = this.store.pageInfo.get(this.page);
    return (info && info.aula) || 'down';
  }

  treeEdges() {
    const out = [];
    for (const c of this.pageNodes()) {
      if (c.type !== 'connector' || !c.from?.node || !c.to?.node) continue;
      const a = this.store.get(c.from.node);
      const b = this.store.get(c.to.node);
      if (a && b && a.branch && b.branch) out.push([a.id, b.id, c.id]);
    }
    return out;
  }

  treeParent(id) {
    const e = this.treeEdges().find(([, to]) => to === id);
    return e ? e[0] : null;
  }

  addBranch(sibling = false) {
    const n = this.selection[0];
    if (!n || !n.branch || this.sel.size !== 1) return null;
    const parentId = sibling ? this.treeParent(n.id) : n.id;
    if (!parentId) return this.addBranch(false);
    const parent = this.store.get(parentId);
    const dir = this.aulaDir();
    const ref = sibling ? n : this.treeEdges().filter(([f]) => f === parentId).map(([, t]) => this.store.get(t)).find(Boolean) || null;
    const base = ref || n;
    const w = ref ? ref.w : Math.max(120, Math.round(parent.w * 0.85));
    const h = ref ? ref.h : Math.max(48, Math.round(parent.h * 0.8));
    const off = dir === 'up' ? [0, -(parent.h + 80)] : dir === 'right' ? [parent.w + 80, 0] : [0, parent.h + 80];
    let id;
    this.commit(() => {
      const fill = ref ? ref.fill : { type: 'solid', color: '#F6E4A6', alpha: 1 };
      id = this.store.add({ type: 'shape', shape: base.shape === 'note' ? 'rounded' : base.shape || 'rounded', page: this.page, parent: parent.parent || null, name: 'Nova ideia', branch: true, x: round(parent.x + off[0]), y: round(parent.y + off[1]), w, h, fill: fill ? { ...fill } : null, stroke: base.stroke ? { ...base.stroke } : { color: '#5C4034', alpha: 1 }, strokeWidth: base.strokeWidth ?? 1.5, text: 'Nova ideia', fontSize: ref ? ref.fontSize || 14 : 14, fontWeight: 400, ...(ref && ref.textColor ? { textColor: ref.textColor } : {}) });
      const sample = this.treeEdges()[0];
      const conn = sample ? this.store.get(sample[2]) : null;
      this.store.add({ type: 'connector', page: this.page, parent: null, name: 'Conector', x: 0, y: 0, w: 0, h: 0, from: { node: parentId, side: 'auto' }, to: { node: id, side: 'auto' }, routing: conn ? conn.routing : 'elbow', startCap: conn ? conn.startCap : dir === 'up' ? 'triangle' : 'none', endCap: conn ? conn.endCap : dir === 'up' ? 'none' : 'triangle', stroke: { color: '#2B1D17', alpha: 1 }, strokeWidth: 1.6, text: '' });
    });
    this.select([id]);
    this.relayoutTree(parentId).then(() => {
      if (this.store.get(id) && this.sel.has(id)) this.editText(id);
    });
    return id;
  }

  async relayoutTree(anchorId = null) {
    const edges = this.treeEdges();
    const ids = new Set();
    for (const [a, b] of edges) {
      ids.add(a);
      ids.add(b);
    }
    for (const n of this.pageNodes()) if (n.branch) ids.add(n.id);
    const nodes = [...ids].map((id) => this.store.get(id)).filter(Boolean);
    if (nodes.length < 2) return;
    const pos = layoutTree(nodes, edges.map(([a, b]) => [a, b]), this.aulaDir());
    const roots = nodes.filter((n) => !edges.some(([, t]) => t === n.id));
    const anchor = this.store.get(anchorId) && roots.some((r) => r.id === anchorId) ? this.store.get(anchorId) : roots[0] || nodes[0];
    const ap = pos.get(anchor.id);
    const dx = anchor.x - ap.x;
    const dy = anchor.y - ap.y;
    const targets = nodes.map((n) => ({ id: n.id, x0: n.x, y0: n.y, x1: round(pos.get(n.id).x + dx), y1: round(pos.get(n.id).y + dy) }));
    await this.animateNodes(targets, 220);
  }

  async setAulaDir(dir) {
    const info = this.store.pageInfo.get(this.page);
    if (!info) return;
    const was = this.aulaDir();
    this.commit(() => {
      this.store.pageInfo.set(this.page, { ...info, aula: dir });
      if ((was === 'up') !== (dir === 'up')) {
        for (const [, , cid] of this.treeEdges()) {
          const c = this.store.get(cid);
          this.store.update(cid, { startCap: c.endCap || 'none', endCap: c.startCap || 'none' });
        }
      }
    });
    await this.relayoutTree();
    this.zoomToFit();
  }

  smartDuplicate() {
    const ids = [...this.sel];
    if (!ids.length) return [];
    const L = this.lastDup;
    let dx = 20;
    let dy = 20;
    if (L && L.out.length === ids.length && L.out.every((id) => this.sel.has(id))) {
      const src = this.store.get(L.src);
      const cur = this.store.get(L.out[0]);
      if (src && cur) {
        dx = round(cur.x - src.x);
        dy = round(cur.y - src.y);
      }
    }
    const first = this.store.get(ids[0]);
    const inLayout = first && first.parent && this.store.get(first.parent)?.layout?.mode && this.store.get(first.parent).layout.mode !== 'none';
    if (inLayout) dx = dy = 0;
    const out = this.duplicate(ids, dx, dy);
    if (out.length) this.lastDup = { src: ids[0], out };
    return out;
  }

  async tidy(gap = null) {
    const sel = this.selection.filter((n) => n.type !== 'connector' && !this.isLocked(n));
    if (sel.length < 2) {
      this.emit({ toast: 'Selecione dois ou mais objetos para organizar em grade' });
      return;
    }
    const boxes = sel.map((n) => nodeBounds(n, this.store));
    let g = gap;
    if (g === null) {
      const sorted = [...boxes].sort((a, b) => a.x - b.x);
      const gaps = [];
      for (let i = 1; i < sorted.length; i++) {
        const v = sorted[i].x - (sorted[i - 1].x + sorted[i - 1].w);
        if (v > 0) gaps.push(v);
      }
      gaps.sort((a, b) => a - b);
      g = gaps.length ? clamp(Math.round(gaps[Math.floor(gaps.length / 2)]), 8, 200) : 20;
    }
    const pos = gridLayout(boxes, g);
    const targets = sel.map((n, i) => ({ id: n.id, x0: n.x, y0: n.y, x1: round(n.x + pos[i].x - boxes[i].x), y1: round(n.y + pos[i].y - boxes[i].y) }));
    await this.animateNodes(targets, 260);
  }

  nudge(dx, dy) {
    const sel = this.selection.filter((n) => !this.isLocked(n));
    if (!sel.length) return;
    this.commit(() => {
      for (const n of sel) {
        if (n.type === 'connector') {
          const patch = {};
          for (const end of ['from', 'to']) if (n[end] && !n[end].node) patch[end] = { x: n[end].x + dx, y: n[end].y + dy };
          this.store.update(n.id, patch);
        } else this.translate(n, dx, dy);
      }
    });
  }

  setProp(patch, ids = [...this.sel]) {
    this.commit(() => {
      for (const id of ids) {
        const n = this.store.get(id);
        if (!n) continue;
        const p = typeof patch === 'function' ? patch(n) : patch;
        if (!p) continue;
        this.store.update(id, p);
        if (n.type === 'text' && ('fontSize' in p || 'fontWeight' in p || 'fontFamily' in p || 'letterSpacing' in p || 'lineHeight' in p || 'text' in p || 'autoSize' in p)) {
          const fit = fitText({ ...n, ...p }, this.store);
          if (fit) this.store.update(id, fit);
        }
      }
    });
  }

  toggleAutoLayout() {
    const sel = this.selection;
    if (sel.length === 1 && isContainer(sel[0]) && sel[0].type !== 'shape') {
      const n = sel[0];
      const on = n.layout && n.layout.mode !== 'none';
      this.setProp({ layout: on ? { ...n.layout, mode: 'none' } : { mode: 'v', gap: 10, padding: 16, align: 'start', hug: true, hugCross: true } });
      return;
    }
    if (!sel.length) return;
    const b = this.selectionBox();
    const horiz = b.w > b.h;
    const id = this.frameSelection();
    if (!id) return;
    const kids = this.store.childrenOf(id);
    kids.sort((a, c) => (horiz ? a.x - c.x : a.y - c.y)).forEach((k, i) => this.store.update(k.id, { z: i + 1 }));
    this.setProp({ fill: null, layout: { mode: horiz ? 'h' : 'v', gap: 10, padding: 0, align: 'start', hug: true, hugCross: true } }, [id]);
  }

  async autoArrange(direction = 0) {
    let nodes = this.selection.filter((n) => n.type !== 'connector');
    if (nodes.length < 2) nodes = this.pageNodes().filter((n) => !n.parent && n.type !== 'connector' && n.type !== 'section' && n.type !== 'frame');
    const ids = new Set(nodes.map((n) => n.id));
    const index = new Map(nodes.map((n, i) => [n.id, i]));
    const edges = [];
    for (const c of this.pageNodes()) {
      if (c.type !== 'connector' || !c.from?.node || !c.to?.node) continue;
      if (ids.has(c.from.node) && ids.has(c.to.node)) edges.push([index.get(c.from.node), index.get(c.to.node)]);
    }
    if (nodes.length < 2) return;
    const b = union(nodes.map((n) => ({ x: n.x, y: n.y, w: n.w, h: n.h })));
    let pos;
    try {
      pos = Engine.layoutLayered(nodes.map((n) => ({ w: n.w, h: n.h })), edges, direction, 60, 70);
    } catch {
      return;
    }
    const minX = Math.min(...pos.map((p) => p.x));
    const minY = Math.min(...pos.map((p) => p.y));
    const targets = nodes.map((n, i) => ({ id: n.id, x0: n.x, y0: n.y, x1: Math.round(b.x + pos[i].x - minX), y1: Math.round(b.y + pos[i].y - minY) }));
    await this.animateNodes(targets, 380);
    this.commit(() => {
      for (const n of nodes) {
        for (const c of this.pageNodes()) {
          if (c.type === 'connector' && (c.from?.node === n.id || c.to?.node === n.id) && c.routing !== 'straight') {
            this.store.update(c.id, { from: c.from.node ? { ...c.from, side: 'auto' } : c.from, to: c.to.node ? { ...c.to, side: 'auto' } : c.to });
          }
        }
      }
    });
  }

  animateNodes(targets, ms) {
    this.animating = true;
    return new Promise((resolve) => {
      const t0 = performance.now();
      const step = (now) => {
        const t = clamp((now - t0) / ms, 0, 1);
        const e = 1 - Math.pow(1 - t, 3);
        this.commit(() => {
          for (const tg of targets) {
            const n = this.store.get(tg.id);
            if (!n) continue;
            const nx = round(tg.x0 + (tg.x1 - tg.x0) * e);
            const ny = round(tg.y0 + (tg.y1 - tg.y0) * e);
            this.translate(n, nx - n.x, ny - n.y);
          }
        });
        if (t < 1) requestAnimationFrame(step);
        else {
          this.animating = false;
          this.stopCapture();
          resolve();
        }
      };
      requestAnimationFrame(step);
    });
  }

  selectAll() {
    const ids = this.store.childrenOf(this.entered || null, this.page).filter((n) => n.page === this.page && !n.locked).map((n) => n.id);
    this.select(ids);
  }
}

const scalePt = (p, sx, sy, ox, oy, fx, fy, mirror = false) => {
  const T = (x, y) => (mirror ? { x: fx ? ox - x : x, y: fy ? oy - y : y } : { x: x * Math.abs(sx), y: y * Math.abs(sy) });
  const q = T(p.x, p.y);
  const out = { x: round(q.x), y: round(q.y) };
  if (p.ix !== undefined) {
    const a = T(p.ix, p.iy);
    out.ix = round(a.x);
    out.iy = round(a.y);
  }
  if (p.ox !== undefined) {
    const a = T(p.ox, p.oy);
    out.ox = round(a.x);
    out.oy = round(a.y);
  }
  return out;
};

const roundRect = (c, x, y, w, h, r) => {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
};

export { SHAPES, nodeParts, flattenD, resolveText, hexToNum };
