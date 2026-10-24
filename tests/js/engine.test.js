import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { Engine, Fallback } from '../../web/src/engine/index.js';

const wasmBytes = readFileSync(new URL('../../web/assets/engine.wasm', import.meta.url));
const timings = [];

function timed(label, fn) {
  const t0 = performance.now();
  const value = fn();
  const ms = performance.now() - t0;
  timings.push([label, ms]);
  return { value, ms };
}

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function square(x, y, s) {
  return [{ x, y }, { x: x + s, y }, { x: x + s, y: y + s }, { x, y: y + s }];
}

function shoelace(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a / 2);
}

function inRing(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.y > y) !== (b.y > y) && x < a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x)) inside = !inside;
  }
  return inside;
}

function inRings(rings, x, y) {
  let inside = false;
  for (const r of rings) if (inRing(r, x, y)) inside = !inside;
  return inside;
}

function starPolygon(random, cx, cy, radius, count) {
  const pts = [];
  const offset = random() * Math.PI * 2;
  for (let i = 0; i < count; i++) {
    const angle = offset + (i / count) * Math.PI * 2 + (random() - 0.5) * (Math.PI / count);
    const r = radius * (0.35 + random() * 0.65);
    pts.push({ x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r });
  }
  return pts;
}

function segmentHitsBox(a, b, box) {
  const l = box.x, r = box.x + box.w, t = box.y, btm = box.y + box.h, e = 1e-6;
  if (Math.abs(a.y - b.y) < 1e-9) {
    const lx = Math.min(a.x, b.x), hx = Math.max(a.x, b.x);
    return a.y > t + e && a.y < btm - e && hx > l + e && lx < r - e;
  }
  const ly = Math.min(a.y, b.y), hy = Math.max(a.y, b.y);
  return a.x > l + e && a.x < r - e && hy > t + e && ly < btm - e;
}

function assertRouteValid(route, start, end, obstacles) {
  assert.ok(route.length >= 2, 'rota vazia');
  assert.deepEqual(route[0], start);
  assert.deepEqual(route[route.length - 1], end);
  for (let i = 0; i + 1 < route.length; i++) {
    const a = route[i], b = route[i + 1];
    assert.ok(Math.abs(a.x - b.x) < 1e-9 || Math.abs(a.y - b.y) < 1e-9, 'segmento não ortogonal');
    for (const o of obstacles) assert.ok(!segmentHitsBox(a, b, o), `rota atravessa obstáculo ${JSON.stringify(o)}`);
  }
}

function boxesOverlap(a, b, tol = 1e-6) {
  return a.x < b.x + b.w - tol && b.x < a.x + a.w - tol && a.y < b.y + b.h - tol && b.y < a.y + a.h - tol;
}

const implementations = [
  ['wasm', () => Engine],
  ['fallback', () => Fallback],
];

before(async () => {
  assert.equal(await Engine.load(wasmBytes), true);
});

after(() => {
  const lines = timings.map(([label, ms]) => `  ${label.padEnd(58)} ${ms.toFixed(1).padStart(9)} ms`);
  console.log(`\nTempos do núcleo:\n${lines.join('\n')}\n`);
});

describe('carregamento', () => {
  test('o módulo não importa nada do ambiente', () => {
    const mod = new WebAssembly.Module(wasmBytes);
    assert.deepEqual(WebAssembly.Module.imports(mod), []);
    const names = WebAssembly.Module.exports(mod).map((e) => e.name);
    for (const name of ['grafo_route_orthogonal', 'grafo_boolean', 'grafo_layout_layered', 'grafo_index_query', 'grafo_alloc', 'grafo_reset']) assert.ok(names.includes(name), name);
  });

  test('load aceita ArrayBuffer e Uint8Array e falha sem lançar', async () => {
    assert.equal(await Engine.load(wasmBytes.buffer.slice(wasmBytes.byteOffset, wasmBytes.byteOffset + wasmBytes.byteLength)), true);
    assert.equal(await Engine.load(new Uint8Array([0, 1, 2, 3])), false);
    assert.equal(Engine.ready, false);
    assert.equal(Engine.simplify([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }], 0.1).length, 2);
    assert.equal(await Engine.load(new Uint8Array(wasmBytes)), true);
    assert.equal(Engine.ready, true);
  });
});

