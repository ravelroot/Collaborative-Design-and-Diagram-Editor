import { Application, Container, Graphics, Text, TextStyle, Sprite, Texture, BlurFilter, FillGradient } from 'pixi.js';
import 'pixi.js/advanced-blend-modes';
import 'pixi.js/unsafe-eval';
import { nodeParts, parseD, flattenD, shapeDef } from './shapes.js';
import { connectorRoute, layoutText, hasText, isContainer, polylineMid, outlineOf, intersects, nodeBounds, FONT_STACKS } from './geom.js';
import { hexToNum, storage } from './util.js';
import { Engine } from './engine/index.js';

const BLENDS = new Set(['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity', 'add']);

const tracePath = (g, d, ox = 0, oy = 0) => {
  for (const c of parseD(d)) {
    if (c[0] === 'M') g.moveTo(c[1] + ox, c[2] + oy);
    else if (c[0] === 'L') g.lineTo(c[1] + ox, c[2] + oy);
    else if (c[0] === 'C') g.bezierCurveTo(c[1] + ox, c[2] + oy, c[3] + ox, c[4] + oy, c[5] + ox, c[6] + oy);
    else if (c[0] === 'Q') g.quadraticCurveTo(c[1] + ox, c[2] + oy, c[3] + ox, c[4] + oy);
    else if (c[0] === 'Z') g.closePath();
  }
};

const dashPolyline = (g, pts, dash, style) => {
  const [on, off] = dash;
  let draw = true;
  let left = on;
  for (let i = 1; i < pts.length; i++) {
    let ax = pts[i - 1].x;
    let ay = pts[i - 1].y;
    const bx = pts[i].x;
    const by = pts[i].y;
    let seg = Math.hypot(bx - ax, by - ay);
    while (seg > 0) {
      const step = Math.min(left, seg);
      const t = step / seg;
      const nx = ax + (bx - ax) * t;
      const ny = ay + (by - ay) * t;
      if (draw) g.moveTo(ax, ay).lineTo(nx, ny);
      ax = nx;
      ay = ny;
      seg -= step;
      left -= step;
      if (left <= 0.0001) {
        draw = !draw;
        left = draw ? on : off;
      }
    }
  }
  g.stroke(style);
};

