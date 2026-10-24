const DIRECTIONS = { top: 0, up: 0, right: 1, bottom: 2, down: 2, left: 3, none: -1, free: -1 };
const OPERATIONS = { union: 0, subtract: 1, difference: 1, intersect: 2, intersection: 2, exclude: 3, xor: 3 };
const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];
const EPS = 1e-7;

function ok(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function clean(points) {
  if (!Array.isArray(points)) return [];
  return points.filter((p) => p && ok(+p.x) && ok(+p.y)).map((p) => {
    const q = { x: +p.x, y: +p.y };
    for (const k of ['inx', 'iny', 'outx', 'outy']) if (k in p && ok(+p[k])) q[k] = +p[k];
    return q;
  });
}

function cleanBoxes(boxes) {
  if (!Array.isArray(boxes)) return [];
  return boxes.filter((b) => b && ok(+b.x) && ok(+b.y) && ok(+b.w) && ok(+b.h)).map((b) => ({ x: +b.x, y: +b.y, w: +b.w, h: +b.h }));
}

function validPoint(p) {
  return !!p && ok(+p.x) && ok(+p.y);
}

function toDir(d) {
  if (typeof d === 'string') return d in DIRECTIONS ? DIRECTIONS[d] : -1;
  if (typeof d !== 'number' || !Number.isFinite(d)) return -1;
  return d >= 0 && d <= 3 ? d | 0 : -1;
}

function toOp(op) {
  if (typeof op === 'string') return op in OPERATIONS ? OPERATIONS[op] : -1;
  return op >= 0 && op <= 3 ? op | 0 : -1;
}

function flat(points) {
  const out = new Float64Array(points.length * 2);
  for (let i = 0; i < points.length; i++) {
    out[i * 2] = +points[i].x || 0;
    out[i * 2 + 1] = +points[i].y || 0;
  }
  return out;
}

function unflat(arr, n) {
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = { x: arr[i * 2], y: arr[i * 2 + 1] };
  return out;
}

function pointInPolygonFlat(pts, n, x, y) {
  if (n < 3) return false;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = pts[i * 2], yi = pts[i * 2 + 1], xj = pts[j * 2], yj = pts[j * 2 + 1];
    if ((yi > y) !== (yj > y)) {
      const t = (y - yi) / (yj - yi);
      if (x < xi + t * (xj - xi)) inside = !inside;
    }
  }
  return inside;
}

function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = 0;
  if (len2 > 0) t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(ax + t * dx - px, ay + t * dy - py);
}

function compressRoute(points) {
  const out = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 1e-9 && Math.abs(last.y - p.y) < 1e-9) continue;
    if (out.length >= 2) {
      const q = out[out.length - 2];
      const sameX = Math.abs(q.x - last.x) < 1e-9 && Math.abs(last.x - p.x) < 1e-9;
      const sameY = Math.abs(q.y - last.y) < 1e-9 && Math.abs(last.y - p.y) < 1e-9;
      if (sameX || sameY) {
        out[out.length - 1] = { x: p.x, y: p.y };
        continue;
      }
    }
    out.push({ x: p.x, y: p.y });
  }
  return out;
}

function uniqueSorted(values) {
  values.sort((a, b) => a - b);
  const out = [];
  for (const v of values) if (!out.length || v - out[out.length - 1] > 1e-6) out.push(v);
  return out;
}

function nearestIndex(values, v) {
  let lo = 0, hi = values.length - 1;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (values[m] < v) lo = m + 1;
    else hi = m;
  }
  if (lo > 0 && Math.abs(values[lo - 1] - v) < Math.abs(values[lo] - v)) return lo - 1;
  return lo;
}

