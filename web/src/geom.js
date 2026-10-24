import { flattenD, nodeParts, shapeDef } from './shapes.js';
import { Engine } from './engine/index.js';

export const CONTAINER_TYPES = new Set(['frame', 'section', 'component']);
export const isContainer = (n) => !!n && (CONTAINER_TYPES.has(n.type) || (n.type === 'shape' && !!shapeDef(n.shape).container));
export const hasText = (n) => !!n && (n.type === 'text' || n.type === 'sticky' || (n.type === 'shape' && !shapeDef(n.shape).noText) || n.type === 'section');

export const rotatePoint = (px, py, cx, cy, a) => {
  if (!a) return { x: px, y: py };
  const c = Math.cos(a);
  const s = Math.sin(a);
  const dx = px - cx;
  const dy = py - cy;
  return { x: cx + dx * c - dy * s, y: cy + dx * s + dy * c };
};

export const corners = (n) => {
  const a = ((n.rotation || 0) * Math.PI) / 180;
  const cx = n.x + n.w / 2;
  const cy = n.y + n.h / 2;
  return [[n.x, n.y], [n.x + n.w, n.y], [n.x + n.w, n.y + n.h], [n.x, n.y + n.h]].map(([x, y]) => rotatePoint(x, y, cx, cy, a));
};

export const aabb = (pts) => {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  if (x0 === Infinity) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};

export const union = (boxes) => {
  const pts = [];
  for (const b of boxes) if (b) pts.push({ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y + b.h });
  return pts.length ? aabb(pts) : null;
};

export const intersects = (a, b) => a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;
export const contains = (a, b) => b.x >= a.x && b.y >= a.y && b.x + b.w <= a.x + a.w && b.y + b.h <= a.y + a.h;

export const toLocal = (n, px, py) => {
  const a = -((n.rotation || 0) * Math.PI) / 180;
  const p = rotatePoint(px, py, n.x + n.w / 2, n.y + n.h / 2, a);
  return { x: p.x - n.x, y: p.y - n.y };
};

let measureCtx = null;
const ctx2d = () => {
  if (!measureCtx) {
    const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(4, 4) : document.createElement('canvas');
    measureCtx = c.getContext('2d');
  }
  return measureCtx;
};

export const FONT_STACKS = {
  'Sistema': 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  'Sans-serif': 'Arial, "Helvetica Neue", Helvetica, sans-serif',
  'Serif': 'Georgia, "Times New Roman", Times, serif',
  'Mono': 'ui-monospace, "Cascadia Mono", Consolas, "Courier New", monospace',
  'Verdana': 'Verdana, Geneva, sans-serif',
  'Trebuchet': '"Trebuchet MS", Tahoma, sans-serif',
};
export const fontCss = (n) => `${n.fontStyle === 'italic' ? 'italic ' : ''}${n.fontWeight || 400} ${n.fontSize || 16}px ${FONT_STACKS[n.fontFamily] || FONT_STACKS['Sistema']}`;

export const measure = (text, n) => {
  const c = ctx2d();
  c.font = fontCss(n);
  return c.measureText(text).width + (n.letterSpacing || 0) * Math.max(0, text.length - 1);
};

export const resolveText = (n, store) => {
  let t = String(n.text ?? '');
  if (n.data && n.data.source && store) {
    const ds = store.dataY.get(n.data.source);
    const row = ds && ds.rows && ds.rows[n.data.row | 0];
    if (row) t = t.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (m, k) => (row[k] !== undefined ? row[k] : m));
  }
  return t;
};

export const textBox = (n) => {
  if (n.type === 'shape') {
    const d = shapeDef(n.shape);
    if (d.labelBelow) return { x: -40, y: n.h + 4, w: n.w + 80, h: 40, below: true };
    if (d.text) return d.text(n.w, n.h);
    return { x: 6, y: 4, w: n.w - 12, h: n.h - 8 };
  }
  if (n.type === 'sticky') return { x: 14, y: 14, w: n.w - 28, h: n.h - 28 };
  if (n.type === 'section') return { x: 0, y: -26, w: n.w, h: 22 };
  return { x: 0, y: 0, w: n.w, h: n.h };
};

export const wrapLines = (text, n, maxW) => {
  const out = [];
  for (const para of String(text).split('\n')) {
    if (!maxW || maxW <= 0 || n.autoSize === 'width') {
      out.push(para);
      continue;
    }
    const words = para.split(/(\s+)/);
    let line = '';
    for (const w of words) {
      const test = line + w;
      if (line && measure(test.trimEnd(), n) > maxW) {
        out.push(line.trimEnd());
        line = w.trimStart();
        while (measure(line, n) > maxW && line.length > 1) {
          let cut = line.length - 1;
          while (cut > 1 && measure(line.slice(0, cut), n) > maxW) cut--;
          out.push(line.slice(0, cut));
          line = line.slice(cut);
        }
      } else line = test;
    }
    out.push(line);
  }
  return out;
};