export const fillStyle = (fill, w, h) => {
  if (!fill) return null;
  if (fill.type === 'linear' && Array.isArray(fill.stops) && fill.stops.length >= 2) {
    const a = (((fill.angle ?? 90) - 90) * Math.PI) / 180;
    const cx = w / 2;
    const cy = h / 2;
    const r = (Math.abs(Math.cos(a)) * w + Math.abs(Math.sin(a)) * h) / 2;
    try {
      const gr = new FillGradient(cx - Math.cos(a) * r, cy - Math.sin(a) * r, cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      for (const s of fill.stops) gr.addColorStop(Math.max(0, Math.min(1, s.o)), hexToNum(s.color));
      return { fill: gr, alpha: fill.alpha ?? 1 };
    } catch {
      return { color: hexToNum(fill.stops[0].color), alpha: fill.alpha ?? 1 };
    }
  }
  if (fill.type === 'image') return null;
  return { color: hexToNum(fill.color), alpha: fill.alpha ?? 1 };
};

export class Renderer {
  constructor(store) {
    this.store = store;
    this.views = new Map();
    this.textures = new Map();
    this.page = null;
    this.structureSeen = -1;
    this.zoom = 1;
    this.camX = 0;
    this.camY = 0;
    this.editingText = null;
    this.hidden = new Set();
    this.backend = '';
    this.theme = 'light';
  }

  async init(host) {
    this.host = host;
    this.app = new Application();
    const opts = { resizeTo: host, antialias: true, autoDensity: true, resolution: Math.min(2, window.devicePixelRatio || 1), autoStart: false, background: '#E9E4DA', powerPreference: 'high-performance' };
    let ok = false;
    const forced = new URLSearchParams(location.search).get('render') || storage.get('renderer', 'webgl');
    const order = forced === 'webgpu' ? ['webgpu', 'webgl'] : ['webgl', 'webgpu'];
    for (const preference of order) {
      try {
        await this.app.init({ ...opts, preference });
        ok = true;
        break;
      } catch {
        this.app = new Application();
      }
    }
    if (!ok) throw new Error('Sem suporte a WebGPU ou WebGL2');
    this.app.ticker.stop();
    this.backend = this.app.renderer.name === 'webgpu' || this.app.renderer.type === 2 ? 'WebGPU' : 'WebGL2';
    this.app.canvas.className = 'stage';
    host.prepend(this.app.canvas);
    this.world = new Container();
    this.app.stage.addChild(this.world);
  }

  setBackground(hex) {
    this.app.renderer.background.color = hexToNum(hex);
  }

  setView(camX, camY, zoom) {
    this.camX = camX;
    this.camY = camY;
    this.zoom = zoom;
    this.world.scale.set(zoom);
    this.world.position.set(-camX * zoom, -camY * zoom);
  }

  viewport() {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    return { x: this.camX, y: this.camY, w: w / this.zoom, h: h / this.zoom };
  }

  textRes() {
    const z = this.zoom;
    const b = z <= 0.5 ? 1 : z <= 1 ? 2 : z <= 2 ? 3 : z <= 4 ? 5 : 8;
    return Math.min(8, b * Math.min(2, window.devicePixelRatio || 1));
  }

  texture(assetId) {
    if (!assetId) return null;
    const cached = this.textures.get(assetId);
    if (cached) return cached.texture;
    const src = this.store.assetsY.get(assetId) || (String(assetId).startsWith('data:') ? assetId : null);
    if (!src) return null;
    const entry = { texture: null };
    this.textures.set(assetId, entry);
    const img = new Image();
    img.onload = () => {
      entry.texture = Texture.from(img);
      this.forceAll = true;
      this.onAsync && this.onAsync();
    };
    img.src = src;
    return null;
  }

  ensure(n) {
    let v = this.views.get(n.id);
    if (!v) {
      const wrap = new Container();
      const self = new Container();
      const gfx = new Graphics();
      self.addChild(gfx);
      wrap.addChild(self);
      v = { wrap, self, gfx, sig: '', kids: null, mask: null, label: null, shadow: null, sprite: null, extra: null, bounds: null };
      this.views.set(n.id, v);
    }
    return v;
  }

  kidsOf(v) {
    if (!v.kids) {
      v.kids = new Container();
      v.wrap.addChild(v.kids);
    }
    return v.kids;
  }

  rebuild(page) {
    const store = this.store;
    const onPage = new Set();
    for (const n of store.nodes.values()) if (n.page === page) onPage.add(n.id);
    const stale = [];
    for (const [id, v] of this.views) {
      if (!onPage.has(id)) {
        stale.push(v);
        this.views.delete(id);
      }
    }
    const attach = (container, parent) => {
      const kids = store.childrenOf(parent, page).filter((c) => c.page === page);
      container.removeChildren();
      for (const k of kids) {
        const v = this.ensure(k);
        container.addChild(v.wrap);
        if (isContainer(k) || k.type === 'group' || k.type === 'boolean') attach(this.kidsOf(v), k.id);
        else if (v.kids) v.kids.removeChildren();
      }
    };
    attach(this.world, null);
    for (const v of stale) {
      v.wrap.removeFromParent();
      if (v.kids) v.kids.removeChildren();
      v.wrap.destroy({ children: true });
    }
  }

  render(page, force = false) {
    const store = this.store;
    if (page !== this.page || store.structureVersion !== this.structureSeen || force) {
      this.page = page;
      this.structureSeen = store.structureVersion;
      this.rebuild(page);
      force = true;
    }
    const res = this.textRes();
    const all = this.forceAll;
    this.forceAll = false;
    const vp = this.viewport();
    const margin = 200 / this.zoom;
    const view = { x: vp.x - margin, y: vp.y - margin, w: vp.w + margin * 2, h: vp.h + margin * 2 };
    for (const n of store.nodes.values()) {
      if (n.page !== page) continue;
      const v = this.views.get(n.id);
      if (!v) continue;
      let sig = String(store.ver.get(n.id) || 0);
      if (hasText(n)) sig += '|' + res + (n.data ? JSON.stringify(store.dataY.get(n.data.source)?.rows?.[n.data.row | 0] || '') : '');
      if (n.type === 'connector' || n.type === 'boolean') sig += '|' + store.version;
      if (n.type === 'instance') sig += '|' + this.instanceSig(n);
      if (n.type === 'image' || (n.fill && n.fill.type === 'image')) sig += '|' + this.textures.size;
      if (this.editingText === n.id || this.hidden.has(n.id)) sig += '|editing';
      if (sig !== v.sig || all || force) {
        v.sig = sig;
        this.draw(n, v, res);
        v.bounds = nodeBounds(n, store);
      }
      if (!n.parent && v.bounds) v.wrap.visible = n.visible !== false && (isContainer(n) || intersects(view, v.bounds) || n.type === 'connector');
    }
    this.app.render();
  }

  instanceSig(n) {
    const comp = this.store.get(n.componentId);
    if (!comp) return 'x';
    let s = String(this.store.ver.get(comp.id) || 0);
    for (const d of this.store.descendants(comp.id)) s += ',' + (this.store.ver.get(d.id) || 0);
    return hash(s);
  }

  draw(n, v, res) {
    const { wrap, self, gfx } = v;
    gfx.clear();
    if (v.shadow) {
      v.shadow.destroy();
      v.shadow = null;
    }
    if (v.label) {
      v.label.destroy({ children: true });
      v.label = null;
    }
    if (v.sprite) {
      v.sprite.destroy();
      v.sprite = null;
    }
    if (v.extra) {
      v.extra.destroy({ children: true });
      v.extra = null;
    }
    if (v.mask && v.kids) {
      v.kids.mask = null;
    }
    if (v.mask) {
      v.mask.destroy();
      v.mask = null;
    }
    self.filters = null;
    wrap.alpha = n.opacity ?? 1;
    wrap.visible = n.visible !== false;
    self.blendMode = BLENDS.has(n.blend) ? n.blend : 'normal';
    if (n.type === 'connector') {
      self.pivot.set(0, 0);
      self.position.set(0, 0);
      self.rotation = 0;
      this.drawConnector(n, v, res);
      return;
    }
    if (n.type === 'group') {
      self.position.set(0, 0);
      self.pivot.set(0, 0);
      self.rotation = 0;
      return;
    }
    if (n.type === 'boolean') {
      self.position.set(0, 0);
      self.pivot.set(0, 0);
      self.rotation = 0;
      if (v.kids) v.kids.visible = false;
      this.drawBoolean(n, gfx);
      return;
    }
    self.pivot.set(n.w / 2, n.h / 2);
    self.position.set(n.x + n.w / 2, n.y + n.h / 2);
    self.rotation = ((n.rotation || 0) * Math.PI) / 180;
    const parts = n.type === 'text' ? [] : nodeParts(n);
    const shadow = (n.effects || []).find((e) => e.type === 'shadow' && e.visible !== false);
    if (shadow && parts.length) {
      const sg = new Graphics();
      for (const p of parts) {
        if (p.kind === 'line' || p.kind === 'dashed' || p.kind === 'ghost') continue;
        tracePath(sg, p.d, shadow.x || 0, shadow.y || 4);
        sg.fill({ color: hexToNum(shadow.color || '#000000'), alpha: shadow.alpha ?? 0.25 });
      }
      if (shadow.blur > 0) sg.filters = [new BlurFilter({ strength: shadow.blur / 2, quality: 3 })];
      self.addChildAt(sg, 0);
      v.shadow = sg;
    }
    const strokeColor = n.stroke ? hexToNum(n.stroke.color) : 0x2b1d17;
    const strokeAlpha = n.stroke ? n.stroke.alpha ?? 1 : 1;
    const sw = n.stroke ? n.strokeWidth ?? 1 : 0;
    const fs = fillStyle(n.fill, n.w, n.h);
    const isTypeShape = n.type === 'shape';
    const def = isTypeShape ? shapeDef(n.shape) : null;
    for (const p of parts) {
      tracePath(gfx, p.d);
      if (p.kind === 'fill' || p.kind === 'dashedFill') {
        if (fs && n.type !== 'image') gfx.fill(fs);
        if (sw > 0 && p.kind === 'fill') {
          if (n.dash && n.dash[0] > 0) {
            for (const ring of flattenD(p.d, 0.8)) dashPolyline(gfx, [...ring, ring[0]], n.dash, { width: sw, color: strokeColor, alpha: strokeAlpha });
          } else gfx.stroke({ width: (def && def.thick ? sw * 3 : sw), color: strokeColor, alpha: strokeAlpha, alignment: n.strokeAlign === 'inside' ? 1 : n.strokeAlign === 'outside' ? 0 : 0.5, join: 'round' });
        }
        if (p.kind === 'dashedFill') for (const ring of flattenD(p.d, 0.8)) dashPolyline(gfx, [...ring, ring[0]], [8, 6], { width: Math.max(1, sw || 1.5), color: strokeColor, alpha: strokeAlpha });
      } else if (p.kind === 'line') {
        gfx.stroke({ width: Math.max(1, sw || 1.5), color: strokeColor, alpha: strokeAlpha, cap: 'round', join: 'round' });
      } else if (p.kind === 'dashed') {
        for (const ring of flattenD(p.d, 0.8)) dashPolyline(gfx, ring, [6, 5], { width: Math.max(1, sw || 1.5), color: strokeColor, alpha: strokeAlpha });
      } else if (p.kind === 'accent') {
        gfx.fill({ color: n.stroke ? strokeColor : 0x5d1c16, alpha: 1 });
      } else if (p.kind === 'white') {
        gfx.fill({ color: 0xffffff, alpha: 1 });
      } else if (p.kind === 'ghost') {
        gfx.fill({ color: 0xffffff, alpha: 0.001 });
      }
    }
    if (n.type === 'image' || (n.fill && n.fill.type === 'image')) {
      const tex = this.texture(n.type === 'image' ? n.src : n.fill.src);
      if (tex) {
        const sp = new Sprite(tex);
        const mode = n.fit || (n.fill && n.fill.fit) || 'fill';
        const tw = tex.width || 1;
        const th = tex.height || 1;
        let sx = n.w / tw;
        let sy = n.h / th;
        if (mode === 'fill') sx = sy = Math.max(sx, sy);
        else if (mode === 'fit') sx = sy = Math.min(sx, sy);
        sp.scale.set(sx, sy);
        sp.position.set((n.w - tw * sx) / 2, (n.h - th * sy) / 2);
        const m = new Graphics();
        tracePath(m, nodeParts({ ...n, type: 'rect' })[0].d);
        m.fill({ color: 0xffffff });
        self.addChild(m);
        sp.mask = m;
        self.addChildAt(sp, v.shadow ? 2 : 1);
        v.sprite = sp;
        v.extra = m;
        if (sw > 0) {
          const og = new Graphics();
          tracePath(og, nodeParts({ ...n, type: 'rect' })[0].d);
          og.stroke({ width: sw, color: strokeColor, alpha: strokeAlpha });
          m.addChild(og);
        }
      } else {
        gfx.fill({ color: 0xd6bdb8, alpha: 0.5 });
      }
    }
    if ((n.type === 'frame' || n.type === 'component') && n.clip !== false) {
      const kids = this.kidsOf(v);
      const m = new Graphics();
      tracePath(m, nodeParts({ ...n, type: 'rect' })[0].d, n.x, n.y);
      m.fill({ color: 0xffffff });
      wrap.addChild(m);
      kids.mask = m;
      v.mask = m;
    }
    if (n.type === 'instance') this.drawInstance(n, v, res);
    if (hasText(n) && this.editingText !== n.id) this.drawLabel(n, v, res, def);
    const blur = (n.effects || []).find((e) => e.type === 'blur' && e.visible !== false && e.radius > 0);
    if (blur) self.filters = [new BlurFilter({ strength: blur.radius / 2, quality: 3 })];
  }

  drawLabel(n, v, res, def) {
    const t = layoutText(n, this.store);
    if (!t.lines.length || (t.lines.length === 1 && !t.lines[0])) return;
    const box = t.box;
    const color = n.textColor || (n.type === 'text' ? (n.fill && n.fill.color) || '#2B1D17' : def && def.invertText ? '#FAF3E6' : '#2B1D17');
    const align = n.align || (def && def.align) || (n.type === 'text' ? 'left' : n.type === 'sticky' ? 'left' : 'center');
    const valign = n.valign || (def && def.valign) || (n.type === 'text' || n.type === 'sticky' ? 'top' : 'middle');
    const table = def && def.table;
    const container = new Container();
    const mk = (text, bold, w) => {
      const style = new TextStyle({
        fontFamily: FONT_STACKS[n.fontFamily] || FONT_STACKS['Sistema'],
        fontSize: n.fontSize || 16,
        fontWeight: String(bold ? 700 : n.fontWeight || 400),
        fontStyle: n.fontStyle === 'italic' ? 'italic' : 'normal',
        fill: color,
        align,
        letterSpacing: n.letterSpacing || 0,
        lineHeight: t.lineH,
      });
      const tx = new Text({ text, style, resolution: res });
      if (w !== undefined) tx.position.x = align === 'center' ? (w - tx.width) / 2 : align === 'right' ? w - tx.width : 0;
      return tx;
    };
    if (table) {
      const head = mk(t.lines[0], true);
      head.position.set(Math.max(8, (n.w - head.width) / 2), Math.max(0, (30 - t.lineH) / 2));
      container.addChild(head);
      const body = t.lines.slice(1);
      body.forEach((line, i) => {
        const tx = mk(line, false);
        tx.position.set(10, 36 + i * t.lineH);
        container.addChild(tx);
      });
    } else {
      const tx = mk(t.lines.join('\n'), false);
      let x = box.x;
      if (align === 'center') x = box.x + (box.w - tx.width) / 2;
      else if (align === 'right') x = box.x + box.w - tx.width;
      let y = box.y;
      if (valign === 'middle') y = box.y + (box.h - t.height) / 2;
      else if (valign === 'bottom') y = box.y + box.h - t.height;
      if (box.below) y = box.y;
      tx.position.set(x, y);
      if (def && def.vertical) {
        tx.rotation = -Math.PI / 2;
        tx.position.set(box.x + (box.w - t.lineH) / 2, box.y + (box.h + tx.width) / 2);
      }
      container.addChild(tx);
    }
    if (n.textDecoration === 'underline' || (def && def.defaults && def.defaults.textDecoration === 'underline')) {
      const g = new Graphics();
      for (const c of container.children) g.moveTo(c.x, c.y + t.lineH * 0.92).lineTo(c.x + c.width, c.y + t.lineH * 0.92);
      g.stroke({ width: Math.max(1, (n.fontSize || 16) / 14), color: hexToNum(color) });
      container.addChild(g);
    }
    v.self.addChild(container);
    v.label = container;
  }

  drawInstance(n, v, res) {
    const store = this.store;
    const comp = store.get(n.componentId);
    if (!comp) return;
    const sx = n.w / Math.max(1, comp.w);
    const sy = n.h / Math.max(1, comp.h);
    const holder = new Container();
    const sub = new Container();
    holder.addChild(sub);
    const m = new Graphics();
    m.rect(0, 0, n.w, n.h).fill({ color: 0xffffff });
    holder.addChild(m);
    sub.mask = m;
    const ov = n.overrides || {};
    const draw = (parentId, depth) => {
      if (depth > 6) return;
      for (const c of store.childrenOf(parentId)) {
        if (c.visible === false) continue;
        const o = ov[c.id] || {};
        const clone = { ...c, ...o, id: c.id + '@' + n.id, x: (c.x - comp.x) * sx, y: (c.y - comp.y) * sy, w: c.w * sx, h: c.h * sy };
        if (c.type === 'connector') continue;
        const tmp = { wrap: new Container(), self: new Container(), gfx: new Graphics(), kids: null, mask: null, label: null, shadow: null, sprite: null, extra: null };
        tmp.self.addChild(tmp.gfx);
        tmp.wrap.addChild(tmp.self);
        if (c.type !== 'group') this.draw(clone, tmp, res);
        sub.addChild(tmp.wrap);
        draw(c.id, depth + 1);
      }
    };
    draw(comp.id, 0);
    v.self.addChild(holder);
    v.extra = holder;
  }

  drawBoolean(n, g) {
    const store = this.store;
    const kids = store.childrenOf(n.id).filter((c) => c.visible !== false);
    if (!kids.length) return;
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
    const first = kids[0];
    const fill = n.fill || first.fill || { type: 'solid', color: '#A3B4BE', alpha: 1 };
    const stroke = n.stroke || first.stroke;
    const sw = n.stroke ? n.strokeWidth ?? 1 : first.stroke ? first.strokeWidth ?? 1 : 0;
    const holes = rings.map((r, i) => rings.some((o, j) => j !== i && r.length && contains(o, r[0])));
    rings.forEach((r, i) => {
      if (holes[i] || r.length < 3) return;
      g.poly(r.flatMap((p) => [p.x, p.y]), true);
      g.fill(fillStyle(fill, 1, 1) || { color: 0xa3b4be });
      rings.forEach((h, j) => {
        if (holes[j] && h.length > 2 && contains(r, h[0])) {
          g.poly(h.flatMap((p) => [p.x, p.y]), true);
          g.cut();
        }
      });
    });
    if (sw > 0 && stroke) {
      rings.forEach((r) => {
        if (r.length < 3) return;
        g.poly(r.flatMap((p) => [p.x, p.y]), true);
        g.stroke({ width: sw, color: hexToNum(stroke.color), alpha: stroke.alpha ?? 1 });
      });
    }
  }

  drawConnector(n, v, res) {
    const g = v.gfx;
    const r = connectorRoute(n, this.store);
    const color = hexToNum(n.stroke ? n.stroke.color : '#2B1D17');
    const alpha = n.stroke ? n.stroke.alpha ?? 1 : 1;
    const sw = n.strokeWidth ?? 1.6;
    const pts = r.points;
    if (pts.length < 2) return;
    const style = { width: sw, color, alpha, cap: 'round', join: 'round' };
    const trimmed = pts.map((p) => ({ ...p }));
    const cut = (i, j, cap) => {
      if (!cap || cap === 'none' || cap === 'one' || cap === 'many' || cap === 'oneMany' || cap === 'zeroMany') return;
      const a = trimmed[i];
      const b = pts[j];
      const l = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const k = Math.min(l, sw * 3) / l;
      a.x -= (a.x - b.x) * k * (cap === 'arrow' ? 0 : 1);
      a.y -= (a.y - b.y) * k * (cap === 'arrow' ? 0 : 1);
    };
    cut(0, 1, n.startCap);
    cut(trimmed.length - 1, trimmed.length - 2, n.endCap ?? 'triangle');
    if (n.dash && n.dash[0] > 0) dashPolyline(g, trimmed, n.dash, style);
    else if (r.curve) {
      const [, c1, c2] = r.curve;
      g.moveTo(trimmed[0].x, trimmed[0].y).bezierCurveTo(c1.x, c1.y, c2.x, c2.y, trimmed[trimmed.length - 1].x, trimmed[trimmed.length - 1].y);
      g.stroke(style);
    } else {
      g.moveTo(trimmed[0].x, trimmed[0].y);
      for (let i = 1; i < trimmed.length; i++) g.lineTo(trimmed[i].x, trimmed[i].y);
      g.stroke(style);
    }
    drawCap(g, pts[0], pts[1], n.startCap, sw, color, alpha);
    drawCap(g, pts[pts.length - 1], pts[pts.length - 2], n.endCap ?? 'triangle', sw, color, alpha);
    if (n.text) {
      const mid = polylineMid(pts);
      const holder = new Container();
      const tx = new Text({ text: n.text, style: new TextStyle({ fontFamily: FONT_STACKS['Sistema'], fontSize: n.fontSize || 13, fill: n.textColor || '#2B1D17' }), resolution: res });
      const pad = 4;
      const bg = new Graphics();
      bg.roundRect(mid.x - tx.width / 2 - pad, mid.y - tx.height / 2 - pad / 2, tx.width + pad * 2, tx.height + pad, 4).fill({ color: hexToNum(this.labelBg || '#FAF6EF') });
      tx.position.set(mid.x - tx.width / 2, mid.y - tx.height / 2);
      holder.addChild(bg, tx);
      v.self.addChild(holder);
      v.label = holder;
    }
  }

  destroy() {
    for (const v of this.views.values()) v.wrap.destroy({ children: true });
    this.views.clear();
    this.app.destroy(true, { children: true });
  }
}

const contains = (ring, p) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y || 1e-9) + a.x) inside = !inside;
  }
  return inside;
};

