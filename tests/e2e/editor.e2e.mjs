import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const port = 5199;
let server;
let browser;
let page;

const at = async (wx, wy) => {
  const ov = await page.locator('#overlay').boundingBox();
  const p = await page.evaluate(([x, y]) => window.grafo.editor.toScreen(x, y), [wx, wy]);
  return { x: ov.x + p.x, y: ov.y + p.y };
};
const vp = (fx, fy) => page.evaluate(([fx, fy]) => {
  const v = window.grafo.renderer.viewport();
  return { x: v.x + v.w * fx, y: v.y + v.h * fy };
}, [fx, fy]);
const count = (t) => page.evaluate((t) => [...window.grafo.store.nodes.values()].filter((n) => n.page === window.grafo.editor.page && (!t || n.type === t)).length, t);
const drag = async (a, b) => {
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 5 });
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.up();
};

before(async () => {
  server = spawn(process.execPath, [path.join(root, 'scripts', 'serve.mjs')], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 600));
  browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('grafo:tutorial', '"declined"');
    } catch {}
  });
  page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  await page.goto(`http://localhost:${port}/`);
  await page.waitForFunction(() => window.grafo && window.grafo.editor, null, { timeout: 30000 });
  await page.evaluate(() => {
    const g = window.grafo;
    g.editor.setPage(g.store.addPage('E2E'));
  });
});

after(async () => {
  await browser?.close();
  server?.kill();
});

test('abre com render por GPU e núcleo WASM', async () => {
  const info = await page.evaluate(() => ({ backend: window.grafo.renderer.backend, engine: window.grafo.engineMode }));
  assert.match(info.backend, /WebGL2|WebGPU/);
  assert.equal(info.engine, 'WASM');
});

test('desenha, duplica, desfaz, refaz e exclui', async () => {
  await page.keyboard.press('r');
  const a = await vp(0.4, 0.4);
  await drag(await at(a.x, a.y), await at(a.x + 150, a.y + 100));
  assert.equal(await count('rect'), 1);
  const n = await page.evaluate(() => window.grafo.store.get([...window.grafo.editor.sel][0]));
  assert.ok(Math.abs(n.w - 150) <= 2 && Math.abs(n.h - 100) <= 2);
  await page.keyboard.press('Control+d');
  assert.equal(await count('rect'), 2);
  await page.keyboard.press('Control+z');
  assert.equal(await count('rect'), 1);
  await page.keyboard.press('Control+Shift+z');
  assert.equal(await count('rect'), 2);
  await page.keyboard.press('Delete');
  assert.equal(await count('rect'), 1);
});

test('move com o mouse e liga formas com conector', async () => {
  const r = await page.evaluate(() => [...window.grafo.store.nodes.values()].find((n) => n.type === 'rect' && n.page === window.grafo.editor.page));
  const c = await at(r.x + r.w / 2, r.y + r.h / 2);
  await page.mouse.click(c.x, c.y);
  await drag(c, { x: c.x + 60, y: c.y + 40 });
  const moved = await page.evaluate((id) => window.grafo.store.get(id), r.id);
  assert.ok(moved.x > r.x + 30);
  await page.evaluate(() => {
    const g = window.grafo;
    const p = g.editor.viewportCenter();
    g.editor.insertShape('decision', p.x - 250, p.y - 200);
  });
  const d = await page.evaluate(() => window.grafo.store.get([...window.grafo.editor.sel][0]));
  await page.keyboard.press('x');
  await drag(await at(moved.x + moved.w / 2, moved.y + moved.h / 2), await at(d.x + d.w / 2, d.y + d.h / 2));
  const conn = await page.evaluate(() => [...window.grafo.store.nodes.values()].find((n) => n.type === 'connector' && n.page === window.grafo.editor.page));
  assert.ok(conn && conn.from.node === moved.id && conn.to.node === d.id);
});

test('cria texto pelo teclado', async () => {
  await page.keyboard.press('Escape');
  await page.keyboard.press('t');
  const p = await vp(0.7, 0.7);
  const s = await at(p.x, p.y);
  await page.mouse.click(s.x, s.y);
  await page.waitForSelector('.text-editor');
  await page.keyboard.type('Grafo E2E');
  await page.keyboard.press('Escape');
  const t = await page.evaluate(() => [...window.grafo.store.nodes.values()].find((n) => n.type === 'text' && n.text === 'Grafo E2E'));
  assert.ok(t && t.w > 40);
});

test('auto layout, componente e booleana', async () => {
  const r = await page.evaluate(() => {
    const g = window.grafo;
    const ed = g.editor;
    const st = g.store;
    const ids = [0, 1, 2].map((i) => ed.commit(() => st.add({ type: 'rect', page: ed.page, parent: null, x: 3000 + i * 130, y: 0, w: 100, h: 60, fill: { type: 'solid', color: '#D6BDB8', alpha: 1 } })));
    ed.select(ids);
    ed.toggleAutoLayout();
    const fr = st.get([...ed.sel][0]);
    const cid = ed.makeComponent();
    const inst = ed.insertInstance(cid, 3200, 400);
    const a = ed.commit(() => st.add({ type: 'rect', page: ed.page, parent: null, x: 5000, y: 0, w: 100, h: 100 }));
    const b = ed.commit(() => st.add({ type: 'ellipse', page: ed.page, parent: null, x: 5050, y: 50, w: 100, h: 100 }));
    ed.select([a, b]);
    ed.booleanOp('union');
    return { layout: fr.layout.mode, w: st.get(fr.id).w, comp: st.get(cid).type, inst: st.get(inst).componentId === cid, bool: st.get([...ed.sel][0]).type };
  });
  assert.deepEqual(r, { layout: 'h', w: 320, comp: 'component', inst: true, bool: 'boolean' });
});

