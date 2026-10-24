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
  browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
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

test('sem erros de JavaScript', () => {
  assert.deepEqual(page.errors, []);
});
