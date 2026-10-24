import { build } from 'esbuild';
import { mkdir, cp, rm, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const web = path.join(root, 'web');
const dist = path.join(web, 'dist');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
const result = await build({
  entryPoints: [path.join(web, 'src', 'main.js')],
  bundle: true,
  format: 'esm',
  target: ['chrome113', 'edge113', 'firefox115', 'safari16'],
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  outfile: path.join(dist, 'app.js'),
  define: { 'process.env.NODE_ENV': '"production"', GRAFO_VERSION: JSON.stringify(pkg.version) },
  metafile: true,
  logLevel: 'warning',
});
await cp(path.join(web, 'css'), path.join(dist, 'css'), { recursive: true });
await cp(path.join(web, 'img'), path.join(dist, 'img'), { recursive: true });
await cp(path.join(web, 'assets'), path.join(dist, 'assets'), { recursive: true });
await writeFile(path.join(dist, 'index.html'), await readFile(path.join(web, 'index.html'), 'utf8'));
const bytes = Object.values(result.metafile.outputs).reduce((s, o) => s + o.bytes, 0);
console.log(`web/dist pronto (${(bytes / 1024).toFixed(0)} KB de JavaScript)`);
