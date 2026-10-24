import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import * as Y from 'yjs';
import { calc, parseCSV, normHex, safeName, escapeXml, hexToNum, numToHex } from '../../web/src/util.js';
import { SHAPES, nodeParts, parseD, flattenD, pathD } from '../../web/src/shapes.js';
import { rotatePoint, corners, aabb, union, toLocal, anchorOf, bestSide, distToPolyline, pointInPoly, hitNode, connectorRoute, isContainer } from '../../web/src/geom.js';
import { Store, LOCAL } from '../../web/src/doc.js';

const rng = (seed) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const newStore = () => {
  const s = new Store('00000000-0000-4000-8000-' + String(Math.floor(Math.random() * 1e12)).padStart(12, '0'));
  s.ensureDefaults();
  return s;
};

describe('utilitários', () => {
  test('calculadora dos campos numéricos', () => {
    assert.equal(calc('10+5*2'), 20);
    assert.equal(calc('(10+5)*2'), 30);
    assert.equal(calc('-4/2'), -2);
    assert.equal(calc('1.5e2'), 150);
    assert.ok(Number.isNaN(calc('alert(1)')));
    assert.ok(Number.isNaN(calc('2+')));
    assert.ok(Number.isNaN(calc('')));
    assert.ok(Number.isNaN(calc('1'.repeat(80))));
  });

  test('CSV com aspas, ponto e vírgula e BOM', () => {
    const r = parseCSV('﻿id;nome;obs\n1;"Ana; Maria";"diz ""oi"""\n2;Bruno;\n');
    assert.deepEqual(r.columns, ['id', 'nome', 'obs']);
    assert.equal(r.rows.length, 2);
    assert.equal(r.rows[0].nome, 'Ana; Maria');
    assert.equal(r.rows[0].obs, 'diz "oi"');
    assert.equal(r.rows[1].obs, '');
  });

  test('cores, nomes de arquivo e XML', () => {
    assert.equal(normHex('abc'), '#AABBCC');
    assert.equal(normHex('zz', '#000000'), '#000000');
    assert.equal(numToHex(hexToNum('#5D1C16')), '#5D1C16');
    assert.equal(safeName('Relatório <final>/2026'), 'Relatorio-final-2026');
    assert.equal(escapeXml('<a href="x">&</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
  });
});

describe('formas', () => {
  test('todas as formas geram caminhos válidos em vários tamanhos', () => {
    for (const [id, def] of Object.entries(SHAPES)) {
      for (const [w, h] of [[def.w, def.h], [1, 1], [500, 20]]) {
        const parts = def.parts(w, h, { radius: 4 });
        assert.ok(parts.length > 0, id);
        for (const p of parts) {
          const cmds = parseD(p.d);
          assert.ok(cmds.length > 0, id);
          for (const c of cmds) for (const v of c.slice(1)) assert.ok(Number.isFinite(v), `${id} ${p.d}`);
        }
      }
    }
    assert.ok(Object.keys(SHAPES).length >= 90);
  });

  test('retângulo arredondado achata dentro da caixa', () => {
    const [part] = nodeParts({ type: 'rect', w: 100, h: 50, radius: 12 });
    const [ring] = flattenD(part.d, 0.5);
    const b = aabb(ring);
    assert.ok(Math.abs(b.w - 100) < 0.01 && Math.abs(b.h - 50) < 0.01);
  });

  test('caminho da caneta com alças', () => {
    const d = pathD([{ x: 0, y: 0, ox: 10, oy: 0 }, { x: 20, y: 20, ix: 20, iy: 10 }], false);
    assert.match(d, /^M0 0C10 0 20 10 20 20$/);
  });
});

describe('geometria', () => {
  test('rotação, cantos e conversão para coordenadas locais', () => {
    const p = rotatePoint(10, 0, 0, 0, Math.PI / 2);
    assert.ok(Math.abs(p.x) < 1e-9 && Math.abs(p.y - 10) < 1e-9);
    const n = { x: 0, y: 0, w: 100, h: 50, rotation: 90 };
    const b = aabb(corners(n));
    assert.ok(Math.abs(b.w - 50) < 1e-6 && Math.abs(b.h - 100) < 1e-6);
    const l = toLocal(n, 50, 25);
    assert.ok(Math.abs(l.x - 50) < 1e-9 && Math.abs(l.y - 25) < 1e-9);
    assert.deepEqual(union([{ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: -5, w: 5, h: 5 }]), { x: 0, y: -5, w: 25, h: 15 });
  });

  test('pontos de conexão e lado mais próximo', () => {
    const n = { x: 0, y: 0, w: 100, h: 60 };
    assert.deepEqual(anchorOf(n, 'right'), { x: 100, y: 30, dir: 1 });
    assert.equal(bestSide(n, 500, 30), 'right');
    assert.equal(bestSide(n, 50, -400), 'top');
  });

  test('acerto do clique em retângulo, elipse e linha', () => {
    assert.ok(hitNode({ type: 'rect', x: 0, y: 0, w: 100, h: 100 }, 50, 50, 0));
    assert.ok(!hitNode({ type: 'ellipse', x: 0, y: 0, w: 100, h: 100 }, 2, 2, 0));
    assert.ok(hitNode({ type: 'ellipse', x: 0, y: 0, w: 100, h: 100 }, 50, 2, 0));
    assert.ok(distToPolyline([{ x: 0, y: 0 }, { x: 100, y: 0 }], 50, 3) <= 3);
    assert.ok(pointInPoly([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], 5, 5));
  });

  test('conector ortogonal entre formas sai e chega pelos lados certos', () => {
    const s = newStore();
    const page = s.pages.get(0);
    s.transact(() => {
      s.add({ id: 'a', type: 'shape', shape: 'process', page, parent: null, x: 0, y: 0, w: 100, h: 50 });
      s.add({ id: 'b', type: 'shape', shape: 'process', page, parent: null, x: 300, y: 200, w: 100, h: 50 });
    });
    const c = { type: 'connector', page, from: { node: 'a', side: 'right' }, to: { node: 'b', side: 'left' }, routing: 'elbow' };
    const r = connectorRoute(c, s);
    assert.deepEqual(r.points[0], { x: 100, y: 25 });
    assert.deepEqual(r.points[r.points.length - 1], { x: 300, y: 225 });
    for (let i = 1; i < r.points.length; i++) {
      const a = r.points[i - 1];
      const b = r.points[i];
      assert.ok(Math.abs(a.x - b.x) < 1e-6 || Math.abs(a.y - b.y) < 1e-6, 'segmentos só horizontais ou verticais');
    }
    assert.equal(connectorRoute({ ...c, routing: 'straight' }, s).points.length, 2);
    assert.equal(connectorRoute({ ...c, routing: 'curved' }, s).points.length, 25);
    assert.ok(isContainer({ type: 'frame' }) && !isContainer({ type: 'rect' }));
    s.destroy();
  });
});

describe('documento colaborativo', () => {
  test('incluir, alterar, ordenar e excluir em cascata', () => {
    const s = newStore();
    const page = s.pages.get(0);
    s.transact(() => {
      s.add({ id: 'f', type: 'frame', page, parent: null, x: 0, y: 0, w: 200, h: 200 });
      s.add({ id: 'k1', type: 'rect', page, parent: 'f', x: 0, y: 0, w: 10, h: 10 });
      s.add({ id: 'k2', type: 'rect', page, parent: 'f', x: 0, y: 0, w: 10, h: 10 });
      s.add({ id: 'out', type: 'rect', page, parent: null, x: 300, y: 0, w: 10, h: 10 });
      s.add({ id: 'c', type: 'connector', page, parent: null, from: { node: 'k1', side: 'right' }, to: { node: 'out', side: 'left' } });
    });
    assert.deepEqual(s.childrenOf('f').map((n) => n.id), ['k1', 'k2']);
    s.transact(() => s.update('k1', { z: 99 }));
    assert.deepEqual(s.childrenOf('f').map((n) => n.id), ['k2', 'k1']);
    s.transact(() => s.remove(['f']));
    assert.equal(s.get('k1'), undefined);
    assert.equal(s.get('k2'), undefined);
    assert.ok(s.get('c').from.x !== undefined && !s.get('c').from.node, 'conector solto vira ponto livre');
    s.destroy();
  });

  test('desfazer e refazer só as próprias alterações', () => {
    const s = newStore();
    const page = s.pages.get(0);
    s.transact(() => s.add({ id: 'x', type: 'rect', page, parent: null, x: 0, y: 0, w: 10, h: 10 }), LOCAL);
    s.undo.stopCapturing();
    s.transact(() => s.update('x', { x: 50 }), LOCAL);
    s.transact(() => s.update('x', { w: 999 }), 'remoto');
    s.undo.undo();
    assert.equal(s.get('x').x, 0);
    assert.equal(s.get('x').w, 999);
    s.undo.redo();
    assert.equal(s.get('x').x, 50);
    s.destroy();
  });

  test('arquivo .grafo ida e volta e recusa de arquivo inválido', () => {
    const s = newStore();
    const page = s.pages.get(0);
    s.transact(() => {
      s.add({ id: 'a', type: 'text', page, parent: null, x: 1, y: 2, w: 3, h: 4, text: 'olá' });
      s.commentsY.set('c1', { id: 'c1', page, x: 0, y: 0, body: 'oi' });
    });
    const data = JSON.parse(JSON.stringify(s.toJSON()));
    const t = newStore();
    t.loadJSON(data);
    assert.equal(t.get('a').text, 'olá');
    assert.equal(t.commentsY.get('c1').body, 'oi');
    assert.throws(() => t.loadJSON({ format: 'outro' }));
    s.destroy();
    t.destroy();
  });

  test('três réplicas convergem com edições concorrentes em ordem aleatória', () => {
    const r = rng(42);
    const reps = [newStore(), new Store('22222222-2222-4222-8222-222222222222'), new Store('33333333-3333-4333-8333-333333333333')];
    const base = Y.encodeStateAsUpdate(reps[0].doc);
    for (const x of reps.slice(1)) Y.applyUpdate(x.doc, base);
    const page = reps[0].pages.get(0);
    const queues = reps.map(() => []);
    reps.forEach((s, i) => s.doc.on('update', (u, origin) => {
      if (origin === 'net') return;
      reps.forEach((_, j) => j !== i && queues[j].push(u));
    }));
    const ids = [];
    for (let step = 0; step < 600; step++) {
      const i = Math.floor(r() * 3);
      const s = reps[i];
      const op = r();
      s.transact(() => {
        if (op < 0.35 || ids.length < 3) {
          const id = 'n' + step;
          ids.push(id);
          s.add({ id, type: 'rect', page, parent: null, x: Math.floor(r() * 1000), y: Math.floor(r() * 1000), w: 10, h: 10 });
        } else if (op < 0.85) {
          const id = ids[Math.floor(r() * ids.length)];
          if (s.get(id)) s.update(id, { x: Math.floor(r() * 1000), fill: { type: 'solid', color: '#A3B4BE', alpha: r() } });
        } else {
          const id = ids[Math.floor(r() * ids.length)];
          if (s.get(id)) s.remove([id]);
        }
      });
      if (r() < 0.3) {
        const j = Math.floor(r() * 3);
        const q = queues[j];
        q.sort(() => r() - 0.5);
        while (q.length) Y.applyUpdate(reps[j].doc, q.pop(), 'net');
      }
    }
    reps.forEach((s, j) => {
      while (queues[j].length) Y.applyUpdate(s.doc, queues[j].shift(), 'net');
    });
    const snap = (s) => JSON.stringify(Object.fromEntries([...s.nodes.entries()].sort(([a], [b]) => (a < b ? -1 : 1))));
    assert.equal(snap(reps[0]), snap(reps[1]));
    assert.equal(snap(reps[1]), snap(reps[2]));
    assert.deepEqual(reps[0].nodesY.toJSON(), reps[2].nodesY.toJSON());
    reps.forEach((s) => s.destroy());
  });

  test('escala: 20.000 objetos e consultas de filhos com índice', () => {
    const s = newStore();
    const page = s.pages.get(0);
    const t0 = performance.now();
    s.transact(() => {
      for (let f = 0; f < 200; f++) {
        s.add({ id: 'f' + f, type: 'frame', page, parent: null, x: f * 400, y: 0, w: 380, h: 380 });
        for (let k = 0; k < 99; k++) s.add({ id: `f${f}k${k}`, type: 'rect', page, parent: 'f' + f, x: f * 400 + k, y: k, w: 10, h: 10 });
      }
    });
    const tAdd = performance.now() - t0;
    const t1 = performance.now();
    let total = 0;
    for (let f = 0; f < 200; f++) total += s.childrenOf('f' + f).length;
    const tQuery = performance.now() - t1;
    assert.equal(s.nodes.size, 20000);
    assert.equal(total, 19800);
    assert.ok(tAdd < 8000, `inclusão em ${tAdd.toFixed(0)} ms`);
    assert.ok(tQuery < 500, `consultas em ${tQuery.toFixed(0)} ms`);
    const update = Y.encodeStateAsUpdate(s.doc);
    const t = new Store('11111111-1111-4111-8111-111111111111');
    const t2 = performance.now();
    Y.applyUpdate(t.doc, update);
    const tLoad = performance.now() - t2;
    assert.equal(t.nodes.size, 20000);
    assert.ok(tLoad < 8000, `carga em ${tLoad.toFixed(0)} ms`);
    console.log(`20.000 objetos: inclusão ${tAdd.toFixed(0)} ms, 200 consultas ${tQuery.toFixed(1)} ms, documento de ${(update.byteLength / 1024).toFixed(0)} KB carregado em ${tLoad.toFixed(0)} ms`);
    s.destroy();
    t.destroy();
  });
});
