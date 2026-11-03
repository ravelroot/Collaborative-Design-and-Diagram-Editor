import { SHAPES } from './shapes.js';
import { Engine } from './engine/index.js';

const C = { wine: '#5D1C16', slate: '#A3B4BE', coffee: '#5C4034', linen: '#E6DDCE', olive: '#7A6E46', rose: '#D6BDB8', straw: '#F6E4A6', ink: '#2B1D17', paper: '#FAF6EF', white: '#FFFFFF', sage: '#C9D3A8', light: '#FAF3E6' };
const DARK = new Set([C.wine, C.coffee, C.olive, C.ink]);

export const TEMPLATE_CATEGORIES = [
  { id: 'uml', name: 'UML e SysML', icon: 'component' },
  { id: 'process', name: 'Processos', icon: 'connector' },
  { id: 'arch', name: 'Arquitetura', icon: 'layers' },
  { id: 'data', name: 'Dados', icon: 'data' },
  { id: 'infra', name: 'Infraestrutura', icon: 'share' },
  { id: 'security', name: 'Segurança', icon: 'lock' },
  { id: 'testing', name: 'Testes', icon: 'check' },
  { id: 'ux', name: 'UX e produto', icon: 'frame' },
  { id: 'mgmt', name: 'Gestão', icon: 'tree' },
  { id: 'analysis', name: 'Análise', icon: 'sparkle' },
];

class Board {
  constructor() {
    this.items = [];
    this.k = 0;
  }

  node(shape, text, x, y, w, h, o = {}) {
    const def = SHAPES[shape] || SHAPES.rect;
    const key = o.key || 'n' + this.k++;
    this.items.push({ kind: 'shape', key, shape, text: text ?? '', x, y, w: w ?? def.w, h: h ?? def.h, ...o });
    return key;
  }

  box(text, x, y, w, h, fill = C.paper, o = {}) {
    return this.node(o.shape || 'rounded', text, x, y, w, h, { fill, textColor: DARK.has(fill) ? C.light : undefined, ...o });
  }

  text(text, x, y, o = {}) {
    const key = 'n' + this.k++;
    this.items.push({ kind: 'text', key, text, x, y, size: 16, weight: 400, w: 0, ...o });
    return key;
  }

  edge(from, to, o = {}) {
    this.items.push({ kind: 'edge', from, to, ...o });
  }

  line(x1, y1, x2, y2, o = {}) {
    this.items.push({ kind: 'edge', from: { x: x1, y: y1 }, to: { x: x2, y: y2 }, routing: 'straight', endCap: 'none', ...o });
  }

  wrap(keys, label, pad = 30, o = {}) {
    const boxes = this.items.filter((it) => keys.includes(it.key));
    if (!boxes.length) return null;
    const x0 = Math.min(...boxes.map((b) => b.x)) - pad;
    const y0 = Math.min(...boxes.map((b) => b.y)) - pad - 24;
    const x1 = Math.max(...boxes.map((b) => b.x + b.w)) + pad;
    const y1 = Math.max(...boxes.map((b) => b.y + b.h)) + pad;
    const key = 'n' + this.k++;
    this.items.unshift({ kind: 'shape', key, shape: o.shape || 'boundary', text: label, x: x0, y: y0, w: x1 - x0, h: y1 - y0, fill: o.fill || C.paper, fontWeight: 600, ...o, container: true });
    return key;
  }
}

const OPS = [
  ['<>-', { startCap: 'diamond', endCap: 'none' }],
  [' o-', { startCap: 'diamondOpen', endCap: 'none' }],
  ['-|>', { endCap: 'triangle' }],
  ['..|>', { endCap: 'triangle', dash: true }],
  ['..>', { endCap: 'arrow', dash: true }],
  ['<->', { startCap: 'arrow', endCap: 'arrow' }],
  ['1-n', { startCap: 'one', endCap: 'many' }],
  ['1-1', { startCap: 'one', endCap: 'one' }],
  ['n-n', { startCap: 'many', endCap: 'many' }],
  ['0-n', { startCap: 'one', endCap: 'zeroMany' }],
  ['--', { endCap: 'none' }],
  ['>', {}],
];

const OPS_UP = new Set(['-|>', '..|>']);

const parseNodes = (spec) => spec.split(';').map((s) => s.trim()).filter(Boolean).map((s) => {
  const [key, shape, ...rest] = s.split(':');
  return { key: key.trim(), shape: shape.trim(), text: rest.join(':').trim().replace(/\\n/g, '\n') };
});

const parseEdges = (spec) => (spec || '').split(';').map((s) => s.trim()).filter(Boolean).map((s) => {
  const [rel, ...lbl] = s.split(':');
  for (const [op, style] of OPS) {
    const i = rel.indexOf(op);
    if (i > 0) return { from: rel.slice(0, i).trim(), to: rel.slice(i + op.length).trim(), label: lbl.join(':').trim(), op, ...style };
  }
  return null;
}).filter(Boolean);

const STYLE = {
  terminator: { fill: C.wine },
  startEvent: {}, endEvent: {},
  decision: { fill: C.straw },
  gateway: { fill: C.straw },
  parallelGateway: { fill: C.straw },
  entity: { fill: C.white },
  umlClass: { fill: C.white },
  umlInterface: { fill: C.linen },
  database: { fill: C.linen },
  netDatabase: { fill: C.linen },
  state: { fill: C.linen },
  useCase: { fill: C.white },
  orgCard: { fill: C.white },
  annotation: {},
};

const sizeOf = (n, o) => {
  const def = SHAPES[n.shape] || SHAPES.rect;
  const lines = String(n.text || '').split('\n');
  let w = o.w?.[n.key] ?? def.w;
  let h = o.h?.[n.key] ?? def.h;
  if (def.table) {
    w = Math.max(w, Math.max(...lines.map((l) => l.length)) * 7.4 + 24);
    h = Math.max(60, 36 + (lines.length - 1) * 18 + 10);
  } else if (!def.labelBelow && !def.noText && ['process', 'rounded', 'rect', 'bpmnTask', 'bpmnSubprocess', 'state', 'useCase', 'umlComponent', 'document', 'data', 'orgRole', 'apiGateway', 'umlNote', 'note', 'hexagon', 'ellipse', 'decision', 'diamond'].includes(n.shape)) {
    const longest = Math.max(...lines.map((l) => l.length));
    w = Math.max(w, Math.min(260, longest * 8 + 36));
    const per = Math.max(8, (w - 30) / 7.6);
    const wrapped = lines.reduce((acc, l) => acc + Math.max(1, Math.ceil(l.length / per)), 0);
    h = Math.max(h, wrapped * 19 + 28);
    if (n.shape === 'decision' || n.shape === 'diamond') {
      w = Math.max(w, longest * 9 + 60);
      h = Math.max(h, lines.length * 19 + 50);
    }
  }
  return { w: Math.round(w), h: Math.round(h) };
};

const layered = (nodes, edges, dir, gx, gy) => {
  const index = new Map(nodes.map((n, i) => [n.key, i]));
  const sizes = nodes.map((n) => ({ w: n.w, h: n.h }));
  const list = edges.filter((e) => !e.noLayout && index.has(e.from) && index.has(e.to)).map((e) => (e.endCap === 'triangle' && e.label !== undefined && OPS_UP.has(e.op) ? [index.get(e.to), index.get(e.from)] : [index.get(e.from), index.get(e.to)]));
  let pos;
  try {
    pos = Engine.layoutLayered(sizes, list, dir === 'up' ? 0 : dir === 'right' || dir === 'left' ? 1 : 0, gx, gy);
  } catch {
    pos = null;
  }
  if (!pos || pos.length !== nodes.length) pos = nodes.map((n, i) => ({ x: (i % 4) * 240, y: Math.floor(i / 4) * 160 }));
  const minX = Math.min(...pos.map((p) => p.x));
  const minY = Math.min(...pos.map((p) => p.y));
  const maxY = Math.max(...pos.map((p, i) => p.y + nodes[i].h));
  const maxX = Math.max(...pos.map((p, i) => p.x + nodes[i].w));
  nodes.forEach((n, i) => {
    n.x = Math.round(pos[i].x - minX);
    n.y = Math.round(pos[i].y - minY);
    if (dir === 'up') n.y = Math.round(maxY - minY - n.y - n.h);
    if (dir === 'left') n.x = Math.round(maxX - minX - n.x - n.w);
  });
};

const graph = (nodeSpec, edgeSpec, o = {}) => (b) => {
  const nodes = parseNodes(nodeSpec).map((n) => ({ ...n, ...sizeOf(n, o) }));
  const edges = parseEdges(edgeSpec);
  if (o.layout) o.layout(nodes, edges);
  else layered(nodes, edges, o.dir || 'down', o.gx ?? 70, o.gy ?? 70);
  const ox = o.x || 0;
  const oy = o.y || 0;
  for (const n of nodes) {
    const st = { ...(STYLE[n.shape] || {}), ...(o.style?.[n.key] || {}) };
    if (st.fill) st.textColor = st.textColor || (DARK.has(st.fill) ? C.light : undefined);
    b.node(n.shape, n.text, n.x + ox, n.y + oy, n.w, n.h, { key: n.key, ...st, branch: o.aula ? true : undefined });
  }
  for (const { op, ...e } of edges) b.edge(e.from, e.to, { label: e.label, routing: o.routing, ...e, ...(o.edgeStyle || {}) });
  for (const g of o.groups || []) b.wrap(g.keys, g.label, g.pad, g.o);
  if (o.title) b.text(o.title, ox, oy - 70 - (o.groups?.length ? 30 : 0), { size: 24, weight: 700 });
};

const columns = (keys, x0, y0, gapX, gapY, rows) => (nodes) => {
  const at = new Map();
  rows.forEach((row, r) => row.forEach((k, c) => k && at.set(k, [c, r])));
  for (const n of nodes) {
    const p = at.get(n.key) || [0, 0];
    n.x = x0 + p[0] * gapX + (gapX - n.w) / 2;
    n.y = y0 + p[1] * gapY + (gapY - n.h) / 2;
  }
};

const grid = (o) => (b) => {
  const { title, cols, rows, cw = 150, rh = 44, first = 170 } = o;
  if (title) b.text(title, 0, -60, { size: 24, weight: 700 });
  const widths = [first, ...cols.map(() => cw)];
  let x = 0;
  ['', ...cols].forEach((c, i) => {
    if (i) b.box(c, x, 0, widths[i], rh, C.wine, { shape: 'rect', fontWeight: 600, fontSize: 13 });
    x += widths[i];
  });
  rows.forEach((row, r) => {
    let cx = 0;
    row.forEach((cell, i) => {
      if (widths[i] >= 1) {
        const fill = i === 0 ? C.linen : o.color ? o.color(cell, r, i) : C.white;
        b.box(String(cell), cx, rh * (r + 1), widths[i], rh, fill, { shape: 'rect', fontSize: 13, fontWeight: i === 0 ? 600 : 400, align: i === 0 ? 'left' : 'center' });
      }
      cx += widths[i];
    });
  });
};

const sequence = (actors, msgs, o = {}) => (b) => {
  const gap = 200;
  const h = 120 + msgs.length * 56;
  actors.forEach((a, i) => b.node(o.kinds?.[i] === 'actor' ? 'lifeline' : 'lifeline', a, i * gap, 0, 130, h, { key: 'a' + i, fill: C.white }));
  msgs.forEach(([f, t, label, kind], j) => {
    const y = 90 + j * 56;
    const x1 = f * gap + 65;
    const x2 = t * gap + 65;
    if (f === t) {
      b.edge({ x: x1 + 8, y }, { x: x1 + 8, y: y + 30 }, { label, routing: 'elbow', endCap: 'arrow' });
      return;
    }
    b.edge({ x: x1 + (x2 > x1 ? 8 : -8), y }, { x: x2 + (x2 > x1 ? -8 : 8), y }, { label, routing: 'straight', endCap: kind === 'r' ? 'arrow' : 'triangle', dash: kind === 'r' });
  });
  for (let i = 0; i < actors.length; i++) b.node('activation', '', i * gap + 57, 80, 16, h - 110, { fill: C.linen });
  if (o.title) b.text(o.title, 0, -60, { size: 24, weight: 700 });
};