test('ações rápidas buscam e executam comandos', async () => {
  await page.evaluate(() => window.grafo.editor.select([]));
  await page.locator('#overlay').focus();
  await page.keyboard.press('Control+k');
  await page.waitForSelector('.palette-input');
  await page.keyboard.type('retangulo');
  const first = await page.locator('.palette-item.active .palette-label').textContent();
  assert.match(first, /Retângulo/);
  await page.keyboard.type(' ferramenta');
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('.palette-back').count(), 0);
  assert.equal(await page.evaluate(() => window.grafo.editor.tool), 'rect');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+k');
  await page.keyboard.type('decisao');
  await page.keyboard.press('Enter');
  const shape = await page.evaluate(() => window.grafo.store.get([...window.grafo.editor.sel][0]));
  assert.equal(shape.type, 'shape');
  await page.keyboard.press('Control+k');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.palette-back').count(), 0);
});

test('espelha seleção, troca cores, copia propriedades e organiza em grade', async () => {
  const r = await page.evaluate(async () => {
    const g = window.grafo;
    const ed = g.editor;
    const st = g.store;
    const a = ed.commit(() => st.add({ type: 'polygon', page: ed.page, parent: null, x: 8000, y: 0, w: 100, h: 80, sides: 3, fill: { type: 'solid', color: '#5D1C16', alpha: 1 }, stroke: { color: '#A3B4BE', alpha: 1 }, strokeWidth: 3, radius: 4 }));
    const b = ed.commit(() => st.add({ type: 'rect', page: ed.page, parent: null, x: 8300, y: 0, w: 50, h: 50, fill: { type: 'solid', color: '#F6E4A6', alpha: 1 } }));
    const c = ed.commit(() => st.add(ed.newConnector({ node: a, side: 'right' }, { node: b, side: 'left' }, 'connector')));
    const d = ed.commit(() => st.add({ type: 'star', page: ed.page, parent: null, x: 8600, y: 0, w: 90, h: 90, rotation: 30, sides: 5, inner: 0.45 }));
    ed.select([a, b]);
    ed.flip('h');
    const fa = st.get(a);
    const fb = st.get(b);
    const fc = st.get(c);
    ed.select([d]);
    ed.flip('v');
    const fd = st.get(d);
    ed.select([a]);
    ed.swapFillStroke();
    const sw = st.get(a);
    ed.copyProps();
    ed.select([b]);
    ed.pasteProps();
    const pb = st.get(b);
    const items = [0, 1, 2, 3].map((i) => ed.commit(() => st.add({ type: 'rect', page: ed.page, parent: null, x: 9000 + (i % 2) * 140 + (i === 3 ? 13 : 0), y: Math.floor(i / 2) * 110 + (i === 1 ? 9 : 0), w: 100, h: 80, fill: { type: 'solid', color: '#D6BDB8', alpha: 1 } })));
    ed.select(items);
    await ed.tidy(20);
    const grid = items.map((id) => [st.get(id).x, st.get(id).y]);
    return { fa: [fa.x, fa.flipX], fd: [fd.x, fd.y, fd.rotation, fd.flipY], fb: fb.x, sides: [fc.from.side, fc.to.side], sw: [sw.fill.color, sw.stroke.color], pb: [pb.fill.color, pb.stroke && pb.stroke.color, pb.strokeWidth, pb.radius], grid };
  });
  assert.deepEqual(r.fa, [8250, true]);
  assert.deepEqual(r.fd, [8600, 0, -30, true]);
  assert.equal(r.fb, 8000);
  assert.deepEqual(r.sides, ['left', 'right']);
  assert.deepEqual(r.sw, ['#A3B4BE', '#5D1C16']);
  assert.deepEqual(r.pb, ['#A3B4BE', '#5D1C16', 3, 4]);
  assert.deepEqual(r.grid, [[9000, 0], [9120, 0], [9000, 100], [9120, 100]]);
});

test('Ctrl+D repete o deslocamento, Tab navega e a proporção fica travada', async () => {
  const r = await page.evaluate(() => {
    const g = window.grafo;
    const ed = g.editor;
    const st = g.store;
    const a = ed.commit(() => st.add({ type: 'rect', page: ed.page, parent: null, x: 12000, y: 0, w: 100, h: 50, fill: { type: 'solid', color: '#D6BDB8', alpha: 1 } }));
    ed.select([a]);
    const [b] = ed.smartDuplicate();
    ed.commit(() => ed.translate(st.get(b), 130, -20));
    const [c] = ed.smartDuplicate();
    const pos = [st.get(b).x, st.get(c).x, st.get(c).y];
    ed.select([a]);
    ed.selectSibling(1);
    const next = [...ed.sel][0];
    ed.selectSibling(-1);
    const prev = [...ed.sel][0];
    ed.setProp({ lockRatio: true }, [a]);
    return { pos, next, prev, a, b };
  });
  assert.deepEqual(r.pos, [12150, 12300, 0]);
  assert.equal(r.next, r.b);
  assert.equal(r.prev, r.a);
  await page.evaluate(() => window.grafo.ui.renderRight());
  const w = page.locator('#rightPanel input[aria-label="Largura"]');
  await w.fill('200');
  await w.press('Enter');
  const n = await page.evaluate((id) => window.grafo.store.get(id), r.a);
  assert.deepEqual([n.w, n.h], [200, 100]);
  assert.equal(await page.locator('#rightPanel .ratio-btn.active').count(), 1);
});

