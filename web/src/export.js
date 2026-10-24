import { nodeParts, flattenD, shapeDef } from './shapes.js';
import { connectorRoute, layoutText, hasText, isContainer, outlineOf, nodeBounds, union, polylineMid, FONT_STACKS } from './geom.js';
import { capGeometry } from './render.js';
import { escapeXml, download, safeName, uid } from './util.js';
import { Engine } from './engine/index.js';

const num = (v) => Math.round(v * 100) / 100;

export class SvgWriter {
  constructor(store) {
    this.store = store;
    this.defs = [];
    this.n = 0;
  }

  id(prefix) {
    return `${prefix}${++this.n}`;
  }

  paint(fill, w, h) {
    if (!fill) return { fill: 'none' };
    if (fill.type === 'linear' && fill.stops) {
      const id = this.id('g');
      const a = (((fill.angle ?? 90) - 90) * Math.PI) / 180;
      const x1 = 0.5 - Math.cos(a) / 2;
      const y1 = 0.5 - Math.sin(a) / 2;
      this.defs.push(`<linearGradient id="${id}" x1="${num(x1)}" y1="${num(y1)}" x2="${num(1 - x1)}" y2="${num(1 - y1)}">${fill.stops.map((s) => `<stop offset="${num(s.o)}" stop-color="${s.color}"/>`).join('')}</linearGradient>`);
      return { fill: `url(#${id})`, opacity: fill.alpha ?? 1 };
    }
    if (fill.type === 'image') return { fill: 'none' };
    return { fill: fill.color, opacity: fill.alpha ?? 1 };
  }

  effects(n) {
    const fx = (n.effects || []).filter((e) => e.visible !== false);
    if (!fx.length) return '';
    const id = this.id('f');
    let body = '';
    for (const e of fx) {
      if (e.type === 'shadow') body += `<feDropShadow dx="${num(e.x || 0)}" dy="${num(e.y ?? 4)}" stdDeviation="${num((e.blur || 0) / 2)}" flood-color="${e.color || '#000000'}" flood-opacity="${e.alpha ?? 0.25}"/>`;
      if (e.type === 'blur' && e.radius > 0) body += `<feGaussianBlur stdDeviation="${num(e.radius / 2)}"/>`;
    }
    if (!body) return '';
    this.defs.push(`<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%">${body}</filter>`);
    return ` filter="url(#${id})"`;
  }