const quad = (title, labels, lists, o = {}) => (b) => {
  b.text(title, 0, -60, { size: 24, weight: 700 });
  const fills = o.fills || [C.sage, C.rose, C.slate, C.straw];
  labels.forEach((l, i) => {
    const x = (i % 2) * 330;
    const y = Math.floor(i / 2) * 250;
    b.box(`${l}\n\n${lists[i].map((s) => '• ' + s).join('\n')}`, x, y, 310, 230, fills[i], { shape: 'rect', align: 'left', valign: 'top', fontSize: 14 });
  });
  if (o.axes) {
    b.text(o.axes[0], 250, 500, { size: 13, weight: 600 });
    b.text(o.axes[1], -40, 230, { size: 13, weight: 600, rotation: -90 });
  }
};

const stack = (title, levels, o = {}) => (b) => {
  b.text(title, 0, -60, { size: 24, weight: 700 });
  const n = levels.length;
  const W = o.width || 560;
  const fills = o.fills || [C.wine, C.coffee, C.olive, C.rose, C.straw, C.linen, C.slate];
  levels.forEach((l, i) => {
    const w = o.pyramid ? W * (i + 1) / n : W;
    const x = (W - w) / 2;
    b.box(l, x, i * 74, w, 66, fills[i % fills.length], { shape: o.pyramid ? 'trapezoid' : 'rect', fontWeight: 600 });
  });
};

const pyramid = (title, levels) => (b) => {
  b.text(title, 0, -60, { size: 24, weight: 700 });
  const W = 600;
  const n = levels.length;
  levels.forEach((l, i) => {
    const w = 140 + (W - 140) * (i / Math.max(1, n - 1));
    const fill = [C.wine, C.coffee, C.olive, C.rose, C.straw, C.linen][i % 6];
    b.box(l, (W - w) / 2, i * 78, w, 70, fill, { shape: 'rect', fontWeight: 600 });
  });
};

const mindmap = (root, branches, o = {}) => (b) => {
  const r = b.node('ellipse', root, -110, -45, 220, 90, { key: 'root', fill: C.wine, textColor: C.light, fontWeight: 700, fontSize: 18, branch: o.aula ? true : undefined });
  const half = Math.ceil(branches.length / 2);
  branches.forEach(([label, leaves], i) => {
    const right = i < half;
    const idx = right ? i : i - half;
    const count = right ? half : branches.length - half;
    const y = (idx - (count - 1) / 2) * 190;
    const x = right ? 260 : -460;
    const k = b.box(label, x, y - 25, 200, 50, [C.straw, C.sage, C.rose, C.slate][i % 4], { fontWeight: 600, branch: o.aula ? true : undefined });
    b.edge(r, k, { routing: 'curved', endCap: 'none', strokeWidth: 2 });
    (leaves || []).forEach((leaf, j) => {
      const ly = y - 25 + (j - (leaves.length - 1) / 2) * 56;
      const lk = b.box(leaf, right ? x + 260 : x - 240, ly + 6, 180, 40, C.white, { fontSize: 13, branch: o.aula ? true : undefined });
      b.edge(k, lk, { routing: 'curved', endCap: 'none' });
    });
  });
};

const tree = (spec, o = {}) => graph(spec.nodes, spec.edges, { dir: 'down', gx: 40, gy: 70, routing: 'elbow', ...o });

const ishikawa = (problem, bones) => (b) => {
  b.text('Diagrama de Ishikawa (causa e efeito)', 0, -100, { size: 24, weight: 700 });
  const L = 900;
  b.box(problem, L + 10, 150, 200, 90, C.wine, { fontWeight: 700 });
  b.line(0, 195, L + 10, 195, { endCap: 'triangle', strokeWidth: 3 });
  bones.forEach(([label, causes], i) => {
    const top = i % 2 === 0;
    const col = Math.floor(i / 2);
    const bx = 120 + col * 280;
    const y0 = top ? 20 : 370;
    b.box(label, bx - 70, top ? y0 - 40 : y0, 140, 36, C.straw, { fontWeight: 600 });
    b.line(bx, top ? y0 : y0, bx + 120, 195, { strokeWidth: 2 });
    causes.forEach((c, j) => {
      const t = (j + 1) / (causes.length + 1);
      const px = bx + 120 * t;
      const py = (top ? y0 : y0) + (195 - y0) * t;
      b.line(px - 90, py, px, py, { strokeWidth: 1.2 });
      b.text(c, px - 160, py - 20, { size: 12 });
    });
  });
};

const venn = (title, sets, center) => (b) => {
  b.text(title, 0, -60, { size: 24, weight: 700 });
  const pos = sets.length === 2 ? [[0, 0], [200, 0]] : [[0, 0], [200, 0], [100, 170]];
  const fills = [C.rose, C.slate, C.sage];
  sets.forEach(([label, items], i) => {
    b.node('ellipse', '', pos[i][0], pos[i][1], 320, 320, { fill: fills[i], opacity: 0.6 });
    const tx = pos[i][0] + (i === 0 ? 30 : i === 1 ? 200 : 110);
    const ty = pos[i][1] + (i === 2 ? 230 : 90);
    b.text(`${label}\n${items.join('\n')}`, tx, ty, { size: 13, weight: 400 });
  });
  b.text(center, sets.length === 2 ? 210 : 215, sets.length === 2 ? 150 : 165, { size: 13, weight: 700 });
};

const kanban = (cols) => (b) => {
  b.text('Quadro Kanban', 0, -60, { size: 24, weight: 700 });
  const colors = [C.straw, C.rose, C.slate, C.sage, C.linen];
  cols.forEach(([name, cards], i) => {
    const x = i * 260;
    b.box(`${name} (${cards.length})`, x, 0, 240, 44, C.coffee, { shape: 'rect', fontWeight: 700 });
    b.node('rect', '', x, 44, 240, Math.max(260, cards.length * 120 + 30), { fill: C.linen, stroke: null });
    cards.forEach((c, j) => b.items.push({ kind: 'sticky', key: 'n' + b.k++, text: c, x: x + 20, y: 64 + j * 120, w: 200, h: 100, color: colors[(i + j) % colors.length] }));
  });
};

const gantt = (title, weeks, tasks) => (b) => {
  b.text(title, 0, -60, { size: 24, weight: 700 });
  const lw = 220;
  const cw = 70;
  b.box('Tarefa', 0, 0, lw, 40, C.wine, { shape: 'rect', fontWeight: 600 });
  weeks.forEach((w, i) => b.box(w, lw + i * cw, 0, cw, 40, C.wine, { shape: 'rect', fontSize: 12 }));
  tasks.forEach(([name, start, len, kind], r) => {
    const y = 40 + r * 44;
    b.box(name, 0, y, lw, 44, C.linen, { shape: 'rect', align: 'left', fontSize: 13 });
    weeks.forEach((_, i) => b.node('rect', '', lw + i * cw, y, cw, 44, { fill: C.white, stroke: { color: C.linen, alpha: 1 }, strokeWidth: 1 }));
    if (kind === 'm') b.node('diamond', '', lw + start * cw + cw / 2 - 12, y + 10, 24, 24, { fill: C.wine });
    else b.box('', lw + start * cw + 4, y + 10, len * cw - 8, 24, [C.olive, C.slate, C.rose, C.coffee][r % 4], { radius: 6 });
  });
};

const lanes = (title, laneNames, nodeSpec, edgeSpec, place, o = {}) => (b) => {
  const LW = 150;
  const RH = o.rh || 150;
  const CW = o.cw || 190;
  const cols = Math.max(...Object.values(place).map((p) => p[0])) + 1;
  const W = 60 + cols * CW + 40;
  const pool = b.node('pool', title, 0, 0, W, laneNames.length * RH, { fill: C.paper, fontWeight: 700, key: 'pool' });
  laneNames.forEach((l, i) => b.node('lane', l, 36, i * RH, W - 36, RH, { fill: i % 2 ? C.white : C.paper, fontWeight: 600 }));
  const nodes = parseNodes(nodeSpec).map((n) => ({ ...n, ...sizeOf(n, {}) }));
  for (const n of nodes) {
    const [c, r] = place[n.key] || [0, 0];
    n.x = 36 + LW / 2 + 10 + c * CW + (CW - n.w) / 2 - LW / 4;
    n.y = r * RH + (RH - n.h) / 2;
    const st = { ...(STYLE[n.shape] || {}) };
    if (st.fill) st.textColor = DARK.has(st.fill) ? C.light : undefined;
    b.node(n.shape, n.text, n.x, n.y, n.w, n.h, { key: n.key, ...st });
  }
  for (const { op, ...e } of parseEdges(edgeSpec)) b.edge(e.from, e.to, { routing: 'elbow', ...e });
  return pool;
};

const journey = (title, stages, rows) => (b) => {
  b.text(title, 0, -60, { size: 24, weight: 700 });
  const cw = 210;
  const lw = 150;
  stages.forEach((s, i) => b.box(s, lw + i * cw, 0, cw - 10, 50, C.wine, { fontWeight: 700 }));
  rows.forEach(([label, cells, color], r) => {
    const y = 66 + r * 110;
    b.box(label, 0, y, lw - 10, 96, C.linen, { fontWeight: 700 });
    cells.forEach((c, i) => b.box(c, lw + i * cw, y, cw - 10, 96, color || C.white, { fontSize: 13 }));
  });
};

const roadmap = (title, periods, tracks) => (b) => {
  b.text(title, 0, -60, { size: 24, weight: 700 });
  const lw = 160;
  const cw = 230;
  periods.forEach((p, i) => b.box(p, lw + i * cw, 0, cw - 10, 44, C.wine, { shape: 'rect', fontWeight: 700 }));
  tracks.forEach(([name, items], r) => {
    const y = 56 + r * 90;
    b.box(name, 0, y, lw - 10, 78, C.linen, { shape: 'rect', fontWeight: 700 });
    items.forEach(([label, start, len], j) => b.box(label, lw + start * cw + 6, y + 14, len * cw - 22, 50, [C.straw, C.sage, C.rose, C.slate][(r + j) % 4], { fontSize: 13 }));
  });
};

const wireframe = () => (b) => {
  b.text('Wireframe de página', 0, -60, { size: 24, weight: 700 });
  b.node('uiBrowser', '', 0, 0, 900, 620, { fill: C.white });
  b.node('uiNavbar', 'Logo        Início   Produtos   Preços   Contato', 0, 30, 900, 56, { fill: C.linen });
  b.text('Título principal da página', 40, 120, { size: 30, weight: 700 });
  b.text('Uma frase curta explicando o valor do produto para quem chega.', 40, 170, { size: 15 });
  b.node('uiButton', 'Começar agora', 40, 220, 160, 44, { fill: C.wine, textColor: C.light });
  b.node('uiInput', 'seu@email.com', 220, 222, 240, 40, { fill: C.white });
  b.node('uiImage', '', 520, 110, 340, 220, { fill: C.linen });
  [0, 1, 2].forEach((i) => {
    b.node('uiCard', `Recurso ${i + 1}\nDescrição breve do recurso.`, 40 + i * 280, 370, 260, 160, { fill: C.paper });
  });
  b.node('uiTabs', 'Mensal  |  Anual', 40, 550, 300, 40, { fill: C.white });
};

const timing = () => (b) => {
  b.text('Diagrama de tempo', 0, -60, { size: 24, weight: 700 });
  const lanesT = [['Usuário', [['Ocioso', 0, 2], ['Digitando', 2, 3], ['Esperando', 5, 2], ['Lendo', 7, 3]]], ['Sistema', [['Ocioso', 0, 5], ['Processando', 5, 2], ['Respondendo', 7, 1], ['Ocioso', 8, 2]]], ['Banco', [['Livre', 0, 5], ['Consulta', 5, 2], ['Livre', 7, 3]]]];
  const unit = 80;
  lanesT.forEach(([name, segs], r) => {
    const y = r * 90;
    b.box(name, 0, y, 130, 70, C.linen, { shape: 'rect', fontWeight: 700 });
    segs.forEach(([s, start, len], j) => b.box(s, 140 + start * unit, y + 10 + (j % 2) * 10, len * unit - 4, 40, j % 2 ? C.straw : C.slate, { shape: 'rect', fontSize: 12 }));
  });
  for (let t = 0; t <= 10; t++) b.text(`${t * 100} ms`, 130 + t * unit, 280, { size: 11 });
  b.line(140, 270, 140 + 10 * unit, 270, { endCap: 'arrow' });
};