test('conta-gotas pega a cor do objeto e mede distâncias com Alt', async () => {
  const ids = await page.evaluate(() => {
    Object.defineProperty(window, 'EyeDropper', { value: undefined, configurable: true, writable: true });
    const g = window.grafo;
    const ed = g.editor;
    const st = g.store;
    const src = ed.commit(() => st.add({ type: 'ellipse', page: ed.page, parent: null, x: 14000, y: 0, w: 120, h: 120, fill: { type: 'solid', color: '#7A6E46', alpha: 1 } }));
    const dst = ed.commit(() => st.add({ type: 'rect', page: ed.page, parent: null, x: 14200, y: 30, w: 60, h: 60, fill: { type: 'solid', color: '#FFFFFF', alpha: 1 } }));
    ed.zoomTo({ x: 13900, y: -100, w: 500, h: 320 }, false, 1);
    ed.select([dst]);
    return { src, dst };
  });
  await page.keyboard.press('i');
  const s = await at(14060, 60);
  await page.mouse.click(s.x, s.y);
  const color = await page.evaluate((id) => window.grafo.store.get(id).fill.color, ids.dst);
  assert.equal(color, '#7A6E46');
  assert.equal(await page.evaluate(() => window.grafo.editor.tool), 'select');
  await page.keyboard.down('Alt');
  await page.mouse.move(s.x, s.y + 2);
  const gaps = await page.evaluate(() => {
    const ed = window.grafo.editor;
    return { on: ed.measuring, target: ed.measureTarget(ed.selection)?.id };
  });
  await page.keyboard.up('Alt');
  assert.equal(gaps.on, true);
  assert.equal(gaps.target, ids.src);
});

test('busca de camadas filtra pelo nome', async () => {
  await page.evaluate(() => {
    const g = window.grafo;
    const ed = g.editor;
    ed.commit(() => g.store.add({ type: 'rect', page: ed.page, parent: null, name: 'Botão Comprar', x: 16000, y: 0, w: 80, h: 40 }));
    ed.select([]);
    g.ui.leftTab = 'layers';
    g.ui.renderLeft();
  });
  const search = page.locator('.layer-search');
  await search.fill('botao comp');
  await page.waitForTimeout(100);
  const rows = await page.locator('#leftPanel .layer').allTextContents();
  assert.equal(rows.length, 1);
  assert.match(rows[0], /Botão Comprar/);
  await search.press('Escape');
  assert.ok((await page.locator('#leftPanel .layer').count()) > 1);
});

test('guias da régua, ajustar frame, renomear em lote e maiúsculas', async () => {
  await page.evaluate(() => {
    const ed = window.grafo.editor;
    ed.select([]);
    ed.zoomTo({ x: 17900, y: -100, w: 600, h: 400 }, false, 1);
  });
  const rx = await page.locator('#rulerX').boundingBox();
  const target = await at(18000, 120);
  await page.mouse.move(rx.x + 300, rx.y + 10);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 6 });
  await page.mouse.up();
  const guides = await page.evaluate(() => window.grafo.editor.pageGuides().map((g) => [g.axis, g.v]));
  assert.deepEqual(guides, [['y', 120]]);
  const r = await page.evaluate(() => {
    const g = window.grafo;
    const ed = g.editor;
    const st = g.store;
    const fr = ed.commit(() => st.add({ type: 'frame', page: ed.page, parent: null, name: 'Caixa', x: 18000, y: 0, w: 400, h: 400, fill: { type: 'solid', color: '#FFFFFF', alpha: 1 } }));
    const kids = [0, 1, 2].map((i) => ed.commit(() => st.add({ type: 'rect', page: ed.page, parent: fr, name: 'Ret', x: 18040 + i * 60, y: 50 + i * 10, w: 40, h: 40 })));
    const snap = ed.snapBox({ x: 18100, y: 117, w: 50, h: 50 }, ed.snapCandidates(new Set()));
    ed.select([fr]);
    ed.fitToContent();
    const f = st.get(fr);
    ed.select(kids);
    g.ui.renameSelection();
    const t = ed.commit(() => st.add({ type: 'text', page: ed.page, parent: null, x: 18600, y: 0, w: 10, h: 20, text: 'olá mundo', fontSize: 16, autoSize: 'width' }));
    ed.select([t]);
    ed.setProp({ textCase: 'title' });
    return { fit: [f.x, f.y, f.w, f.h], kids, snapDy: snap.dy, t };
  });
  assert.deepEqual(r.fit, [18040, 50, 160, 60]);
  assert.equal(r.snapDy, 3);
  await page.locator('.modal input').first().fill('Card $n');
  await page.getByRole('button', { name: 'Renomear' }).click();
  const names = await page.evaluate((ids) => ids.map((id) => window.grafo.store.get(id).name), r.kids);
  assert.deepEqual(names, ['Card 1', 'Card 2', 'Card 3']);
  const titled = await page.evaluate(() => [...document.querySelectorAll('#rightPanel .icon-btn.active')].map((b) => b.title));
  assert.ok(titled.includes('Primeira Letra Maiúscula'));
  await page.keyboard.press('Shift+g');
  assert.equal(await page.evaluate(() => window.grafo.editor.settings.guides), false);
  await page.keyboard.press('Shift+g');
  await page.evaluate(() => window.grafo.editor.clearGuides());
});