for (const [name, get] of implementations) {
  describe(`roteamento ortogonal (${name})`, () => {
    test('desvia de um obstáculo entre a origem e o destino', () => {
      const E = get();
      const obstacles = [{ x: 100, y: -50, w: 100, h: 200 }];
      const route = E.routeOrthogonal(obstacles, { x: 0, y: 50 }, 1, { x: 300, y: 50 }, 3, 10);
      assertRouteValid(route, { x: 0, y: 50 }, { x: 300, y: 50 }, obstacles);
      assert.ok(route.length <= 6);
    });

    test('sai e chega pelos lados pedidos', () => {
      const E = get();
      const route = E.routeOrthogonal([], { x: 0, y: 0 }, 2, { x: 200, y: 100 }, 0, 20);
      assert.equal(route[1].x, 0);
      assert.ok(route[1].y > 0);
      assert.equal(route[route.length - 2].x, 200);
      assert.ok(route[route.length - 2].y < 100);
    });

    test('labirinto aleatório sem atravessar obstáculos', () => {
      const E = get();
      const random = rng(7);
      for (let trial = 0; trial < 25; trial++) {
        const obstacles = [];
        for (let i = 0; i < 12; i++) obstacles.push({ x: 40 + random() * 500, y: random() * 400, w: 20 + random() * 60, h: 20 + random() * 60 });
        const start = { x: 0, y: 200 }, end = { x: 700, y: 200 };
        const route = E.routeOrthogonal(obstacles, start, 1, end, 3, 6);
        assertRouteValid(route, start, end, obstacles.filter((o) => !(o.x < 0 && o.x + o.w > 0)));
      }
    });
  });

  describe(`booleanas (${name})`, () => {
    test('áreas esperadas para dois quadrados', () => {
      const E = get();
      const area = (rings) => rings.reduce((acc, r) => acc + shoelace(r), 0);
      assert.ok(Math.abs(area(E.boolean('union', square(0, 0, 10), square(5, 5, 10))) - 175) < 1e-6);
      assert.ok(Math.abs(area(E.boolean('subtract', square(0, 0, 10), square(5, 5, 10))) - 75) < 1e-6);
      assert.ok(Math.abs(area(E.boolean('intersect', square(0, 0, 10), square(5, 5, 10))) - 25) < 1e-6);
      assert.ok(Math.abs(area(E.boolean('exclude', square(0, 0, 10), square(5, 5, 10))) - 150) < 1e-6);
    });

    test('contido, disjunto e coincidente', () => {
      const E = get();
      const outer = square(0, 0, 100), inner = square(25, 25, 10), far = square(500, 500, 10);
      assert.equal(E.boolean('union', outer, inner).length, 1);
      assert.equal(E.boolean('intersect', outer, far).length, 0);
      assert.equal(E.boolean('union', outer, far).length, 2);
      const hole = E.boolean('subtract', outer, inner);
      assert.equal(hole.length, 2);
      assert.equal(inRings(hole, 30, 30), false);
      assert.equal(inRings(hole, 5, 5), true);
      const same = E.boolean('union', square(0, 0, 10), square(0, 0, 10));
      assert.ok(Math.abs(same.reduce((acc, r) => acc + shoelace(r), 0) - 100) < 1e-3);
      const touching = E.boolean('intersect', square(0, 0, 10), square(5, 0, 10));
      assert.ok(Math.abs(touching.reduce((acc, r) => acc + shoelace(r), 0) - 50) < 1e-3);
    });

    test('fuzz: 300 pares aleatórios conferidos ponto a ponto', () => {
      const E = get();
      const random = rng(name === 'wasm' ? 11 : 13);
      const ops = ['union', 'subtract', 'intersect', 'exclude'];
      const expect = {
        union: (a, b) => a || b,
        subtract: (a, b) => a && !b,
        intersect: (a, b) => a && b,
        exclude: (a, b) => a !== b,
      };
      let samples = 0, mismatches = 0;
      const { ms } = timed(`booleanas: fuzz 300 pares × 4 operações (${name})`, () => {
        for (let pair = 0; pair < 300; pair++) {
          const A = starPolygon(random, 0, 0, 100, 5 + Math.floor(random() * 20));
          const B = starPolygon(random, (random() - 0.5) * 160, (random() - 0.5) * 160, 100, 5 + Math.floor(random() * 20));
          const results = {};
          for (const op of ops) {
            const rings = E.boolean(op, A, B);
            assert.ok(Array.isArray(rings));
            for (const r of rings) for (const p of r) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
            results[op] = rings;
          }
          let inA = 0, inB = 0, inU = 0, inI = 0;
          for (let gy = 0; gy < 24; gy++) {
            for (let gx = 0; gx < 24; gx++) {
              const x = -200 + (gx + 0.5) * (400 / 24) + 0.0137, y = -200 + (gy + 0.5) * (400 / 24) + 0.0291;
              const a = inRing(A, x, y), b = inRing(B, x, y);
              inA += a; inB += b;
              for (const op of ops) {
                samples++;
                const got = inRings(results[op], x, y);
                if (op === 'union') inU += got;
                if (op === 'intersect') inI += got;
                if (got !== expect[op](a, b)) mismatches++;
              }
            }
          }
          assert.ok(inU >= Math.max(inA, inB) - 2, `união menor que uma das partes (par ${pair})`);
          assert.ok(inI <= Math.min(inA, inB) + 2, `interseção maior que uma das partes (par ${pair})`);
        }
      });
      assert.ok(mismatches / samples < 0.002, `divergências ponto a ponto: ${mismatches}/${samples}`);
      assert.ok(ms < 20000);
    });
  });

  describe(`simplificação, curvas e distâncias (${name})`, () => {
    test('Ramer–Douglas–Peucker mantém extremos e cantos', () => {
      const E = get();
      const out = E.simplify([{ x: 0, y: 0 }, { x: 1, y: 0.01 }, { x: 2, y: 0 }, { x: 3, y: 5 }], 0.1);
      assert.deepEqual(out, [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 5 }]);
      const line = Array.from({ length: 100 }, (_, i) => ({ x: i, y: 2 * i }));
      assert.equal(E.simplify(line, 0.01).length, 2);
    });

    test('suavização devolve um controle por ponto e passa pelos pontos', () => {
      const E = get();
      const pts = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 }, { x: 30, y: 10 }];
      const out = E.smooth(pts);
      assert.equal(out.length, 4);
      out.forEach((p, i) => { assert.equal(p.x, pts[i].x); assert.equal(p.y, pts[i].y); });
    });

    test('achatamento respeita a tolerância e fecha sem repetir o primeiro ponto', () => {
      const E = get();
      const curve = [{ x: 0, y: 0, outx: 0, outy: 50 }, { x: 100, y: 0, inx: 100, iny: 50 }];
      const coarse = E.flatten(curve, false, 2), fine = E.flatten(curve, false, 0.05);
      assert.ok(fine.length > coarse.length);
      assert.deepEqual(fine[fine.length - 1], { x: 100, y: 0 });
      const closed = E.flatten(square(0, 0, 10), true, 0.5);
      assert.equal(closed.length, 4);
    });

    test('ponto em polígono e distância a polilinha', () => {
      const E = get();
      assert.equal(E.pointInPolygon(square(0, 0, 10), { x: 5, y: 5 }), true);
      assert.equal(E.pointInPolygon(square(0, 0, 10), { x: 15, y: 5 }), false);
      assert.ok(Math.abs(E.distanceToPolyline([{ x: 0, y: 0 }, { x: 10, y: 0 }], { x: 5, y: 3 }) - 3) < 1e-9);
    });
  });

  describe(`entradas degeneradas (${name})`, () => {
    test('vazio, um ponto, pontos repetidos, NaN e Infinity não travam', () => {
      const E = get();
      const bad = [{ x: NaN, y: 0 }, { x: 0, y: Infinity }, { x: -Infinity, y: 1 }, null, { x: 'a', y: 2 }];
      assert.deepEqual(E.simplify([], 1), []);
      assert.deepEqual(E.simplify(bad, 1), []);
      assert.equal(E.simplify([{ x: 1, y: 1 }], 1).length, 1);
      assert.equal(E.simplify(Array.from({ length: 50 }, () => ({ x: 3, y: 3 })), 0.5).length, 2);
      assert.deepEqual(E.smooth([]), []);
      assert.deepEqual(E.flatten([], true, 1), []);
      assert.deepEqual(E.flatten(bad, true, NaN), []);
      assert.deepEqual(E.boolean('union', [], []), []);
      assert.deepEqual(E.boolean('intersect', bad, square(0, 0, 10)), []);
      assert.deepEqual(E.boolean('nada', square(0, 0, 10), square(0, 0, 10)), []);
      assert.equal(E.boolean('union', Array.from({ length: 10 }, () => ({ x: 2, y: 2 })), square(0, 0, 10)).length, 1);
      const collinear = [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 10 }];
      for (const op of ['union', 'subtract', 'intersect', 'exclude']) assert.ok(Array.isArray(E.boolean(op, collinear, square(0, 0, 10))));
      assert.deepEqual(E.routeOrthogonal([], { x: NaN, y: 0 }, 1, { x: 10, y: 0 }, 3, 5), []);
      const r = E.routeOrthogonal([{ x: NaN, y: 0, w: 10, h: 10 }, { x: 20, y: -20, w: 10, h: 40 }], { x: 0, y: 0 }, 1, { x: 50, y: 0 }, 3, Infinity);
      assert.ok(r.length >= 2);
      assert.equal(E.pointInPolygon(bad, { x: 0, y: 0 }), false);
      assert.equal(E.distanceToPolyline([], { x: 0, y: 0 }), Infinity);
      assert.deepEqual(E.layoutLayered([], [], 0, 10, 10), []);
      const lay = E.layoutLayered([{ w: NaN, h: 10 }, { w: 10, h: Infinity }, null], [[0, 1], [1, 0], [0, 0], [5, 9], [0, 'x']], 1, NaN, -3);
      assert.equal(lay.length, 3);
      for (const p of lay) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
      E.indexBuild([{ x: NaN, y: 0, w: 1, h: 1 }, { x: 0, y: 0, w: 1, h: 1 }]);
      assert.deepEqual(E.indexQuery({ x: -5, y: -5, w: 20, h: 20 }), [1]);
      assert.deepEqual(E.indexQuery({ x: NaN, y: 0, w: 1, h: 1 }), []);
    });
  });

  describe(`escalabilidade (${name})`, () => {
    test('roteamento com 500 obstáculos', () => {
      const E = get();
      const obstacles = [];
      for (let row = 0; row < 20; row++) for (let col = 0; col < 25; col++) {
        obstacles.push({ x: 100 + col * 90 + (row % 2) * 30, y: row * 80, w: 50, h: 40 });
      }
      const start = { x: 0, y: 790 }, end = { x: 2500, y: 10 };
      const { value, ms } = timed(`roteamento: 500 obstáculos (${name})`, () => E.routeOrthogonal(obstacles, start, 1, end, 3, 8));
      assertRouteValid(value, start, end, obstacles);
      assert.ok(ms < (name === 'wasm' ? 3000 : 8000), `${ms.toFixed(0)} ms`);
    });

    test('roteamento com 500 obstáculos aleatórios sem corredor reto', () => {
      const E = get();
      const random = rng(21);
      const start = { x: -40, y: -40 }, end = { x: 3040, y: 3040 };
      const obstacles = [];
      while (obstacles.length < 500) {
        const o = { x: random() * 2900, y: random() * 2900, w: 30 + random() * 120, h: 30 + random() * 120 };
        if (o.x < 60 && o.y < 60) continue;
        if (o.x + o.w > 2940 && o.y + o.h > 2940) continue;
        obstacles.push(o);
      }
      for (let k = 0; k < 10; k++) obstacles[k] = { x: 300 * k + 150, y: -200, w: 40, h: 3200 - (k % 2) * 250 };
      const { value, ms } = timed(`roteamento: 500 obstáculos aleatórios + paredes (${name})`, () => E.routeOrthogonal(obstacles, start, 1, end, 3, 6));
      assertRouteValid(value, start, end, obstacles);
      assert.ok(ms < (name === 'wasm' ? 3000 : 8000), `${ms.toFixed(0)} ms`);
    });

    test('índice espacial com 10.000 caixas confere com força bruta', () => {
      const E = get();
      const random = rng(99);
      const boxes = Array.from({ length: 10000 }, () => ({ x: random() * 20000, y: random() * 20000, w: 5 + random() * 200, h: 5 + random() * 200 }));
      timed(`índice: construir 10.000 caixas (${name})`, () => E.indexBuild(boxes));
      const queries = Array.from({ length: 1000 }, () => ({ x: random() * 20000, y: random() * 20000, w: random() * 1500, h: random() * 1500 }));
      const { value } = timed(`índice: 1.000 consultas (${name})`, () => queries.map((q) => E.indexQuery(q)));
      queries.forEach((q, qi) => {
        const expected = [];
        boxes.forEach((b, i) => {
          if (b.x > q.x + q.w || b.x + b.w < q.x || b.y > q.y + q.h || b.y + b.h < q.y) return;
          expected.push(i);
        });
        assert.deepEqual(value[qi], expected);
      });
    });

    test('layout em camadas com 300 nós e 400 arestas sem sobreposição', () => {
      const E = get();
      const random = rng(5);
      const sizes = Array.from({ length: 300 }, () => ({ w: 60 + random() * 100, h: 30 + random() * 50 }));
      const edges = [];
      for (let i = 1; i < 300; i++) edges.push([Math.floor(random() * i), i]);
      while (edges.length < 400) edges.push([Math.floor(random() * 300), Math.floor(random() * 300)]);
      for (const dir of [0, 1]) {
        const { value, ms } = timed(`layout: 300 nós / 400 arestas, ${dir ? 'esq→dir' : 'cima→baixo'} (${name})`, () => E.layoutLayered(sizes, edges, dir, 24, 48));
        assert.equal(value.length, 300);
        const rects = value.map((p, i) => ({ x: p.x, y: p.y, w: sizes[i].w, h: sizes[i].h }));
        for (const r of rects) assert.ok(Number.isFinite(r.x) && Number.isFinite(r.y));
        for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) assert.ok(!boxesOverlap(rects[i], rects[j]), `nós ${i} e ${j} sobrepostos`);
        assert.ok(ms < 5000);
      }
    });
  });
}