class MinHeap {
  constructor() { this.items = []; }
  get size() { return this.items.length; }
  push(f, s) {
    const a = this.items;
    a.push([f, s]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

function routeFallback(obstacles, start, startDir, end, endDir, margin) {
  const sdir = toDir(startDir), tdir = toDir(endDir);
  margin = Math.max(0, +margin || 0);
  const a = { x: start.x, y: start.y }, b = { x: end.x, y: end.y };
  const stepDir = (p, d) => { if (d >= 0) { p.x += DX[d] * margin; p.y += DY[d] * margin; } };
  stepDir(a, sdir);
  stepDir(b, tdir);
  const inside = (box, x, y) => x > box.l + EPS && x < box.r - EPS && y > box.t + EPS && y < box.b - EPS;
  const boxes = [];
  for (const o of obstacles) {
    let { x, y, w, h } = o;
    if (w < 0) { x += w; w = -w; }
    if (h < 0) { y += h; h = -h; }
    const raw = { l: x, t: y, r: x + w, b: y + h };
    const inf = { l: x - margin, t: y - margin, r: x + w + margin, b: y + h + margin };
    if (!inside(inf, a.x, a.y) && !inside(inf, b.x, b.y)) boxes.push(inf);
    else if (!inside(raw, a.x, a.y) && !inside(raw, b.x, b.y)) boxes.push(raw);
  }
  let minX = Math.min(a.x, b.x), maxX = Math.max(a.x, b.x), minY = Math.min(a.y, b.y), maxY = Math.max(a.y, b.y);
  const xsRaw = [a.x, b.x, (a.x + b.x) / 2], ysRaw = [a.y, b.y, (a.y + b.y) / 2];
  for (const bx of boxes) {
    xsRaw.push(bx.l, bx.r);
    ysRaw.push(bx.t, bx.b);
    minX = Math.min(minX, bx.l); maxX = Math.max(maxX, bx.r);
    minY = Math.min(minY, bx.t); maxY = Math.max(maxY, bx.b);
  }
  const pad = margin > 0 ? margin : 10;
  xsRaw.push(minX - pad, maxX + pad);
  ysRaw.push(minY - pad, maxY + pad);
  const xs = uniqueSorted(xsRaw), ys = uniqueSorted(ysRaw);
  const nx = xs.length, ny = ys.length;
  const firstAbove = (v, x) => { let lo = 0, hi = v.length; while (lo < hi) { const m = (lo + hi) >> 1; if (v[m] > x) hi = m; else lo = m + 1; } return lo; };
  const lastBelow = (v, x) => { let lo = 0, hi = v.length; while (lo < hi) { const m = (lo + hi) >> 1; if (v[m] < x) lo = m + 1; else hi = m; } return lo - 1; };
  const nodes = nx * ny;
  const blocked = new Uint8Array(nodes), hBlocked = new Uint8Array(nodes), vBlocked = new Uint8Array(nodes);
  for (const bx of boxes) {
    const x0 = firstAbove(xs, bx.l + EPS), x1 = lastBelow(xs, bx.r - EPS);
    const y0 = firstAbove(ys, bx.t + EPS), y1 = lastBelow(ys, bx.b - EPS);
    const sx0 = Math.max(0, lastBelow(xs, bx.l + EPS)), sy0 = Math.max(0, lastBelow(ys, bx.t + EPS));
    for (let iy = y0; iy <= y1; iy++) {
      for (let ix = x0; ix <= x1; ix++) blocked[iy * nx + ix] = 1;
      for (let ix = sx0; ix <= x1 && ix + 1 < nx; ix++) if (xs[ix + 1] > bx.l + EPS && xs[ix] < bx.r - EPS) hBlocked[iy * nx + ix] = 1;
    }
    for (let ix = x0; ix <= x1; ix++) {
      for (let iy = sy0; iy <= y1 && iy + 1 < ny; iy++) if (ys[iy + 1] > bx.t + EPS && ys[iy] < bx.b - EPS) vBlocked[iy * nx + ix] = 1;
    }
  }
  const sIndex = nearestIndex(ys, a.y) * nx + nearestIndex(xs, a.x);
  const tIndex = nearestIndex(ys, b.y) * nx + nearestIndex(xs, b.x);
  blocked[sIndex] = 0;
  blocked[tIndex] = 0;
  const states = nx * ny * 4;
  const g = new Float64Array(states).fill(Infinity);
  const from = new Int32Array(states).fill(-1);
  const closed = new Uint8Array(states);
  const span = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  const bend = margin * 2 + 16 + span * 0.02;
  const goalDir = tdir >= 0 ? (tdir + 2) % 4 : -1;
  const heap = new MinHeap();
  for (let d = 0; d < 4; d++) {
    if (sdir >= 0 && d !== sdir) continue;
    g[sIndex * 4 + d] = 0;
    heap.push(span, sIndex * 4 + d);
  }
  let bestGoal = -1, bestCost = Infinity;
  while (heap.size) {
    const [f, st] = heap.pop();
    if (closed[st]) continue;
    if (f >= bestCost) break;
    closed[st] = 1;
    const node = st >> 2, dir = st & 3;
    if (node === tIndex) {
      let extra = 0;
      if (goalDir >= 0 && dir !== goalDir) extra = dir === (goalDir + 2) % 4 ? bend * 2 : bend;
      if (g[st] + extra < bestCost) { bestCost = g[st] + extra; bestGoal = st; }
      continue;
    }
    const ix = node % nx, iy = (node / nx) | 0;
    for (let nd = 0; nd < 4; nd++) {
      if (nd === (dir + 2) % 4) continue;
      const jx = ix + DX[nd], jy = iy + DY[nd];
      if (jx < 0 || jy < 0 || jx >= nx || jy >= ny) continue;
      const next = jy * nx + jx;
      if (blocked[next]) continue;
      if ((nd === 1 && hBlocked[node]) || (nd === 3 && hBlocked[next]) || (nd === 2 && vBlocked[node]) || (nd === 0 && vBlocked[next])) continue;
      const cost = g[st] + Math.abs(xs[jx] - xs[ix]) + Math.abs(ys[jy] - ys[iy]) + (nd !== dir ? bend : 0);
      const ns = next * 4 + nd;
      if (closed[ns] || cost >= g[ns]) continue;
      g[ns] = cost;
      from[ns] = st;
      heap.push(cost + Math.abs(xs[jx] - b.x) + Math.abs(ys[jy] - b.y), ns);
    }
  }
  if (bestGoal < 0) {
    const mx = (a.x + b.x) / 2;
    return compressRoute([start, a, { x: mx, y: a.y }, { x: mx, y: b.y }, b, end]);
  }
  const chain = [];
  for (let st = bestGoal; st >= 0; st = from[st]) {
    const node = st >> 2;
    chain.push({ x: xs[node % nx], y: ys[(node / nx) | 0] });
  }
  chain.reverse();
  return compressRoute([{ x: start.x, y: start.y }, ...chain, { x: end.x, y: end.y }]);
}

function simplifyFallback(points, eps) {
  const n = points.length;
  if (n <= 2) return points.map((p) => ({ x: p.x, y: p.y }));
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let best = -1, index = -1;
    for (let i = a + 1; i < b; i++) {
      const d = distanceToSegment(points[i].x, points[i].y, points[a].x, points[a].y, points[b].x, points[b].y);
      if (d > best) { best = d; index = i; }
    }
    if (index >= 0 && best > eps) {
      keep[index] = 1;
      stack.push([a, index], [index, b]);
    }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push({ x: points[i].x, y: points[i].y });
  return out;
}

function smoothFallback(points) {
  const n = points.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = points[i];
    if (i === 0) { out.push({ x: p.x, y: p.y, c1x: p.x, c1y: p.y, c2x: p.x, c2y: p.y }); continue; }
    const a = points[Math.max(0, i - 2)], b = points[i - 1], d = points[Math.min(n - 1, i + 1)];
    out.push({ x: p.x, y: p.y, c1x: b.x + (p.x - a.x) / 6, c1y: b.y + (p.y - a.y) / 6, c2x: p.x - (d.x - b.x) / 6, c2y: p.y - (d.y - b.y) / 6 });
  }
  return out;
}

function flattenFallback(points, closed, tol) {
  const n = points.length;
  if (!n) return [];
  if (!(tol > 0)) tol = 0.25;
  const out = [{ x: points[0].x, y: points[0].y }];
  const segments = closed ? n : n - 1;
  for (let s = 0; s < segments; s++) {
    const p = points[s], q = points[(s + 1) % n];
    const stack = [[p.x, p.y, p.outx ?? p.x, p.outy ?? p.y, q.inx ?? q.x, q.iny ?? q.y, q.x, q.y, 0]];
    while (stack.length) {
      const c = stack.pop();
      const flatness = Math.max(distanceToSegment(c[2], c[3], c[0], c[1], c[6], c[7]), distanceToSegment(c[4], c[5], c[0], c[1], c[6], c[7]));
      if (flatness <= tol || c[8] >= 18) {
        if (s === segments - 1 && closed && stack.length === 0) break;
        out.push({ x: c[6], y: c[7] });
        continue;
      }
      const ax = (c[0] + c[2]) / 2, ay = (c[1] + c[3]) / 2, bx = (c[2] + c[4]) / 2, by = (c[3] + c[5]) / 2;
      const cx = (c[4] + c[6]) / 2, cy = (c[5] + c[7]) / 2, dx = (ax + bx) / 2, dy = (ay + by) / 2;
      const ex = (bx + cx) / 2, ey = (by + cy) / 2, mx = (dx + ex) / 2, my = (dy + ey) / 2;
      stack.push([mx, my, ex, ey, cx, cy, c[6], c[7], c[8] + 1], [c[0], c[1], ax, ay, dx, dy, mx, my, c[8] + 1]);
    }
  }
  return out;
}

function cleanRing(points) {
  const out = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 1e-12 && Math.abs(last.y - p.y) < 1e-12) continue;
    out.push({ x: +p.x, y: +p.y });
  }
  while (out.length > 1 && Math.abs(out[0].x - out[out.length - 1].x) < 1e-12 && Math.abs(out[0].y - out[out.length - 1].y) < 1e-12) out.pop();
  return out;
}