test('novo quadro a partir de modelo e aula com ramificações', async () => {
  const before = await page.evaluate(() => window.grafo.store.fileId);
  await page.locator('#overlay').focus();
  await page.keyboard.press('Control+Alt+n');
  await page.waitForSelector('.gallery');
  assert.equal(await page.locator('.gallery-card').count(), 4);
  await page.locator('.gallery-nav-btn[data-cat="process"]').click();
  assert.equal(await page.locator('.gallery-card').count(), 6);
  await page.locator('.gallery-search').fill('fluxograma');
  await page.locator('.gallery-card[data-id="flowchart"]').click();
  await page.waitForFunction((id) => window.grafo.store.fileId !== id && window.grafo.store.name === 'Fluxograma', before);
  const flow = await page.evaluate(() => {
    const g = window.grafo;
    const nodes = [...g.store.nodes.values()].filter((n) => n.page === g.editor.page);
    return { shapes: nodes.filter((n) => n.type === 'shape').length, conns: nodes.filter((n) => n.type === 'connector').length, undo: g.store.undo.canUndo(), buttons: document.querySelectorAll('#presentBtn .btn-label').length };
  });
  assert.equal(flow.shapes, 8);
  assert.equal(flow.conns, 8);
  assert.equal(flow.undo, false);
  assert.equal(flow.buttons, 1);
  await page.keyboard.press('Control+Alt+n');
  await page.waitForSelector('.gallery');
  await page.locator('.gallery-card[data-id="aula-down"]').click();
  await page.waitForFunction(() => window.grafo.store.name === 'Aula');
  const root = await page.evaluate(() => {
    const g = window.grafo;
    const r = [...g.store.nodes.values()].find((n) => n.page === g.editor.page && n.branch && n.text === 'Tema da aula');
    g.editor.select([r.id]);
    return r;
  });
  await page.locator('#overlay').focus();
  await page.keyboard.press('Tab');
  await page.waitForSelector('.text-editor');
  await page.keyboard.type('Quarta ideia');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  const aula = await page.evaluate((rid) => {
    const g = window.grafo;
    const ed = g.editor;
    const kids = ed.treeEdges().filter(([f]) => f === rid).map(([, t]) => g.store.get(t));
    const fresh = kids.find((k) => k.text === 'Quarta ideia');
    const r = g.store.get(rid);
    return { kids: kids.length, below: kids.every((k) => k.y > r.y + r.h), overlap: kids.some((a) => kids.some((b) => a !== b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h)), fresh: !!fresh };
  }, root.id);
  assert.deepEqual(aula, { kids: 4, below: true, overlap: false, fresh: true });
  await page.keyboard.press('Enter');
  await page.waitForSelector('.text-editor');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate((rid) => window.grafo.editor.treeEdges().filter(([f]) => f === rid).length, root.id), 5);
  await page.evaluate(() => window.grafo.openTemplate('pattern-observer', true));
  await page.waitForFunction(() => window.grafo.store.name === 'Aula · Observer');
  await page.evaluate(() => {
    const g = window.grafo;
    const ed = g.editor;
    ed.setPage(g.store.addPage('E2E'));
    const fr = ed.commit(() => g.store.add({ type: 'frame', page: ed.page, parent: null, name: 'Tela', x: 0, y: 0, w: 390, h: 300, fill: { type: 'solid', color: '#FFFFFF', alpha: 1 }, clip: true }));
    ed.commit(() => g.store.add({ type: 'rect', page: ed.page, parent: fr, x: 20, y: 20, w: 120, h: 80, fill: { type: 'solid', color: '#D6BDB8', alpha: 1 } }));
  });
});

test('exporta SVG e PDF válidos', async () => {
  const dl = page.waitForEvent('download');
  await page.evaluate(() => window.grafo.ui.exportDialog(true));
  await page.locator('.modal select').nth(1).selectOption('svg');
  await page.locator('.modal footer .btn.primary').click();
  const svg = await (await dl).path();
  const { readFileSync } = await import('node:fs');
  assert.match(readFileSync(svg, 'utf8'), /^<svg[\s\S]*<\/svg>$/);
  const dl2 = page.waitForEvent('download');
  await page.evaluate(() => window.grafo.ui.exportDialog(true));
  await page.locator('.modal select').nth(1).selectOption('pdf');
  await page.locator('.modal footer .btn.primary').click();
  const pdf = readFileSync(await (await dl2).path());
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
});

test('duas abas do mesmo arquivo colaboram', async () => {
  const other = await page.context().newPage();
  await other.goto(page.url());
  await other.waitForFunction(() => window.grafo && window.grafo.editor, null, { timeout: 30000 });
  await page.evaluate(() => {
    const g = window.grafo;
    g.editor.commit(() => g.store.add({ id: 'e2e-sync', type: 'rect', page: g.editor.page, parent: null, x: 0, y: -500, w: 40, h: 40 }));
  });
  await other.waitForFunction(() => !!window.grafo.store.get('e2e-sync'), null, { timeout: 5000 });
  await other.close();
});

