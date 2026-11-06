const OPENERS = [
  ['([', '])', 'terminator'],
  ['[[', ']]', 'predefined'],
  ['[(', ')]', 'database'],
  ['((', '))', 'ellipse'],
  ['{{', '}}', 'preparation'],
  ['[/', ['/]', '\\]'], 'data'],
  ['[\\', ['\\]', '/]'], 'data'],
  ['[', ']', 'process'],
  ['(', ')', 'rounded'],
  ['{', '}', 'decision'],
  ['>', ']', 'chevron'],
];

const TO_MERMAID = {
  process: ['[', ']'],
  rect: ['[', ']'],
  rounded: ['(', ')'],
  terminator: ['([', '])'],
  predefined: ['[[', ']]'],
  database: ['[(', ')]'],
  ellipse: ['((', '))'],
  decision: ['{', '}'],
  diamond: ['{', '}'],
  preparation: ['{{', '}}'],
  hexagon: ['{{', '}}'],
  data: ['[/', '/]'],
  parallelogram: ['[/', '/]'],
  trapezoid: ['[/', '\\]'],
  manualOperation: ['[\\', '/]'],
  chevron: ['>', ']'],
};

const MAX_NODES = 400;
const MAX_EDGES = 800;
const ID_RE = /^[A-Za-z0-9_À-ɏ]+/;
const TEXT_EDGE = /^\s*(<)?(--|==|-\.)\s+(.+?)\s+(-{2,}>|-{3,}|\.->|\.-|={2,}>|={3,})\s*/;
const PLAIN_EDGE = /^\s*(<)?(-{2,}>|-{3,}|-\.+->|-\.+-|={2,}>|={3,}|--o|--x|~~~)\s*(?:\|([^|]*)\|\s*)?/;

const cleanLabel = (s) => String(s ?? '')
  .replace(/^"(.*)"$/s, '$1')
  .replace(/#quot;/g, '"')
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/\\n/g, '\n')
  .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
  .trim()
  .slice(0, 300);

