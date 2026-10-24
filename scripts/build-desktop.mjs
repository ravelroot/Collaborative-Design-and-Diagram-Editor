import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DESKTOP = join(ROOT, 'desktop');
const EXE = join(ROOT, 'Grafo.exe');
const GO_TOOLCHAIN = 'go1.24.7';
const GOVERSIONINFO = 'github.com/josephspurrier/goversioninfo/cmd/goversioninfo@v1.5.0';
const GRID = 25;

async function logoPixels() {
  const svg = await readFile(join(ROOT, 'docs/images/logo.svg'), 'utf8');
  if (!svg.includes(`viewBox="0 0 ${GRID} ${GRID}"`)) throw new Error('docs/images/logo.svg mudou: a grade não é mais 25×25.');
  const path = svg.match(/<path[^>]*\sd="([^"]+)"/);
  if (!path) throw new Error('docs/images/logo.svg mudou: o desenho do logo não foi encontrado.');
  const pixels = [];
  for (const [, x, y, width] of path[1].matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
    for (let i = 0; i < Number(width); i++) pixels.push([Number(x) + i, Number(y)]);
  }
  const xs = pixels.map(([x]) => x);
  const ys = pixels.map(([, y]) => y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { pixels: pixels.map(([x, y]) => [x - minX, y - minY]), width: Math.max(...xs) - minX + 1, height: Math.max(...ys) - minY + 1 };
}

function draw(logo, side) {
  const scale = Math.max(1, Math.round(side / 24));
  const x0 = Math.floor((side - logo.width * scale) / 2);
  const y0 = Math.floor((side - logo.height * scale) / 2);
  const rgba = Buffer.alloc(side * side * 4, 0xff);
  for (const [px, py] of logo.pixels) {
    for (let dy = 0; dy < scale; dy++) {
      for (let dx = 0; dx < scale; dx++) {
        const i = ((y0 + py * scale + dy) * side + x0 + px * scale + dx) * 4;
        rgba[i] = rgba[i + 1] = rgba[i + 2] = 0;
      }
    }
  }
  return rgba;
}

function iconBmp(rgba, side) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(side, 4);
  header.writeInt32LE(side * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  const colors = Buffer.alloc(side * side * 4);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const from = (y * side + x) * 4;
      const to = ((side - 1 - y) * side + x) * 4;
      colors[to] = rgba[from + 2];
      colors[to + 1] = rgba[from + 1];
      colors[to + 2] = rgba[from];
      colors[to + 3] = rgba[from + 3];
    }
  }
  const mask = Buffer.alloc(Math.ceil(side / 32) * 4 * side);
  return Buffer.concat([header, colors, mask]);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(data) {
  let c = 0xffffffff;
  for (const b of data) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngBlock(type, data) {
  const size = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([size, body, crc]);
}

function zlibStored(data) {
  const parts = [Buffer.from([0x78, 0x01])];
  for (let i = 0; i < data.length || i === 0; i += 0xffff) {
    const chunk = data.subarray(i, i + 0xffff);
    const header = Buffer.alloc(5);
    header[0] = i + 0xffff >= data.length ? 1 : 0;
    header.writeUInt16LE(chunk.length, 1);
    header.writeUInt16LE(~chunk.length & 0xffff, 3);
    parts.push(header, chunk);
  }
  let a = 1;
  let b = 0;
  for (const byte of data) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  const adler = Buffer.alloc(4);
  adler.writeUInt32BE(((b << 16) | a) >>> 0);
  parts.push(adler);
  return Buffer.concat(parts);
}

function iconPng(rgba, side) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(side, 0);
  ihdr.writeUInt32BE(side, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const lines = Buffer.alloc((side * 4 + 1) * side);
  for (let y = 0; y < side; y++) rgba.copy(lines, y * (side * 4 + 1) + 1, y * side * 4, (y + 1) * side * 4);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngBlock('IHDR', ihdr), pngBlock('IDAT', zlibStored(lines)), pngBlock('IEND', Buffer.alloc(0))]);
}