const hash = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
};

export const capGeometry = (tip, from, cap, sw) => {
  const dx = tip.x - from.x;
  const dy = tip.y - from.y;
  const l = Math.hypot(dx, dy) || 1;
  const ux = dx / l;
  const uy = dy / l;
  const px = -uy;
  const py = ux;
  const s = Math.max(8, sw * 4.5);
  const at = (a, b) => ({ x: tip.x - ux * a + px * b, y: tip.y - uy * a + py * b });
  switch (cap) {
    case 'arrow': return { lines: [[at(s, s * 0.55), tip, at(s, -s * 0.55)]] };
    case 'triangle': return { fill: [tip, at(s, s * 0.5), at(s, -s * 0.5)] };
    case 'diamond': return { fill: [tip, at(s * 0.8, s * 0.45), at(s * 1.6, 0), at(s * 0.8, -s * 0.45)] };
    case 'diamondOpen': return { open: [tip, at(s * 0.8, s * 0.45), at(s * 1.6, 0), at(s * 0.8, -s * 0.45)] };
    case 'circle': return { circle: { ...at(s * 0.45, 0), r: s * 0.42 } };
    case 'one': return { lines: [[at(s * 0.7, s * 0.55), at(s * 0.7, -s * 0.55)], [at(s, s * 0.55), at(s, -s * 0.55)]] };
    case 'many': return { lines: [[at(s, 0), at(0, s * 0.6)], [at(s, 0), tip], [at(s, 0), at(0, -s * 0.6)], [at(s * 1.2, s * 0.55), at(s * 1.2, -s * 0.55)]] };
    case 'oneMany': return { lines: [[at(s, 0), at(0, s * 0.6)], [at(s, 0), at(0, -s * 0.6)], [at(s * 1.3, s * 0.55), at(s * 1.3, -s * 0.55)]] };
    case 'zeroMany': return { lines: [[at(s, 0), at(0, s * 0.6)], [at(s, 0), at(0, -s * 0.6)]], ring: { ...at(s * 1.5, 0), r: s * 0.32 } };
    default: return null;
  }
};

const drawCap = (g, tip, from, cap, sw, color, alpha) => {
  if (!from) return;
  const geo = capGeometry(tip, from, cap, sw);
  if (!geo) return;
  if (geo.fill) {
    g.poly(geo.fill.flatMap((p) => [p.x, p.y]), true).fill({ color, alpha });
  }
  if (geo.open) {
    g.poly(geo.open.flatMap((p) => [p.x, p.y]), true).fill({ color: 0xffffff, alpha }).stroke({ width: sw, color, alpha });
  }
  if (geo.circle) g.circle(geo.circle.x, geo.circle.y, geo.circle.r).fill({ color: 0xffffff, alpha }).stroke({ width: sw, color, alpha });
  if (geo.ring) g.circle(geo.ring.x, geo.ring.y, geo.ring.r).fill({ color: 0xffffff, alpha }).stroke({ width: sw, color, alpha });
  if (geo.lines) {
    for (const l of geo.lines) {
      g.moveTo(l[0].x, l[0].y);
      for (let i = 1; i < l.length; i++) g.lineTo(l[i].x, l[i].y);
    }
    g.stroke({ width: sw, color, alpha, cap: 'round', join: 'round' });
  }
};