test('aguenta 3.000 objetos na página', async () => {
  const r = await page.evaluate(async () => {
    const g = window.grafo;
    const pid = g.store.addPage('Carga');
    g.editor.setPage(pid);
    const t0 = performance.now();
    g.store.transact(() => {
      for (let i = 0; i < 3000; i++) g.store.add({ type: 'rect', page: pid, parent: null, x: (i % 60) * 30, y: Math.floor(i / 60) * 30, w: 24, h: 24, fill: { type: 'solid', color: '#A3B4BE', alpha: 1 } });
    });
    const add = performance.now() - t0;
    g.editor.zoomToFit(false);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const t1 = performance.now();
    for (let i = 0; i < 20; i++) {
      g.editor.camX += 5;
      g.renderer.setView(g.editor.camX, g.editor.camY, g.editor.zoom);
      g.renderer.render(pid);
      g.editor.drawOverlay();
    }
    return { add, frameCpu: (performance.now() - t1) / 20 };
  });
  assert.ok(r.add < 3000, `inclusão: ${r.add} ms`);
  assert.ok(r.frameCpu < 50, `quadro: ${r.frameCpu} ms`);
});

test('abre com dois cliques pelo index.html e pelo web/index.html', async () => {
  for (const file of ['index.html', path.join('web', 'index.html'), 'Grafo.html']) {
    const p = await page.context().newPage();
    const errors = [];
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(pathToFileURL(path.join(root, file)).href);
    await p.waitForFunction(() => window.grafo && window.grafo.editor, null, { timeout: 30000 });
    const info = await p.evaluate(() => ({ url: location.pathname, engine: window.grafo.engineMode, mode: window.grafo.store.mode }));
    assert.match(info.url, /Grafo\.html$/);
    assert.equal(info.engine, 'WASM');
    assert.equal(info.mode, 'local');
    assert.deepEqual(errors, []);
    await p.close();
  }
});

test('tutorial da primeira abertura: aceitar, avançar, pular e reabrir', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(`http://localhost:${port}/`);
  await p.waitForSelector('.tour-welcome', { timeout: 30000 });
  assert.match(await p.locator('.tour-card h2').textContent(), /Bem-vindo ao Grafo/);
  await p.getByRole('button', { name: 'Ver tutorial' }).click();
  assert.match(await p.locator('.tour-step').textContent(), /^1 de \d+$/);
  assert.ok((await p.locator('.tour-ring').count()) >= 1);
  await p.getByRole('button', { name: 'Próximo' }).click();
  assert.match(await p.locator('.tour-step').textContent(), /^2 de/);
  await p.keyboard.press('ArrowRight');
  assert.match(await p.locator('.tour-step').textContent(), /^3 de/);
  await p.getByRole('button', { name: 'Pular tutorial' }).click();
  assert.equal(await p.locator('.tour').count(), 0);
  assert.equal(await p.evaluate(() => localStorage.getItem('grafo:tutorial')), '"declined"');
  await p.reload();
  await p.waitForFunction(() => window.grafo && window.grafo.editor);
  await p.waitForTimeout(800);
  assert.equal(await p.locator('.tour').count(), 0);
  await p.getByRole('button', { name: 'Ajuda' }).click();
  await p.getByRole('menuitem', { name: /Tutorial rápido/ }).click();
  await p.waitForSelector('.tour-card .tour-step');
  for (let i = 0; i < 12 && (await p.locator('.tour').count()); i++) {
    const next = p.getByRole('button', { name: /Próximo|Começar a criar/ });
    await next.click();
  }
  assert.equal(await p.locator('.tour').count(), 0);
  assert.equal(await p.evaluate(() => localStorage.getItem('grafo:tutorial')), '"finished"');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('ponte do app desktop: salvar pela janela do Windows e F11', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('grafo:tutorial', '"declined"');
    } catch {}
    window.__calls = [];
    window.grafoDesktop = Object.freeze({
      version: '0.0.0',
      toggleFullscreen: () => window.__calls.push(['fullscreen']),
      quit: () => window.__calls.push(['quit']),
      saveDialog: async (o) => {
        window.__calls.push(['dialog', o]);
        return 'C:\\Temp\\' + o.name;
      },
      writeFile: async (path, data) => {
        window.__calls.push(['write', path, data.length]);
      },
    });
  });
  const p = await ctx.newPage();
  await p.goto(pathToFileURL(path.join(root, 'Grafo.html')).href);
  await p.waitForFunction(() => window.grafo && window.grafo.editor, null, { timeout: 30000 });
  await p.keyboard.press('Control+s');
  await p.waitForFunction(() => window.__calls.some((c) => c[0] === 'write'));
  await p.keyboard.press('F11');
  const calls = await p.evaluate(() => window.__calls);
  const dialog = calls.find((c) => c[0] === 'dialog')[1];
  assert.equal(dialog.extension, 'grafo');
  assert.equal(dialog.description, 'Projeto do Grafo');
  assert.ok(calls.find((c) => c[0] === 'write')[2] > 100);
  assert.ok(calls.some((c) => c[0] === 'fullscreen'));
  assert.match(await p.locator('#statusbar').textContent(), /App desktop/);
  assert.equal(typeof (await p.evaluate(() => typeof window.__grafoBeforeClose)), 'string');
  await ctx.close();
});