  node(n, depth = 0, withKids = true) {
    if (!n || n.visible === false || depth > 12) return '';
    const store = this.store;
    const style = [];
    if ((n.opacity ?? 1) < 1) style.push(`opacity:${n.opacity}`);
    if (n.blend && n.blend !== 'normal') style.push(`mix-blend-mode:${n.blend}`);
    const st = style.length ? ` style="${style.join(';')}"` : '';
    if (n.type === 'connector') return this.connector(n, st);
    if (n.type === 'group') return `<g${st}>${this.children(n.id, depth)}</g>`;
    if (n.type === 'boolean') return this.boolean(n, st);
    const rot = n.rotation ? ` rotate(${num(n.rotation)} ${num(n.w / 2)} ${num(n.h / 2)})` : '';
    let out = `<g transform="translate(${num(n.x)} ${num(n.y)})${rot}"${st}${this.effects(n)}>`;
    const def = n.type === 'shape' ? shapeDef(n.shape) : null;
    const strokeColor = n.stroke ? n.stroke.color : '#2B1D17';
    const sw = n.stroke ? n.strokeWidth ?? 1 : 0;
    const p = this.paint(n.fill, n.w, n.h);
    const dash = n.dash && n.dash[0] > 0 ? ` stroke-dasharray="${n.dash.join(' ')}"` : '';
    if (n.type !== 'text') {
      for (const part of nodeParts(n)) {
        const d = part.d;
        if (part.kind === 'fill' || part.kind === 'dashedFill') {
          const fillAttr = n.type === 'image' ? 'none' : p.fill;
          out += `<path d="${d}" fill="${fillAttr}"${p.opacity !== undefined && p.opacity < 1 ? ` fill-opacity="${p.opacity}"` : ''}${part.kind === 'dashedFill' ? ` stroke="${strokeColor}" stroke-width="${Math.max(1, sw || 1.5)}" stroke-dasharray="8 6"` : sw > 0 ? ` stroke="${strokeColor}" stroke-width="${num(def && def.thick ? sw * 3 : sw)}"${dash}` : ''} stroke-linejoin="round"/>`;
        } else if (part.kind === 'line') out += `<path d="${d}" fill="none" stroke="${strokeColor}" stroke-width="${Math.max(1, sw || 1.5)}" stroke-linecap="round" stroke-linejoin="round"/>`;
        else if (part.kind === 'dashed') out += `<path d="${d}" fill="none" stroke="${strokeColor}" stroke-width="${Math.max(1, sw || 1.5)}" stroke-dasharray="6 5"/>`;
        else if (part.kind === 'accent') out += `<path d="${d}" fill="${n.stroke ? strokeColor : '#5D1C16'}"/>`;
        else if (part.kind === 'white') out += `<path d="${d}" fill="#FFFFFF"/>`;
      }
    }
    const imgSrc = n.type === 'image' ? n.src : n.fill && n.fill.type === 'image' ? n.fill.src : null;
    if (imgSrc) {
      const href = store.assetsY.get(imgSrc) || imgSrc;
      const cid = this.id('c');
      this.defs.push(`<clipPath id="${cid}"><path d="${nodeParts({ ...n, type: 'rect' })[0].d}"/></clipPath>`);
      const par = (n.fit || n.fill?.fit) === 'fit' ? 'xMidYMid meet' : (n.fit || n.fill?.fit) === 'stretch' ? 'none' : 'xMidYMid slice';
      out += `<image href="${escapeXml(href)}" width="${num(n.w)}" height="${num(n.h)}" preserveAspectRatio="${par}" clip-path="url(#${cid})"/>`;
      if (sw > 0) out += `<path d="${nodeParts({ ...n, type: 'rect' })[0].d}" fill="none" stroke="${strokeColor}" stroke-width="${sw}"/>`;
    }
    if (n.type === 'instance') out += this.instance(n, depth);
    if (hasText(n)) out += this.text(n, def);
    out += '</g>';
    if (withKids && (isContainer(n) || n.type === 'instance')) {
      const kids = this.children(n.id, depth);
      if (kids) {
        if ((n.type === 'frame' || n.type === 'component') && n.clip !== false) {
          const cid = this.id('c');
          this.defs.push(`<clipPath id="${cid}"><path transform="translate(${num(n.x)} ${num(n.y)})" d="${nodeParts({ ...n, type: 'rect' })[0].d}"/></clipPath>`);
          out += `<g clip-path="url(#${cid})"${st}>${kids}</g>`;
        } else out += `<g${st}>${kids}</g>`;
      }
    }
    return out;
  }

  children(id, depth) {
    return this.store.childrenOf(id).map((c) => this.node(c, depth + 1)).join('');
  }