export const layoutText = (n, store) => {
  const text = resolveText(n, store);
  const box = textBox(n);
  const lines = wrapLines(text, n, n.type === 'text' && n.autoSize === 'width' ? 0 : box.w);
  const size = n.fontSize || 16;
  const lh = size * (n.lineHeight || 1.25);
  const widths = lines.map((l) => measure(l, n));
  return { lines, widths, lineH: lh, width: Math.max(0, ...widths), height: lines.length * lh, box };
};

export const fitText = (n, store) => {
  if (n.type !== 'text') return null;
  const t = layoutText({ ...n, autoSize: n.autoSize || 'width' }, store);
  if ((n.autoSize || 'width') === 'width') return { w: Math.max(4, Math.ceil(t.width)), h: Math.max(4, Math.ceil(t.height)) };
  if (n.autoSize === 'height') return { w: n.w, h: Math.max(4, Math.ceil(t.height)) };
  return null;
};

const SIDE_DIR = { top: 0, right: 1, bottom: 2, left: 3 };
export const anchorOf = (n, side) => {
  const pts = { top: [n.w / 2, 0], right: [n.w, n.h / 2], bottom: [n.w / 2, n.h], left: [0, n.h / 2], center: [n.w / 2, n.h / 2] };
  const [lx, ly] = pts[side] || pts.center;
  const a = ((n.rotation || 0) * Math.PI) / 180;
  const p = rotatePoint(n.x + lx, n.y + ly, n.x + n.w / 2, n.y + n.h / 2, a);
  let dir = SIDE_DIR[side] ?? -1;
  if (a && dir >= 0) dir = (dir + Math.round(a / (Math.PI / 2)) + 4) % 4;
  return { x: p.x, y: p.y, dir };
};

export const bestSide = (n, tx, ty) => {
  const cx = n.x + n.w / 2;
  const cy = n.y + n.h / 2;
  const dx = (tx - cx) / Math.max(n.w, 1);
  const dy = (ty - cy) / Math.max(n.h, 1);
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'bottom' : 'top';
};

export const nearestAnchor = (n, px, py) => {
  let best = 'top';
  let bd = Infinity;
  for (const s of ['top', 'right', 'bottom', 'left']) {
    const a = anchorOf(n, s);
    const d = Math.hypot(a.x - px, a.y - py);
    if (d < bd) {
      bd = d;
      best = s;
    }
  }
  return { side: best, dist: bd };
};

const endPoint = (store, end, other) => {
  if (end && end.node) {
    const n = store.get(end.node);
    if (n) {
      const side = !end.side || end.side === 'auto' ? bestSide(n, other.x, other.y) : end.side;
      return anchorOf(n, side);
    }
  }
  return { x: end?.x ?? 0, y: end?.y ?? 0, dir: -1 };
};

const endCenter = (store, end) => {
  if (end && end.node) {
    const n = store.get(end.node);
    if (n) return { x: n.x + n.w / 2, y: n.y + n.h / 2 };
  }
  return { x: end?.x ?? 0, y: end?.y ?? 0 };
};

const DIRV = [[0, -1], [1, 0], [0, 1], [-1, 0]];

export const connectorRoute = (c, store) => {
  const fc = endCenter(store, c.from);
  const tc = endCenter(store, c.to);
  const a = endPoint(store, c.from, tc);
  const b = endPoint(store, c.to, fc);
  const routing = c.routing || 'elbow';
  if (routing === 'straight') return { points: [a, b], curve: null, a, b };
  if (routing === 'curved') {
    const d = Math.max(40, Math.hypot(b.x - a.x, b.y - a.y) * 0.4);
    const da = a.dir >= 0 ? DIRV[a.dir] : [Math.sign(b.x - a.x) || 1, 0];
    const db = b.dir >= 0 ? DIRV[b.dir] : [Math.sign(a.x - b.x) || -1, 0];
    const c1 = { x: a.x + da[0] * d, y: a.y + da[1] * d };
    const c2 = { x: b.x + db[0] * d, y: b.y + db[1] * d };
    const pts = [];
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      const u = 1 - t;
      pts.push({ x: u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x, y: u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y });
    }
    return { points: pts, curve: [a, c1, c2, b], a, b };
  }
  const obstacles = [];
  const span = { x: Math.min(a.x, b.x) - 160, y: Math.min(a.y, b.y) - 160, w: Math.abs(a.x - b.x) + 320, h: Math.abs(a.y - b.y) + 320 };
  for (const id of [c.from?.node, c.to?.node]) {
    const n = id && store.get(id);
    if (n) obstacles.push({ x: n.x, y: n.y, w: n.w, h: n.h });
  }
  if (c.avoid !== false) {
    let count = 0;
    for (const n of store.nodes.values()) {
      if (count > 60) break;
      if (n.page !== c.page || n.type === 'connector' || n.id === c.from?.node || n.id === c.to?.node || isContainer(n) || n.visible === false) continue;
      if (n.type === 'text' || n.type === 'path') continue;
      if (intersects(span, n)) {
        obstacles.push({ x: n.x, y: n.y, w: n.w, h: n.h });
        count++;
      }
    }
  }
  let pts = null;
  try {
    pts = Engine.routeOrthogonal(obstacles, { x: a.x, y: a.y }, a.dir, { x: b.x, y: b.y }, b.dir, 16);
  } catch {
    pts = null;
  }
  if (!pts || pts.length < 2) {
    const mx = (a.x + b.x) / 2;
    pts = [a, { x: mx, y: a.y }, { x: mx, y: b.y }, b];
  }
  pts[0] = { x: a.x, y: a.y };
  pts[pts.length - 1] = { x: b.x, y: b.y };
  const clean = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i];
    const q = clean[clean.length - 1];
    if (Math.abs(p.x - q.x) < 0.01 && Math.abs(p.y - q.y) < 0.01) continue;
    if (clean.length >= 2) {
      const r = clean[clean.length - 2];
      if ((Math.abs(r.x - q.x) < 0.01 && Math.abs(q.x - p.x) < 0.01) || (Math.abs(r.y - q.y) < 0.01 && Math.abs(q.y - p.y) < 0.01)) {
        clean[clean.length - 1] = p;
        continue;
      }
    }
    clean.push(p);
  }
  return { points: clean, curve: null, a, b };
};