test('diagrama a partir de texto, volta como Mermaid e conecta em sequência', async () => {
  await page.evaluate(() => {
    const g = window.grafo;
    g.editor.setPage(g.store.addPage('Texto'));
  });
  await page.locator('#overlay').focus();
  await page.keyboard.press('Control+Alt+KeyM');
  await page.waitForSelector('.text-diagram');
  await page.locator('.text-diagram textarea').fill('flowchart LR\n  A[Um] --> B{Dois}\n  B -- sim --> C([Três])\n  B -.->|não| A');
  assert.match(await page.locator('.text-diagram-info').textContent(), /3 formas · 3 conectores/);
  await page.locator('.modal footer .btn.primary').click();
  const d = await page.evaluate(() => {
    const g = window.grafo;
    const nodes = g.editor.pageNodes();
    const shapes = nodes.filter((n) => n.type === 'shape');
    const by = Object.fromEntries(shapes.map((n) => [n.text, n]));
    const conns = nodes.filter((n) => n.type === 'connector');
    return { shapes: shapes.length, conns: conns.length, kinds: [by['Um'].shape, by['Dois'].shape, by['Três'].shape], lr: by['Um'].x < by['Dois'].x && by['Dois'].x < by['Três'].x, label: conns.some((c) => c.text === 'sim'), dotted: conns.some((c) => Array.isArray(c.dash)), mermaid: g.editor.mermaidFor([]) };
  });
  assert.equal(d.shapes, 3);
  assert.equal(d.conns, 3);
  assert.deepEqual(d.kinds, ['process', 'decision', 'terminator']);
  assert.ok(d.lr);
  assert.ok(d.label && d.dotted);
  assert.match(d.mermaid, /^flowchart LR/);
  assert.match(d.mermaid, /-->\|sim\|/);
  assert.match(d.mermaid, /-\.->/);
  await page.keyboard.press('Control+Alt+KeyM');
  await page.waitForSelector('.text-diagram');
  await page.locator('.text-diagram textarea').fill('Raiz\n  Ramo A\n    Folha\n  Ramo B');
  await page.locator('.modal footer .btn.primary').click();
  const tree = await page.evaluate(() => window.grafo.editor.selection.length);
  assert.equal(tree, 4);
  const seq = await page.evaluate(() => {
    const g = window.grafo;
    const ed = g.editor;
    const ids = [0, 1, 2].map((i) => ed.commit(() => g.store.add({ type: 'shape', shape: 'process', page: ed.page, parent: null, x: 4000 + i * 220, y: 3000, w: 140, h: 70, text: 'P' + i })));
    ed.select([ids[2], ids[0], ids[1]]);
    return ids;
  });
  await page.locator('#overlay').focus();
  await page.keyboard.press('Control+Alt+KeyX');
  const links = await page.evaluate((ids) => window.grafo.editor.pageNodes().filter((c) => c.type === 'connector' && ids.includes(c.from?.node)).map((c) => [ids.indexOf(c.from.node), ids.indexOf(c.to.node)]), seq);
  assert.deepEqual(links.sort(), [[0, 1], [1, 2]]);
  await page.keyboard.press('Control+Alt+KeyX');
  assert.equal(await page.evaluate((ids) => window.grafo.editor.pageNodes().filter((c) => c.type === 'connector' && ids.includes(c.from?.node)).length, seq), 2);
});

test('localizar e substituir entre páginas, com desfazer', async () => {
  const pages = await page.evaluate(() => {
    const g = window.grafo;
    const st = g.store;
    const p1 = st.addPage('Busca 1');
    const p2 = st.addPage('Busca 2');
    st.transact(() => {
      st.add({ type: 'text', page: p1, parent: null, x: 0, y: 0, w: 100, h: 20, text: 'Cliente novo', fontSize: 16 });
      st.add({ type: 'shape', shape: 'process', page: p2, parent: null, x: 0, y: 0, w: 140, h: 70, text: 'Avisar cliente' });
      st.add({ type: 'shape', shape: 'process', page: p2, parent: null, x: 0, y: 200, w: 140, h: 70, text: 'clientela', locked: true });
    });
    g.editor.setPage(p1);
    return [p1, p2];
  });
  await page.locator('#overlay').focus();
  await page.keyboard.press('Control+KeyF');
  await page.waitForSelector('.find-panel');
  await page.locator('.find-query').fill('cliente');
  assert.match(await page.locator('.find-count').textContent(), /de 3/);
  await page.locator('.find-opt[aria-label="Só palavras inteiras"]').click();
  assert.match(await page.locator('.find-count').textContent(), /de 2/);
  await page.locator('.find-query').press('Enter');
  await page.locator('.find-query').press('Enter');
  const jumped = await page.evaluate(() => ({ page: window.grafo.editor.page, sel: window.grafo.editor.selection.map((n) => n.text) }));
  assert.equal(jumped.page, pages[1]);
  assert.deepEqual(jumped.sel, ['Avisar cliente']);
  await page.keyboard.press('Control+KeyH');
  await page.locator('.find-replace').fill('Freguês');
  await page.locator('.find-replace').press('Control+Enter');
  const texts = await page.evaluate(() => [...window.grafo.store.nodes.values()].filter((n) => /Freguês|clientela/.test(n.text || '')).map((n) => n.text).sort());
  assert.deepEqual(texts, ['Avisar Freguês', 'Freguês novo', 'clientela']);
  await page.locator('.find-replace').press('Escape');
  assert.equal(await page.locator('.find-panel').count(), 0);
  await page.locator('#overlay').focus();
  await page.keyboard.press('Control+z');
  const undone = await page.evaluate(() => [...window.grafo.store.nodes.values()].some((n) => n.text === 'Avisar cliente') && [...window.grafo.store.nodes.values()].some((n) => n.text === 'Cliente novo'));
  assert.ok(undone);
});