function ghClip(A, B, forwardA, forwardB, mode, scale) {
  const pool = [];
  const build = (pts) => {
    const head = pool.length, n = pts.length;
    pts.forEach((p, i) => pool.push({ x: p.x, y: p.y, alpha: 0, next: head + (i + 1) % n, prev: head + (i + n - 1) % n, neighbor: -1, intersect: false, entry: false, visited: false }));
    return head;
  };
  const headA = build(A), headB = build(B);
  const insert = (v, start, end) => {
    let cur = start;
    while (pool[cur].next !== end && pool[pool[cur].next].intersect && pool[pool[cur].next].alpha < pool[v].alpha) cur = pool[cur].next;
    const after = pool[cur].next;
    pool[v].next = after;
    pool[v].prev = cur;
    pool[cur].next = v;
    pool[after].prev = v;
  };
  const na = A.length, nb = B.length;
  for (let i = 0; i < na; i++) {
    const a1 = A[i], a2 = A[(i + 1) % na];
    for (let j = 0; j < nb; j++) {
      const b1 = B[j], b2 = B[(j + 1) % nb];
      const rx = a2.x - a1.x, ry = a2.y - a1.y, sx = b2.x - b1.x, sy = b2.y - b1.y;
      const d = rx * sy - ry * sx, qx = b1.x - a1.x, qy = b1.y - a1.y;
      const rl = Math.hypot(rx, ry), sl = Math.hypot(sx, sy);
      if (Math.abs(d) <= 1e-10 * rl * sl) {
        const off = Math.abs(qx * ry - qy * rx) / (rl || 1);
        if (off < 1e-9 * scale) {
          const r2 = rl * rl || 1;
          const t0 = (qx * rx + qy * ry) / r2, t1 = ((b2.x - a1.x) * rx + (b2.y - a1.y) * ry) / r2;
          if (Math.max(t0, t1) >= -1e-10 && Math.min(t0, t1) <= 1 + 1e-10) return null;
        }
        continue;
      }
      const alpha = (qx * sy - qy * sx) / d, beta = (qx * ry - qy * rx) / d, ea = 1e-9;
      if (alpha < -ea || alpha > 1 + ea || beta < -ea || beta > 1 + ea) continue;
      if (alpha <= ea || alpha >= 1 - ea || beta <= ea || beta >= 1 - ea) return null;
      const x = a1.x + alpha * rx, y = a1.y + alpha * ry;
      const ia = pool.length;
      pool.push({ x, y, alpha, next: -1, prev: -1, neighbor: ia + 1, intersect: true, entry: false, visited: false });
      pool.push({ x, y, alpha: beta, next: -1, prev: -1, neighbor: ia, intersect: true, entry: false, visited: false });
      insert(ia, headA + i, headA + (i + 1) % na);
      insert(ia + 1, headB + j, headB + (j + 1) % nb);
    }
  }
  const fa = flat(A), fb = flat(B);
  const aInB = pointInPolygonFlat(fb, nb, A[0].x, A[0].y);
  const bInA = pointInPolygonFlat(fa, na, B[0].x, B[0].y);
  const rings = [];
  if (pool.length === na + nb) {
    if (mode === 0) { if (aInB) rings.push(B); else if (bInA) rings.push(A); else rings.push(A, B); }
    else if (mode === 2) { if (aInB) rings.push(A); else if (bInA) rings.push(B); }
    else if (!aInB) { if (bInA) rings.push(A, B); else rings.push(A); }
    return rings.map((r) => r.map((p) => ({ x: p.x, y: p.y })));
  }
  const mark = (head, status) => {
    let v = head;
    do {
      if (pool[v].intersect) { pool[v].entry = status; status = !status; }
      v = pool[v].next;
    } while (v !== head);
  };
  mark(headA, forwardA !== aInB);
  mark(headB, forwardB !== bInA);
  for (;;) {
    let start = -1, v = headA;
    do {
      if (pool[v].intersect && !pool[v].visited) { start = v; break; }
      v = pool[v].next;
    } while (v !== headA);
    if (start < 0) break;
    let current = start;
    const ring = [{ x: pool[current].x, y: pool[current].y }];
    let guard = pool.length * 4 + 16;
    do {
      pool[current].visited = true;
      if (pool[current].neighbor >= 0) pool[pool[current].neighbor].visited = true;
      const forward = pool[current].entry;
      do {
        current = forward ? pool[current].next : pool[current].prev;
        ring.push({ x: pool[current].x, y: pool[current].y });
      } while (!pool[current].intersect && --guard > 0);
      current = pool[current].neighbor;
    } while (!pool[current].visited && --guard > 0);
    const last = ring[ring.length - 1];
    if (ring.length > 1 && Math.abs(last.x - ring[0].x) < 1e-9 && Math.abs(last.y - ring[0].y) < 1e-9) ring.pop();
    if (ring.length >= 3) rings.push(ring);
    if (guard <= 0) break;
  }
  return rings;
}