  text(n, def) {
    const t = layoutText(n, this.store);
    if (!t.lines.length || (t.lines.length === 1 && !t.lines[0])) return '';
    const color = n.textColor || (n.type === 'text' ? (n.fill && n.fill.color) || '#2B1D17' : def && def.invertText ? '#FAF3E6' : '#2B1D17');
    const align = n.align || (def && def.align) || (n.type === 'text' || n.type === 'sticky' ? 'left' : 'center');
    const valign = n.valign || (def && def.valign) || (n.type === 'text' || n.type === 'sticky' ? 'top' : 'middle');
    const font = `font-family="${escapeXml(FONT_STACKS[n.fontFamily] || FONT_STACKS['Sistema'])}" font-size="${n.fontSize || 16}" font-weight="${n.fontWeight || 400}"${n.fontStyle === 'italic' ? ' font-style="italic"' : ''}${n.letterSpacing ? ` letter-spacing="${n.letterSpacing}"` : ''}${n.textDecoration === 'underline' ? ' text-decoration="underline"' : ''}`;
    const box = t.box;
    const asc = (n.fontSize || 16) * 0.8 + (t.lineH - (n.fontSize || 16)) / 2;
    if (def && def.table) {
      let s = `<text ${font.replace(/font-weight="\d+"/, 'font-weight="700"')} fill="${color}" x="${num(n.w / 2)}" y="${num((30 - t.lineH) / 2 + asc)}" text-anchor="middle">${escapeXml(t.lines[0])}</text>`;
      t.lines.slice(1).forEach((l, i) => {
        s += `<text ${font} fill="${color}" x="10" y="${num(36 + i * t.lineH + asc)}">${escapeXml(l)}</text>`;
      });
      return s;
    }
    let y = box.y;
    if (valign === 'middle' && !box.below) y = box.y + (box.h - t.height) / 2;
    else if (valign === 'bottom') y = box.y + box.h - t.height;
    const anchor = align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start';
    const x = align === 'center' ? box.x + box.w / 2 : align === 'right' ? box.x + box.w : box.x;
    if (def && def.vertical) {
      const cx = box.x + box.w / 2;
      const cy = box.y + box.h / 2;
      return `<text ${font} fill="${color}" text-anchor="middle" transform="translate(${num(cx)} ${num(cy)}) rotate(-90)" y="${num(asc - t.lineH / 2)}">${escapeXml(t.lines.join(' '))}</text>`;
    }
    return `<text ${font} fill="${color}" text-anchor="${anchor}">${t.lines.map((l, i) => `<tspan x="${num(x)}" y="${num(y + i * t.lineH + asc)}">${escapeXml(l) || ' '}</tspan>`).join('')}</text>`;
  }

  instance(n, depth) {
    const store = this.store;
    const comp = store.get(n.componentId);
    if (!comp || depth > 6) return '';
    const sx = n.w / Math.max(1, comp.w);
    const sy = n.h / Math.max(1, comp.h);
    const ov = n.overrides || {};
    let out = '';
    const draw = (pid, d) => {
      for (const c of store.childrenOf(pid)) {
        if (c.visible === false || c.type === 'connector') continue;
        const clone = { ...c, ...(ov[c.id] || {}), x: (c.x - comp.x) * sx, y: (c.y - comp.y) * sy, w: c.w * sx, h: c.h * sy };
        if (c.type !== 'group') out += this.node(clone, depth + 1, false);
        draw(c.id, d + 1);
      }
    };
    draw(comp.id, 0);
    const cid = this.id('c');
    this.defs.push(`<clipPath id="${cid}"><rect width="${num(n.w)}" height="${num(n.h)}"/></clipPath>`);
    return `<g clip-path="url(#${cid})">${out}</g>`;
  }

  boolean(n, st) {
    const kids = this.store.childrenOf(n.id).filter((c) => c.visible !== false);
    if (!kids.length) return '';
    const op = { union: 0, subtract: 1, intersect: 2, exclude: 3 }[n.op || 'union'] ?? 0;
    let rings = outlineOf(kids[0]);
    for (let i = 1; i < kids.length; i++) {
      const other = outlineOf(kids[i]);
      const next = [];
      for (const a of rings) for (const b of other) {
        try {
          for (const r of Engine.boolean(op, a, b)) next.push(r);
        } catch {}
      }
      rings = next.length || op === 2 ? next : rings;
    }
    const d = rings.filter((r) => r.length > 2).map((r) => r.map((p, i) => `${i ? 'L' : 'M'}${num(p.x)} ${num(p.y)}`).join('') + 'Z').join('');
    const p = this.paint(n.fill || kids[0].fill, n.w, n.h);
    const stroke = n.stroke || kids[0].stroke;
    const sw = n.strokeWidth ?? kids[0].strokeWidth ?? 0;
    return `<path${st} d="${d}" fill="${p.fill}" fill-rule="evenodd"${stroke && sw ? ` stroke="${stroke.color}" stroke-width="${sw}"` : ''}${this.effects(n)}/>`;
  }