describe('memória do WASM', () => {
  test('milhares de chamadas não fazem a arena crescer', () => {
    const random = rng(3);
    Engine.reset();
    assert.equal(Engine.heapUsed(), 0);
    const work = () => {
      const obstacles = Array.from({ length: 20 }, () => ({ x: random() * 500, y: random() * 500, w: 30, h: 30 }));
      Engine.routeOrthogonal(obstacles, { x: -50, y: 250 }, 1, { x: 600, y: 250 }, 3, 6);
      Engine.boolean(random() < 0.5 ? 'union' : 'exclude', starPolygon(random, 0, 0, 50, 12), starPolygon(random, 30, 10, 50, 12));
      Engine.simplify(Array.from({ length: 200 }, (_, i) => ({ x: i, y: Math.sin(i / 7) * 20 })), 0.5);
      Engine.flatten([{ x: 0, y: 0, outx: 30, outy: 80 }, { x: 100, y: 0, inx: 70, iny: -80 }], false, 0.2);
      Engine.layoutLayered(Array.from({ length: 12 }, () => ({ w: 40, h: 20 })), [[0, 1], [1, 2], [0, 3], [3, 4], [2, 5]], 0, 10, 20);
      Engine.pointInPolygon(square(0, 0, 10), { x: 1, y: 1 });
    };
    for (let i = 0; i < 50; i++) work();
    const usedAfterWarmup = Engine.heapUsed();
    const bytesAfterWarmup = Engine.memoryBytes();
    timed('memória: 5.000 rodadas de chamadas mistas (wasm)', () => { for (let i = 0; i < 5000; i++) work(); });
    assert.equal(Engine.heapUsed(), usedAfterWarmup);
    assert.equal(Engine.heapUsed(), 0);
    assert.equal(Engine.memoryBytes(), bytesAfterWarmup);
    Engine.indexBuild(Array.from({ length: 1000 }, (_, i) => ({ x: i, y: i, w: 1, h: 1 })));
    const withIndex = Engine.heapUsed();
    for (let i = 0; i < 200; i++) Engine.indexBuild(Array.from({ length: 1000 }, (_, k) => ({ x: k + i, y: k, w: 1, h: 1 })));
    assert.ok(Engine.heapUsed() <= withIndex * 1.5);
    Engine.reset();
    assert.equal(Engine.heapUsed(), 0);
    assert.deepEqual(Engine.indexQuery({ x: 0, y: 0, w: 10, h: 10 }), []);
  });
});