export const polylineMid = (pts) => {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  let half = total / 2;
  for (let i = 1; i < pts.length; i++) {
    const l = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (half <= l && l > 0) {
      const t = half / l;
      return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t };
    }
    half -= l;
  }
  return pts[0] || { x: 0, y: 0 };
};

export const distToSeg = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax;
  const dy = by - ay;
  const l = dx * dx + dy * dy;
  let t = l ? ((px - ax) * dx + (py - ay) * dy) / l : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
};

export const distToPolyline = (pts, px, py) => {
  let d = Infinity;
  for (let i = 1; i < pts.length; i++) d = Math.min(d, distToSeg(px, py, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y));
  return d;
};

export const pointInPoly = (pts, x, y) => {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y || 1e-9) + a.x) inside = !inside;
  }
  return inside;
};

export const outlineOf = (n) => {
  const rings = [];
  for (const part of nodeParts(n)) {
    if (part.kind === 'line' || part.kind === 'dashed') continue;
    for (const r of flattenD(part.d, 1)) rings.push(r);
  }
  const a = ((n.rotation || 0) * Math.PI) / 180;
  const cx = n.w / 2;
  const cy = n.h / 2;
  return rings.map((r) => r.map((p) => {
    const q = rotatePoint(p.x, p.y, cx, cy, a);
    return { x: q.x + n.x, y: q.y + n.y };
  }));
};

export const nodeBounds = (n, store) => {
  if (n.type === 'connector') {
    const r = connectorRoute(n, store);
    return aabb(r.points);
  }
  if (!n.rotation) return { x: n.x, y: n.y, w: n.w, h: n.h };
  return aabb(corners(n));
};

export const hitNode = (n, px, py, tol, store) => {
  if (n.type === 'connector') {
    const r = connectorRoute(n, store);
    return distToPolyline(r.points, px, py) <= tol + (n.strokeWidth || 2) / 2;
  }
  const l = toLocal(n, px, py);
  if (n.type === 'path') {
    const pts = flattenD(nodeParts(n)[0]?.d || '', 1)[0] || [];
    if (n.closed && n.fill && pointInPoly(pts, l.x, l.y)) return true;
    const near = distToPolyline(n.closed && pts.length ? [...pts, pts[0]] : pts, l.x, l.y) <= tol + (n.strokeWidth || 2) / 2;
    return near;
  }
  if (n.type === 'text' || n.type === 'image' || n.type === 'sticky' || n.type === 'group' || n.type === 'instance' || n.type === 'boolean') {
    return l.x >= -tol && l.y >= -tol && l.x <= n.w + tol && l.y <= n.h + tol;
  }
  if (n.type === 'ellipse') {
    const rx = n.w / 2 + tol;
    const ry = n.h / 2 + tol;
    const dx = l.x - n.w / 2;
    const dy = l.y - n.h / 2;
    return (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1;
  }
  if (n.type === 'shape') {
    const d = shapeDef(n.shape);
    if (d.labelBelow && n.text && l.y > n.h && l.y < n.h + 30 && l.x > -30 && l.x < n.w + 30) return true;
  }
  const inBox = l.x >= -tol && l.y >= -tol && l.x <= n.w + tol && l.y <= n.h + tol;
  if (!inBox) return false;
  if ((n.type === 'frame' || n.type === 'section' || n.type === 'component') && !n.fill) {
    return l.x <= tol || l.y <= tol || l.x >= n.w - tol || l.y >= n.h - tol;
  }
  return true;
};

export const snapValue = (v, grid) => (grid > 0 ? Math.round(v / grid) * grid : v);