  connector(n, st) {
    const r = connectorRoute(n, this.store);
    const pts = r.points;
    if (pts.length < 2) return '';
    const color = n.stroke ? n.stroke.color : '#2B1D17';
    const sw = n.strokeWidth ?? 1.6;
    let d;
    if (r.curve) {
      const [a, c1, c2, b] = r.curve;
      d = `M${num(a.x)} ${num(a.y)}C${num(c1.x)} ${num(c1.y)} ${num(c2.x)} ${num(c2.y)} ${num(b.x)} ${num(b.y)}`;
    } else d = pts.map((p, i) => `${i ? 'L' : 'M'}${num(p.x)} ${num(p.y)}`).join('');
    let out = `<g${st}><path d="${d}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"${n.dash && n.dash[0] > 0 ? ` stroke-dasharray="${n.dash.join(' ')}"` : ''}/>`;
    for (const [tip, from, cap] of [[pts[0], pts[1], n.startCap], [pts[pts.length - 1], pts[pts.length - 2], n.endCap ?? 'triangle']]) {
      const g = capGeometry(tip, from, cap, sw);
      if (!g) continue;
      const P = (arr) => arr.map((p, i) => `${i ? 'L' : 'M'}${num(p.x)} ${num(p.y)}`).join('');
      if (g.fill) out += `<path d="${P(g.fill)}Z" fill="${color}"/>`;
      if (g.open) out += `<path d="${P(g.open)}Z" fill="#FFFFFF" stroke="${color}" stroke-width="${sw}"/>`;
      if (g.circle) out += `<circle cx="${num(g.circle.x)}" cy="${num(g.circle.y)}" r="${num(g.circle.r)}" fill="#FFFFFF" stroke="${color}" stroke-width="${sw}"/>`;
      if (g.ring) out += `<circle cx="${num(g.ring.x)}" cy="${num(g.ring.y)}" r="${num(g.ring.r)}" fill="#FFFFFF" stroke="${color}" stroke-width="${sw}"/>`;
      if (g.lines) out += `<path d="${g.lines.map(P).join('')}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round"/>`;
    }
    if (n.text) {
      const m = polylineMid(pts);
      const fs = n.fontSize || 13;
      const w = n.text.length * fs * 0.56 + 8;
      out += `<rect x="${num(m.x - w / 2)}" y="${num(m.y - fs * 0.75)}" width="${num(w)}" height="${num(fs * 1.5)}" rx="4" fill="#FAF6EF"/><text x="${num(m.x)}" y="${num(m.y + fs * 0.35)}" text-anchor="middle" font-family="${escapeXml(FONT_STACKS['Sistema'])}" font-size="${fs}" fill="${n.textColor || '#2B1D17'}">${escapeXml(n.text)}</text>`;
    }
    return out + '</g>';
  }
}

export const exportBounds = (store, roots) => union(roots.map((n) => {
  const b = nodeBounds(n, store);
  if (n.type === 'shape' && shapeDef(n.shape).labelBelow) return { x: b.x - 40, y: b.y, w: b.w + 80, h: b.h + 44 };
  return b;
}));