function booleanFallback(op, polyA, polyB) {
  op = toOp(op);
  if (op < 0) return [];
  const A = cleanRing(polyA), B = cleanRing(polyB);
  if (A.length < 3 || B.length < 3) {
    const out = [];
    if ((op === 0 || op === 1 || op === 3) && A.length >= 3) out.push(A);
    if ((op === 0 || op === 3) && B.length >= 3) out.push(B);
    return out;
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of [...A, ...B]) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
  const scale = Math.max(maxX - minX, maxY - minY, 1e-9);
  const dirs = [[0.7548776662, 0.569840291], [-0.6180339887, 0.7861513778], [0.4142135624, -0.9101797211], [-0.8191520443, -0.5735764364], [0.2588190451, 0.9659258263], [0.9238795325, -0.3826834324]];
  for (let attempt = 0; attempt < 7; attempt++) {
    const amount = attempt === 0 ? 0 : scale * 1e-7 * attempt * attempt;
    const [ux, uy] = attempt === 0 ? [0, 0] : dirs[(attempt - 1) % 6];
    const P = B.map((p) => ({ x: p.x + ux * amount, y: p.y + uy * amount }));
    let result;
    if (op === 0) result = ghClip(A, P, false, false, 0, scale);
    else if (op === 1) result = ghClip(A, P, false, true, 1, scale);
    else if (op === 2) result = ghClip(A, P, true, true, 2, scale);
    else {
      const first = ghClip(A, P, false, true, 1, scale);
      const second = first && ghClip(P, A, false, true, 1, scale);
      result = first && second ? [...first, ...second] : null;
    }
    if (result) return result;
  }
  return [];
}

