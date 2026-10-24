export const uid = (n = 12) => {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (const b of a) s += abc[b % 36];
  return s;
};

export const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
  const r = (Math.random() * 16) | 0;
  return (c === 'x' ? r : (r & 3) | 8).toString(16);
}));

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const round = (v, p = 100) => Math.round(v * p) / p;
export const deg = (r) => (r * 180) / Math.PI;
export const rad = (d) => (d * Math.PI) / 180;

export const hexToNum = (hex) => parseInt(String(hex || '#000000').replace('#', '').slice(0, 6).padEnd(6, '0'), 16) || 0;
export const numToHex = (n) => '#' + (n >>> 0).toString(16).padStart(6, '0').slice(-6).toUpperCase();
export const normHex = (v, fallback = '#000000') => {
  let s = String(v || '').trim().replace('#', '');
  if (/^[0-9a-f]{3}$/i.test(s)) s = s.split('').map((c) => c + c).join('');
  return /^[0-9a-f]{6}$/i.test(s) ? '#' + s.toUpperCase() : fallback;
};
export const rgba = (hex, a = 1) => {
  const n = hexToNum(hex);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

export const debounce = (fn, ms) => {
  let t = 0;
  const d = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  d.flush = (...args) => {
    clearTimeout(t);
    fn(...args);
  };
  return d;
};

export const el = (tag, attrs = {}, ...children) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(e.dataset, v);
    else if (v === true) e.setAttribute(k, '');
    else e.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return e;
};

const ICONS = {
  move: 'M5 3l13 7-6 1.6L9.5 18z',
  scale: 'M4 4h7M4 4v7M4 4l7 7M20 20h-7M20 20v-7M20 20l-7-7',
  frame: 'M7 3v18M17 3v18M3 7h18M3 17h18',
  section: 'M3 5h8v3H3zM3 8h18v12H3z',
  rect: 'M4 5h16v14H4z',
  ellipse: 'M12 5a8 7 0 1 0 0.01 0z',
  line: 'M5 19L19 5',
  arrow: 'M5 19L19 5M11 5h8v8',
  polygon: 'M12 4l8 15H4z',
  star: 'M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7z',
  pen: 'M4 20l3-1 11-11-2-2L5 17zM14 6l4 4M4 20l2.5-5.5',
  pencil: 'M3 17c3-6 6 2 9-4s5-6 9-6',
  text: 'M5 6V4h14v2M12 4v16M9 20h6',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9.5a1.5 1.5 0 1 0 .01 0',
  sticky: 'M4 4h16v11l-5 5H4zM15 20v-5h5',
  connector: 'M5 7h4v10h6M17 15l2 2-2 2M3 5h4v4H3z',
  hand: 'M8 12V6a1.5 1.5 0 0 1 3 0v5M11 11V4.5a1.5 1.5 0 0 1 3 0V11M14 11V6a1.5 1.5 0 0 1 3 0v7c0 4-2.5 7-6 7-3 0-4.5-2-6-5l-1.5-3a1.4 1.4 0 0 1 2.4-1.4L8 13',
  comment: 'M4 5h16v11H9l-5 4z',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 .01 0',
  eyeoff: 'M3 3l18 18M10.6 6.1A10 10 0 0 1 12 6c6 0 10 6 10 6a17 17 0 0 1-3.3 3.8M6.6 6.6C3.7 8.4 2 12 2 12s4 7 10 7c1.6 0 3-.4 4.3-1',
  lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  unlock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 6.8-1.2',
  play: 'M7 4l13 8-13 8z',
  sun: 'M12 8a4 4 0 1 0 .01 0M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  upload: 'M12 20V9M7 14l5-5 5 5M5 4h14',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  copy: 'M8 8h12v12H8zM4 16V4h12',
  history: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 3',
  layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
  shapes: 'M4 4h7v7H4zM17.5 4a3.5 3.5 0 1 0 .01 0M7.5 13l4 7h-8zM14 14h7v7h-7z',
  data: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  component: 'M12 3l4 4-4 4-4-4zM12 13l4 4-4 4-4-4zM7 8l4 4-4 4-4-4zM17 8l4 4-4 4-4-4z',
  instance: 'M12 3l9 9-9 9-9-9z',
  group: 'M4 4h6v6H4zM14 14h6v6h-6zM4 14h6v6H4zM14 4h6v6h-6z',
  page: 'M6 3h9l4 4v14H6zM15 3v4h4',
  alignLeft: 'M4 3v18M8 7h12v4H8zM8 14h7v4H8z',
  alignCenterH: 'M12 3v18M6 7h12v4H6zM8.5 14h7v4h-7z',
  alignRight: 'M20 3v18M4 7h12v4H4zM9 14h7v4H9z',
  alignTop: 'M3 4h18M7 8h4v12H7zM14 8h4v7h-4z',
  alignCenterV: 'M3 12h18M7 6h4v12H7zM14 8.5h4v7h-4z',
  alignBottom: 'M3 20h18M7 4h4v12H7zM14 9h4v7h-4z',
  distH: 'M4 3v18M20 3v18M10 7h4v10h-4z',
  distV: 'M3 4h18M3 20h18M7 10h10v4H7z',
  union: 'M4 4h10v6h6v10H10v-6H4z',
  subtract: 'M4 4h10v6h-4v4H4zM10 10h10v10H10z',
  intersect: 'M4 4h10v10H4zM10 10h10v10H10zM10 10h4v4h-4z',
  exclude: 'M4 4h10v6h-4v4H4zM14 10h6v10H10v-6h4z',
  autolayout: 'M4 5h16v14H4zM8 9h3v6H8zM13 9h3v6h-3z',
  close: 'M6 6l12 12M18 6L6 18',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  chevronDown: 'M6 9l6 6 6-6',
  chevronRight: 'M9 6l6 6-6 6',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  share: 'M18 8a3 3 0 1 0-2.8-4M6 15a3 3 0 1 0 .01 0M18 16a3 3 0 1 0 .01 0M8.6 13.5l6.8-3.9M8.6 16.5l6.8 3.9',
  grid: 'M4 4h16v16H4zM4 9.3h16M4 14.6h16M9.3 4v16M14.6 4v16',
  zoomIn: 'M10.5 4a6.5 6.5 0 1 0 .01 0M20 20l-4.8-4.8M10.5 7.5v6M7.5 10.5h6',
  zoomOut: 'M10.5 4a6.5 6.5 0 1 0 .01 0M20 20l-4.8-4.8M7.5 10.5h6',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  keyboard: 'M3 6h18v12H3zM7 10h.01M11 10h.01M15 10h.01M7 14h10',
  sparkle: 'M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z',
  tree: 'M10 3h4v4h-4zM4 17h4v4H4zM10 17h4v4h-4zM16 17h4v4h-4zM12 7v5M6 17v-5h12v5',
  csv: 'M5 3h10l4 4v14H5zM8 12h8M8 16h8M12 9v10',
  check: 'M5 12l5 5 9-10',
  resolve: 'M12 3a9 9 0 1 0 .01 0M8 12l3 3 5-6',
  menu: 'M4 7h16M4 12h16M4 17h16',
  user: 'M12 4a4 4 0 1 0 .01 0M4 21c1-4 4-6 8-6s7 2 8 6',
  wifi: 'M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.5h.01',
  wifioff: 'M3 3l18 18M8.5 16a5 5 0 0 1 7 0M5 12.5a10 10 0 0 1 5-2.7M2 9a15 15 0 0 1 4.6-3M16.6 9.6A10 10 0 0 1 19 12.5M12 19.5h.01',
  minimap: 'M3 5h18v14H3zM12 9h6v6h-6z',
  ruler: 'M3 17L17 3l4 4L7 21zM7 13l2 2M10 10l2 2M13 7l2 2',
};