const splitStatements = (src) => {
  const out = [];
  for (const raw of String(src).replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.replace(/%%.*$/, '');
    let cur = '';
    let quote = false;
    let depth = 0;
    for (const ch of line) {
      if (ch === '"') quote = !quote;
      if (!quote && '[({'.includes(ch)) depth++;
      if (!quote && '])}'.includes(ch)) depth = Math.max(0, depth - 1);
      if (ch === ';' && !quote && depth === 0) {
        if (cur.trim()) out.push(cur.trim());
        cur = '';
      } else cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
  }
  return out;
};

const findCloser = (s, from, closers) => {
  const list = Array.isArray(closers) ? closers : [closers];
  let quote = false;
  for (let i = from; i < s.length; i++) {
    if (s[i] === '"') quote = !quote;
    if (quote) continue;
    for (const c of list) if (s.startsWith(c, i)) return { at: i, len: c.length };
  }
  return null;
};

const parseNodeRef = (s, i) => {
  const m = s.slice(i).match(ID_RE);
  if (!m) return null;
  const id = m[0];
  let j = i + id.length;
  let label = null;
  let shape = null;
  for (const [open, close, kind] of OPENERS) {
    if (!s.startsWith(open, j)) continue;
    const end = findCloser(s, j + open.length, close);
    if (!end) continue;
    label = cleanLabel(s.slice(j + open.length, end.at));
    shape = kind;
    j = end.at + end.len;
    break;
  }
  const cls = s.slice(j).match(/^:::[\w-]+/);
  if (cls) j += cls[0].length;
  return { id, label, shape, end: j };
};

const parseGroup = (s, i) => {
  const refs = [];
  let j = i;
  for (;;) {
    while (s[j] === ' ' || s[j] === '\t') j++;
    const r = parseNodeRef(s, j);
    if (!r) break;
    refs.push(r);
    j = r.end;
    const amp = s.slice(j).match(/^\s*&\s*/);
    if (!amp) break;
    j += amp[0].length;
  }
  return refs.length ? { refs, end: j } : null;
};

const parseEdgeOp = (s, i) => {
  const rest = s.slice(i);
  const t = rest.match(TEXT_EDGE);
  if (t) {
    const op = t[2] + t[4];
    return { op, back: !!t[1], label: cleanLabel(t[3]), end: i + t[0].length };
  }
  const p = rest.match(PLAIN_EDGE);
  if (p) return { op: p[2], back: !!p[1], label: cleanLabel(p[3] || ''), end: i + p[0].length };
  return null;
};

const edgeStyle = (op, back) => {
  const dotted = op.includes('.');
  const thick = op.includes('=');
  const last = op[op.length - 1];
  const endCap = last === '>' ? 'triangle' : last === 'o' ? 'circle' : 'none';
  return { dotted, thick, endCap, startCap: back ? 'triangle' : 'none', hidden: op === '~~~' };
};

export const detectTextDiagram = (src) => {
  const s = String(src || '');
  if (/^\s*(%%[^\n]*\n\s*)*(graph|flowchart)\b/i.test(s)) return 'mermaid';
  if (/^\s*[A-Za-z0-9_]+[^\n]*?(-->|---|==>|-\.->)/m.test(s)) return 'mermaid';
  return 'outline';
};

export const parseMermaid = (src) => {
  const statements = splitStatements(src);
  const nodes = new Map();
  const edges = [];
  const groups = [];
  const stack = [];
  const warnings = [];
  let dir = 'TD';
  const touch = (r) => {
    let n = nodes.get(r.id);
    if (!n) {
      if (nodes.size >= MAX_NODES) return null;
      n = { id: r.id, label: r.id, shape: 'process' };
      nodes.set(r.id, n);
    }
    for (const g of stack) g.members.add(r.id);
    if (r.label !== null) n.label = r.label || ' ';
    if (r.shape) n.shape = r.shape;
    return n;
  };
  statements.forEach((st, idx) => {
    const head = st.match(/^(graph|flowchart)\s*(TB|TD|BT|LR|RL)?\s*$/i);
    if (head) {
      if (head[2]) dir = head[2].toUpperCase() === 'TB' ? 'TD' : head[2].toUpperCase();
      return;
    }
    if (idx === 0 && /^(graph|flowchart)\b/i.test(st)) return;
    if (/^(classDef|class|style|linkStyle|click|direction|accTitle|accDescr|title)\b/i.test(st)) return;
    const sub = st.match(/^subgraph\s+(.+)$/i);
    if (sub) {
      const raw = sub[1].trim();
      const named = raw.match(/^([A-Za-z0-9_]+)\s*\[(.+)\]$/);
      const g = { title: cleanLabel(named ? named[2] : raw), members: new Set() };
      groups.push(g);
      stack.push(g);
      return;
    }
    if (/^end$/i.test(st)) {
      stack.pop();
      return;
    }
    let pos = 0;
    let left = parseGroup(st, 0);
    if (!left) {
      warnings.push(st);
      return;
    }
    left.refs.forEach(touch);
    pos = left.end;
    for (;;) {
      const op = parseEdgeOp(st, pos);
      if (!op) break;
      const right = parseGroup(st, op.end);
      if (!right) break;
      right.refs.forEach(touch);
      const style = edgeStyle(op.op, op.back);
      if (!style.hidden) {
        for (const a of left.refs) for (const b of right.refs) {
          if (edges.length >= MAX_EDGES) break;
          if (nodes.has(a.id) && nodes.has(b.id)) edges.push({ from: a.id, to: b.id, label: op.label, ...style });
        }
      }
      left = right;
      pos = right.end;
    }
    if (st.slice(pos).trim()) warnings.push(st);
  });
  return { kind: 'mermaid', dir, nodes: [...nodes.values()], edges, groups: groups.filter((g) => g.members.size).map((g) => ({ title: g.title, members: [...g.members] })), warnings };
};

export const parseOutline = (src) => {
  const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
  const nodes = [];
  const edges = [];
  const stack = [];
  for (const raw of lines) {
    if (!raw.trim()) continue;
    if (nodes.length >= MAX_NODES) break;
    const indent = raw.match(/^[\t ]*/)[0].replace(/\t/g, '    ').length;
    const label = cleanLabel(raw.trim().replace(/^([-*+•]|\d+[.)])\s+/, '').replace(/^#+\s*/, ''));
    if (!label) continue;
    const id = 'o' + nodes.length;
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const parent = stack[stack.length - 1];
    nodes.push({ id, label, shape: parent ? 'rounded' : 'terminator', depth: parent ? parent.depth + 1 : 0 });
    if (parent) edges.push({ from: parent.id, to: id, label: '', dotted: false, thick: false, endCap: 'none', startCap: 'none' });
    stack.push({ id, indent, depth: parent ? parent.depth + 1 : 0 });
  }
  return { kind: 'outline', dir: 'LR', nodes, edges, groups: [], warnings: [] };
};

export const parseTextDiagram = (src, kind = 'auto') => {
  const k = kind === 'auto' ? detectTextDiagram(src) : kind;
  return k === 'mermaid' ? parseMermaid(src) : parseOutline(src);
};

export const labelSize = (label, base = { w: 140, h: 70 }) => {
  const lines = String(label || '').split('\n');
  const longest = Math.max(1, ...lines.map((l) => l.length));
  const perLine = Math.min(longest, 28);
  const wrapped = lines.reduce((s, l) => s + Math.max(1, Math.ceil(l.length / 28)), 0);
  const w = Math.max(base.w, Math.round(perLine * 7.6 + 40));
  const h = Math.max(base.h, Math.round(wrapped * 18 + 34));
  return { w: Math.min(w, 300), h: Math.min(h, 260) };
};

const quoteLabel = (s) => {
  const t = String(s || '').replace(/"/g, '#quot;').replace(/\n/g, '<br/>');
  return /[\[\](){}|<>#&;:]/.test(t) || t !== t.trim() || !t ? `"${t}"` : t;
};

export const toMermaid = (shapes, connectors, textOf = (n) => n.text || n.name || '') => {
  const ids = new Map();
  shapes.forEach((n, i) => ids.set(n.id, 'n' + (i + 1)));
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const n of shapes) {
    minX = Math.min(minX, n.x);
    maxX = Math.max(maxX, n.x + n.w);
    minY = Math.min(minY, n.y);
    maxY = Math.max(maxY, n.y + n.h);
  }
  const dir = shapes.length && maxX - minX > (maxY - minY) * 1.25 ? 'LR' : 'TD';
  const out = [`flowchart ${dir}`];
  for (const n of shapes) {
    const [a, b] = TO_MERMAID[n.shape] || (n.type === 'ellipse' ? TO_MERMAID.ellipse : TO_MERMAID.process);
    out.push(`  ${ids.get(n.id)}${a}${quoteLabel(textOf(n) || n.name || ' ')}${b}`);
  }
  for (const c of connectors) {
    const f = ids.get(c.from?.node);
    const t = ids.get(c.to?.node);
    if (!f || !t) continue;
    const dotted = Array.isArray(c.dash) && c.dash.length > 0;
    const thick = (c.strokeWidth || 0) >= 3;
    const arrow = c.endCap && c.endCap !== 'none';
    const back = c.startCap && c.startCap !== 'none' && !arrow;
    const [src, dst] = back ? [t, f] : [f, t];
    let op = dotted ? (arrow || back ? '-.->' : '-.-') : thick ? (arrow || back ? '==>' : '===') : arrow || back ? '-->' : '---';
    const label = String(c.text || '').trim();
    out.push(`  ${src} ${op}${label ? `|${label.replace(/\|/g, '/').replace(/\n/g, ' ')}|` : ''} ${dst}`);
  }
  return out.join('\n');
};