function layoutFallback(sizes, edges, direction, gapX, gapY) {
  const n = sizes.length;
  if (!n) return [];
  const lr = direction === 1;
  const gapAcross = lr ? gapY : gapX, gapAlong = lr ? gapX : gapY;
  const list = edges.filter(([a, b]) => a >= 0 && b >= 0 && a < n && b < n && a !== b).map(([a, b]) => [a, b]);
  const out = Array.from({ length: n }, () => []);
  list.forEach((e, i) => out[e[0]].push(i));
  const state = new Uint8Array(n);
  for (let root = 0; root < n; root++) {
    if (state[root]) continue;
    state[root] = 1;
    const stack = [[root, 0]];
    while (stack.length) {
      const top = stack[stack.length - 1];
      if (top[1] >= out[top[0]].length) { state[top[0]] = 2; stack.pop(); continue; }
      const ei = out[top[0]][top[1]++];
      const to = list[ei][1];
      if (state[to] === 1) list[ei].reversed = true;
      else if (state[to] === 0) { state[to] = 1; stack.push([to, 0]); }
    }
  }
  const dag = list.map((e) => (e.reversed ? [e[1], e[0]] : [e[0], e[1]]));
  const indeg = new Int32Array(n);
  const succ = Array.from({ length: n }, () => []);
  for (const [a, b] of dag) { indeg[b]++; succ[a].push(b); }
  const layer = new Int32Array(n);
  const queue = [];
  for (let i = 0; i < n; i++) if (!indeg[i]) queue.push(i);
  for (let q = 0; q < queue.length; q++) {
    const v = queue[q];
    for (const to of succ[v]) {
      layer[to] = Math.max(layer[to], layer[v] + 1);
      if (--indeg[to] === 0) queue.push(to);
    }
  }
  const layers = [];
  for (let i = 0; i < n; i++) (layers[layer[i]] ||= []).push(i);
  for (let l = 0; l < layers.length; l++) layers[l] ||= [];
  const neighbors = Array.from({ length: n }, () => []);
  for (const [a, b] of dag) { neighbors[a].push(b); neighbors[b].push(a); }
  const order = new Float64Array(n);
  layers.forEach((nodes) => nodes.forEach((v, i) => { order[v] = i; }));
  for (let iter = 0; iter < 8; iter++) {
    const down = iter % 2 === 0;
    for (let s = 1; s < layers.length; s++) {
      const l = down ? s : layers.length - 1 - s;
      const ref = down ? l - 1 : l + 1;
      const bary = new Map();
      for (const v of layers[l]) {
        const ns = neighbors[v].filter((u) => layer[u] === ref);
        bary.set(v, ns.length ? ns.reduce((acc, u) => acc + order[u], 0) / ns.length : order[v]);
      }
      layers[l].sort((p, q) => bary.get(p) - bary.get(q));
      layers[l].forEach((v, i) => { order[v] = i; });
    }
  }
  const breadth = (i) => (lr ? sizes[i].h : sizes[i].w) || 0;
  const depth = (i) => (lr ? sizes[i].w : sizes[i].h) || 0;
  const pos = new Float64Array(n);
  let along = 0;
  const result = new Array(n);
  for (const nodes of layers) {
    const total = nodes.reduce((acc, v) => acc + breadth(v), 0) + gapAcross * Math.max(0, nodes.length - 1);
    let at = -total / 2;
    const layerDepth = nodes.reduce((acc, v) => Math.max(acc, depth(v)), 0);
    for (const v of nodes) {
      pos[v] = at;
      const alongPos = along + (layerDepth - depth(v)) / 2;
      result[v] = lr ? { x: alongPos, y: at } : { x: at, y: alongPos };
      at += breadth(v) + gapAcross;
    }
    along += layerDepth + gapAlong;
  }
  const minX = Math.min(...result.map((p) => p.x)), minY = Math.min(...result.map((p) => p.y));
  return result.map((p) => ({ x: p.x - minX, y: p.y - minY }));
}