const ibd = () => (b) => {
  b.text('Bloco interno (IBD)', 0, -60, { size: 24, weight: 700 });
  b.node('boundary', 'ibd [bloco] Drone', 0, 0, 820, 420, { fill: C.paper, fontWeight: 700, container: true });
  const parts = [['bat', 'bateria: Bateria', 40, 70], ['ctl', 'controle: Controlador', 320, 70], ['mot', 'motores: Motor [4]', 600, 70], ['cam', 'câmera: Câmera', 320, 270], ['gps', 'gps: Receptor GPS', 40, 270]];
  for (const [k, t, x, y] of parts) b.box(`«part»\n${t}`, x, y, 190, 90, C.white, { key: k, shape: 'rect' });
  b.edge('bat', 'ctl', { label: 'energia', endCap: 'arrow', routing: 'straight' });
  b.edge('ctl', 'mot', { label: 'PWM', endCap: 'arrow', routing: 'straight' });
  b.edge('cam', 'ctl', { label: 'vídeo', endCap: 'arrow' });
  b.edge('gps', 'ctl', { label: 'posição', endCap: 'arrow' });
};

const deployment = () => (b) => {
  b.text('Diagrama de implantação', 0, -60, { size: 24, weight: 700 });
  b.node('boundary', '«device» Servidor de aplicação', 0, 0, 380, 260, { fill: C.paper, container: true, fontWeight: 700 });
  b.node('umlComponent', 'api.jar', 40, 60, 140, 80, { key: 'api', fill: C.white });
  b.node('umlComponent', 'worker.jar', 200, 60, 140, 80, { key: 'wk', fill: C.white });
  b.node('boundary', '«device» Servidor de banco', 480, 0, 300, 260, { fill: C.paper, container: true, fontWeight: 700 });
  b.node('database', 'PostgreSQL', 580, 80, 100, 110, { key: 'db', fill: C.linen });
  b.node('laptop', 'Navegador', 140, 360, 90, 64, { key: 'cli' });
  b.edge('cli', 'api', { label: 'HTTPS', endCap: 'arrow' });
  b.edge('api', 'db', { label: 'TCP 5432', endCap: 'arrow' });
  b.edge('wk', 'db', { label: 'TCP 5432', endCap: 'arrow' });
};

const c4 = (level) => {
  if (level === 1) return graph('u:netUser:Cliente\n[Pessoa];s:rounded:Loja online\n[Sistema de software];p:rounded:Gateway de pagamento\n[Sistema externo];e:rounded:Serviço de e-mail\n[Sistema externo];a:netUser:Atendente\n[Pessoa]', 'u>s:Compra produtos;a>s:Gerencia pedidos;s>p:Cobra pagamentos;s>e:Envia confirmações', { title: 'C4 · Contexto', style: { s: { fill: C.wine }, p: { fill: C.slate }, e: { fill: C.slate } }, gy: 110 });
  if (level === 2) return graph('u:netUser:Cliente;w:rounded:Aplicação web\n[React];m:rounded:App celular\n[Flutter];api:rounded:API\n[Spring Boot];q:queue:Fila de eventos;db:database:Banco\n[PostgreSQL];c:rounded:Cache\n[Redis]', 'u>w:HTTPS;u>m:HTTPS;w>api:JSON/HTTPS;m>api:JSON/HTTPS;api>db:JDBC;api>c:lê e grava;api>q:publica', { title: 'C4 · Contêineres', style: { w: { fill: C.wine }, m: { fill: C.wine }, api: { fill: C.wine } }, groups: [{ keys: ['w', 'm', 'api', 'q', 'db', 'c'], label: 'Loja online [Sistema]' }], gy: 100 });
  return graph('ctl:rounded:Controlador de pedidos\n[REST];svc:rounded:Serviço de pedidos;rep:rounded:Repositório de pedidos;pay:rounded:Cliente de pagamento;db:database:Banco;ext:rounded:Gateway de pagamento\n[Externo]', 'ctl>svc:usa;svc>rep:usa;svc>pay:usa;rep>db:SQL;pay>ext:HTTPS', { title: 'C4 · Componentes', style: { ctl: { fill: C.olive }, svc: { fill: C.olive }, rep: { fill: C.olive }, pay: { fill: C.olive }, ext: { fill: C.slate } }, groups: [{ keys: ['ctl', 'svc', 'rep', 'pay'], label: 'API [Contêiner]' }], gy: 100 });
};

const T = (id, cat, name, desc, build) => ({ id, cat, name, desc, build });