test('cada comando vira um passo próprio de desfazer, mesmo logo após outra alteração', async () => {
  const texts = await page.evaluate(() => {
    const g = window.grafo;
    const st = g.store;
    const ed = g.editor;
    const p = st.addPage('Desfazer');
    let id;
    st.transact(() => {
      id = st.add({ type: 'shape', shape: 'process', page: p, parent: null, x: 0, y: 0, w: 140, h: 70, text: 'Avisar cliente' });
    });
    ed.setPage(p);
    ed.replaceText([id], 'cliente', 'Freguês', {});
    const replaced = st.get(id)?.text;
    st.undo.undo();
    return [replaced, st.get(id)?.text];
  });
  assert.deepEqual(texts, ['Avisar Freguês', 'Avisar cliente']);
});

test('tabela, grade de encaixe, espaço entre itens e página vazia', async () => {
  await page.evaluate(() => {
    const g = window.grafo;
    g.editor.setPage(g.store.addPage('Tabela'));
  });
  await page.waitForSelector('.empty-hint.show');
  await page.locator('#overlay').focus();
  await page.keyboard.press('r');
  await page.waitForSelector('.empty-hint:not(.show)', { state: 'attached' });
  await page.keyboard.press('Escape');
  await page.waitForSelector('.empty-hint.show');
  await page.keyboard.press('Shift+T');
  await page.waitForSelector('.modal');
  await page.locator('.modal input[aria-label="Número de colunas"]').focus();
  await page.waitForTimeout(120);
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Número de colunas');
  const rows = page.locator('.modal input[aria-label="Número de linhas"]');
  await rows.fill('3');
  await rows.press('Enter');
  const cols = page.locator('.modal input[aria-label="Número de colunas"]');
  await cols.fill('2');
  await cols.press('Enter');
  await page.locator('.modal footer .btn.primary').click();
  const table = await page.evaluate(() => {
    const g = window.grafo;
    const t = g.editor.selection[0];
    const kids = g.store.childrenOf(t.id);
    return { type: t.type, cells: kids.length, head: kids.filter((k) => k.fontWeight === 600).length, w: t.w, h: t.h };
  });
  assert.deepEqual(table, { type: 'frame', cells: 6, head: 2, w: 280, h: 120 });
  await page.waitForFunction(() => !document.querySelector('.empty-hint.show'));
  await page.locator('#overlay').focus();
  await page.keyboard.press("Control+Shift+'");
  assert.equal(await page.evaluate(() => window.grafo.editor.settings.snapGrid), true);
  await page.evaluate(() => {
    window.grafo.editor.settings.gridSize = 10;
    window.grafo.editor.saveSettings();
  });
  const a = await vp(0.3, 0.75);
  await page.keyboard.press('r');
  await drag(await at(a.x + 3.3, a.y + 6.6), await at(a.x + 97.7, a.y + 61.2));
  const box = await page.evaluate(() => {
    const n = window.grafo.editor.selection[0];
    return [n.x, n.y, n.w, n.h];
  });
  assert.ok(box.every((v) => Math.abs(v % 10) < 1e-6), JSON.stringify(box));
  await page.keyboard.press('Shift+ArrowRight');
  const moved = await page.evaluate(() => window.grafo.editor.selection[0].x);
  assert.equal(moved, box[0] + 10);
  await page.keyboard.press("Control+Shift+'");
  const gap = await page.evaluate(() => {
    const g = window.grafo;
    const ed = g.editor;
    const ids = [0, 1, 2].map((i) => ed.commit(() => g.store.add({ type: 'rect', page: ed.page, parent: null, x: 9000 + i * 130 + i * i * 7, y: 9000, w: 100, h: 60 })));
    ed.select(ids);
    return ids;
  });
  const gapInput = page.locator('input[aria-label="Espaço horizontal igual entre os itens"]');
  await gapInput.fill('24');
  await gapInput.press('Enter');
  const xs = await page.evaluate((ids) => ids.map((id) => window.grafo.store.get(id).x), gap);
  assert.deepEqual(xs, [9000, 9124, 9248]);
  await page.locator('.quick-style[aria-label="Estilo Vinho"]').click();
  const styled = await page.evaluate((ids) => ids.map((id) => {
    const n = window.grafo.store.get(id);
    return [n.fill.color, n.stroke.color, n.textColor];
  }), gap);
  assert.deepEqual(styled[2], ['#5D1C16', '#3E120E', '#FAF3E6']);
  await page.waitForSelector('.quick-style[aria-label="Estilo Vinho"][aria-pressed="true"]');
  assert.match(await page.locator('.statusbar .save-state').textContent(), /Salv/);
});