let fallbackBoxes = [];

export const Fallback = {
  routeOrthogonal: (obstacles, start, startDir, end, endDir, margin = 12) => {
    if (!validPoint(start) || !validPoint(end)) return [];
    return routeFallback(cleanBoxes(obstacles), { x: +start.x, y: +start.y }, startDir, { x: +end.x, y: +end.y }, endDir, ok(+margin) ? +margin : 0);
  },
  simplify: (points, eps = 1) => simplifyFallback(clean(points), ok(+eps) ? Math.max(0, +eps) : 0),
  smooth: (points) => smoothFallback(clean(points)),
  flatten: (points, closed = false, tol = 0.25) => flattenFallback(clean(points), !!closed, ok(+tol) && tol > 0 ? +tol : 0.25),
  boolean: (op, polyA, polyB) => booleanFallback(op, clean(polyA), clean(polyB)),
  pointInPolygon: (polygon, point) => {
    if (!validPoint(point)) return false;
    const poly = clean(polygon);
    return pointInPolygonFlat(flat(poly), poly.length, +point.x, +point.y);
  },
  distanceToPolyline: (points, point) => {
    const pts = clean(points);
    if (!pts.length || !validPoint(point)) return Infinity;
    if (pts.length === 1) return Math.hypot(pts[0].x - point.x, pts[0].y - point.y);
    let best = Infinity;
    for (let i = 0; i + 1 < pts.length; i++) best = Math.min(best, distanceToSegment(point.x, point.y, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y));
    return best;
  },
  layoutLayered: (sizes, edges, direction = 0, gapX = 40, gapY = 60) => layoutFallback(
    (sizes || []).map((s) => ({ w: s && ok(+s.w) && s.w > 0 ? +s.w : 0, h: s && ok(+s.h) && s.h > 0 ? +s.h : 0 })),
    (edges || []).filter((e) => Array.isArray(e) && Number.isInteger(e[0]) && Number.isInteger(e[1])),
    toLayoutDir(direction),
    ok(+gapX) && gapX >= 0 ? +gapX : 0,
    ok(+gapY) && gapY >= 0 ? +gapY : 0,
  ),
  indexBuild: (boxes) => {
    fallbackBoxes = (boxes || []).map((b) => {
      if (!b || !ok(+b.x) || !ok(+b.y) || !ok(+b.w) || !ok(+b.h)) return null;
      let { x, y, w, h } = b;
      if (w < 0) { x += w; w = -w; }
      if (h < 0) { y += h; h = -h; }
      return { x, y, w, h };
    });
    return fallbackBoxes.length;
  },
  indexQuery: (box) => {
    if (!box || !ok(+box.x) || !ok(+box.y) || !ok(+box.w) || !ok(+box.h)) return [];
    let { x, y, w, h } = box;
    if (w < 0) { x += w; w = -w; }
    if (h < 0) { y += h; h = -h; }
    const out = [];
    fallbackBoxes.forEach((b, i) => {
      if (!b || b.x > x + w || b.x + b.w < x || b.y > y + h || b.y + b.h < y) return;
      out.push(i);
    });
    return out;
  },
};

function toLayoutDir(direction) {
  if (direction === 'LR' || direction === 'lr' || direction === 'horizontal' || direction === 1) return 1;
  return 0;
}

let ex = null;

function heap() {
  return ex.memory.buffer;
}

function alloc(bytes) {
  return ex.grafo_alloc(Math.max(8, bytes)) >>> 0;
}