export const toSVG = (store, roots, { background = null, padding = 0, bounds = null } = {}) => {
  const w = new SvgWriter(store);
  const b = bounds || exportBounds(store, roots) || { x: 0, y: 0, w: 1, h: 1 };
  const x = b.x - padding;
  const y = b.y - padding;
  const W = Math.max(1, Math.ceil(b.w + padding * 2));
  const H = Math.max(1, Math.ceil(b.h + padding * 2));
  const body = roots.map((n) => w.node(n)).join('');
  const bg = background ? `<rect x="${num(x)}" y="${num(y)}" width="${W}" height="${H}" fill="${background}"/>` : '';
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="${num(x)} ${num(y)} ${W} ${H}"><defs>${w.defs.join('')}</defs>${bg}${body}</svg>`, width: W, height: H };
};

export const svgToCanvas = (svg, width, height, scale = 2, background = null) => new Promise((resolve, reject) => {
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(width * scale));
    c.height = Math.max(1, Math.round(height * scale));
    const ctx = c.getContext('2d');
    if (background) {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, c.width, c.height);
    }
    ctx.drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url);
    resolve(c);
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    reject(new Error('Falha ao rasterizar'));
  };
  img.src = url;
});

const canvasBlob = (c, type, q) => new Promise((resolve) => c.toBlob(resolve, type, q));

export const buildPDF = async (pages) => {
  const enc = new TextEncoder();
  const chunks = [];
  const offsets = [];
  let pos = 0;
  const push = (data) => {
    const u = typeof data === 'string' ? enc.encode(data) : data;
    chunks.push(u);
    pos += u.length;
  };
  const objs = [];
  const add = (fn) => {
    objs.push(fn);
    return objs.length;
  };
  const catalog = add(null);
  const pagesObj = add(null);
  const kids = [];
  const pageData = [];
  for (const p of pages) {
    const img = add(null);
    const content = add(null);
    const page = add(null);
    kids.push(page);
    pageData.push({ ...p, img, content, page });
  }
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const writeObj = (id, body, stream) => {
    offsets[id] = pos;
    push(`${id} 0 obj\n${body}\n`);
    if (stream) {
      push('stream\n');
      push(stream);
      push('\nendstream\n');
    }
    push('endobj\n');
  };
  writeObj(catalog, `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`);
  writeObj(pagesObj, `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`);
  for (const p of pageData) {
    const wpt = num(p.width * 0.75);
    const hpt = num(p.height * 0.75);
    writeObj(p.img, `<< /Type /XObject /Subtype /Image /Width ${p.pxW} /Height ${p.pxH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>`, p.jpeg);
    const cs = `q ${wpt} 0 0 ${hpt} 0 0 cm /Im0 Do Q`;
    writeObj(p.content, `<< /Length ${cs.length} >>`, enc.encode(cs));
    writeObj(p.page, `<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${wpt} ${hpt}] /Resources << /XObject << /Im0 ${p.img} 0 R >> >> /Contents ${p.content} 0 R >>`);
  }
  const xref = pos;
  let x = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objs.length; i++) x += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  push(x);
  push(`trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Producer (Grafo) >>\nstartxref\n${xref}\n%%EOF`);
  return new Blob(chunks, { type: 'application/pdf' });
};

export const exportNodes = async (store, roots, format, { scale = 2, background = null, name = 'grafo' } = {}) => {
  if (!roots.length) throw new Error('Nada para exportar');
  const base = safeName(name);
  if (format === 'svg') {
    const { svg } = toSVG(store, roots, { background });
    download(new Blob([svg], { type: 'image/svg+xml' }), `${base}.svg`);
    return;
  }
  if (format === 'png' || format === 'jpg') {
    const { svg, width, height } = toSVG(store, roots, { background });
    const c = await svgToCanvas(svg, width, height, scale, format === 'jpg' ? background || '#FFFFFF' : null);
    const blob = await canvasBlob(c, format === 'jpg' ? 'image/jpeg' : 'image/png', 0.92);
    download(blob, `${base}.${format}`);
    return;
  }
  if (format === 'pdf') {
    const pages = [];
    for (const r of roots) {
      const { svg, width, height } = toSVG(store, [r], { background: background || '#FFFFFF' });
      const c = await svgToCanvas(svg, width, height, scale, '#FFFFFF');
      const blob = await canvasBlob(c, 'image/jpeg', 0.94);
      pages.push({ width, height, pxW: c.width, pxH: c.height, jpeg: new Uint8Array(await blob.arrayBuffer()) });
    }
    download(await buildPDF(pages), `${base}.pdf`);
  }
};

export const thumbnail = async (store, roots, size = 320) => {
  const { svg, width, height } = toSVG(store, roots, { background: '#FFFFFF', padding: 8 });
  const k = size / Math.max(width, height);
  const c = await svgToCanvas(svg, width, height, k, '#FFFFFF');
  return c.toDataURL('image/png');
};

export const saveGrafoFile = (store) => {
  const data = store.toJSON();
  download(new Blob([JSON.stringify(data)], { type: 'application/json' }), `${safeName(store.name)}.grafo`);
};

export const importSvgAsImage = async (file) => {
  const text = await file.text();
  if (!/^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(text)) throw new Error('SVG inválido');
  const clean = text.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son\w+="[^"]*"/gi, '').replace(/\son\w+='[^']*'/gi, '').replace(/(href|xlink:href)\s*=\s*"(?!#|data:image)[^"]*"/gi, '');
  const url = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(clean)));
  return url;
};

export { uid };