test('área de IA: chave no navegador, diagrama UML pelo provedor, desfazer, erros e modelo local', async () => {
  const spec = {
    title: 'Sistema bancário',
    nodes: [
      { id: 'cliente', shape: 'umlClass', name: 'Cliente', attributes: ['- nome: String'], methods: ['+ abrirConta(): Conta'] },
      { id: 'conta', shape: 'umlClass', name: 'Conta', stereotype: 'abstract', attributes: ['- saldo: Decimal'] },
      { id: 'cc', shape: 'umlClass', name: 'ContaCorrente', attributes: ['- limite: Decimal'] },
      { id: 'tx', shape: 'umlClass', name: 'Transacao', attributes: ['- valor: Decimal'] },
    ],
    edges: [
      { from: 'cc', to: 'conta', type: 'inheritance' },
      { from: 'cliente', to: 'conta', type: 'association', fromLabel: '1', toLabel: '1..*' },
      { from: 'conta', to: 'tx', type: 'composition' },
    ],
  };
  const calls = [];
  let status = 200;
  await page.route('https://api.anthropic.com/v1/messages', async (route) => {
    calls.push({ headers: route.request().headers(), body: JSON.parse(route.request().postData()) });
    await route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(status === 200 ? { content: [{ type: 'tool_use', name: 'criar_diagrama', input: spec }] } : { error: { message: 'invalid x-api-key' } }) });
  });
  await page.evaluate(() => {
    const g = window.grafo;
    g.editor.setPage(g.store.addPage('IA'));
  });
  await page.locator('#overlay').focus();
  await page.keyboard.press('Control+Alt+KeyI');
  await page.waitForSelector('.ai-prompt');
  await page.locator('.ai-prompt').fill('Diagrama de classes UML de um sistema bancário');
  await page.locator('.ai-go').click();
  assert.match(await page.locator('.ai-error').textContent(), /chave/);
  await page.locator('input[aria-label="Chave de API"]').fill('sk-teste-e2e');
  await page.locator('#leftPanel .btn.small.primary', { hasText: 'Salvar' }).click();
  await page.waitForSelector('.ai-dot.on');
  await page.locator('.ai-go').click();
  await page.waitForSelector('.ai-result');
  const made = await page.evaluate(() => {
    const nodes = window.grafo.editor.pageNodes();
    return { classes: nodes.filter((n) => n.shape === 'umlClass').map((n) => n.name).sort(), conns: nodes.filter((n) => n.type === 'connector').length, session: sessionStorage.getItem('grafo:aiKey:anthropic'), local: localStorage.getItem('grafo:aiKey:anthropic'), sel: window.grafo.editor.sel.size };
  });
  assert.deepEqual(made.classes, ['Cliente', 'Conta', 'ContaCorrente', 'Transacao']);
  assert.equal(made.conns, 3);
  assert.equal(made.sel, 4);
  assert.equal(made.session, 'sk-teste-e2e');
  assert.equal(made.local, null);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].headers['x-api-key'], 'sk-teste-e2e');
  assert.equal(calls[0].headers['anthropic-dangerous-direct-browser-access'], 'true');
  assert.equal(calls[0].body.tool_choice.name, 'criar_diagrama');
  assert.equal(calls[0].body.messages[0].content, 'Diagrama de classes UML de um sistema bancário');
  assert.match(await page.locator('.ai-history').first().textContent(), /sistema bancário/);
  await page.locator('.ai-result .btn', { hasText: 'Desfazer' }).click();
  assert.equal(await page.evaluate(() => window.grafo.editor.pageNodes().length), 0);
  status = 401;
  await page.locator('.ai-go').click();
  await page.waitForSelector('.ai-error');
  assert.match(await page.locator('.ai-error').textContent(), /recusou a chave/);
  assert.equal(await page.evaluate(() => window.grafo.editor.pageNodes().length), 0);
  await page.unroute('https://api.anthropic.com/v1/messages');
  let local = null;
  await page.route('http://localhost:11434/v1/chat/completions', async (route) => {
    local = JSON.parse(route.request().postData());
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ choices: [{ message: { content: 'Segue: ' + JSON.stringify({ title: 'Login', layout: 'manual', nodes: [{ id: 'tela', shape: 'uiPhone', x: 0, y: 0, w: 390, h: 844 }, { id: 'ok', shape: 'uiButton', text: 'Entrar', x: 40, y: 700, w: 310, h: 48 }], edges: [] }) } }] }) });
  });
  await page.locator('#leftPanel select[aria-label="aiprov"]').selectOption('ollama');
  await page.locator('#leftPanel .btn.small.primary', { hasText: 'Salvar' }).click();
  await page.locator('.ai-prompt').fill('Tela de login de um app');
  await page.locator('.ai-go').click();
  await page.waitForSelector('.ai-result');
  await page.unroute('http://localhost:11434/v1/chat/completions');
  assert.equal(local.response_format.type, 'json_object');
  assert.equal(local.model, 'llama3.1');
  const screen = await page.evaluate(() => {
    const nodes = window.grafo.editor.pageNodes();
    const phone = nodes.find((n) => n.shape === 'uiPhone');
    const btn = nodes.find((n) => n.shape === 'uiButton');
    return { parent: btn.parent === phone.id, dx: btn.x - phone.x, dy: btn.y - phone.y };
  });
  assert.deepEqual(screen, { parent: true, dx: 40, dy: 700 });
  await page.evaluate(() => {
    sessionStorage.clear();
    localStorage.removeItem('grafo:aiSettings');
  });
});

test('Tab não cobre o canvas com a camada de acessibilidade do PixiJS', async () => {
  await page.locator('#overlay').focus();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Tab');
  const box = await page.locator('#overlay').boundingBox();
  const top = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.id, [box.x + box.width / 2, box.y + box.height / 2]);
  assert.equal(top, 'overlay');
});

test('sem erros de JavaScript', () => {
  assert.deepEqual(page.errors, []);
});