function putF64(values) {
  const p = alloc(values.length * 8);
  new Float64Array(heap(), p, values.length).set(values);
  return p;
}

function putI32(values) {
  const p = alloc(values.length * 4);
  new Int32Array(heap(), p, values.length).set(values);
  return p;
}

function readF64(p, n) {
  return new Float64Array(heap(), p, n).slice();
}

function release(...ptrs) {
  for (const p of ptrs) ex.grafo_free(p);
}

async function toBytes(source) {
  if (source instanceof Uint8Array) return source;
  if (source instanceof ArrayBuffer) return new Uint8Array(source);
  if (ArrayBuffer.isView(source)) return new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
  const response = await fetch(source);
  if (!response.ok) throw new Error(`engine ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

export const Engine = {
  ready: false,
  usedFallback: true,

  async load(source) {
    try {
      const bytes = await toBytes(source ?? new URL('../../assets/engine.wasm', import.meta.url));
      const module = await WebAssembly.compile(bytes);
      const imports = {};
      for (const imp of WebAssembly.Module.imports(module)) {
        if (imp.kind !== 'function') continue;
        imports[imp.module] = imports[imp.module] || {};
        imports[imp.module][imp.name] = () => 0;
      }
      const instance = await WebAssembly.instantiate(module, imports);
      if (typeof instance.exports._initialize === 'function') instance.exports._initialize();
      ex = instance.exports;
      Engine.ready = true;
      Engine.usedFallback = false;
      return true;
    } catch {
      ex = null;
      Engine.ready = false;
      Engine.usedFallback = true;
      return false;
    }
  },

  unload() {
    ex = null;
    Engine.ready = false;
    Engine.usedFallback = true;
  },

  reset() {
    if (ex) ex.grafo_reset();
    fallbackBoxes = [];
  },

  heapUsed() {
    return ex ? ex.grafo_heap_used() >>> 0 : 0;
  },

  memoryBytes() {
    return ex ? ex.memory.buffer.byteLength : 0;
  },

  routeOrthogonal(obstacles, start, startDir, end, endDir, margin = 12) {
    if (!ex) return Fallback.routeOrthogonal(obstacles, start, startDir, end, endDir, margin);
    if (!validPoint(start) || !validPoint(end)) return [];
    if (!ok(+margin)) margin = 0;
    const list = cleanBoxes(obstacles);
    const boxes = new Float64Array(list.length * 4);
    list.forEach((o, i) => { boxes[i * 4] = o.x; boxes[i * 4 + 1] = o.y; boxes[i * 4 + 2] = o.w; boxes[i * 4 + 3] = o.h; });
    const maxPoints = 512;
    const pb = putF64(boxes);
    const po = alloc(maxPoints * 16);
    const count = ex.grafo_route_orthogonal(pb, list.length, start.x, start.y, toDir(startDir), end.x, end.y, toDir(endDir), margin, po, maxPoints);
    const out = unflat(readF64(po, count * 2), count);
    release(pb, po);
    return out;
  },

  simplify(points, eps = 1) {
    if (!ex) return Fallback.simplify(points, eps);
    points = clean(points);
    eps = ok(+eps) ? Math.max(0, +eps) : 0;
    const n = points.length;
    if (!n) return [];
    const pi = putF64(flat(points));
    const po = alloc(n * 16);
    const count = ex.grafo_simplify(pi, n, eps, po);
    const out = unflat(readF64(po, count * 2), count);
    release(pi, po);
    return out;
  },

  smooth(points) {
    if (!ex) return Fallback.smooth(points);
    points = clean(points);
    const n = points.length;
    if (!n) return [];
    const pi = putF64(flat(points));
    const po = alloc(n * 48);
    const count = ex.grafo_smooth(pi, n, po, n);
    const raw = readF64(po, count * 6);
    release(pi, po);
    const out = new Array(count);
    for (let i = 0; i < count; i++) out[i] = { x: raw[i * 6], y: raw[i * 6 + 1], c1x: raw[i * 6 + 2], c1y: raw[i * 6 + 3], c2x: raw[i * 6 + 4], c2y: raw[i * 6 + 5] };
    return out;
  },

  flatten(points, closed = false, tol = 0.25) {
    if (!ex) return Fallback.flatten(points, closed, tol);
    points = clean(points);
    tol = ok(+tol) && tol > 0 ? +tol : 0.25;
    const n = points.length;
    if (!n) return [];
    const data = new Float64Array(n * 6);
    points.forEach((p, i) => {
      data.set([p.x, p.y, p.inx ?? p.x, p.iny ?? p.y, p.outx ?? p.x, p.outy ?? p.y], i * 6);
    });
    const maxOut = Math.min(1 << 20, n * 512 + 16);
    const pi = putF64(data);
    const po = alloc(maxOut * 16);
    const count = ex.grafo_flatten(pi, n, closed ? 1 : 0, tol, po, maxOut);
    const out = unflat(readF64(po, count * 2), count);
    release(pi, po);
    return out;
  },

  boolean(op, polyA, polyB) {
    const code = toOp(op);
    if (code < 0) return [];
    if (!ex) return Fallback.boolean(code, polyA, polyB);
    polyA = clean(polyA);
    polyB = clean(polyB);
    const na = polyA.length, nb = polyB.length;
    const maxOut = Math.min(2000000, (na + nb) * 2 + 2 * na * nb + 16);
    const maxRings = Math.min(1000000, na * nb + 8);
    const pa = putF64(flat(polyA));
    const pb = putF64(flat(polyB));
    const po = alloc(maxOut * 16);
    const pr = alloc(maxRings * 4);
    const rings = ex.grafo_boolean(code, pa, na, pb, nb, po, maxOut, pr, maxRings);
    let out;
    if (rings < 0) {
      out = Fallback.boolean(code, polyA, polyB);
    } else {
      const sizes = new Int32Array(heap(), pr, rings).slice();
      const total = sizes.reduce((acc, v) => acc + v, 0);
      const raw = readF64(po, total * 2);
      out = [];
      let offset = 0;
      for (const size of sizes) {
        out.push(unflat(raw.subarray(offset * 2, (offset + size) * 2), size));
        offset += size;
      }
    }
    release(pa, pb, po, pr);
    return out;
  },

  pointInPolygon(polygon, point) {
    if (!ex) return Fallback.pointInPolygon(polygon, point);
    if (!validPoint(point)) return false;
    polygon = clean(polygon);
    if (polygon.length < 3) return false;
    const p = putF64(flat(polygon));
    const r = ex.grafo_point_in_polygon(p, polygon.length, point.x, point.y);
    release(p);
    return r !== 0;
  },

  distanceToPolyline(points, point) {
    if (!ex) return Fallback.distanceToPolyline(points, point);
    points = clean(points);
    if (!points.length || !validPoint(point)) return Infinity;
    const p = putF64(flat(points));
    const d = ex.grafo_distance_to_polyline(p, points.length, point.x, point.y);
    release(p);
    return d;
  },

  layoutLayered(sizes, edges, direction = 0, gapX = 40, gapY = 60) {
    if (!ex) return Fallback.layoutLayered(sizes, edges, direction, gapX, gapY);
    const n = sizes.length;
    if (!n) return [];
    const sz = new Float64Array(n * 2);
    sizes.forEach((s, i) => { sz[i * 2] = s && ok(+s.w) ? +s.w : 0; sz[i * 2 + 1] = s && ok(+s.h) ? +s.h : 0; });
    if (!ok(+gapX)) gapX = 0;
    if (!ok(+gapY)) gapY = 0;
    const list = (edges || []).filter((e) => Array.isArray(e) && Number.isInteger(e[0]) && Number.isInteger(e[1]));
    const ed = new Int32Array(list.length * 2);
    list.forEach((e, i) => { ed[i * 2] = e[0]; ed[i * 2 + 1] = e[1]; });
    const ps = putF64(sz);
    const pe = putI32(ed);
    const po = alloc(n * 16);
    ex.grafo_layout_layered(n, ps, list.length, pe, toLayoutDir(direction), gapX, gapY, po);
    const out = unflat(readF64(po, n * 2), n);
    release(ps, pe, po);
    return out;
  },

  indexBuild(boxes) {
    if (!ex) return Fallback.indexBuild(boxes);
    const list = boxes || [];
    const data = new Float64Array(list.length * 4);
    list.forEach((b, i) => { if (!b) { data[i * 4] = NaN; return; } data[i * 4] = b.x; data[i * 4 + 1] = b.y; data[i * 4 + 2] = b.w; data[i * 4 + 3] = b.h; });
    const p = putF64(data);
    ex.grafo_index_build(p, list.length);
    release(p);
    return list.length;
  },

  indexQuery(box) {
    if (!ex) return Fallback.indexQuery(box);
    if (!box || !ok(+box.x) || !ok(+box.y) || !ok(+box.w) || !ok(+box.h)) return [];
    const max = Math.max(1, ex.grafo_index_size());
    const po = alloc(max * 4);
    const count = ex.grafo_index_query(box.x, box.y, box.w, box.h, po, max);
    const out = Array.from(new Int32Array(heap(), po, count)).sort((a, b) => a - b);
    release(po);
    return out;
  },
};

export default Engine;
