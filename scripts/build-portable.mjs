import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'web', 'dist');
const check = process.argv.includes('--check');

const html = await readFile(path.join(dist, 'index.html'), 'utf8');
const css = await readFile(path.join(dist, 'css', 'grafo.css'), 'utf8');
const js = (await readFile(path.join(dist, 'app.js'), 'utf8')).replace(/<\/script/gi, '<\\/script');
const wasm = await readFile(path.join(dist, 'assets', 'engine.wasm'));
const favicon = await readFile(path.join(dist, 'img', 'favicon.svg'), 'utf8');
const boot = `window.GRAFO_ENGINE_WASM=${JSON.stringify('data:application/wasm;base64,' + wasm.toString('base64'))};`;
const sha = (s) => `'sha256-${createHash('sha256').update(s, 'utf8').digest('base64')}'`;
const csp = `default-src 'none'; script-src ${sha(boot)} ${sha(js)} 'wasm-unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; worker-src blob:; base-uri 'none'; form-action 'none'; object-src 'none'`;
let out = html
  .replace('<meta charset="utf-8">', `<meta charset="utf-8">\n  <meta http-equiv="Content-Security-Policy" content="${csp}">`)
  .replace(/<link rel="icon"[^>]*>/, `<link rel="icon" href="data:image/svg+xml;base64,${Buffer.from(favicon).toString('base64')}" type="image/svg+xml">`)
  .replace(/<link rel="apple-touch-icon"[^>]*>\n?\s*/, '')
  .replace('<link rel="stylesheet" href="css/grafo.css">', () => `<style>${css}</style>`)
  .replace('<script type="module" src="app.js"></script>', () => `<script>${boot}</script>\n  <script type="module">${js}</script>`);
const target = path.join(root, 'Grafo.html');
if (check) {
  const cur = await readFile(target, 'utf8').catch(() => '');
  if (cur !== out) {
    console.error('Grafo.html está desatualizado: rode npm run portable');
    process.exit(1);
  }
  console.log('Grafo.html em dia');
} else {
  await writeFile(target, out);
  console.log(`Grafo.html pronto (${(out.length / 1024 / 1024).toFixed(2)} MB)`);
}