async function generateIcon() {
  const logo = await logoPixels();
  const sides = [16, 20, 24, 30, 32, 36, 40, 48, 60, 64, 72, 96, 128, 256];
  const images = sides.map((side) => {
    const rgba = draw(logo, side);
    return side === 256 ? iconPng(rgba, side) : iconBmp(rgba, side);
  });
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sides.length, 4);
  let offset = 6 + 16 * sides.length;
  const entries = sides.map((side, i) => {
    const e = Buffer.alloc(16);
    e[0] = side === 256 ? 0 : side;
    e[1] = side === 256 ? 0 : side;
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(images[i].length, 8);
    e.writeUInt32LE(offset, 12);
    offset += images[i].length;
    return e;
  });
  return Buffer.concat([header, ...entries, ...images]);
}

function go(args, extraEnv = {}) {
  return execFileSync('go', args, {
    cwd: DESKTOP,
    stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, GOTOOLCHAIN: GO_TOOLCHAIN, GOFLAGS: '-mod=readonly', ...extraEnv },
  });
}

function versionInfo(version) {
  const [major, minor, patch] = version.split('.').map(Number);
  const number = { Major: major, Minor: minor, Patch: patch, Build: 0 };
  return {
    FixedFileInfo: { FileVersion: number, ProductVersion: number, FileFlagsMask: '3f', FileFlags: '00', FileOS: '040004', FileType: '01', FileSubType: '00' },
    StringFileInfo: {
      Comments: 'Editor colaborativo de design de interfaces e diagramas. Abre maximizado; F11 alterna a tela cheia.',
      CompanyName: 'Erik Pimenta',
      FileDescription: 'Grafo, editor de design e diagramas',
      FileVersion: version,
      InternalName: 'Grafo',
      LegalCopyright: 'Copyright (©) 2026 Erik Pimenta. Todos os direitos reservados.',
      OriginalFilename: 'Grafo.exe',
      ProductName: 'Grafo',
      ProductVersion: version,
    },
    VarFileInfo: { Translation: { LangID: '0416', CharsetID: '04B0' } },
    IconPath: 'grafo.ico',
    ManifestPath: 'grafo.manifest',
  };
}

async function build(dest, version, html) {
  await writeFile(join(DESKTOP, 'page_windows.go'), `package main\n\nvar page = []byte(${JSON.stringify(html).replace(/\uFEFF/g, '\\ufeff')})\n`, 'utf8');
  await writeFile(join(DESKTOP, 'grafo.ico'), await generateIcon());
  await writeFile(join(DESKTOP, 'versioninfo.json'), JSON.stringify(versionInfo(version), null, 2) + '\n');
  const tool = process.env.GRAFO_GOVERSIONINFO;
  const resourceArgs = ['-64', '-o', 'resource_windows_amd64.syso', 'versioninfo.json'];
  if (tool) execFileSync(tool, resourceArgs, { cwd: DESKTOP, stdio: ['ignore', 'inherit', 'inherit'] });
  else go(['run', GOVERSIONINFO, ...resourceArgs]);
  go(['build', '-trimpath', '-buildvcs=false', '-ldflags', `-s -w -buildid= -H=windowsgui -X main.version=${version}`, '-o', dest, '.'], { GOOS: 'windows', GOARCH: 'amd64', GOAMD64: 'v1', CGO_ENABLED: '0' });
}

const sha256 = (data) => createHash('sha256').update(data).digest('hex');

async function main() {
  const check = process.argv.includes('--check');
  const version = (await readFile(join(ROOT, 'VERSION'), 'utf8')).trim();
  const html = (await readFile(join(ROOT, 'Grafo.html'), 'utf8')).replace(/\r\n?/g, '\n');
  if (!check) {
    await build(EXE, version, html);
    const exe = await readFile(EXE);
    console.log(`Grafo.exe ${version} pronto (${(exe.length / 1024 / 1024).toFixed(1)} MB, sha256 ${sha256(exe).slice(0, 16)}…)`);
    return;
  }
  const folder = await mkdtemp(join(tmpdir(), 'grafo-'));
  try {
    const fresh = join(folder, 'Grafo.exe');
    await build(fresh, version, html);
    const [a, b] = await Promise.all([readFile(EXE).catch(() => Buffer.alloc(0)), readFile(fresh)]);
    if (sha256(a) !== sha256(b)) throw new Error('Grafo.exe está desatualizado: rode npm run desktop');
    console.log(`Grafo.exe em dia (sha256 ${sha256(b).slice(0, 16)}…)`);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