export const TEMPLATES = [
  T('uml-class', 'uml', 'Classe', 'Classes com atributos, métodos, herança e associações.', graph('pessoa:umlClass:Pessoa\n- nome: String\n- email: String\n+ contato(): String;cli:umlClass:Cliente\n- pontos: int\n+ comprar(p: Pedido);func:umlClass:Funcionário\n- cargo: String;ped:umlClass:Pedido\n- data: Date\n+ total(): Decimal;item:umlClass:ItemPedido\n- quantidade: int;prod:umlClass:Produto\n- preco: Decimal;pag:umlInterface:«interface» Pagável\n+ pagar(valor)', 'cli-|>pessoa;func-|>pessoa;cli>ped:faz 1..*;ped<>-item:contém;item>prod:refere;ped..|>pag:implementa', { title: 'Diagrama de classes', gx: 60, gy: 90 })),
  T('uml-sequence', 'uml', 'Sequência', 'Mensagens entre participantes ao longo do tempo.', sequence(['Cliente', 'App', 'API', 'Banco'], [[0, 1, 'Toca em Comprar'], [1, 2, 'POST /pedidos'], [2, 3, 'INSERT pedido'], [3, 2, 'id do pedido', 'r'], [2, 2, 'Valida estoque'], [2, 1, '201 Created', 'r'], [1, 0, 'Mostra confirmação', 'r']], { title: 'Diagrama de sequência' })),
  T('uml-usecase', 'uml', 'Caso de uso', 'Atores, casos de uso e o limite do sistema.', graph('cli:actor:Cliente;adm:actor:Administrador;u1:useCase:Buscar produto;u2:useCase:Fazer pedido;u3:useCase:Pagar;u4:useCase:Acompanhar entrega;u5:useCase:Cadastrar produto;u6:useCase:Emitir relatório', 'cli--u1;cli--u2;cli--u4;u2..>u3:«include»;adm--u5;adm--u6', { title: 'Diagrama de casos de uso', dir: 'right', gx: 50, gy: 120, groups: [{ keys: ['u1', 'u2', 'u3', 'u4', 'u5', 'u6'], label: 'Loja online', o: { shape: 'rect' } }] })),
  T('uml-state', 'uml', 'Máquina de estados', 'Estados, transições e eventos de um objeto.', graph('i:initialState:;a:state:Rascunho;b:state:Enviado;c:state:Pago;d:state:Em entrega;e:state:Entregue;x:state:Cancelado;f:finalState:', 'i>a;a>b:enviar;b>c:pagamento aprovado;b>x:cancelar;c>d:despachar;d>e:receber;e>f;x>f', { title: 'Máquina de estados do pedido', gy: 80 })),
  T('uml-activity', 'uml', 'Atividade', 'Fluxo de ações com decisões e paralelismo.', graph('i:initialState:;a:rounded:Receber pedido;d:decision:Estoque?;f1:forkBar:;b:rounded:Separar itens;c:rounded:Emitir nota;f2:forkBar:;e:rounded:Enviar;n:rounded:Avisar cliente;fim:finalState:', 'i>a;a>d;d>f1:sim;d>n:não;f1>b;f1>c;b>f2;c>f2;f2>e;e>fim;n>fim', { title: 'Diagrama de atividade', gy: 60 })),
  T('uml-component', 'uml', 'Componente', 'Componentes e as interfaces que oferecem e usam.', graph('ui:umlComponent:Interface web;api:umlComponent:API de pedidos;pay:umlComponent:Pagamentos;inv:umlComponent:Estoque;not:umlComponent:Notificações;db:database:Banco', 'ui>api:REST;api>pay:IPagamento;api>inv:IEstoque;api..>not:eventos;inv>db;api>db', { title: 'Diagrama de componentes', gy: 90 })),
  T('uml-deployment', 'uml', 'Implantação', 'Nós físicos e os artefatos implantados neles.', deployment()),
  T('uml-object', 'uml', 'Objeto', 'Instâncias e seus valores num momento.', graph('p:umlClass:p1: Pedido\nnumero = 1042\nstatus = PAGO;c:umlClass:ana: Cliente\nnome = "Ana"\npontos = 120;i1:umlClass:i1: ItemPedido\nquantidade = 2;i2:umlClass:i2: ItemPedido\nquantidade = 1;pr:umlClass:caneca: Produto\npreco = 39,90', 'c--p;p--i1;p--i2;i1--pr', { title: 'Diagrama de objetos' })),
  T('uml-package', 'uml', 'Pacote', 'Organização em pacotes e dependências.', graph('web:umlPackage:web;app:umlPackage:aplicacao;dom:umlPackage:dominio;inf:umlPackage:infraestrutura;ext:umlPackage:integracoes', 'web..>app;app..>dom;inf..>dom;inf..>ext;web..>inf:configura', { title: 'Diagrama de pacotes', gy: 90 })),
  T('uml-communication', 'uml', 'Comunicação', 'Objetos ligados com mensagens numeradas.', graph('u:actor:Usuário;t:rect::Tela;c:rect::Controlador;s:rect::Serviço;r:rect::Repositório', 'u>t:1: enviar formulário;t>c:2: salvar(dados);c>s:3: validar();s>r:4: gravar();r>s:5: ok', { title: 'Diagrama de comunicação', dir: 'right', gx: 80, gy: 90 })),
  T('uml-timing', 'uml', 'Tempo', 'Mudanças de estado de cada participante no tempo.', timing()),
  T('uml-overview', 'uml', 'Visão geral de interação', 'Atividade cujos passos são interações.', graph('i:initialState:;a:umlPackage:ref Autenticar;d:decision:Válido?;b:umlPackage:ref Montar carrinho;c:umlPackage:ref Pagar;e:umlPackage:ref Mostrar erro;f:finalState:', 'i>a;a>d;d>b:sim;d>e:não;b>c;c>f;e>f', { title: 'Visão geral de interação' })),
  T('sysml-req', 'uml', 'Requisitos', 'Requisitos SysML com derivação, satisfação e verificação.', graph('r1:rect:«requirement»\nAutonomia\nVoar 30 min;r2:rect:«requirement»\nBateria\n≥ 5000 mAh;r3:rect:«requirement»\nPeso\n≤ 1,2 kg;b:rect:«block»\nBateria LiPo;t:rect:«testCase»\nVoo de resistência', 'r2..>r1:«deriveReqt»;r3..>r1:«deriveReqt»;b..>r2:«satisfy»;t..>r1:«verify»', { title: 'Diagrama de requisitos', gy: 100 })),
  T('sysml-bdd', 'uml', 'Definição de blocos (BDD)', 'Blocos SysML e a composição entre eles.', graph('d:umlClass:«block» Drone\nmassa: kg\nautonomia: min;b:umlClass:«block» Bateria\ncapacidade: mAh;m:umlClass:«block» Motor\nrpm: int;c:umlClass:«block» Controlador;s:umlClass:«block» Sensor', 'd<>-b:1;d<>-m:4;d<>-c:1;c<>-s:1..*', { title: 'Definição de blocos (BDD)', gy: 90 })),
  T('sysml-ibd', 'uml', 'Bloco interno (IBD)', 'Partes internas de um bloco e os fluxos entre elas.', ibd()),
  T('sysml-par', 'uml', 'Paramétrico', 'Restrições e equações ligadas a parâmetros.', graph('c1:ellipse:«constraint»\nE = P × t;c2:ellipse:«constraint»\nP = m × g × v;m:rect:massa: kg;v:rect:velocidade: m/s;t:rect:tempo: h;e:rect:energia: Wh', 'm--c2;v--c2;c2--c1:P;t--c1;c1--e', { title: 'Diagrama paramétrico', gy: 90 })),

  T('flowchart', 'process', 'Fluxograma', 'Início, processos, decisões e fim.', graph('a:terminator:Início;b:process:Receber pedido;c:decision:Tem estoque?;d:process:Separar e embalar;e:document:Emitir nota fiscal;f:process:Avisar cliente;g:database:Registrar pedido;h:terminator:Fim', 'a>b;b>c;c>d:Sim;c>f:Não;d>e;e>g;f>h;g>h', { title: 'Fluxograma de pedidos' })),
  T('bpmn', 'process', 'BPMN 2.0', 'Processo com piscina, raias, tarefas e gateways.', lanes('Compra online', ['Cliente', 'Loja', 'Transportadora'], 's:startEvent:Pedido feito;t1:bpmnTask:Conferir pagamento;g:gateway:Aprovado?;t2:bpmnTask:Separar produtos;t3:bpmnTask:Avisar recusa;t4:bpmnTask:Coletar pacote;t5:bpmnTask:Entregar;e:endEvent:Recebido', 's>t1;t1>g;g>t2:sim;g>t3:não;t2>t4;t4>t5;t5>e', { s: [0, 0], t1: [1, 1], g: [2, 1], t2: [3, 1], t3: [3, 0], t4: [4, 2], t5: [5, 2], e: [6, 0] })),
  T('dfd', 'process', 'Fluxo de dados (DFD)', 'Entidades externas, processos e depósitos de dados.', graph('c:rect:Cliente;p1:ellipse:1.0\nRegistrar pedido;p2:ellipse:2.0\nCobrar;p3:ellipse:3.0\nExpedir;d1:storedData:D1 Pedidos;d2:storedData:D2 Pagamentos;b:rect:Banco emissor', 'c>p1:dados do pedido;p1>d1:pedido;p1>p2:valor;p2>b:cobrança;b>p2:aprovação;p2>d2:recibo;d1>p3:itens;p3>c:entrega', { title: 'Diagrama de fluxo de dados', style: { c: { fill: C.linen }, b: { fill: C.linen } } })),
  T('process-map', 'process', 'Mapa de processo', 'Etapas do processo da ponta a ponta.', graph('a:chevron:Pedir;b:chevron:Aprovar;c:chevron:Comprar;d:chevron:Receber;e:chevron:Pagar', 'a--b;b--c;c--d;d--e', { title: 'Mapa de processo de compras', dir: 'right', gx: 10, style: { a: { fill: C.wine }, b: { fill: C.coffee }, c: { fill: C.olive }, d: { fill: C.rose }, e: { fill: C.straw } } })),
  T('sipoc', 'process', 'SIPOC', 'Fornecedores, entradas, processo, saídas e clientes.', grid({ title: 'SIPOC · atendimento de pedidos', cols: ['Fornecedores', 'Entradas', 'Processo', 'Saídas', 'Clientes'], first: 0, cw: 180, rh: 54, rows: [['', 'Fabricantes', 'Produtos', 'Receber pedido', 'Pedido confirmado', 'Consumidor final'], ['', 'Transportadora', 'Rotas e prazos', 'Separar e embalar', 'Pacote pronto', 'Lojista parceiro'], ['', 'Banco', 'Autorização', 'Cobrar', 'Nota fiscal', 'Financeiro'], ['', 'TI', 'Sistema de pedidos', 'Expedir', 'Rastreio', 'Atendimento']] })),
  T('decision-tree', 'process', 'Árvore de decisão', 'Perguntas que levam a resultados.', tree({ nodes: 'q1:decision:Cliente novo?;q2:decision:Compra > R$ 500?;q3:decision:Tem cupom?;r1:rounded:Frete grátis;r2:rounded:Desconto 10%;r3:rounded:Aplicar cupom;r4:rounded:Preço normal', edges: 'q1>q2:sim;q1>q3:não;q2>r1:sim;q2>r2:não;q3>r3:sim;q3>r4:não' }, { title: 'Árvore de decisão de descontos', style: { r1: { fill: C.sage }, r2: { fill: C.sage }, r3: { fill: C.sage }, r4: { fill: C.linen } } })),

  T('c4-context', 'arch', 'C4 · Contexto', 'O sistema, quem usa e com quem conversa.', c4(1)),
  T('c4-containers', 'arch', 'C4 · Contêineres', 'Aplicações, serviços e bancos dentro do sistema.', c4(2)),
  T('c4-components', 'arch', 'C4 · Componentes', 'Componentes dentro de um contêiner.', c4(3)),
  T('layered', 'arch', 'Em camadas', 'Apresentação, aplicação, domínio e infraestrutura.', stack('Arquitetura em camadas', ['Apresentação · telas, controladores, API', 'Aplicação · casos de uso e orquestração', 'Domínio · entidades e regras de negócio', 'Infraestrutura · banco, mensageria, integrações'], { fills: [C.wine, C.olive, C.rose, C.slate] })),
  T('microservices', 'arch', 'Microsserviços', 'Gateway, serviços independentes, bancos e eventos.', graph('cli:laptop:Clientes;gw:apiGateway:Gateway de API;auth:rounded:Autenticação;ped:rounded:Pedidos;cat:rounded:Catálogo;pag:rounded:Pagamentos;bus:queue:Barramento de eventos;d1:database:auth;d2:database:pedidos;d3:database:catálogo;d4:database:pagamentos', 'cli>gw;gw>auth;gw>ped;gw>cat;gw>pag;auth>d1;ped>d2;cat>d3;pag>d4;ped..>bus:publica;pag..>bus:assina', { title: 'Arquitetura de microsserviços', gy: 90, style: { auth: { fill: C.olive }, ped: { fill: C.olive }, cat: { fill: C.olive }, pag: { fill: C.olive } } })),
  T('hexagonal', 'arch', 'Hexagonal', 'Domínio no centro, portas e adaptadores em volta.', (b) => {
    b.text('Arquitetura hexagonal (portas e adaptadores)', 0, -80, { size: 24, weight: 700 });
    b.node('hexagon', '', 160, 60, 520, 420, { fill: C.linen });
    b.node('hexagon', 'Domínio\nentidades e regras', 300, 180, 240, 180, { fill: C.wine, textColor: C.light, fontWeight: 700, key: 'dom' });
    const ports = [['Porta de entrada\nCriarPedido', 200, 120, 'p1'], ['Porta de entrada\nConsultarPedido', 200, 380, 'p2'], ['Porta de saída\nRepositório', 520, 120, 'p3'], ['Porta de saída\nNotificador', 520, 380, 'p4']];
    for (const [t, x, y, k] of ports) b.box(t, x, y, 130, 56, C.straw, { key: k, fontSize: 12 });
    const ad = [['REST', -120, 120, 'a1', 'p1'], ['CLI', -120, 380, 'a2', 'p2'], ['PostgreSQL', 820, 120, 'a3', 'p3'], ['E-mail', 820, 380, 'a4', 'p4']];
    for (const [t, x, y, k, p] of ad) {
      b.box(`Adaptador\n${t}`, x, y, 150, 56, C.slate, { key: k });
      if (x < 0) b.edge(k, p, { endCap: 'arrow' });
      else b.edge(p, k, { endCap: 'arrow' });
    }
    b.edge('p1', 'dom', { endCap: 'arrow' });
    b.edge('p2', 'dom', { endCap: 'arrow' });
    b.edge('dom', 'p3', { endCap: 'arrow' });
    b.edge('dom', 'p4', { endCap: 'arrow' });
  }),
  T('event-driven', 'arch', 'Orientada a eventos', 'Produtores, broker de eventos e consumidores.', graph('p1:rounded:Pedidos\n(produtor);p2:rounded:Pagamentos\n(produtor);br:queue:Broker\nKafka / RabbitMQ;c1:rounded:Estoque\n(consumidor);c2:rounded:Notificações\n(consumidor);c3:rounded:Analytics\n(consumidor);dlq:queue:Fila de mensagens mortas', 'p1>br:PedidoCriado;p2>br:PagamentoAprovado;br>c1;br>c2;br>c3;br..>dlq:falhas', { title: 'Arquitetura orientada a eventos', gy: 100, style: { br: { fill: C.straw } } })),
  T('clean', 'arch', 'Clean Architecture', 'Círculos concêntricos com a regra de dependência.', (b) => {
    b.text('Clean Architecture', 0, -60, { size: 24, weight: 700 });
    const rings = [['Frameworks e drivers · web, banco, UI', C.slate, 0], ['Adaptadores de interface · controladores, gateways, apresentadores', C.sage, 70], ['Casos de uso · regras da aplicação', C.rose, 140], ['Entidades\nregras de negócio', C.wine, 210]];
    for (const [t, f, d] of rings) b.node('ellipse', '', d, d, 640 - d * 2, 640 - d * 2, { fill: f });
    rings.forEach(([t, f, d], i) => b.text(t, i === 3 ? 270 : 180 - i * 10, i === 3 ? 300 : d + 22, { size: i === 3 ? 18 : 13, weight: 700, color: i === 3 ? C.light : C.ink }));
    b.line(680, 560, 680, 120, { endCap: 'triangle', strokeWidth: 2, label: 'dependências apontam para dentro' });
  }),

  T('erd', 'data', 'Entidade-relacionamento', 'Entidades com chaves e cardinalidade pé-de-galinha.', graph('cli:entity:cliente\nPK id: uuid\nnome: varchar(80)\nemail: citext;ped:entity:pedido\nPK id: uuid\nFK cliente_id: uuid\ncriado_em: timestamptz\nstatus: varchar(20);item:entity:item_pedido\nPK id: uuid\nFK pedido_id: uuid\nFK produto_id: uuid\nquantidade: int;prod:entity:produto\nPK id: uuid\nnome: varchar(120)\npreco: numeric(10,2)', 'cli1-nped:faz;ped1-nitem:contém;prod1-nitem:aparece em', { title: 'Diagrama entidade-relacionamento', dir: 'right', gx: 90, gy: 70 })),
  T('relational', 'data', 'Modelo relacional', 'Tabelas, chaves primárias e estrangeiras.', graph('a:entity:alunos\nPK id_aluno\nnome\nnascimento;t:entity:turmas\nPK id_turma\nnome\nano;m:entity:matriculas\nPK id_matricula\nFK id_aluno\nFK id_turma\ndata;p:entity:professores\nPK id_professor\nnome;d:entity:disciplinas\nPK id_disciplina\nFK id_professor\nnome', 'a1-nm;t1-nm;p1-nd;t0-nd', { title: 'Modelo relacional · escola', gx: 70, gy: 90 })),
  T('db-schema', 'data', 'Esquema de banco', 'Esquema físico com tipos e índices.', graph('u:entity:users\nid bigserial PK\nemail citext UNIQUE\nsenha_hash text\ncriado_em timestamptz;s:entity:sessions\nid uuid PK\nuser_id bigint FK\nexpira_em timestamptz\nidx (user_id);o:entity:orders\nid bigserial PK\nuser_id bigint FK\ntotal numeric(12,2)\nidx (user_id, criado_em);l:entity:order_lines\norder_id bigint FK\nsku text\nqtd int\nPK (order_id, sku)', 'u1-ns;u1-no;o1-nl', { title: 'Esquema do banco (PostgreSQL)', dir: 'right', gx: 80 })),
  T('dw', 'data', 'Data warehouse', 'Esquema estrela com fato e dimensões.', (b) => {
    b.text('Data warehouse · esquema estrela', 0, -60, { size: 24, weight: 700 });
    b.node('entity', 'fato_vendas\nFK data_id\nFK produto_id\nFK loja_id\nFK cliente_id\nquantidade\nvalor', 290, 200, 220, 170, { key: 'f', fill: C.straw });
    const dims = [['dim_data\nPK data_id\ndia, mês, ano', 0, 0, 'd1'], ['dim_produto\nPK produto_id\nnome, categoria', 580, 0, 'd2'], ['dim_loja\nPK loja_id\ncidade, região', 0, 420, 'd3'], ['dim_cliente\nPK cliente_id\nsegmento, idade', 580, 420, 'd4']];
    for (const [t, x, y, k] of dims) {
      b.node('entity', t, x, y, 200, 110, { key: k, fill: C.white });
      b.edge(k, 'f', { startCap: 'one', endCap: 'many' });
    }
  }),
  T('pipeline', 'data', 'Pipeline de dados', 'Fontes, ingestão, transformação e consumo.', graph('s1:netDatabase:ERP;s2:globe:API externa;s3:document:Planilhas;in:rounded:Ingestão\n(Airbyte / CDC);raw:bucket:Camada bruta;tr:rounded:Transformação\n(dbt / Spark);dw:netDatabase:Data warehouse;bi:display:Painéis de BI;ml:rounded:Modelos de ML', 's1>in;s2>in;s3>in;in>raw;raw>tr;tr>dw;dw>bi;dw>ml', { title: 'Pipeline de dados', dir: 'right', gx: 70, gy: 50, style: { tr: { fill: C.olive }, in: { fill: C.olive } } })),
  T('json-tree', 'data', 'Árvore JSON', 'Estrutura hierárquica de um documento JSON.', tree({ nodes: 'r:rounded:{ } pedido;id:rounded:"id": 1042;cl:rounded:{ } cliente;nm:rounded:"nome": "Ana";em:rounded:"email": "ana@…";it:rounded:[ ] itens;i0:rounded:{ } 0;i1:rounded:{ } 1;s0:rounded:"sku": "CAN-01";s1:rounded:"sku": "CAM-07"', edges: 'r>id;r>cl;r>it;cl>nm;cl>em;it>i0;it>i1;i0>s0;i1>s1' }, { title: 'Árvore JSON', style: { r: { fill: C.wine }, cl: { fill: C.straw }, it: { fill: C.straw } } })),

  T('network', 'infra', 'Rede', 'Internet, firewall, sub-redes, servidores e usuários.', graph('net:globe:Internet;fw:firewall:Firewall;rt:router:Roteador;lb:loadBalancer:Balanceador;w1:server:Web 1;w2:server:Web 2;db:netDatabase:Banco;u1:laptop:Estação 1;u2:laptop:Estação 2', 'net>fw;fw>rt;rt>lb;lb>w1;lb>w2;w1>db;w2>db;rt>u1;rt>u2', { title: 'Diagrama de rede', groups: [{ keys: ['lb', 'w1', 'w2', 'db'], label: 'DMZ 10.0.1.0/24' }] })),
  T('cloud', 'infra', 'Arquitetura em nuvem', 'CDN, balanceador, aplicação escalável e serviços gerenciados.', graph('u:netUser:Usuários;cdn:netCloud:CDN;lb:loadBalancer:Balanceador;a1:containerBox:App;a2:containerBox:App;fn:lambda:Funções;q:queue:Fila;db:netDatabase:Banco gerenciado;st:bucket:Armazenamento de objetos', 'u>cdn;cdn>lb;lb>a1;lb>a2;a1>db;a2>db;a1>q;q>fn;fn>st', { title: 'Arquitetura em nuvem', groups: [{ keys: ['lb', 'a1', 'a2', 'fn', 'q', 'db', 'st'], label: 'Região sa-east-1 · VPC' }] })),
  T('kubernetes', 'infra', 'Kubernetes', 'Ingress, serviços, deployments, pods e volumes.', graph('ing:apiGateway:Ingress;svc1:rounded:Service web;svc2:rounded:Service api;p1:containerBox:Pod web;p2:containerBox:Pod web;p3:containerBox:Pod api;p4:containerBox:Pod api;cfg:document:ConfigMap / Secret;pv:bucket:PersistentVolume', 'ing>svc1;ing>svc2;svc1>p1;svc1>p2;svc2>p3;svc2>p4;cfg..>p3;p4>pv', { title: 'Kubernetes', groups: [{ keys: ['svc1', 'svc2', 'p1', 'p2', 'p3', 'p4', 'cfg', 'pv'], label: 'Namespace loja' }] })),
  T('docker', 'infra', 'Docker e contêineres', 'Serviços do Compose, redes e volumes.', graph('px:containerBox:proxy\nnginx;web:containerBox:web\nnode:22;api:containerBox:api\njava:21;db:containerBox:db\npostgres:17;rd:containerBox:cache\nredis:7;vol:bucket:volume pgdata', 'px>web:80;px>api:8080;api>db:5432;api>rd:6379;db--vol', { title: 'Docker Compose', groups: [{ keys: ['web', 'api', 'db', 'rd'], label: 'rede interna' }] })),
  T('cicd', 'infra', 'CI/CD', 'Do commit à produção com testes e aprovação.', graph('c:rounded:Commit / PR;b:rounded:Build;t:rounded:Testes;s:rounded:Análise de segurança;i:containerBox:Imagem no registry;st:rounded:Deploy em homologação;a:decision:Aprovado?;p:rounded:Deploy em produção;m:display:Monitoramento', 'c>b;b>t;t>s;s>i;i>st;st>a;a>p:sim;a>c:não;p>m', { title: 'Pipeline de CI/CD', dir: 'right', gx: 60, gy: 60, style: { p: { fill: C.wine } } })),
  T('environments', 'infra', 'Topologia de ambientes', 'Desenvolvimento, homologação e produção.', graph('dev:laptop:Desenvolvimento;git:rounded:Repositório;ci:rounded:CI;hml:server:Homologação;prd:server:Produção;dr:server:Recuperação de desastre;obs:display:Observabilidade', 'dev>git;git>ci;ci>hml;hml>prd:promoção;prd..>dr:réplica;hml..>obs;prd..>obs', { title: 'Topologia de ambientes', dir: 'right', gx: 70 })),

  T('threat', 'security', 'Modelo de ameaças', 'Fluxos de dados, limites de confiança e ameaças STRIDE.', graph('u:netUser:Usuário;web:rounded:Aplicação web;api:rounded:API;db:netDatabase:Banco;t1:note:S · Falsificação\nlogin roubado;t2:note:T · Adulteração\nparâmetros alterados;t3:note:I · Vazamento\ndados pessoais;t4:note:D · Negação de serviço\nexcesso de requisições', 'u>web:HTTPS;web>api:token;api>db:SQL;t1..>web;t2..>api;t3..>db;t4..>api', { title: 'Modelo de ameaças (STRIDE)', groups: [{ keys: ['api', 'db'], label: 'Limite de confiança · rede interna' }], style: { t1: { fill: C.rose }, t2: { fill: C.rose }, t3: { fill: C.rose }, t4: { fill: C.rose } } })),
  T('auth-flow', 'security', 'Fluxo de autenticação', 'OAuth 2.0 com código de autorização e PKCE.', sequence(['Usuário', 'App', 'Servidor de autorização', 'API'], [[0, 1, 'Entrar'], [1, 2, 'GET /authorize + code_challenge'], [2, 0, 'Tela de login e consentimento', 'r'], [0, 2, 'Credenciais + MFA'], [2, 1, 'Redireciona com code', 'r'], [1, 2, 'POST /token + code_verifier'], [2, 1, 'access_token + refresh_token', 'r'], [1, 3, 'GET /dados (Bearer)'], [3, 1, '200 OK', 'r']], { title: 'Fluxo de autenticação OAuth 2.0 + PKCE' })),
  T('zero-trust', 'security', 'Zero Trust', 'Toda requisição verificada por identidade, dispositivo e política.', graph('u:netUser:Usuário;d:laptop:Dispositivo;idp:rounded:Provedor de identidade\nMFA;pdp:rounded:Motor de políticas;pep:firewall:Ponto de aplicação;a1:server:App A;a2:server:App B;log:display:Registro e análise', 'u>idp:autentica;d>pdp:postura;idp>pdp:identidade;pdp>pep:decisão;u>pep:requisição;pep>a1:menor privilégio;pep>a2:menor privilégio;pep..>log', { title: 'Arquitetura Zero Trust', style: { pdp: { fill: C.wine }, pep: {} } })),

  T('test-pyramid', 'testing', 'Pirâmide de testes', 'Proporção entre testes unitários, de integração e ponta a ponta.', pyramid('Pirâmide de testes', ['Ponta a ponta\npoucos, lentos, de ponta a ponta', 'Integração\ncontratos, banco, mensageria', 'Componentes\nmódulos isolados com dublês', 'Unitários\nmuitos, rápidos, baratos'])),
  T('test-plan', 'testing', 'Plano de testes', 'Escopo, tipos de teste, responsáveis e critérios.', grid({ title: 'Plano de testes · versão 2.0', cols: ['Tipo', 'Ferramenta', 'Responsável', 'Critério de saída'], cw: 190, first: 190, rows: [['Login', 'Unitário', 'JUnit', 'Dev', 'Cobertura ≥ 80%'], ['Checkout', 'Integração', 'Testcontainers', 'Dev', 'Sem falhas'], ['Fluxo de compra', 'Ponta a ponta', 'Playwright', 'QA', '100% dos cenários'], ['API pública', 'Contrato', 'Pact', 'QA', 'Contratos verdes'], ['Black Friday', 'Carga', 'k6', 'SRE', 'p95 < 300 ms'], ['Cadastro', 'Segurança', 'OWASP ZAP', 'Segurança', 'Zero críticas']] })),
  T('test-state', 'testing', 'Máquina de estados de teste', 'Estados de um caso de teste e as transições.', graph('i:initialState:;a:state:Rascunho;b:state:Pronto;c:state:Em execução;d:state:Passou;e:state:Falhou;f:state:Bloqueado;g:state:Reaberto', 'i>a;a>b:revisado;b>c:executar;c>d:ok;c>e:erro;c>f:ambiente fora;e>g:corrigido;f>b:liberado;g>c:reexecutar', { title: 'Máquina de estados do caso de teste', style: { d: { fill: C.sage }, e: { fill: C.rose } } })),

  T('journey', 'ux', 'Jornada do usuário', 'Etapas, ações, pensamentos, emoções e oportunidades.', journey('Jornada de compra', ['Descobrir', 'Comparar', 'Comprar', 'Receber', 'Usar'], [['Ações', ['Vê anúncio no Instagram', 'Lê avaliações', 'Paga com Pix', 'Acompanha rastreio', 'Usa e indica']], ['Pensamentos', ['“Será que serve?”', '“Qual é melhor?”', '“É seguro?”', '“Quando chega?”', '“Valeu a pena”']], ['Emoções', ['Curioso', 'Indeciso', 'Ansioso', 'Impaciente', 'Satisfeito'], C.straw], ['Oportunidades', ['Vídeo curto do produto', 'Comparador lado a lado', 'Selo de segurança', 'Aviso por WhatsApp', 'Programa de indicação'], C.sage]])),
  T('user-flow', 'ux', 'Fluxo do usuário', 'Telas e decisões do caminho do usuário.', graph('a:terminator:Abre o app;b:rect:Tela inicial;c:decision:Logado?;d:rect:Login;e:rect:Catálogo;f:rect:Produto;g:rect:Carrinho;h:rect:Pagamento;i:terminator:Pedido feito', 'a>b;b>c;c>e:sim;c>d:não;d>e;e>f;f>g:adicionar;g>h;h>i', { title: 'Fluxo do usuário' })),
  T('wireframe', 'ux', 'Wireframe', 'Esboço de página com navegação, destaque e cartões.', wireframe()),
  T('roadmap', 'ux', 'Roadmap', 'Iniciativas por trimestre e por trilha.', roadmap('Roadmap 2027', ['T1', 'T2', 'T3', 'T4'], [['Produto', [['Novo checkout', 0, 1], ['Assinaturas', 1, 2], ['Marketplace', 3, 1]]], ['Plataforma', [['Migração para nuvem', 0, 2], ['Observabilidade', 2, 1]]], ['Dados', [['Data warehouse', 1, 1], ['Recomendações', 2, 2]]], ['Marketing', [['Rebranding', 0, 1], ['Programa de fidelidade', 2, 2]]]])),
  T('kanban', 'ux', 'Kanban', 'Colunas de trabalho com cartões.', kanban([['A fazer', ['Pesquisa com usuários', 'Definir métricas', 'Revisar textos']], ['Fazendo', ['Protótipo do checkout', 'API de cupons']], ['Em revisão', ['Tela de perfil']], ['Feito', ['Login social', 'Busca por voz']]])),

  T('org-chart', 'mgmt', 'Organograma', 'Hierarquia da equipe com cargos.', tree({ nodes: 'ceo:orgCard:Marina Costa\nDiretora-geral;cto:orgCard:Rafael Lima\nTecnologia;cmo:orgCard:Júlia Alves\nMarketing;cfo:orgCard:Pedro Rocha\nFinanças;d1:orgCard:Ana Souza\nDesenvolvimento;d2:orgCard:Caio Melo\nInfraestrutura;m1:orgCard:Bia Nunes\nConteúdo;f1:orgCard:Leo Dias\nControladoria', edges: 'ceo>cto;ceo>cmo;ceo>cfo;cto>d1;cto>d2;cmo>m1;cfo>f1' }, { title: 'Organograma', gx: 30 })),
  T('raci', 'mgmt', 'Matriz RACI', 'Quem executa, aprova, é consultado e informado.', grid({ title: 'Matriz RACI · lançamento', cols: ['Produto', 'Design', 'Engenharia', 'Marketing', 'Diretoria'], cw: 130, first: 220, color: (v) => (v === 'R' ? C.sage : v === 'A' ? C.straw : v === 'C' ? C.slate : C.white), rows: [['Definir escopo', 'A', 'C', 'C', 'I', 'I'], ['Protótipo', 'C', 'R', 'C', 'I', 'I'], ['Desenvolvimento', 'A', 'C', 'R', 'I', 'I'], ['Campanha', 'C', 'C', 'I', 'R', 'A'], ['Go-live', 'R', 'I', 'R', 'I', 'A']] })),
  T('gantt', 'mgmt', 'Gantt', 'Tarefas, duração e marcos ao longo das semanas.', gantt('Cronograma do projeto', ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8'], [['Levantamento', 0, 2], ['Design', 1, 2], ['Desenvolvimento', 2, 4], ['Testes', 5, 2], ['Homologação', 6, 1], ['Lançamento', 7, 1, 'm']])),
  T('risk-matrix', 'mgmt', 'Matriz de riscos', 'Probabilidade × impacto com riscos posicionados.', (b) => {
    b.text('Matriz de riscos', 0, -60, { size: 24, weight: 700 });
    const fills = [[C.sage, C.sage, C.straw, C.straw, C.rose], [C.sage, C.straw, C.straw, C.rose, C.rose], [C.straw, C.straw, C.rose, C.rose, C.wine], [C.straw, C.rose, C.rose, C.wine, C.wine], [C.rose, C.rose, C.wine, C.wine, C.wine]];
    for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) b.node('rect', '', 120 + c * 110, (4 - r) * 80, 110, 80, { fill: fills[r][c], stroke: { color: C.white, alpha: 1 }, strokeWidth: 2 });
    ['Rara', 'Improvável', 'Possível', 'Provável', 'Quase certa'].forEach((t, i) => b.text(t, 0, (4 - i) * 80 + 30, { size: 12 }));
    ['Mínimo', 'Menor', 'Moderado', 'Maior', 'Severo'].forEach((t, i) => b.text(t, 130 + i * 110, 410, { size: 12 }));
    b.text('Impacto →', 330, 440, { size: 13, weight: 700 });
    b.text('Probabilidade ↑', -10, -30, { size: 13, weight: 700 });
    [['R1 Atraso do fornecedor', 3, 3], ['R2 Falha no servidor', 1, 4], ['R3 Saída de pessoa-chave', 2, 2], ['R4 Mudança de lei', 0, 3]].forEach(([t, r, c]) => b.items.push({ kind: 'sticky', key: 'n' + b.k++, text: t, x: 125 + c * 110, y: (4 - r) * 80 + 6, w: 100, h: 68, color: C.white, fontSize: 11 }));
  }),

  T('mind-map', 'analysis', 'Mapa mental', 'Ideia central com ramificações.', mindmap('Lançamento do app', [['Público', ['Estudantes', 'Professores']], ['Canais', ['Instagram', 'Escolas parceiras']], ['Recursos', ['Aulas ao vivo', 'Exercícios']], ['Métricas', ['Downloads', 'Retenção 30 dias']], ['Riscos', ['Prazo', 'Orçamento']], ['Equipe', ['Produto', 'Engenharia']]])),
  T('ishikawa', 'analysis', 'Ishikawa', 'Causas agrupadas que levam a um problema.', ishikawa('Entregas atrasadas', [['Método', ['Rota mal planejada', 'Sem prioridade']], ['Máquina', ['Caminhão parado', 'Sistema lento']], ['Mão de obra', ['Equipe reduzida', 'Falta de treino']], ['Material', ['Embalagem falta', 'Etiqueta errada']], ['Medição', ['Prazo irreal', 'Sem rastreio']], ['Meio ambiente', ['Chuva', 'Trânsito']]])),
  T('swot', 'analysis', 'SWOT', 'Forças, fraquezas, oportunidades e ameaças.', quad('Análise SWOT', ['Forças', 'Fraquezas', 'Oportunidades', 'Ameaças'], [['Marca conhecida', 'Equipe experiente', 'Produto bem avaliado'], ['Preço alto', 'Pouca presença digital'], ['Mercado em crescimento', 'Parcerias com escolas'], ['Concorrente novo', 'Alta do dólar']])),
  T('venn', 'analysis', 'Venn', 'Conjuntos e o que eles têm em comum.', venn('Diagrama de Venn', [['Design', ['Interface', 'Pesquisa']], ['Engenharia', ['Arquitetura', 'Código']], ['Negócio', ['Receita', 'Mercado']]], 'Produto')),
  T('matrix-2x2', 'analysis', 'Matriz 2×2', 'Esforço × impacto para priorizar.', quad('Matriz esforço × impacto', ['Ganhos rápidos\n(alto impacto, pouco esforço)', 'Grandes projetos\n(alto impacto, muito esforço)', 'Tarefas menores\n(baixo impacto, pouco esforço)', 'Evitar\n(baixo impacto, muito esforço)'], [['Botão de compartilhar', 'Ajustar textos'], ['Novo checkout', 'App offline'], ['Ícones novos'], ['Reescrever tudo']], { axes: ['Esforço →', 'Impacto →'] })),
  T('concept-pyramid', 'analysis', 'Pirâmide de conceitos', 'Do fundamento ao topo, em níveis.', pyramid('Pirâmide de Maslow', ['Realização pessoal', 'Estima', 'Relacionamentos', 'Segurança', 'Necessidades básicas'])),
];

const P = (name, kind, intent, rel, when, example) => ({ name, kind, intent, rel, when, example });

export const PATTERNS = [
  P('Factory Method', 'Criação', 'Define uma interface para criar um objeto e deixa as subclasses decidirem qual classe instanciar.', 'Criador..>Produto:cria;CriadorConcreto-|>Criador;ProdutoConcreto..|>Produto;CriadorConcreto..>ProdutoConcreto:new', 'A classe não sabe de antemão quais objetos vai criar.', 'Um gerador de relatórios que cria PDF ou planilha conforme a subclasse.'),
  P('Abstract Factory', 'Criação', 'Cria famílias de objetos relacionados sem acoplar às classes concretas.', 'Cliente>FábricaAbstrata;FábricaClara-|>FábricaAbstrata;FábricaEscura-|>FábricaAbstrata;FábricaAbstrata..>Botão:cria;FábricaAbstrata..>Janela:cria', 'O sistema precisa trocar de família inteira de produtos.', 'Temas claro e escuro que criam botões e janelas combinando.'),
  P('Builder', 'Criação', 'Separa a construção de um objeto complexo da sua representação.', 'Diretor>Construtor:usa;ConstrutorConcreto-|>Construtor;ConstrutorConcreto..>Produto:monta', 'O objeto tem muitos parâmetros opcionais ou etapas de montagem.', 'Montar uma consulta SQL ou uma requisição HTTP passo a passo.'),
  P('Prototype', 'Criação', 'Cria objetos copiando um protótipo existente.', 'Cliente>Protótipo:clona;ProtótipoA-|>Protótipo;ProtótipoB-|>Protótipo', 'Criar do zero é caro ou as classes só são conhecidas em tempo de execução.', 'Duplicar uma forma num editor gráfico.'),
  P('Singleton', 'Criação', 'Garante uma única instância de uma classe com um ponto de acesso global.', 'Cliente>Singleton:getInstance();Singleton>Singleton:instância única', 'Deve existir exatamente um objeto, como uma configuração ou um registro.', 'O gerenciador de configuração da aplicação.'),
  P('Object Pool', 'Criação', 'Reaproveita objetos caros em vez de criá-los e destruí-los a toda hora.', 'Cliente>Pool:pega e devolve;Pool<>-Recurso:guarda', 'Criar o objeto é caro e ele é usado por pouco tempo.', 'Pool de conexões com o banco de dados.'),
  P('Adapter', 'Estrutural', 'Converte a interface de uma classe na interface que o cliente espera.', 'Cliente>Alvo;Adaptador..|>Alvo;Adaptador>Adaptado:delega', 'Uma classe útil tem a interface errada para o seu código.', 'Adaptar um SDK de pagamento antigo à interface atual.'),
  P('Bridge', 'Estrutural', 'Separa a abstração da implementação para variarem de forma independente.', 'Abstração o-Implementação;AbstraçãoRefinada-|>Abstração;ImplA..|>Implementação;ImplB..|>Implementação', 'Há duas dimensões de variação que se multiplicariam em subclasses.', 'Controles remotos (abstração) para TVs de marcas diferentes (implementação).'),
  P('Composite', 'Estrutural', 'Trata objetos individuais e composições do mesmo jeito, em árvore.', 'Cliente>Componente;Folha-|>Componente;Composto-|>Componente;Composto<>-Componente:filhos', 'A estrutura é uma hierarquia parte-todo.', 'Pastas e arquivos; grupos de formas num editor.'),
  P('Decorator', 'Estrutural', 'Acrescenta responsabilidades a um objeto dinamicamente, embrulhando-o.', 'ComponenteConcreto-|>Componente;Decorador-|>Componente;Decorador o-Componente:embrulha;DecoradorA-|>Decorador', 'Combinar comportamentos opcionais sem explosão de subclasses.', 'Fluxos com compressão e criptografia empilhadas.'),
  P('Facade', 'Estrutural', 'Oferece uma interface simples para um subsistema complexo.', 'Cliente>Fachada;Fachada>SubsistemaA;Fachada>SubsistemaB;Fachada>SubsistemaC', 'Esconder a complexidade de várias classes atrás de uma porta única.', 'Um serviço de checkout que coordena estoque, pagamento e frete.'),
  P('Flyweight', 'Estrutural', 'Compartilha o estado comum de muitos objetos pequenos para economizar memória.', 'Cliente>FábricaFlyweight;FábricaFlyweight<>-Flyweight:cache;FlyweightConcreto-|>Flyweight', 'Há milhares de objetos quase iguais.', 'Glifos de texto ou árvores numa floresta de um jogo.'),
  P('Proxy', 'Estrutural', 'Coloca um substituto que controla o acesso ao objeto real.', 'Cliente>Assunto;Proxy..|>Assunto;ObjetoReal..|>Assunto;Proxy>ObjetoReal:delega', 'Carregar sob demanda, controlar acesso, fazer cache ou acesso remoto.', 'Imagem carregada só quando aparece na tela.'),
  P('Chain of Responsibility', 'Comportamental', 'Passa a requisição por uma corrente de tratadores até alguém resolver.', 'Cliente>Tratador;TratadorA-|>Tratador;TratadorB-|>Tratador;Tratador>Tratador:próximo', 'Vários objetos podem tratar a requisição e o tratador não é fixo.', 'Middlewares de autenticação, log e limite de taxa.'),
  P('Command', 'Comportamental', 'Transforma uma ação num objeto, permitindo fila, histórico e desfazer.', 'Invocador>Comando;ComandoConcreto..|>Comando;ComandoConcreto>Receptor:executa;Cliente..>ComandoConcreto:cria', 'É preciso desfazer, enfileirar ou registrar ações.', 'Desfazer e refazer num editor.'),
  P('Interpreter', 'Comportamental', 'Representa uma gramática e interpreta sentenças dela.', 'Cliente>Expressão;Terminal-|>Expressão;NãoTerminal-|>Expressão;NãoTerminal<>-Expressão:operandos;Expressão>Contexto:usa', 'Uma linguagem simples precisa ser avaliada muitas vezes.', 'Calculadora de expressões ou regras de desconto.'),
  P('Iterator', 'Comportamental', 'Percorre os elementos de uma coleção sem expor sua estrutura.', 'Cliente>Iterador;Coleção..>Iterador:cria;IteradorConcreto..|>Iterador;ColeçãoConcreta..|>Coleção', 'Percorrer coleções diferentes do mesmo jeito.', 'O for-each de listas, árvores e páginas de uma API.'),
  P('Mediator', 'Comportamental', 'Centraliza a comunicação entre objetos para reduzir o acoplamento.', 'ColegaA>Mediador;ColegaB>Mediador;ColegaC>Mediador;MediadorConcreto..|>Mediador', 'Muitos objetos conversam entre si de forma emaranhada.', 'Torre de controle de um aeroporto; formulário que coordena campos.'),
  P('Memento', 'Comportamental', 'Guarda e restaura o estado de um objeto sem violar o encapsulamento.', 'Originador..>Memento:cria;Zelador<>-Memento:guarda', 'É preciso voltar a um estado anterior.', 'Pontos de salvamento num jogo; histórico de versões.'),
  P('Observer', 'Comportamental', 'Notifica automaticamente os interessados quando o estado muda.', 'Assunto o-Observador:inscritos;ObservadorA..|>Observador;ObservadorB..|>Observador;AssuntoConcreto-|>Assunto', 'Mudanças num objeto precisam refletir em outros sem acoplamento.', 'Eventos de interface; notificações de preço.'),
  P('State', 'Comportamental', 'Muda o comportamento do objeto quando o estado interno muda.', 'Contexto o-Estado:atual;EstadoA..|>Estado;EstadoB..|>Estado;EstadoA..>EstadoB:transição', 'O objeto tem muitos if/else por estado.', 'Pedido: rascunho, pago, enviado, entregue.'),
  P('Strategy', 'Comportamental', 'Define uma família de algoritmos intercambiáveis e escolhe um em tempo de execução.', 'Contexto o-Estratégia:usa;EstratégiaA..|>Estratégia;EstratégiaB..|>Estratégia', 'Há várias formas de fazer a mesma tarefa.', 'Cálculo de frete por transportadora.'),
  P('Template Method', 'Comportamental', 'Define o esqueleto de um algoritmo e deixa passos para as subclasses.', 'ClasseConcretaA-|>ClasseAbstrata;ClasseConcretaB-|>ClasseAbstrata', 'Vários algoritmos seguem os mesmos passos com detalhes diferentes.', 'Importadores de CSV e JSON com o mesmo fluxo.'),
  P('Visitor', 'Comportamental', 'Acrescenta operações a uma estrutura de objetos sem mudar suas classes.', 'Elemento>Visitante:aceita;ElementoA-|>Elemento;ElementoB-|>Elemento;VisitanteExportar..|>Visitante;VisitanteValidar..|>Visitante', 'A estrutura é estável mas as operações mudam muito.', 'Exportar uma árvore de formas para SVG e PDF.'),
  P('Null Object', 'Comportamental', 'Usa um objeto que não faz nada no lugar de null.', 'Cliente>Serviço;ServiçoReal..|>Serviço;ServiçoNulo..|>Serviço', 'Evitar verificações de null espalhadas.', 'Um logger silencioso nos testes.'),
  P('Repository', 'Arquitetural', 'Media o acesso ao armazenamento como se fosse uma coleção em memória.', 'Serviço>Repositório;RepositórioSQL..|>Repositório;RepositórioSQL>Banco', 'Isolar o domínio dos detalhes de persistência.', 'PedidoRepository com findById e save.'),
  P('Unit of Work', 'Arquitetural', 'Registra as mudanças de uma transação e grava tudo de uma vez.', 'Serviço>UnidadeDeTrabalho;UnidadeDeTrabalho>RepositórioA;UnidadeDeTrabalho>RepositórioB;UnidadeDeTrabalho>Banco:commit', 'Várias alterações precisam ser atômicas.', 'O DbContext do Entity Framework.'),
  P('Specification', 'Arquitetural', 'Encapsula regras de negócio combináveis em objetos.', 'Serviço>Especificação;E-|>Especificação;Ou-|>Especificação;ClienteVip-|>Especificação', 'Regras de filtro e validação que se combinam.', 'Clientes VIP E ativos E da região Sul.'),
  P('Dependency Injection', 'Arquitetural', 'Recebe as dependências de fora em vez de criá-las.', 'Injetor..>Cliente:injeta;Cliente>Serviço;ServiçoReal..|>Serviço;ServiçoFalso..|>Serviço', 'Desacoplar e facilitar testes.', 'Construtores com dependências no Spring ou no ASP.NET Core.'),
  P('Service Locator', 'Arquitetural', 'Um registro central entrega os serviços quando pedidos.', 'Cliente>Localizador:pede;Localizador<>-Serviço:registra', 'Código legado sem contêiner de injeção.', 'Registro global de serviços num jogo.'),
  P('MVC', 'Arquitetural', 'Separa modelo, visão e controlador.', 'Controlador>Modelo:atualiza;Modelo..>Visão:notifica;Visão>Controlador:eventos', 'Interfaces com regras de negócio separadas da apresentação.', 'Aplicações web com Spring MVC ou Rails.'),
  P('MVVM', 'Arquitetural', 'A visão se liga a um ViewModel que expõe estado e comandos.', 'Visão<->ViewModel:data binding;ViewModel>Modelo', 'Interfaces reativas com ligação de dados.', 'WPF, Jetpack Compose com ViewModel.'),
  P('CQRS', 'Arquitetural', 'Separa o modelo de escrita (comandos) do modelo de leitura (consultas).', 'Cliente>Comandos;Cliente>Consultas;Comandos>BancoEscrita;BancoEscrita..>Projeção:eventos;Consultas>Projeção', 'Leitura e escrita têm cargas e formatos muito diferentes.', 'Painel de pedidos lendo de uma projeção desnormalizada.'),
  P('Event Sourcing', 'Arquitetural', 'Guarda a sequência de eventos em vez do estado atual.', 'Comando>Agregado;Agregado>LojaDeEventos:anexa;LojaDeEventos..>Projeção:reconstrói', 'Auditoria completa e possibilidade de reconstruir o passado.', 'Conta bancária como soma de lançamentos.'),
  P('Publish/Subscribe', 'Arquitetural', 'Publicadores mandam mensagens para tópicos e assinantes recebem sem se conhecerem.', 'Publicador>Tópico;Tópico>AssinanteA;Tópico>AssinanteB', 'Desacoplar produtores de consumidores.', 'Eventos de pedido no Kafka.'),
  P('Circuit Breaker', 'Resiliência', 'Interrompe chamadas a um serviço que está falhando e tenta de novo depois.', 'Cliente>Disjuntor;Disjuntor>ServiçoRemoto:chama;Disjuntor..>Fechado;Disjuntor..>Aberto;Disjuntor..>MeioAberto', 'Evitar efeito cascata quando uma dependência cai.', 'Resilience4j na chamada ao serviço de frete.'),
  P('Retry', 'Resiliência', 'Repete uma operação que falhou de forma transitória, com espera crescente.', 'Cliente>PolíticaDeRetentativa;PolíticaDeRetentativa>Serviço:tenta de novo', 'Falhas passageiras de rede.', 'Três tentativas com backoff exponencial.'),
  P('Bulkhead', 'Resiliência', 'Isola recursos em compartimentos para que uma falha não afunde tudo.', 'Cliente>CompartimentoA;Cliente>CompartimentoB;CompartimentoA>ServiçoA;CompartimentoB>ServiçoB', 'Uma dependência lenta não pode esgotar todas as threads.', 'Pools de threads separados por integração.'),
  P('Saga', 'Resiliência', 'Coordena uma transação distribuída como passos locais com compensações.', 'Orquestrador>Pedidos:criar;Orquestrador>Pagamentos:cobrar;Orquestrador>Estoque:reservar;Orquestrador..>Pagamentos:estornar se falhar', 'Transações que atravessam vários serviços.', 'Compra com pagamento, estoque e entrega.'),
  P('Transactional Outbox', 'Resiliência', 'Grava o evento na mesma transação do dado e publica depois.', 'Serviço>Banco:dado + outbox;Publicador>Banco:lê outbox;Publicador>Broker:publica', 'Garantir que dado e evento não divirjam.', 'Pedido salvo e evento PedidoCriado publicado com Debezium.'),
  P('API Gateway', 'Integração', 'Uma entrada única roteia, autentica e agrega chamadas para os serviços.', 'Cliente>Gateway;Gateway>ServiçoA;Gateway>ServiçoB;Gateway>ServiçoC', 'Muitos microsserviços expostos a vários clientes.', 'Kong ou Spring Cloud Gateway na frente da loja.'),
  P('Backend for Frontend', 'Integração', 'Um backend específico para cada tipo de cliente.', 'Web>BFFWeb;Celular>BFFCelular;BFFWeb>Serviços;BFFCelular>Serviços', 'Clientes com necessidades de dados muito diferentes.', 'API enxuta para o app e outra para o site.'),
  P('Strangler Fig', 'Integração', 'Substitui um sistema legado aos poucos, desviando rota por rota.', 'Cliente>Fachada;Fachada>Legado:rotas antigas;Fachada>NovoSistema:rotas migradas', 'Modernizar sem reescrever tudo de uma vez.', 'Migrar um monólito para serviços tela por tela.'),
  P('Sidecar', 'Integração', 'Um processo ao lado do serviço cuida de funções transversais.', 'Serviço<->Sidecar:localhost;Sidecar>Observabilidade;Sidecar>Rede', 'Log, proxy, segurança e métricas sem mexer no código.', 'Envoy num pod do Kubernetes.'),
  P('Ambassador', 'Integração', 'Um proxy local fala com serviços remotos em nome da aplicação.', 'Aplicação>Embaixador:localhost;Embaixador>ServiçoRemoto:retentativas e TLS', 'Clientes legados que precisam de recursos de rede modernos.', 'Proxy local que faz mTLS e retentativas.'),
  P('Anti-Corruption Layer', 'Integração', 'Uma camada traduz o modelo de outro sistema para não contaminar o seu.', 'Domínio>CamadaAnticorrupção;CamadaAnticorrupção>Tradutor;Tradutor>SistemaExterno', 'Integrar com sistemas de modelo ruim ou diferente.', 'Tradução de um ERP antigo para o domínio novo.'),
];

const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const patternClasses = (p) => {
  const names = [];
  for (const e of parseEdges(p.rel)) for (const k of [e.from, e.to]) if (!names.includes(k)) names.push(k);
  return names;
};

const patternDiagram = (p) => {
  const names = patternClasses(p);
  const iface = new Set(parseEdges(p.rel).filter((e) => e.dash && e.endCap === 'triangle').map((e) => e.to));
  const abstract = new Set(parseEdges(p.rel).filter((e) => !e.dash && e.endCap === 'triangle').map((e) => e.to));
  const nodes = names.map((n, i) => `c${i}:${iface.has(n) ? 'umlInterface' : 'umlClass'}:${iface.has(n) ? '«interface» ' : abstract.has(n) ? '«abstract» ' : ''}${n}\\n+ operacao()`).join(';');
  const key = new Map(names.map((n, i) => [n, 'c' + i]));
  const edges = parseEdges(p.rel).map((e) => {
    const op = OPS.find(([, st]) => st.startCap === e.startCap && st.endCap === e.endCap && !!st.dash === !!e.dash);
    return `${key.get(e.from)}${op ? op[0] : '>'}${key.get(e.to)}${e.label ? ':' + e.label : ''}`;
  }).join(';');
  return (b) => {
    graph(nodes, edges, { title: `${p.name} · ${p.kind}`, gx: 60, gy: 100 })(b);
    const maxY = Math.max(...b.items.filter((it) => it.kind === 'shape').map((it) => it.y + it.h));
    b.node('umlNote', `${p.intent}\n\nQuando usar: ${p.when}`, 0, maxY + 50, 520, 110, { fill: C.straw, align: 'left', fontSize: 13 });
  };
};

const patternLesson = (p) => {
  const names = patternClasses(p);
  const parts = names.map((n, i) => `p${i}:rounded:${n}`).join(';');
  const pe = names.map((_, i) => `par>p${i}`).join(';');
  const safe = (t) => String(t).replace(/;/g, ',');
  return graph(`r:rounded:${p.name};q:rounded:Problema;s:rounded:Solução;par:rounded:Participantes;ex:rounded:Exemplo;qt:note:${safe(p.when)};st:note:${safe(p.intent)};et:note:${safe(p.example)};${parts}`, `r>q;r>s;r>par;r>ex;q>qt;s>st;ex>et;${pe}`, { aula: true, dir: 'down', gx: 30, gy: 70, routing: 'elbow', title: `Aula · ${p.name}`, style: { r: { fill: C.wine, fontWeight: 700 }, q: { fill: C.straw }, s: { fill: C.straw }, par: { fill: C.straw }, ex: { fill: C.straw }, qt: { fill: C.white }, st: { fill: C.white }, et: { fill: C.white } } });
};

export const PATTERN_TEMPLATES = PATTERNS.map((p) => ({ id: 'pattern-' + slug(p.name), cat: 'patterns', name: p.name, desc: `${p.kind} · ${p.intent}`, build: patternDiagram(p), lesson: patternLesson(p), kind: p.kind }));

export const AULA_STARTS = [
  { id: 'aula-down', cat: 'aula', name: 'Da raiz para baixo', desc: 'Comece por uma raiz no topo e desça pelas ramificações.', dir: 'down' },
  { id: 'aula-right', cat: 'aula', name: 'Ramificações', desc: 'A raiz à esquerda e as ideias se abrindo para os lados.', dir: 'right' },
  { id: 'aula-up', cat: 'aula', name: 'História ao contrário', desc: 'Comece pelo fim e suba até a origem, no sentido inverso.', dir: 'up' },
];

export const aulaStart = (dir) => graph(`r:rounded:${dir === 'up' ? 'Como tudo terminou' : 'Tema da aula'};a:rounded:${dir === 'up' ? 'O que veio antes' : 'Primeira ideia'};b:rounded:${dir === 'up' ? 'Outra causa' : 'Segunda ideia'};c:rounded:${dir === 'up' ? 'Mais uma causa' : 'Terceira ideia'}`, 'r>a;r>b;r>c', { aula: true, dir, gx: 40, gy: 80, routing: 'elbow', edgeStyle: dir === 'up' ? { startCap: 'triangle', endCap: 'none' } : {}, style: { r: { fill: C.wine, fontWeight: 700, fontSize: 18 }, a: { fill: C.straw }, b: { fill: C.straw }, c: { fill: C.straw } } });

export const allTemplates = () => [...TEMPLATES, ...PATTERN_TEMPLATES];

export const findTemplate = (id) => allTemplates().find((t) => t.id === id) || AULA_STARTS.find((t) => t.id === id) || null;

export const buildBoard = (fn) => {
  const b = new Board();
  fn(b);
  return b.items;
};

export const layoutTree = (nodes, edges, dir) => {
  const items = nodes.map((n) => ({ key: n.id, w: n.w, h: n.h }));
  layered(items, edges.map(([f, t]) => ({ from: f, to: t })), dir, 40, 80);
  return new Map(items.map((it) => [it.key, { x: it.x, y: it.y }]));
};

const NAME_OF = (it) => String(it.text || '').split('\n').find((l) => l.trim() && !/^«/.test(l.trim())) || (SHAPES[it.shape] || SHAPES.rect).name;

export const applyBoard = (store, page, items, { measure } = {}) => {
  const shapes = items.filter((it) => it.kind !== 'edge');
  if (!shapes.length) return [];
  const x0 = Math.min(...shapes.map((it) => it.x));
  const y0 = Math.min(...shapes.map((it) => it.y));
  const ids = new Map();
  const out = [];
  const containers = [];
  let z = 1;
  for (const it of items) {
    if (it.kind === 'edge') continue;
    const x = Math.round(it.x - x0);
    const y = Math.round(it.y - y0);
    let node;
    if (it.kind === 'text') {
      node = { type: 'text', name: String(it.text).split('\n')[0].slice(0, 60) || 'Texto', x, y, w: 10, h: 20, text: it.text, fontSize: it.size || 16, fontWeight: it.weight || 400, lineHeight: 1.25, fontFamily: 'Sistema', autoSize: 'width', fill: { type: 'solid', color: it.color || C.ink, alpha: 1 }, rotation: it.rotation || 0 };
      if (measure) Object.assign(node, measure(node) || {});
    } else if (it.kind === 'sticky') {
      node = { type: 'sticky', name: 'Nota', x, y, w: it.w, h: it.h, fill: { type: 'solid', color: it.color || C.straw, alpha: 1 }, text: it.text, fontSize: it.fontSize || 14, effects: [{ type: 'shadow', x: 0, y: 3, blur: 10, color: C.coffee, alpha: 0.25 }] };
    } else {
      const def = SHAPES[it.shape] || SHAPES.rect;
      node = { type: 'shape', shape: it.shape, name: NAME_OF(it).slice(0, 60), x, y, w: Math.round(it.w), h: Math.round(it.h), fill: it.fill === null ? null : { type: 'solid', color: it.fill || C.paper, alpha: 1 }, stroke: it.stroke === null ? null : it.stroke || { color: C.coffee, alpha: 1 }, strokeWidth: it.stroke === null ? 0 : it.strokeWidth ?? 1.5, text: it.text ?? '', fontSize: it.fontSize || (def.table ? 13 : 14), fontWeight: it.fontWeight || (def.container ? 600 : 400) };
      for (const k of ['textColor', 'align', 'valign', 'opacity', 'radius', 'rotation']) if (it[k] !== undefined) node[k] = it[k];
      if (it.branch) node.branch = true;
      if (def.container || it.container) containers.push({ it, x, y });
    }
    node.page = page;
    node.parent = null;
    node.z = z++;
    const id = store.add(node);
    ids.set(it.key, id);
    out.push(id);
  }
  for (const it of items) {
    if (it.kind === 'edge') continue;
    const id = ids.get(it.key);
    const n = store.get(id);
    if (!n || containers.some((c) => c.it === it)) continue;
    let best = null;
    for (const c of containers) {
      const cid = ids.get(c.it.key);
      const cn = store.get(cid);
      if (!cn || cn.z > n.z) continue;
      if (n.x >= cn.x && n.y >= cn.y && n.x + n.w <= cn.x + cn.w && n.y + n.h <= cn.y + cn.h && (!best || cn.w * cn.h < best.w * best.h)) best = cn;
    }
    if (best) store.update(id, { parent: best.id });
  }
  for (const c of containers) {
    const id = ids.get(c.it.key);
    const n = store.get(id);
    let best = null;
    for (const o of containers) {
      if (o === c) continue;
      const on = store.get(ids.get(o.it.key));
      if (!on || on.z > n.z) continue;
      if (n.x >= on.x && n.y >= on.y && n.x + n.w <= on.x + on.w && n.y + n.h <= on.y + on.h && (!best || on.w * on.h < best.w * best.h)) best = on;
    }
    if (best) store.update(id, { parent: best.id });
  }
  for (const it of items) {
    if (it.kind !== 'edge') continue;
    const end = (v) => (typeof v === 'string' ? (ids.has(v) ? { node: ids.get(v), side: 'auto' } : null) : { x: Math.round(v.x - x0), y: Math.round(v.y - y0) });
    const from = end(it.from);
    const to = end(it.to);
    if (!from || !to) continue;
    out.push(store.add({ type: 'connector', page, parent: null, z: z++, name: 'Conector', x: 0, y: 0, w: 0, h: 0, from, to, routing: it.routing || 'elbow', startCap: it.startCap || 'none', endCap: it.endCap ?? 'triangle', stroke: { color: C.ink, alpha: 1 }, strokeWidth: it.strokeWidth || 1.6, text: it.label || '', ...(it.dash ? { dash: [8, 6] } : {}) }));
  }
  return out;
};

export const boardPreview = (items) => {
  const shapes = items.filter((it) => it.kind !== 'edge');
  if (!shapes.length) return '';
  const x0 = Math.min(...shapes.map((it) => it.x));
  const y0 = Math.min(...shapes.map((it) => it.y));
  const x1 = Math.max(...shapes.map((it) => it.x + (it.w || 60)));
  const y1 = Math.max(...shapes.map((it) => it.y + (it.h || 20)));
  const W = Math.max(1, x1 - x0);
  const H = Math.max(1, y1 - y0);
  const byKey = new Map(shapes.map((it) => [it.key, it]));
  const esc = (v) => String(v).replace(/[^#0-9A-Za-z.]/g, '');
  let body = '';
  for (const it of items) {
    if (it.kind !== 'edge') continue;
    const p = (v) => (typeof v === 'string' ? (byKey.has(v) ? { x: byKey.get(v).x + byKey.get(v).w / 2, y: byKey.get(v).y + byKey.get(v).h / 2 } : null) : v);
    const a = p(it.from);
    const b = p(it.to);
    if (a && b) body += `<line x1="${(a.x - x0).toFixed(0)}" y1="${(a.y - y0).toFixed(0)}" x2="${(b.x - x0).toFixed(0)}" y2="${(b.y - y0).toFixed(0)}" stroke="${C.coffee}" stroke-width="${Math.max(1.5, W / 300).toFixed(1)}"/>`;
  }
  for (const it of shapes) {
    const x = (it.x - x0).toFixed(0);
    const y = (it.y - y0).toFixed(0);
    if (it.kind === 'text') {
      body += `<rect x="${x}" y="${y}" width="${Math.min(W, String(it.text).length * (it.size || 16) * 0.5).toFixed(0)}" height="${((it.size || 16) * 0.7).toFixed(0)}" rx="3" fill="${C.coffee}" opacity="0.5"/>`;
      continue;
    }
    const fill = esc(it.kind === 'sticky' ? it.color || C.straw : it.fill === null ? 'none' : it.fill || C.paper);
    const round = ['ellipse', 'useCase', 'initialState', 'finalState', 'startEvent', 'endEvent', 'intermediateEvent', 'globe'].includes(it.shape);
    const stroke = it.container || (SHAPES[it.shape] || {}).container ? C.olive : C.coffee;
    if (round) body += `<ellipse cx="${(it.x - x0 + it.w / 2).toFixed(0)}" cy="${(it.y - y0 + it.h / 2).toFixed(0)}" rx="${(it.w / 2).toFixed(0)}" ry="${(it.h / 2).toFixed(0)}" fill="${fill}" stroke="${stroke}" stroke-width="${Math.max(1, W / 400).toFixed(1)}" opacity="${it.opacity ?? 1}"/>`;
    else body += `<rect x="${x}" y="${y}" width="${it.w.toFixed(0)}" height="${it.h.toFixed(0)}" rx="${it.shape === 'rounded' ? Math.min(12, it.h / 4).toFixed(0) : 2}" fill="${fill}" stroke="${stroke}" stroke-width="${Math.max(1, W / 400).toFixed(1)}"/>`;
  }
  const pad = Math.max(W, H) * 0.04;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${(-pad).toFixed(0)} ${(-pad).toFixed(0)} ${(W + pad * 2).toFixed(0)} ${(H + pad * 2).toFixed(0)}" preserveAspectRatio="xMidYMid meet">${body}</svg>`;
};