export const icon = (name, size = 18) => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.7');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', ICONS[name] || ICONS.rect);
  svg.append(p);
  return svg;
};

export const download = (blob, name) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
};

export const safeName = (s) => String(s || 'grafo').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'grafo';

export const escapeXml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

export const pickFile = (accept, multiple = false) => new Promise((resolve) => {
  const input = el('input', { type: 'file', accept, style: { display: 'none' } });
  if (multiple) input.multiple = true;
  input.addEventListener('change', () => {
    resolve(multiple ? [...input.files] : input.files[0] || null);
    input.remove();
  });
  document.body.append(input);
  input.click();
});

export const readText = (file) => file.text();
export const readDataURL = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = reject;
  r.readAsDataURL(file);
});

export const loadImage = (src) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = reject;
  img.src = src;
});

export const parseCSV = (text) => {
  const rows = [];
  let row = [];
  let cur = '';
  let q = false;
  const s = String(text || '').replace(/^﻿/, '');
  const sep = (s.split('\n')[0].match(/;/g) || []).length > (s.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === sep) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
    } else cur += c;
  }
  row.push(cur);
  if (row.some((v) => v !== '')) rows.push(row);
  if (!rows.length) return { columns: [], rows: [] };
  const columns = rows[0].map((c, i) => c.trim() || `coluna${i + 1}`);
  return { columns, rows: rows.slice(1).map((r) => Object.fromEntries(columns.map((c, i) => [c, (r[i] ?? '').trim()]))) };
};

export const storage = {
  get(k, d) {
    try {
      const v = localStorage.getItem('grafo:' + k);
      return v === null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem('grafo:' + k, JSON.stringify(v));
    } catch {}
  },
};

const NAMES = ['Ana', 'Bruno', 'Carla', 'Davi', 'Elisa', 'Felipe', 'Gabi', 'Heitor', 'Iara', 'João', 'Luana', 'Marcos', 'Nina', 'Otávio', 'Paula', 'Rafa', 'Sofia', 'Tiago'];
const COLORS = ['#5D1C16', '#7A6E46', '#5C4034', '#3F6A80', '#8F2A1F', '#55602F', '#9A5B2E', '#6B4E71'];
export const randomUser = () => ({ name: NAMES[(Math.random() * NAMES.length) | 0], color: COLORS[(Math.random() * COLORS.length) | 0] });
export const userColors = COLORS;

export const calc = (src) => {
  const s = String(src).replace(/\s+/g, '');
  let i = 0;
  const peek = () => s[i];
  const num = () => {
    const m = /^\d*\.?\d+(?:e[-+]?\d+)?/i.exec(s.slice(i));
    if (!m) throw new Error('n');
    i += m[0].length;
    return parseFloat(m[0]);
  };
  const atom = () => {
    if (peek() === '(') {
      i++;
      const v = expr();
      if (peek() !== ')') throw new Error(')');
      i++;
      return v;
    }
    if (peek() === '-') {
      i++;
      return -atom();
    }
    if (peek() === '+') {
      i++;
      return atom();
    }
    return num();
  };
  const term = () => {
    let v = atom();
    while (peek() === '*' || peek() === '/') {
      const op = s[i++];
      const r = atom();
      v = op === '*' ? v * r : v / r;
    }
    return v;
  };
  const expr = () => {
    let v = term();
    while (peek() === '+' || peek() === '-') {
      const op = s[i++];
      const r = term();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  };
  try {
    if (!s || s.length > 64) return NaN;
    const v = expr();
    return i === s.length ? v : NaN;
  } catch {
    return NaN;
  }
};
