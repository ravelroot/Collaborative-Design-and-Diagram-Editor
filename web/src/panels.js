import { el, icon, clamp, round, normHex, rgba, pickFile, readDataURL, loadImage, parseCSV, download, safeName, uid, userColors, storage, calc } from './util.js';
import { TOOLS } from './editor.js';
import { SHAPES, LIBRARIES, shapeDef, nodeParts } from './shapes.js';
import { isContainer, hasText, nodeBounds, union, FONT_STACKS, fitText } from './geom.js';
import { exportNodes, saveGrafoFile, importSvgAsImage, toSVG } from './export.js';
import { present, presentableFrames } from './present.js';
import { Store } from './doc.js';

const BLEND_NAMES = { normal: 'Normal', multiply: 'Multiplicar', screen: 'Tela', overlay: 'Sobrepor', darken: 'Escurecer', lighten: 'Clarear', 'color-dodge': 'Subexposição de cor', 'color-burn': 'Superexposição de cor', 'hard-light': 'Luz forte', 'soft-light': 'Luz suave', difference: 'Diferença', exclusion: 'Exclusão', hue: 'Matiz', saturation: 'Saturação', color: 'Cor', luminosity: 'Luminosidade' };
const TYPE_ICON = { frame: 'frame', section: 'section', group: 'group', rect: 'rect', ellipse: 'ellipse', polygon: 'polygon', star: 'star', path: 'pen', text: 'text', image: 'image', sticky: 'sticky', shape: 'shapes', connector: 'connector', component: 'component', instance: 'instance', boolean: 'union' };
const TYPE_NAME = { frame: 'Frame', section: 'Seção', group: 'Grupo', rect: 'Retângulo', ellipse: 'Elipse', polygon: 'Polígono', star: 'Estrela', path: 'Vetor', text: 'Texto', image: 'Imagem', sticky: 'Nota adesiva', shape: 'Forma', connector: 'Conector', component: 'Componente', instance: 'Instância', boolean: 'Booleana' };
const FRAME_PRESETS = [['Celular', 390, 844], ['Celular grande', 430, 932], ['Tablet', 834, 1194], ['Notebook', 1280, 832], ['Desktop', 1440, 1024], ['Slide 16:9', 1920, 1080], ['A4', 595, 842], ['Post quadrado', 1080, 1080], ['Story', 1080, 1920]];
const PALETTE = ['#5D1C16', '#A3B4BE', '#5C4034', '#E6DDCE', '#7A6E46', '#D6BDB8', '#F6E4A6', '#2B1D17', '#FFFFFF', '#000000'];
const CAPS = { none: 'Nenhuma', arrow: 'Seta', triangle: 'Triângulo', diamond: 'Losango', diamondOpen: 'Losango vazado', circle: 'Círculo', one: 'Um (ER)', many: 'Muitos (ER)', oneMany: 'Um ou muitos', zeroMany: 'Zero ou muitos' };

export class UI {
  constructor(app) {
    this.app = app;
    this.ed = app.editor;
    this.store = app.store;
    this.dom = app.dom;
    this.leftTab = 'layers';
    this.rightTab = 'design';
    this.collapsed = new Set();
    this.libFilter = '';
    this.pins = new Map();
    this.cursors = new Map();
    this.renameId = null;
    this.pending = 0;
    this.buildTop();
    this.buildMenus();
    this.ed.on((info) => this.onEditor(info));
    this.store.on((info) => {
      if (info.connection || info.meta) this.updateTop();
      this.schedule(info.nodes && !info.structure && document.activeElement && this.dom.rightPanel.contains(document.activeElement) ? 'light' : 'all');
    });
    this.bindKeys();
    this.renderAll();
  }

  schedule(kind = 'all') {
    if (this.pending === 'all') return;
    const first = !this.pending;
    this.pending = kind === 'all' ? 'all' : this.pending || 'light';
    if (first) requestAnimationFrame(() => {
      const k = this.pending;
      this.pending = 0;
      this.renderLeft();
      if (k === 'all') this.renderRight();
      this.updateStatus();
    });
  }

  onEditor(info) {
    if (info.selection || info.page || info.tool) {
      this.updateTools();
      this.schedule('all');
    }
    if (info.hover && this.leftTab === 'layers') this.highlightHover();
    if (info.frame) {
      this.positionHtml();
      const now = performance.now();
      if (!this.lastStatus || now - this.lastStatus > 200) {
        this.lastStatus = now;
        this.updateStatus();
      }
    }
    if (info.view) this.dom.zoomBtn.textContent = Math.round(this.ed.zoom * 100) + '%';
    if (info.contextMenu) this.contextMenu(info.contextMenu);
    if (info.toast) this.toast(info.toast);
    if (info.newComment) this.newComment(info.newComment);
    if (info.pickImage) this.importImage();
    if (info.dropFiles) this.dropFiles(info.dropFiles.files, info.dropFiles.world);
    if (info.presence) this.updateAvatars();
  }

  toast(msg) {
    const t = el('div', { class: 'toast', text: msg });
    this.dom.toasts.append(t);
    setTimeout(() => t.remove(), 2600);
  }

  buildTop() {
    const d = this.dom;
    d.logo.append(icon('move', 22));
    d.logo.innerHTML = '';
    d.logo.append(logoSvg());
    d.loadingLogo.append(logoSvg());
    const tools = d.tools;
    for (const t of TOOLS) {
      if (t.sep) {
        tools.append(el('span', { class: 'tool-sep' }));
        continue;
      }
      const b = el('button', { class: 'tool', title: `${t.name} (${t.key})`, 'aria-label': t.name, dataset: { tool: t.id }, onclick: () => this.ed.setTool(t.id) }, icon(t.icon));
      tools.append(b);
    }
    d.presentBtn.append(icon('play', 16), el('span', { class: 'btn-label', text: 'Apresentar' }));
    d.presentBtn.onclick = () => this.startPresent();
    d.shareBtn.onclick = () => this.shareDialog();
    d.zoomBtn.onclick = (e) => this.zoomMenu(e.currentTarget);
    d.themeBtn.onclick = () => this.app.toggleTheme();
    d.fileName.addEventListener('change', () => {
      this.store.name = d.fileName.value.trim() || 'Sem título';
      document.title = `${this.store.name} · Grafo`;
    });
    d.fileName.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') d.fileName.blur();
      e.stopPropagation();
    });
    d.mainMenuBtn.onclick = (e) => this.openMenu(e.currentTarget, this.menuDefs()[0].items());
    d.minimap.addEventListener('pointerdown', (e) => {
      const r = d.minimap.getBoundingClientRect();
      const move = (ev) => this.ed.minimapJump((ev.clientX - r.left) * (d.minimap.width / r.width), (ev.clientY - r.top) * (d.minimap.height / r.height));
      move(e);
      d.minimap.setPointerCapture(e.pointerId);
      d.minimap.onpointermove = move;
      d.minimap.onpointerup = () => (d.minimap.onpointermove = null);
    });
    this.updateTop();
    this.updateTools();
  }

  updateTop() {
    const d = this.dom;
    if (document.activeElement !== d.fileName) d.fileName.value = this.store.name;
    document.title = `${this.store.name} · Grafo`;
    d.themeBtn.innerHTML = '';
    d.themeBtn.append(icon(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon'));
    const online = this.store.online;
    d.conn.className = 'conn' + (online ? '' : ' off');
    d.conn.innerHTML = '';
    d.conn.append(el('span', { class: 'dot' }), el('span', { class: 'btn-label', text: this.store.mode === 'server' ? (online ? 'Ao vivo' : 'Reconectando…') : 'Local' }));
    d.conn.title = this.store.mode === 'server' ? 'Sincronizado com o servidor em tempo real' : 'Salvo neste navegador; abas abertas do mesmo arquivo colaboram entre si';
    this.updateAvatars();
  }

  updateAvatars() {
    const box = this.dom.avatars;
    box.innerHTML = '';
    const seen = new Set();
    for (const [cid, st] of this.store.awareness.getStates()) {
      if (!st.user || seen.has(cid)) continue;
      seen.add(cid);
      const me = cid === this.store.doc.clientID;
      const a = el('span', { class: 'avatar', title: st.user.name + (me ? ' (você)' : ''), style: { background: st.user.color } }, (st.user.name || '?').slice(0, 1).toUpperCase());
      if (!me) a.onclick = () => st.cursor && this.ed.animateView(st.cursor.x - 300 / this.ed.zoom, st.cursor.y - 200 / this.ed.zoom, this.ed.zoom);
      box.append(a);
    }
  }

  updateTools() {
    for (const b of this.dom.tools.querySelectorAll('.tool')) b.classList.toggle('active', b.dataset.tool === this.ed.tool);
  }

  menuDefs() {
    const ed = this.ed;
    const app = this.app;
    const sel = () => ed.sel.size > 0;
    const S = ed.settings;
    const toggle = (k) => () => {
      S[k] = !S[k];
      ed.saveSettings();
    };
    return [
      { name: 'Arquivo', items: () => [
        { label: 'Novo arquivo', key: 'Ctrl+Alt+N', run: () => app.newFile() },
        { label: 'Abrir arquivo .grafo…', key: 'Ctrl+O', run: () => this.openFile() },
        { label: 'Arquivos recentes…', run: () => this.recentDialog() },
        '-',
        { label: 'Salvar cópia .grafo', key: 'Ctrl+S', run: () => saveGrafoFile(this.store) },
        { label: 'Salvar versão…', key: 'Ctrl+Alt+S', run: () => this.saveVersionDialog() },
        { label: 'Histórico de versões…', run: () => this.versionsDialog() },
        '-',
        { label: 'Importar imagem ou SVG…', key: 'Ctrl+Shift+K', run: () => this.importImage() },
        { label: 'Importar CSV de dados…', run: () => this.importCSV() },
        { label: 'Exportar…', key: 'Ctrl+Shift+E', run: () => this.exportDialog() },
      ] },
      { name: 'Editar', items: () => [
        { label: 'Desfazer', key: 'Ctrl+Z', run: () => this.store.undo.undo(), disabled: !this.store.undo.canUndo() },
        { label: 'Refazer', key: 'Ctrl+Shift+Z', run: () => this.store.undo.redo(), disabled: !this.store.undo.canRedo() },
        '-',
        { label: 'Copiar', key: 'Ctrl+C', run: () => ed.copy(), disabled: !sel() },
        { label: 'Recortar', key: 'Ctrl+X', run: () => ed.copy(true), disabled: !sel() },
        { label: 'Colar', key: 'Ctrl+V', run: () => ed.clipboard && ed.paste(ed.clipboard), disabled: !ed.clipboard },
        { label: 'Duplicar', key: 'Ctrl+D', run: () => ed.duplicate(), disabled: !sel() },
        { label: 'Excluir', key: 'Delete', run: () => ed.remove(), disabled: !sel() },
        '-',
        { label: 'Selecionar tudo', key: 'Ctrl+A', run: () => ed.selectAll() },
        { label: 'Selecionar mesma cor', run: () => this.selectSame('fill'), disabled: !sel() },
        { label: 'Selecionar mesmo tipo', run: () => this.selectSame('type'), disabled: !sel() },
      ] },
      { name: 'Exibir', items: () => [
        { label: 'Réguas', key: 'Shift+R', check: S.rulers, run: toggle('rulers') },
        { label: 'Grade de pixels', key: "Ctrl+'", check: S.grid, run: toggle('grid') },
        { label: 'Minimapa', key: 'Shift+M', check: S.minimap, run: toggle('minimap') },
        { label: 'Contornos', key: 'Ctrl+Shift+O', check: S.outlines, run: toggle('outlines') },
        { label: 'Encaixe inteligente', check: S.snap, run: toggle('snap') },
        { label: 'Encaixar em pixels inteiros', check: S.pixelSnap, run: toggle('pixelSnap') },
        { label: 'Links de protótipo', check: !!ed.emitLinks, run: () => { ed.emitLinks = !ed.emitLinks; ed.invalidate(); } },
        { label: 'Render WebGPU (recarrega)', check: storage.get('renderer', 'webgl') === 'webgpu', run: () => { storage.set('renderer', storage.get('renderer', 'webgl') === 'webgpu' ? 'webgl' : 'webgpu'); location.reload(); } },
        '-',
        { label: 'Aproximar', key: 'Ctrl++', run: () => ed.zoomStep(1) },
        { label: 'Afastar', key: 'Ctrl+-', run: () => ed.zoomStep(-1) },
        { label: 'Ajustar tudo', key: 'Shift+1', run: () => ed.zoomToFit() },
        { label: 'Zoom na seleção', key: 'Shift+2', run: () => ed.zoomToSelection(), disabled: !sel() },
        { label: 'Zoom 100%', key: 'Shift+0', run: () => this.zoom100() },
        '-',
        { label: 'Tema claro/escuro', key: 'Alt+T', run: () => app.toggleTheme() },
        { label: 'Ocultar interface', key: 'Ctrl+\\', run: () => this.dom.app.classList.toggle('ui-hidden') },
      ] },
      { name: 'Objeto', items: () => [
        { label: 'Agrupar', key: 'Ctrl+G', run: () => ed.group(), disabled: !sel() },
        { label: 'Desagrupar', key: 'Ctrl+Shift+G', run: () => ed.ungroup(), disabled: !sel() },
        { label: 'Criar frame da seleção', key: 'Ctrl+Alt+G', run: () => ed.frameSelection(), disabled: !sel() },
        { label: 'Adicionar auto layout', key: 'Shift+A', run: () => ed.toggleAutoLayout(), disabled: !sel() },
        '-',
        { label: 'Criar componente', key: 'Ctrl+Alt+K', run: () => ed.makeComponent(), disabled: !sel() },
        { label: 'Desanexar instância', key: 'Ctrl+Alt+B', run: () => ed.selection.forEach((n) => ed.detachInstance(n.id)), disabled: !ed.selection.some((n) => n.type === 'instance') },
        '-',
        { label: 'União', run: () => ed.booleanOp('union') },
        { label: 'Subtrair', run: () => ed.booleanOp('subtract') },
        { label: 'Interseção', run: () => ed.booleanOp('intersect') },
        { label: 'Excluir sobreposição', run: () => ed.booleanOp('exclude') },
        '-',
        { label: 'Espelhar na horizontal', key: 'Shift+H', run: () => ed.flip('h'), disabled: !sel() },
        { label: 'Espelhar na vertical', key: 'Shift+V', run: () => ed.flip('v'), disabled: !sel() },
        { label: 'Bloquear/desbloquear', key: 'Ctrl+Shift+L', run: () => this.toggleProp('locked'), disabled: !sel() },
        { label: 'Mostrar/ocultar', key: 'Ctrl+Shift+H', run: () => this.toggleProp('visible'), disabled: !sel() },
      ] },
      { name: 'Organizar', items: () => [
        { label: 'Trazer para frente', key: 'Ctrl+Shift+]', run: () => ed.arrange('front'), disabled: !sel() },
        { label: 'Avançar', key: 'Ctrl+]', run: () => ed.arrange('forward'), disabled: !sel() },
        { label: 'Recuar', key: 'Ctrl+[', run: () => ed.arrange('backward'), disabled: !sel() },
        { label: 'Enviar para trás', key: 'Ctrl+Shift+[', run: () => ed.arrange('back'), disabled: !sel() },
        '-',
        { label: 'Alinhar à esquerda', key: 'Alt+A', run: () => ed.align('left') },
        { label: 'Centralizar na horizontal', key: 'Alt+H', run: () => ed.align('centerH') },
        { label: 'Alinhar à direita', key: 'Alt+D', run: () => ed.align('right') },
        { label: 'Alinhar ao topo', key: 'Alt+W', run: () => ed.align('top') },
        { label: 'Centralizar na vertical', key: 'Alt+V', run: () => ed.align('centerV') },
        { label: 'Alinhar à base', key: 'Alt+S', run: () => ed.align('bottom') },
        { label: 'Distribuir na horizontal', key: 'Ctrl+Alt+H', run: () => ed.distribute('h') },
        { label: 'Distribuir na vertical', key: 'Ctrl+Alt+V', run: () => ed.distribute('v') },
        '-',
        { label: 'Layout automático (cima → baixo)', key: 'Ctrl+Shift+Y', run: () => ed.autoArrange(0) },
        { label: 'Layout automático (esquerda → direita)', run: () => ed.autoArrange(1) },
      ] },
      { name: 'Ajuda', items: () => [
        { label: 'Atalhos de teclado', key: 'Ctrl+/', run: () => this.shortcutsDialog() },
        { label: 'Seu nome e cor…', run: () => this.shareDialog() },
        { label: 'Sobre o Grafo', run: () => this.aboutDialog() },
      ] },
    ];
  }

  buildMenus() {
    const m = this.dom.menus;
    for (const def of this.menuDefs()) {
      const b = el('button', { class: 'menu-btn', text: def.name, onclick: (e) => {
        const items = this.menuDefs().find((x) => x.name === def.name).items();
        this.openMenu(e.currentTarget, items);
      } });
      b.addEventListener('pointerenter', () => {
        if (this.menuOpen && this.menuOwner !== b) {
          const items = this.menuDefs().find((x) => x.name === def.name).items();
          this.openMenu(b, items);
        }
      });
      m.append(b);
    }
  }

  openMenu(anchor, items, pos) {
    this.closeMenu();
    const menu = el('div', { class: 'menu', role: 'menu' });
    for (const it of items) {
      if (it === '-') {
        menu.append(el('div', { class: 'menu-sep' }));
        continue;
      }
      if (it.header) {
        menu.append(el('div', { class: 'menu-label', text: it.header }));
        continue;
      }
      const b = el('button', { class: 'menu-item', role: 'menuitem', disabled: it.disabled }, el('span', {}, it.check !== undefined ? (it.check ? '✓ ' : '  ') : '', it.label), it.key ? el('kbd', { text: it.key }) : '');
      b.onclick = () => {
        this.closeMenu();
        it.run && it.run();
      };
      menu.append(b);
    }
    document.body.append(menu);
    const r = anchor ? anchor.getBoundingClientRect() : { left: pos.x, bottom: pos.y, top: pos.y };
    const mw = menu.offsetWidth;
    const mh = menu.offsetHeight;
    menu.style.left = clamp(r.left, 4, innerWidth - mw - 4) + 'px';
    menu.style.top = clamp(anchor ? r.bottom + 4 : pos.y, 4, innerHeight - mh - 4) + 'px';
    this.menuOpen = menu;
    this.menuOwner = anchor;
    if (anchor) anchor.classList.add('open');
    setTimeout(() => {
      this.offMenu = (e) => {
        if (!menu.contains(e.target) && e.target !== anchor) this.closeMenu();
      };
      addEventListener('pointerdown', this.offMenu, true);
    });
  }

  closeMenu() {
    if (this.menuOpen) this.menuOpen.remove();
    if (this.menuOwner) this.menuOwner.classList.remove('open');
    this.menuOpen = null;
    this.menuOwner = null;
    if (this.offMenu) removeEventListener('pointerdown', this.offMenu, true);
  }

  contextMenu({ x, y }) {
    const ed = this.ed;
    const has = ed.sel.size > 0;
    const items = has ? [
      { label: 'Copiar', key: 'Ctrl+C', run: () => ed.copy() },
      { label: 'Recortar', key: 'Ctrl+X', run: () => ed.copy(true) },
      { label: 'Colar aqui', run: () => ed.clipboard && ed.paste(ed.clipboard, 0, 0, false, ed.mouse), disabled: !ed.clipboard },
      { label: 'Duplicar', key: 'Ctrl+D', run: () => ed.duplicate() },
      { label: 'Excluir', key: 'Delete', run: () => ed.remove() },
      '-',
      { label: 'Trazer para frente', key: 'Ctrl+Shift+]', run: () => ed.arrange('front') },
      { label: 'Enviar para trás', key: 'Ctrl+Shift+[', run: () => ed.arrange('back') },
      '-',
      { label: 'Agrupar', key: 'Ctrl+G', run: () => ed.group() },
      { label: 'Desagrupar', key: 'Ctrl+Shift+G', run: () => ed.ungroup() },
      { label: 'Criar frame da seleção', key: 'Ctrl+Alt+G', run: () => ed.frameSelection() },
      { label: 'Adicionar auto layout', key: 'Shift+A', run: () => ed.toggleAutoLayout() },
      { label: 'Criar componente', key: 'Ctrl+Alt+K', run: () => ed.makeComponent() },
      '-',
      { label: 'Mostrar/ocultar', key: 'Ctrl+Shift+H', run: () => this.toggleProp('visible') },
      { label: 'Bloquear/desbloquear', key: 'Ctrl+Shift+L', run: () => this.toggleProp('locked') },
      { label: 'Copiar como SVG', run: () => this.copySVG() },
      { label: 'Exportar seleção…', run: () => this.exportDialog() },
    ] : [
      { label: 'Colar aqui', key: 'Ctrl+V', run: () => ed.clipboard && ed.paste(ed.clipboard, 0, 0, false, ed.mouse), disabled: !ed.clipboard },
      { label: 'Selecionar tudo', key: 'Ctrl+A', run: () => ed.selectAll() },
      '-',
      { label: 'Ajustar tudo', key: 'Shift+1', run: () => ed.zoomToFit() },
      { label: 'Layout automático do diagrama', key: 'Ctrl+Shift+Y', run: () => ed.autoArrange(0) },
      { label: 'Adicionar comentário', key: 'C', run: () => this.newComment({ x: ed.mouse.x, y: ed.mouse.y }) },
    ];
    this.openMenu(null, items, { x, y });
  }

  zoomMenu(anchor) {
    const ed = this.ed;
    this.openMenu(anchor, [
      { label: 'Aproximar', key: 'Ctrl++', run: () => ed.zoomStep(1) },
      { label: 'Afastar', key: 'Ctrl+-', run: () => ed.zoomStep(-1) },
      { label: 'Ajustar tudo', key: 'Shift+1', run: () => ed.zoomToFit() },
      { label: 'Zoom na seleção', key: 'Shift+2', run: () => ed.zoomToSelection(), disabled: !ed.sel.size },
      '-',
      { label: '50%', run: () => this.zoomCenter(0.5) },
      { label: '100%', key: 'Shift+0', run: () => this.zoomCenter(1) },
      { label: '200%', run: () => this.zoomCenter(2) },
      { label: '400%', run: () => this.zoomCenter(4) },
    ]);
  }

  zoomCenter(z) {
    const ed = this.ed;
    const sw = this.dom.stageHost.clientWidth;
    const sh = this.dom.stageHost.clientHeight;
    const c = ed.toWorld(sw / 2, sh / 2);
    ed.animateView(c.x - sw / 2 / z, c.y - sh / 2 / z, z);
  }

  zoom100() {
    this.zoomCenter(1);
  }

  toggleProp(k) {
    const sel = this.ed.selection;
    if (!sel.length) return;
    const val = k === 'visible' ? sel.every((n) => n.visible === false) : !sel.every((n) => n.locked);
    this.ed.setProp({ [k]: val });
    if (k === 'locked' && val) this.ed.select([]);
  }

  selectSame(what) {
    const ref = this.ed.selection[0];
    if (!ref) return;
    const ids = this.ed.pageNodes().filter((n) => (what === 'type' ? n.type === ref.type && n.shape === ref.shape : JSON.stringify(n.fill) === JSON.stringify(ref.fill))).map((n) => n.id);
    this.ed.select(ids);
  }

  renderAll() {
    this.renderLeft();
    this.renderRight();
    this.updateStatus();
  }

  tabs(host, tabs, current, onPick) {
    const bar = el('div', { class: 'tabs', role: 'tablist' });
    for (const [id, name, ic] of tabs) {
      bar.append(el('button', { class: 'tab' + (id === current ? ' active' : ''), role: 'tab', 'aria-selected': String(id === current), onclick: () => onPick(id) }, ic ? icon(ic, 14) : '', name));
    }
    host.append(bar);
  }

  renderLeft() {
    const host = this.dom.leftPanel;
    const scroll = host.querySelector('.panel-body')?.scrollTop || 0;
    if (this.renameId && host.querySelector('.rename')) return;
    if (document.activeElement === this.dom.fileName) return;
    host.innerHTML = '';
    host.append(el('div', { class: 'file-head' }, this.dom.fileName, el('span', { class: 'tag', text: this.store.mode === 'server' ? 'Servidor' : 'Local' })));
    this.tabs(host, [['layers', 'Camadas', 'layers'], ['shapes', 'Formas', 'shapes']], this.leftTab, (t) => {
      this.leftTab = t;
      this.renderLeft();
    });
    const body = el('div', { class: 'panel-body' });
    host.append(body);
    if (this.leftTab === 'layers') this.renderLayers(body);
    else this.renderLibrary(body);
    body.scrollTop = scroll;
  }

  renderLayers(body) {
    const store = this.store;
    const ed = this.ed;
    const pages = el('div', { class: 'section' });
    pages.append(el('div', { class: 'section-title' }, 'Páginas', el('button', { class: 'btn small ghost', title: 'Nova página', onclick: () => ed.setPage(store.addPage()) }, icon('plus', 14))));
    const list = el('div', { class: 'pages' });
    for (const p of store.pageList()) {
      const item = el('div', { class: 'page-item' + (p.id === ed.page ? ' active' : ''), onclick: () => ed.setPage(p.id), ondblclick: () => this.renamePage(p.id) }, icon('page', 14), el('span', { class: 'name', text: p.name, style: { flex: '1' } }));
      item.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.openMenu(null, [
          { label: 'Renomear', run: () => this.renamePage(p.id) },
          { label: 'Duplicar página', run: () => this.duplicatePage(p.id) },
          { label: 'Excluir página', run: () => this.deletePage(p.id), disabled: store.pages.length <= 1 },
        ], { x: e.clientX, y: e.clientY });
      });
      list.append(item);
    }
    pages.append(list);
    body.append(pages);
    const layers = el('div', { class: 'section', style: { borderBottom: '0' } });
    layers.append(el('div', { class: 'section-title' }, 'Camadas'));
    const tree = el('div', { class: 'layers', role: 'tree' });
    const roots = store.childrenOf(null, ed.page).filter((n) => n.page === ed.page).reverse();
    if (!roots.length) tree.append(el('div', { class: 'empty', text: 'Página vazia. Escolha uma ferramenta na barra de cima ou arraste uma forma da aba Formas.' }));
    const walk = (n, depth) => {
      const kids = n.type === 'instance' ? [] : store.childrenOf(n.id).reverse();
      const open = !this.collapsed.has(n.id);
      const row = el('div', { class: `layer ${n.type}` + (ed.sel.has(n.id) ? ' selected' : '') + (n.visible === false ? ' hidden' : ''), role: 'treeitem', dataset: { id: n.id }, style: { paddingLeft: 6 + depth * 14 + 'px' }, draggable: 'true' });
      const tw = el('span', { class: 'twisty' }, kids.length ? icon(open ? 'chevronDown' : 'chevronRight', 12) : '');
      tw.onclick = (e) => {
        e.stopPropagation();
        if (open) this.collapsed.add(n.id);
        else this.collapsed.delete(n.id);
        this.renderLeft();
      };
      const name = el('span', { class: 'name', text: n.name || TYPE_NAME[n.type] || n.type });
      const acts = el('span', { class: 'acts' + (n.locked || n.visible === false ? ' on' : '') },
        el('button', { title: n.locked ? 'Desbloquear' : 'Bloquear', onclick: (e) => { e.stopPropagation(); ed.setProp({ locked: !n.locked }, [n.id]); } }, icon(n.locked ? 'lock' : 'unlock', 13)),
        el('button', { title: n.visible === false ? 'Mostrar' : 'Ocultar', onclick: (e) => { e.stopPropagation(); ed.setProp({ visible: n.visible === false }, [n.id]); } }, icon(n.visible === false ? 'eyeoff' : 'eye', 13)));
      row.append(tw, el('span', { class: 'kind' }, icon(TYPE_ICON[n.type] || 'rect', 14)), name, acts);
      row.addEventListener('click', (e) => {
        if (e.shiftKey || e.ctrlKey || e.metaKey) ed.toggle(n.id);
        else ed.select([n.id]);
        ed.emit({ selection: true });
      });
      row.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        this.renameLayer(n.id, name);
      });
      row.addEventListener('pointerenter', () => {
        ed.hover = n.id;
        ed.invalidate();
      });
      row.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('application/x-grafo-layer', n.id);
        e.dataTransfer.effectAllowed = 'move';
      });
      row.addEventListener('dragover', (e) => {
        e.preventDefault();
        const r = row.getBoundingClientRect();
        const f = (e.clientY - r.top) / r.height;
        row.classList.remove('drop-before', 'drop-after', 'drop-in');
        row.classList.add(f < 0.3 ? 'drop-before' : f > 0.7 || !(isContainer(n) || n.type === 'group') ? 'drop-after' : 'drop-in');
      });
      row.addEventListener('dragleave', () => row.classList.remove('drop-before', 'drop-after', 'drop-in'));
      row.addEventListener('drop', (e) => {
        e.preventDefault();
        const id = e.dataTransfer.getData('application/x-grafo-layer');
        const mode = row.classList.contains('drop-in') ? 'in' : row.classList.contains('drop-before') ? 'before' : 'after';
        row.classList.remove('drop-before', 'drop-after', 'drop-in');
        this.moveLayer(id, n.id, mode);
      });
      tree.append(row);
      if (open) for (const k of kids) walk(k, depth + 1);
    };
    for (const r of roots) walk(r, 0);
    tree.addEventListener('pointerleave', () => {
      ed.hover = null;
      ed.invalidate();
    });
    layers.append(tree);
    body.append(layers);
  }

  highlightHover() {
    for (const r of this.dom.leftPanel.querySelectorAll('.layer')) r.classList.toggle('hovered', r.dataset.id === this.ed.hover);
  }

  moveLayer(id, targetId, mode) {
    const store = this.store;
    const n = store.get(id);
    const t = store.get(targetId);
    if (!n || !t || id === targetId || store.ancestors(targetId).some((a) => a.id === id)) return;
    this.ed.commit(() => {
      if (mode === 'in') {
        store.update(id, { parent: t.id, z: store.nextZ(t.id) });
        return;
      }
      const sib = store.childrenOf(t.parent || null, t.page).filter((s) => s.id !== id && s.page === t.page);
      const i = sib.findIndex((s) => s.id === t.id);
      const above = mode === 'before';
      const nb = above ? sib[i + 1] : sib[i - 1];
      const z = nb ? (t.z + nb.z) / 2 : above ? t.z + 1 : t.z - 1;
      store.update(id, { parent: t.parent || null, z });
    });
  }

  renameLayer(id, span) {
    const n = this.store.get(id);
    if (!n) return;
    this.renameId = id;
    const input = el('input', { class: 'rename', value: n.name || '' });
    span.replaceWith(input);
    input.focus();
    input.select();
    const done = (save) => {
      if (!this.renameId) return;
      this.renameId = null;
      if (save && input.value.trim()) this.ed.setProp({ name: input.value.trim().slice(0, 120) }, [id]);
      this.renderLeft();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') done(true);
      if (e.key === 'Escape') done(false);
    });
    input.addEventListener('blur', () => done(true));
  }

  renamePage(id) {
    const info = this.store.pageInfo.get(id);
    this.prompt('Renomear página', 'Nome da página', info?.name || '', (v) => {
      if (v.trim()) this.store.transact(() => this.store.pageInfo.set(id, { ...info, name: v.trim().slice(0, 80) }));
    });
  }

  duplicatePage(id) {
    const store = this.store;
    const nid = store.addPage((store.pageInfo.get(id)?.name || 'Página') + ' (cópia)');
    const prev = this.ed.page;
    this.ed.page = id;
    const data = this.ed.serialize(store.childrenOf(null, id).filter((n) => n.page === id).map((n) => n.id));
    this.ed.page = nid;
    this.ed.paste(data, 0, 0);
    this.ed.page = prev;
    this.ed.setPage(nid);
  }

  deletePage(id) {
    const store = this.store;
    if (store.pages.length <= 1) return;
    this.confirm('Excluir página', 'A página e tudo o que está nela serão excluídos. Dá para desfazer com Ctrl+Z.', () => {
      store.transact(() => {
        const ids = [...store.nodes.values()].filter((n) => n.page === id).map((n) => n.id);
        store.remove(ids);
        const i = store.pages.toArray().indexOf(id);
        if (i >= 0) store.pages.delete(i, 1);
        store.pageInfo.delete(id);
      });
      this.ed.setPage(store.pages.get(0));
    });
  }

  renderLibrary(body) {
    const sec = el('div', { class: 'section' });
    const search = el('input', { class: 'lib-search', placeholder: 'Buscar formas…', value: this.libFilter, 'aria-label': 'Buscar formas' });
    search.addEventListener('input', () => {
      this.libFilter = search.value;
      const pos = search.selectionStart;
      this.renderLeft();
      const s = this.dom.leftPanel.querySelector('.lib-search');
      s.focus();
      s.setSelectionRange(pos, pos);
    });
    search.addEventListener('keydown', (e) => e.stopPropagation());
    sec.append(search);
    body.append(sec);
    const comps = [...this.store.nodes.values()].filter((n) => n.type === 'component');
    const q = this.libFilter.trim().toLowerCase();
    if (comps.length) {
      const s = el('div', { class: 'section' });
      s.append(el('div', { class: 'section-title' }, 'Componentes'));
      const grid = el('div', { class: 'lib-grid', style: { gridTemplateColumns: 'repeat(2, 1fr)' } });
      for (const c of comps) {
        if (q && !String(c.name).toLowerCase().includes(q)) continue;
        const item = el('div', { class: 'lib-item', title: c.name, draggable: 'true', style: { aspectRatio: '1.3' } });
        try {
          const { svg } = toSVG(this.store, [c], {});
          const img = el('img', { src: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg), alt: c.name, style: { maxWidth: '100%', maxHeight: '70%' } });
          item.append(el('div', { style: { display: 'grid', placeItems: 'center', height: '100%', width: '100%', gap: '2px' } }, img, el('small', { text: c.name, style: { fontSize: '10px', color: 'var(--text-faint)' } })));
        } catch {
          item.append(c.name);
        }
        item.addEventListener('dragstart', (e) => e.dataTransfer.setData('application/x-grafo-component', c.id));
        item.addEventListener('click', () => {
          const p = this.ed.viewportCenter();
          if (c.page !== this.ed.page || true) this.ed.insertInstance(c.id, p.x, p.y);
        });
        grid.append(item);
      }
      s.append(grid);
      body.append(s);
    }
    for (const lib of LIBRARIES) {
      const entries = Object.entries(SHAPES).filter(([id, d]) => d.lib === lib.id && (!q || d.name.toLowerCase().includes(q) || lib.name.toLowerCase().includes(q)));
      if (!entries.length) continue;
      const det = el('details', { class: 'lib-group section', open: q || ['basic', 'flow'].includes(lib.id) || this.openLibs?.has(lib.id) ? true : undefined });
      det.addEventListener('toggle', () => {
        this.openLibs = this.openLibs || new Set();
        if (det.open) this.openLibs.add(lib.id);
        else this.openLibs.delete(lib.id);
      });
      det.append(el('summary', {}, icon('chevronRight', 12), lib.name, el('span', { class: 'tag', text: String(entries.length), style: { marginLeft: 'auto' } })));
      const grid = el('div', { class: 'lib-grid' });
      for (const [id, d] of entries) {
        const item = el('div', { class: 'lib-item', title: d.name, draggable: 'true', role: 'button', 'aria-label': d.name });
        item.append(shapePreview(id));
        item.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('application/x-grafo-shape', id);
          e.dataTransfer.effectAllowed = 'copy';
        });
        item.addEventListener('click', () => {
          const p = this.ed.viewportCenter();
          this.ed.insertShape(id, p.x, p.y);
        });
        grid.append(item);
      }
      det.append(grid);
      body.append(det);
    }
  }

  renderRight() {
    const host = this.dom.rightPanel;
    const active = document.activeElement;
    if (active && host.contains(active) && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA') && active.dataset.keep) {
      const k = active.dataset.keep;
      const start = active.selectionStart;
      this.renderRightInner(host);
      const again = host.querySelector(`[data-keep="${CSS.escape(k)}"]`);
      if (again) {
        again.focus();
        try {
          again.setSelectionRange(start, start);
        } catch {}
      }
      return;
    }
    this.renderRightInner(host);
  }

  renderRightInner(host) {
    const scroll = host.querySelector('.panel-body')?.scrollTop || 0;
    host.innerHTML = '';
    const count = this.store.commentsY.size;
    this.tabs(host, [['design', 'Design'], ['proto', 'Protótipo'], ['data', 'Dados'], ['comments', `Comentários${count ? ' ' + count : ''}`]], this.rightTab, (t) => {
      this.rightTab = t;
      this.renderRight();
    });
    const body = el('div', { class: 'panel-body' });
    host.append(body);
    if (this.rightTab === 'design') this.renderDesign(body);
    else if (this.rightTab === 'proto') this.renderProto(body);
    else if (this.rightTab === 'data') this.renderData(body);
    else this.renderComments(body);
    body.scrollTop = scroll;
  }

  num(label, value, onChange, { step = 1, min = -Infinity, max = Infinity, suffix = '', key = '', title = '' } = {}) {
    const input = el('input', { type: 'text', inputmode: 'decimal', value: value === null || value === undefined || Number.isNaN(value) ? 'Misto' : String(round(value, 100)) + suffix, 'aria-label': title || label, dataset: { keep: key || label } });
    const commit = () => {
      const raw = input.value.replace(suffix, '').replace(',', '.').trim();
      let v;
      try {
        v = calc(raw);
      } catch {
        v = NaN;
      }
      if (Number.isFinite(v)) onChange(clamp(v, min, max));
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        commit();
        input.blur();
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const cur = parseFloat(input.value.replace(',', '.')) || 0;
        const v = clamp(cur + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1), min, max);
        input.value = round(v, 100) + suffix;
        onChange(v);
      }
    });
    input.addEventListener('change', commit);
    input.addEventListener('focus', () => input.select());
    const lbl = el('span', { class: 'lbl', text: label, title: 'Arraste para ajustar' });
    lbl.addEventListener('pointerdown', (e) => {
      const x0 = e.clientX;
      const v0 = parseFloat(input.value.replace(',', '.')) || 0;
      lbl.setPointerCapture(e.pointerId);
      lbl.onpointermove = (ev) => {
        const v = clamp(v0 + Math.round((ev.clientX - x0) / 2) * step * (ev.shiftKey ? 10 : 1), min, max);
        input.value = round(v, 100) + suffix;
        onChange(v);
      };
      lbl.onpointerup = () => (lbl.onpointermove = null);
    });
    return el('label', { class: 'field', title }, lbl, input);
  }

  select(options, value, onChange, { label = '', key = '' } = {}) {
    const s = el('select', { 'aria-label': label || key });
    for (const [v, t] of options) s.append(el('option', { value: v, text: t, selected: String(v) === String(value) ? true : undefined }));
    s.addEventListener('change', () => onChange(s.value));
    s.addEventListener('keydown', (e) => e.stopPropagation());
    return el('label', { class: 'field' }, label ? el('span', { class: 'lbl', text: label }) : '', s);
  }

  color(value, alpha, onChange, key) {
    const hex = normHex(value, '#000000');
    const sw = el('span', { class: 'swatch' });
    const fillI = el('i', { style: { background: rgba(hex, alpha ?? 1) } });
    const picker = el('input', { type: 'color', value: hex.toLowerCase(), 'aria-label': 'Escolher cor' });
    picker.addEventListener('input', () => {
      fillI.style.background = picker.value;
      text.value = picker.value.toUpperCase();
      onChange({ color: picker.value.toUpperCase() });
    });
    sw.append(fillI, picker);
    const text = el('input', { type: 'text', value: hex.replace('#', ''), 'aria-label': 'Cor hexadecimal', dataset: { keep: key + '-hex' }, style: { fontFamily: 'var(--mono)' } });
    text.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') text.blur();
    });
    text.addEventListener('change', () => onChange({ color: normHex(text.value, hex) }));
    const a = el('input', { type: 'text', value: Math.round((alpha ?? 1) * 100) + '%', style: { width: '46px', flex: 'none', textAlign: 'right' }, 'aria-label': 'Opacidade da cor', dataset: { keep: key + '-a' } });
    a.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') a.blur();
    });
    a.addEventListener('change', () => {
      const v = parseFloat(a.value);
      if (Number.isFinite(v)) onChange({ alpha: clamp(v, 0, 100) / 100 });
    });
    return el('div', { class: 'field', style: { gap: '6px' } }, sw, text, a);
  }

  renderDesign(body) {
    const ed = this.ed;
    const sel = ed.selection;
    if (!sel.length) return this.renderPageProps(body);
    const n = sel[0];
    const multi = sel.length > 1;
    const same = (k) => (sel.every((s) => JSON.stringify(s[k]) === JSON.stringify(n[k])) ? n[k] : null);
    const set = (patch) => ed.setProp(patch);
    const head = el('div', { class: 'section' });
    head.append(el('div', { class: 'section-title' }, multi ? `${sel.length} itens` : `${TYPE_NAME[n.type] || n.type}${n.type === 'shape' ? ' · ' + shapeDef(n.shape).name : ''}`));
    const al = el('div', { class: 'icon-row', style: { justifyContent: 'space-between' } });
    for (const [ic, how, t] of [['alignLeft', 'left', 'Alinhar à esquerda'], ['alignCenterH', 'centerH', 'Centralizar na horizontal'], ['alignRight', 'right', 'Alinhar à direita'], ['alignTop', 'top', 'Alinhar ao topo'], ['alignCenterV', 'centerV', 'Centralizar na vertical'], ['alignBottom', 'bottom', 'Alinhar à base']]) {
      al.append(el('button', { class: 'icon-btn', title: t, 'aria-label': t, onclick: () => ed.align(how) }, icon(ic, 16)));
    }
    al.append(el('button', { class: 'icon-btn', title: 'Distribuir na horizontal', onclick: () => ed.distribute('h') }, icon('distH', 16)), el('button', { class: 'icon-btn', title: 'Distribuir na vertical', onclick: () => ed.distribute('v') }, icon('distV', 16)));
    head.append(al);
    body.append(head);
    if (n.type === 'instance' && !multi) body.append(this.instanceSection(n));
    if (n.type === 'component' && !multi) {
      const s = el('div', { class: 'section' });
      s.append(el('div', { class: 'section-title' }, 'Componente principal'));
      s.append(el('div', { class: 'row' }, el('button', { class: 'btn small', onclick: () => {
        const b = nodeBounds(n, this.store);
        ed.insertInstance(n.id, b.x + b.w * 1.5 + 40, b.y + b.h / 2);
      } }, icon('instance', 14), 'Criar instância'), el('span', { class: 'hint', text: `${[...this.store.nodes.values()].filter((x) => x.componentId === n.id).length} instâncias` })));
      const desc = el('textarea', { class: 'lib-search', rows: 2, placeholder: 'Descrição do componente', dataset: { keep: 'cdesc' } }, n.description || '');
      desc.addEventListener('keydown', (e) => e.stopPropagation());
      desc.addEventListener('change', () => set({ description: desc.value.slice(0, 500) }));
      s.append(desc);
      body.append(s);
    }
    if ((n.type === 'frame' || n.type === 'component') && !multi) {
      const s = el('div', { class: 'section' });
      s.append(el('div', { class: 'section-title' }, 'Frame'));
      s.append(this.select([['', 'Tamanho predefinido…'], ...FRAME_PRESETS.map(([t, w, h]) => [`${w}x${h}`, `${t} · ${w}×${h}`])], '', (v) => {
        const [w, h] = v.split('x').map(Number);
        if (w && h) set({ w, h, layout: n.layout ? { ...n.layout, hug: false, hugCross: false } : n.layout });
      }, { key: 'preset' }));
      s.append(el('div', { class: 'row', style: { marginTop: '6px' } }, el('label', { class: 'chk' }, checkbox(n.clip !== false, (v) => set({ clip: v })), 'Recortar conteúdo')));
      body.append(s);
    }
    const geo = el('div', { class: 'section' });
    geo.append(el('div', { class: 'section-title' }, 'Posição e tamanho'));
    if (n.type !== 'connector') {
      const b = multi ? ed.selectionBox() : n;
      geo.append(el('div', { class: 'grid2' },
        this.num('X', b.x, (v) => (multi ? ed.commit(() => sel.forEach((s) => ed.translate(s, v - b.x, 0))) : ed.commit(() => ed.translate(n, v - n.x, 0))), { key: 'x' }),
        this.num('Y', b.y, (v) => (multi ? ed.commit(() => sel.forEach((s) => ed.translate(s, 0, v - b.y))) : ed.commit(() => ed.translate(n, 0, v - n.y))), { key: 'y' })));
      geo.append(el('div', { class: 'grid2' },
        this.num('L', multi ? same('w') : n.w, (v) => ed.setProp((s) => ({ w: Math.max(1, v), ...(s.type === 'text' ? { autoSize: 'height' } : {}), ...(s.type === 'path' ? { points: s.points.map((p) => scaleXY(p, Math.max(1, v) / s.w, 1)) } : {}) })), { min: 1, key: 'w', title: 'Largura' }),
        this.num('A', multi ? same('h') : n.h, (v) => ed.setProp((s) => ({ h: Math.max(1, v), ...(s.type === 'text' ? { autoSize: 'none' } : {}), ...(s.type === 'path' ? { points: s.points.map((p) => scaleXY(p, 1, Math.max(1, v) / s.h)) } : {}) })), { min: 1, key: 'h', title: 'Altura' })));
      const row = el('div', { class: 'grid2' }, this.num('°', same('rotation') ?? 0, (v) => set({ rotation: ((v % 360) + 540) % 360 - 180 }), { key: 'rot', title: 'Rotação' }));
      if (['rect', 'frame', 'component', 'image', 'instance', 'section', 'sticky'].includes(n.type) || (n.type === 'shape' && n.shape === 'rect')) row.append(this.num('R', same('radius') ?? 0, (v) => set({ radius: Math.max(0, v) }), { min: 0, key: 'radius', title: 'Raio do canto' }));
      geo.append(row);
      if ((n.type === 'polygon' || n.type === 'star') && !multi) {
        geo.append(el('div', { class: 'grid2' }, this.num('Lados', n.sides || (n.type === 'star' ? 5 : 3), (v) => set({ sides: clamp(Math.round(v), 3, 60) }), { min: 3, max: 60, key: 'sides' }), n.type === 'star' ? this.num('Raio int.', Math.round((n.inner || 0.45) * 100), (v) => set({ inner: clamp(v, 5, 100) / 100 }), { suffix: '%', key: 'inner' }) : ''));
      }
      const parent = !multi && n.parent && this.store.get(n.parent);
      if (parent && (parent.type === 'frame' || parent.type === 'component') && !(parent.layout && parent.layout.mode !== 'none')) {
        const c = n.constraints || { h: 'left', v: 'top' };
        geo.append(el('div', { class: 'hint', text: 'Restrições ao redimensionar o frame' }));
        geo.append(el('div', { class: 'grid2' },
          this.select([['left', 'Esquerda'], ['right', 'Direita'], ['center', 'Centro'], ['stretch', 'Esticar'], ['scale', 'Escala']], c.h, (v) => set({ constraints: { ...c, h: v } }), { label: '↔' }),
          this.select([['top', 'Topo'], ['bottom', 'Base'], ['center', 'Centro'], ['stretch', 'Esticar'], ['scale', 'Escala']], c.v, (v) => set({ constraints: { ...c, v } }), { label: '↕' })));
      }
      if (parent && parent.layout && parent.layout.mode !== 'none') geo.append(el('label', { class: 'chk', style: { marginTop: '4px' } }, checkbox(!!n.absolute, (v) => set({ absolute: v })), 'Posição absoluta (fora do auto layout)'));
    }
    body.append(geo);
    if (!multi && (n.type === 'frame' || n.type === 'component')) body.append(this.autoLayoutSection(n));
    if (n.type === 'connector') body.append(this.connectorSection(n, sel));
    if (n.type === 'shape' && !multi) {
      const s = el('div', { class: 'section' });
      s.append(el('div', { class: 'section-title' }, 'Forma'));
      const lib = shapeDef(n.shape).lib;
      s.append(this.select(Object.entries(SHAPES).filter(([, d]) => d.lib === lib).map(([id, d]) => [id, d.name]), n.shape, (v) => set({ shape: v }), { key: 'shape' }));
      body.append(s);
    }
    if (n.type === 'boolean' && !multi) {
      const s = el('div', { class: 'section' });
      s.append(el('div', { class: 'section-title' }, 'Operação booleana'));
      const row = el('div', { class: 'icon-row' });
      for (const [op, ic, t] of [['union', 'union', 'União'], ['subtract', 'subtract', 'Subtrair'], ['intersect', 'intersect', 'Interseção'], ['exclude', 'exclude', 'Excluir sobreposição']]) row.append(el('button', { class: 'icon-btn' + (n.op === op ? ' active' : ''), title: t, onclick: () => set({ op, name: t }) }, icon(ic, 16)));
      s.append(row);
      body.append(s);
    }
    const layer = el('div', { class: 'section' });
    layer.append(el('div', { class: 'section-title' }, 'Camada'));
    layer.append(el('div', { class: 'grid2' },
      this.select(Object.entries(BLEND_NAMES), same('blend') || 'normal', (v) => set({ blend: v }), { key: 'blend' }),
      this.num('', Math.round((same('opacity') ?? 1) * 100), (v) => set({ opacity: clamp(v, 0, 100) / 100 }), { suffix: '%', min: 0, max: 100, key: 'opacity', title: 'Opacidade' })));
    body.append(layer);
    if (n.type !== 'connector' && n.type !== 'group' && n.type !== 'text') body.append(this.fillSection(sel, n));
    if (n.type !== 'group') body.append(this.strokeSection(sel, n));
    if (sel.some((s) => hasText(s))) body.append(this.textSection(sel.filter((s) => hasText(s)), n.type === 'text' ? n : sel.find((s) => hasText(s))));
    if (n.type !== 'connector') body.append(this.effectsSection(sel, n));
    if (n.type === 'image' && !multi) {
      const s = el('div', { class: 'section' });
      s.append(el('div', { class: 'section-title' }, 'Imagem'));
      s.append(el('div', { class: 'grid2' }, this.select([['fill', 'Preencher'], ['fit', 'Ajustar'], ['stretch', 'Esticar']], n.fit || 'fill', (v) => set({ fit: v }), { key: 'fit' }), el('button', { class: 'btn small', onclick: () => this.replaceImage(n.id) }, 'Trocar imagem')));
      body.append(s);
    }
    body.append(this.exportSection(sel));
  }

  renderPageProps(body) {
    const store = this.store;
    const ed = this.ed;
    const info = store.pageInfo.get(ed.page) || {};
    const s = el('div', { class: 'section' });
    s.append(el('div', { class: 'section-title' }, 'Página'));
    s.append(el('div', { class: 'hint', text: 'Cor de fundo da tela' }));
    s.append(this.color(info.bg || (document.documentElement.dataset.theme === 'dark' ? '#221B18' : '#E9E4DA'), 1, (p) => {
      if (p.color) store.transact(() => store.pageInfo.set(ed.page, { ...info, bg: p.color }));
    }, 'pagebg'));
    body.append(s);
    const styles = el('div', { class: 'section' });
    styles.append(el('div', { class: 'section-title' }, 'Estilos de cor'));
    const list = [...store.stylesY.values()].filter((v) => v.kind === 'color');
    if (!list.length) styles.append(el('div', { class: 'hint', text: 'Selecione um objeto e use “+” em Preenchimento para criar um estilo.' }));
    for (const st of list) {
      const item = el('div', { class: 'style-item' }, el('span', { class: 'chip', style: { background: st.value.color } }), el('span', { text: st.name, style: { flex: '1' } }), el('button', { class: 'icon-btn', title: 'Excluir estilo', onclick: (e) => { e.stopPropagation(); store.transact(() => store.stylesY.delete(st.id)); } }, icon('trash', 13)));
      item.onclick = () => this.prompt('Editar estilo', 'Cor (hex)', st.value.color, (v) => this.updateColorStyle(st, normHex(v, st.value.color)));
      styles.append(item);
    }
    body.append(styles);
    const tstyles = el('div', { class: 'section' });
    tstyles.append(el('div', { class: 'section-title' }, 'Estilos de texto'));
    const tl = [...store.stylesY.values()].filter((v) => v.kind === 'text');
    if (!tl.length) tstyles.append(el('div', { class: 'hint', text: 'Selecione um texto e use “+” em Texto para criar um estilo.' }));
    for (const st of tl) tstyles.append(el('div', { class: 'style-item' }, el('span', { text: 'Aa', style: { fontWeight: st.value.fontWeight, width: '20px' } }), el('span', { text: `${st.name} · ${st.value.fontSize}px`, style: { flex: '1' } }), el('button', { class: 'icon-btn', onclick: () => store.transact(() => store.stylesY.delete(st.id)) }, icon('trash', 13))));
    body.append(tstyles);
    const v = el('div', { class: 'section' });
    v.append(el('div', { class: 'section-title' }, 'Exibição'));
    for (const [k, t] of [['rulers', 'Réguas'], ['grid', 'Grade de pixels (zoom ≥ 400%)'], ['minimap', 'Minimapa'], ['snap', 'Encaixe inteligente'], ['pixelSnap', 'Encaixar em pixels inteiros'], ['outlines', 'Contornos']]) {
      v.append(el('div', { class: 'row' }, el('label', { class: 'chk' }, checkbox(!!ed.settings[k], (val) => { ed.settings[k] = val; ed.saveSettings(); }), t)));
    }
    body.append(v);
    const frames = presentableFrames(store, ed.page);
    const ex = el('div', { class: 'section' });
    ex.append(el('div', { class: 'section-title' }, 'Exportar página'));
    ex.append(el('div', { class: 'row' }, el('button', { class: 'btn small', onclick: () => this.exportDialog(true) }, icon('download', 14), 'Exportar…'), el('span', { class: 'hint', text: `${frames.length} frames` })));
    body.append(ex);
  }

  updateColorStyle(st, color) {
    const store = this.store;
    this.ed.commit(() => {
      store.stylesY.set(st.id, { ...st, value: { ...st.value, color } });
      for (const n of store.nodes.values()) if (n.fillStyle === st.id && n.fill) store.update(n.id, { fill: { ...n.fill, color } });
    });
  }

  fillSection(sel, n) {
    const ed = this.ed;
    const store = this.store;
    const s = el('div', { class: 'section' });
    const fill = n.fill;
    const set = (fillPatch) => ed.setProp((x) => ({ fill: fillPatch === null ? null : { ...(x.fill || { type: 'solid', color: '#D6BDB8', alpha: 1 }), ...fillPatch }, fillStyle: undefined }));
    s.append(el('div', { class: 'section-title' }, 'Preenchimento', el('span', {},
      fill ? el('button', { class: 'btn small ghost', title: 'Criar estilo de cor', onclick: () => this.prompt('Novo estilo de cor', 'Nome', 'Cor ' + (store.stylesY.size + 1), (name) => {
        const id = 's' + uid(8);
        ed.commit(() => {
          store.stylesY.set(id, { id, kind: 'color', name, value: { color: fill.color || '#000000' } });
          ed.setProp({ fillStyle: id });
        });
      }) }, icon('sparkle', 13)) : '',
      el('button', { class: 'btn small ghost', title: fill ? 'Remover preenchimento' : 'Adicionar preenchimento', onclick: () => set(fill ? null : { type: 'solid', color: '#D6BDB8', alpha: 1 }) }, icon(fill ? 'minus' : 'plus', 14)))));
    if (!fill) return s;
    s.append(el('div', { class: 'grid2' }, this.select([['solid', 'Sólido'], ['linear', 'Degradê linear'], ['image', 'Imagem']], fill.type || 'solid', async (v) => {
      if (v === 'linear') set({ type: 'linear', stops: fill.stops || [{ o: 0, color: fill.color || '#F6E4A6' }, { o: 1, color: '#5D1C16' }], angle: 90 });
      else if (v === 'image') {
        const f = await pickFile('image/*');
        if (!f) return;
        const src = await readDataURL(f);
        const aid = 'a' + uid(10);
        ed.commit(() => {
          store.assetsY.set(aid, src);
          ed.setProp((x) => ({ fill: { type: 'image', src: aid, fit: 'fill', alpha: 1, color: x.fill?.color } }));
        });
      } else set({ type: 'solid', color: fill.color || (fill.stops && fill.stops[0].color) || '#D6BDB8' });
    }, { key: 'filltype' }), fill.type === 'linear' ? this.num('°', fill.angle ?? 90, (v) => set({ angle: v }), { key: 'angle', title: 'Ângulo' }) : ''));
    if (fill.type === 'linear') {
      fill.stops.forEach((st, i) => s.append(el('div', { class: 'row' }, this.color(st.color, 1, (p) => set({ stops: fill.stops.map((x, j) => (j === i ? { ...x, ...(p.color ? { color: p.color } : {}) } : x)) }), 'stop' + i))));
    } else if (fill.type !== 'image') {
      s.append(el('div', { class: 'row' }, this.color(fill.color, fill.alpha, (p) => set(p), 'fill')));
    }
    const styleRef = n.fillStyle && store.stylesY.get(n.fillStyle);
    if (styleRef) s.append(el('div', { class: 'hint' }, 'Estilo: ', el('b', { text: styleRef.name })));
    const chips = el('div', { class: 'palette-chips' });
    for (const c of PALETTE) chips.append(el('button', { class: 'chip', title: c, style: { background: c }, onclick: () => set({ type: 'solid', color: c }) }));
    for (const st of store.stylesY.values()) if (st.kind === 'color') chips.append(el('button', { class: 'chip', title: 'Estilo: ' + st.name, style: { background: st.value.color, outline: '2px solid var(--accent)', outlineOffset: '1px' }, onclick: () => ed.setProp({ fill: { type: 'solid', color: st.value.color, alpha: 1 }, fillStyle: st.id }) }));
    s.append(chips);
    return s;
  }

  strokeSection(sel, n) {
    const ed = this.ed;
    const s = el('div', { class: 'section' });
    const stroke = n.stroke;
    const isConn = n.type === 'connector';
    s.append(el('div', { class: 'section-title' }, isConn ? 'Linha' : 'Contorno', isConn ? '' : el('button', { class: 'btn small ghost', title: stroke ? 'Remover contorno' : 'Adicionar contorno', onclick: () => ed.setProp(stroke ? { stroke: null, strokeWidth: 0 } : { stroke: { color: '#2B1D17', alpha: 1 }, strokeWidth: 1 }) }, icon(stroke ? 'minus' : 'plus', 14))));
    if (!stroke) return s;
    s.append(el('div', { class: 'row' }, this.color(stroke.color, stroke.alpha, (p) => ed.setProp((x) => ({ stroke: { ...(x.stroke || { color: '#2B1D17', alpha: 1 }), ...p } })), 'stroke')));
    const dashVal = n.dash && n.dash[0] ? (n.dash[0] <= 2 ? 'dot' : 'dash') : 'solid';
    s.append(el('div', { class: 'grid2' },
      this.num('', n.strokeWidth ?? 1, (v) => ed.setProp({ strokeWidth: Math.max(0, v) }), { min: 0, step: 0.5, key: 'sw', title: 'Espessura' }),
      this.select([['solid', 'Contínua'], ['dash', 'Tracejada'], ['dot', 'Pontilhada']], dashVal, (v) => ed.setProp({ dash: v === 'solid' ? null : v === 'dash' ? [8, 6] : [2, 4] }), { key: 'dash' })));
    if (!isConn && !['path', 'shape'].includes(n.type)) s.append(this.select([['center', 'Centro'], ['inside', 'Dentro'], ['outside', 'Fora']], n.strokeAlign || 'center', (v) => ed.setProp({ strokeAlign: v }), { label: 'Posição' }));
    return s;
  }

  textSection(sel, n) {
    const ed = this.ed;
    const store = this.store;
    const s = el('div', { class: 'section' });
    const set = (p) => ed.setProp(p, sel.map((x) => x.id));
    s.append(el('div', { class: 'section-title' }, 'Texto', el('button', { class: 'btn small ghost', title: 'Criar estilo de texto', onclick: () => this.prompt('Novo estilo de texto', 'Nome', 'Título ' + (store.stylesY.size + 1), (name) => {
      const id = 's' + uid(8);
      store.transact(() => store.stylesY.set(id, { id, kind: 'text', name, value: { fontFamily: n.fontFamily || 'Sistema', fontSize: n.fontSize || 16, fontWeight: n.fontWeight || 400, lineHeight: n.lineHeight || 1.25, letterSpacing: n.letterSpacing || 0 } }));
    }) }, icon('sparkle', 13))));
    const tstyles = [...store.stylesY.values()].filter((v) => v.kind === 'text');
    if (tstyles.length) s.append(this.select([['', 'Aplicar estilo de texto…'], ...tstyles.map((t) => [t.id, `${t.name} · ${t.value.fontSize}`])], '', (v) => {
      const st = store.stylesY.get(v);
      if (st) set({ ...st.value, textStyle: st.id });
    }, { key: 'tstyle' }));
    s.append(el('div', { class: 'grid2', style: { marginTop: '6px' } }, this.select(Object.keys(FONT_STACKS).map((f) => [f, f]), n.fontFamily || 'Sistema', (v) => set({ fontFamily: v }), { key: 'ff' }), this.num('', n.fontSize || 16, (v) => set({ fontSize: clamp(v, 1, 1000) }), { min: 1, key: 'fs', title: 'Tamanho da fonte' })));
    s.append(el('div', { class: 'grid2' }, this.select([[300, 'Leve'], [400, 'Regular'], [500, 'Média'], [600, 'Seminegrito'], [700, 'Negrito'], [800, 'Extranegrito']], n.fontWeight || 400, (v) => set({ fontWeight: Number(v) }), { key: 'fw' }), this.num('↕', Math.round((n.lineHeight || 1.25) * 100), (v) => set({ lineHeight: clamp(v, 50, 400) / 100 }), { suffix: '%', key: 'lh', title: 'Altura da linha' })));
    s.append(el('div', { class: 'grid2' }, this.num('↔', n.letterSpacing || 0, (v) => set({ letterSpacing: clamp(v, -20, 100) }), { step: 0.1, key: 'ls', title: 'Espaçamento entre letras' }), n.type === 'text' ? this.select([['width', 'Largura automática'], ['height', 'Altura automática'], ['none', 'Tamanho fixo']], n.autoSize || 'width', (v) => set({ autoSize: v }), { key: 'auto' }) : ''));
    const align = el('div', { class: 'icon-row' });
    for (const [a, ic] of [['left', 'alignLeft'], ['center', 'alignCenterH'], ['right', 'alignRight']]) align.append(el('button', { class: 'icon-btn' + ((n.align || (n.type === 'text' || n.type === 'sticky' ? 'left' : 'center')) === a ? ' active' : ''), title: { left: 'Esquerda', center: 'Centro', right: 'Direita' }[a], onclick: () => set({ align: a }) }, icon(ic, 15)));
    align.append(el('span', { style: { width: '8px' } }));
    for (const [a, ic] of [['top', 'alignTop'], ['middle', 'alignCenterV'], ['bottom', 'alignBottom']]) align.append(el('button', { class: 'icon-btn' + ((n.valign || (n.type === 'text' || n.type === 'sticky' ? 'top' : 'middle')) === a ? ' active' : ''), title: { top: 'Topo', middle: 'Meio', bottom: 'Base' }[a], onclick: () => set({ valign: a }) }, icon(ic, 15)));
    align.append(el('span', { style: { width: '8px' } }));
    align.append(el('button', { class: 'icon-btn' + (n.fontStyle === 'italic' ? ' active' : ''), title: 'Itálico', style: { fontStyle: 'italic', fontWeight: 700, width: '26px' }, onclick: () => set({ fontStyle: n.fontStyle === 'italic' ? 'normal' : 'italic' }) }, 'I'));
    align.append(el('button', { class: 'icon-btn' + (n.textDecoration === 'underline' ? ' active' : ''), title: 'Sublinhado', style: { textDecoration: 'underline', fontWeight: 700, width: '26px' }, onclick: () => set({ textDecoration: n.textDecoration === 'underline' ? 'none' : 'underline' }) }, 'S'));
    s.append(align);
    if (n.type !== 'text') {
      s.append(el('div', { class: 'hint', text: 'Cor do texto', style: { marginTop: '8px' } }));
      s.append(this.color(n.textColor || '#2B1D17', 1, (p) => p.color && set({ textColor: p.color }), 'tc'));
    } else {
      s.append(el('div', { class: 'hint', text: 'Cor do texto', style: { marginTop: '8px' } }));
      s.append(this.color(n.fill?.color || '#2B1D17', n.fill?.alpha ?? 1, (p) => ed.setProp((x) => ({ fill: { type: 'solid', ...(x.fill || { color: '#2B1D17', alpha: 1 }), ...p } }), sel.map((x) => x.id)), 'tfill'));
    }
    if (sel.length === 1) {
      const ta = el('textarea', { class: 'lib-search', rows: 3, style: { marginTop: '8px', resize: 'vertical' }, dataset: { keep: 'textcontent' }, 'aria-label': 'Conteúdo do texto' }, n.text || '');
      ta.addEventListener('keydown', (e) => e.stopPropagation());
      ta.addEventListener('input', () => set({ text: ta.value }));
      s.append(ta);
    }
    return s;
  }

  effectsSection(sel, n) {
    const ed = this.ed;
    const s = el('div', { class: 'section' });
    const fx = n.effects || [];
    const setFx = (list) => ed.setProp({ effects: list });
    s.append(el('div', { class: 'section-title' }, 'Efeitos', el('span', {},
      el('button', { class: 'btn small ghost', title: 'Adicionar sombra', onclick: () => setFx([...fx, { type: 'shadow', x: 0, y: 4, blur: 12, color: '#2B1D17', alpha: 0.25 }]) }, '+ Sombra'),
      el('button', { class: 'btn small ghost', title: 'Adicionar desfoque', onclick: () => setFx([...fx, { type: 'blur', radius: 4 }]) }, '+ Desfoque'))));
    fx.forEach((e, i) => {
      const upd = (p) => setFx(fx.map((x, j) => (j === i ? { ...x, ...p } : x)));
      const box = el('div', { style: { marginBottom: '8px' } });
      box.append(el('div', { class: 'row' }, el('label', { class: 'chk', style: { flex: '1' } }, checkbox(e.visible !== false, (v) => upd({ visible: v })), e.type === 'shadow' ? 'Sombra projetada' : 'Desfoque da camada'), el('button', { class: 'icon-btn', title: 'Remover efeito', onclick: () => setFx(fx.filter((_, j) => j !== i)) }, icon('minus', 14))));
      if (e.type === 'shadow') {
        box.append(el('div', { class: 'grid3' }, this.num('X', e.x || 0, (v) => upd({ x: v }), { key: 'fx' + i + 'x' }), this.num('Y', e.y ?? 4, (v) => upd({ y: v }), { key: 'fx' + i + 'y' }), this.num('D', e.blur || 0, (v) => upd({ blur: Math.max(0, v) }), { key: 'fx' + i + 'b', title: 'Desfoque' })));
        box.append(this.color(e.color || '#000000', e.alpha ?? 0.25, (p) => upd(p), 'fx' + i));
      } else box.append(this.num('Raio', e.radius || 0, (v) => upd({ radius: Math.max(0, v) }), { key: 'fx' + i + 'r' }));
      s.append(box);
    });
    return s;
  }

  autoLayoutSection(n) {
    const ed = this.ed;
    const L = n.layout && n.layout.mode !== 'none' ? n.layout : null;
    const s = el('div', { class: 'section' });
    s.append(el('div', { class: 'section-title' }, 'Auto layout', el('button', { class: 'btn small ghost', title: L ? 'Remover auto layout' : 'Adicionar auto layout (Shift+A)', onclick: () => ed.toggleAutoLayout() }, icon(L ? 'minus' : 'plus', 14))));
    if (!L) return s;
    const set = (p) => ed.setProp({ layout: { ...L, ...p } });
    const dir = el('div', { class: 'icon-row' });
    dir.append(el('button', { class: 'icon-btn' + (L.mode === 'v' ? ' active' : ''), title: 'Vertical', onclick: () => set({ mode: 'v' }) }, '↓'), el('button', { class: 'icon-btn' + (L.mode === 'h' ? ' active' : ''), title: 'Horizontal', onclick: () => set({ mode: 'h' }) }, '→'));
    s.append(el('div', { class: 'row' }, dir));
    s.append(el('div', { class: 'grid2' }, this.num('Esp.', L.gap ?? 10, (v) => set({ gap: v }), { key: 'gap', title: 'Espaçamento entre itens' }), this.num('Marg.', L.padding ?? 16, (v) => set({ padding: Math.max(0, v) }), { min: 0, key: 'pad', title: 'Margem interna' })));
    s.append(el('div', { class: 'grid2' },
      this.select([['start', 'Início'], ['center', 'Centro'], ['end', 'Fim'], ['stretch', 'Esticar']], L.align || 'start', (v) => set({ align: v }), { label: '⊥' }),
      this.select([['start', 'Início'], ['center', 'Centro'], ['end', 'Fim'], ['between', 'Espaçar']], L.justify || 'start', (v) => set({ justify: v }), { label: '∥' })));
    s.append(el('div', { class: 'row' }, el('label', { class: 'chk' }, checkbox(L.hug !== false, (v) => set({ hug: v })), 'Abraçar no eixo principal'), el('label', { class: 'chk' }, checkbox(L.hugCross !== false, (v) => set({ hugCross: v })), 'no eixo cruzado')));
    return s;
  }

  connectorSection(n, sel) {
    const ed = this.ed;
    const s = el('div', { class: 'section' });
    s.append(el('div', { class: 'section-title' }, 'Conector'));
    const row = el('div', { class: 'icon-row', style: { marginBottom: '6px' } });
    for (const [r, t] of [['straight', 'Reto'], ['elbow', 'Ortogonal'], ['curved', 'Curvo']]) row.append(el('button', { class: 'btn small' + ((n.routing || 'elbow') === r ? ' primary' : ''), onclick: () => ed.setProp({ routing: r }) }, t));
    s.append(row);
    s.append(el('div', { class: 'grid2' }, this.select(Object.entries(CAPS), n.startCap || 'none', (v) => ed.setProp({ startCap: v }), { label: 'Início' }), this.select(Object.entries(CAPS), n.endCap ?? 'triangle', (v) => ed.setProp({ endCap: v }), { label: 'Fim' })));
    if (sel.length === 1) {
      const lab = el('input', { type: 'text', value: n.text || '', placeholder: 'Rótulo', dataset: { keep: 'clabel' } });
      lab.addEventListener('keydown', (e) => e.stopPropagation());
      lab.addEventListener('input', () => ed.setProp({ text: lab.value.slice(0, 200) }));
      s.append(el('label', { class: 'field' }, el('span', { class: 'lbl', text: 'Rótulo' }), lab));
      s.append(el('div', { class: 'row', style: { marginTop: '6px' } }, el('label', { class: 'chk' }, checkbox(n.avoid !== false, (v) => ed.setProp({ avoid: v })), 'Desviar de formas'), el('button', { class: 'btn small ghost', title: 'Inverter direção', onclick: () => ed.setProp({ from: n.to, to: n.from, startCap: n.endCap, endCap: n.startCap }) }, '⇄ Inverter')));
    }
    return s;
  }

  instanceSection(n) {
    const ed = this.ed;
    const store = this.store;
    const comp = store.get(n.componentId);
    const s = el('div', { class: 'section' });
    s.append(el('div', { class: 'section-title' }, 'Instância'));
    if (!comp) {
      s.append(el('div', { class: 'hint', text: 'O componente principal foi excluído.' }));
      return s;
    }
    s.append(el('div', { class: 'row' }, el('button', { class: 'btn small', onclick: () => {
      ed.setPage(comp.page);
      ed.select([comp.id]);
      ed.zoomToSelection();
    } }, icon('component', 14), 'Ir para o principal'), el('button', { class: 'btn small', onclick: () => ed.detachInstance(n.id) }, 'Desanexar')));
    const texts = store.descendants(comp.id).filter((d) => hasText(d));
    if (texts.length) {
      s.append(el('div', { class: 'hint', text: 'Substituições de texto' }));
      for (const t of texts) {
        const cur = (n.overrides && n.overrides[t.id] && n.overrides[t.id].text) ?? t.text;
        const inp = el('input', { type: 'text', value: cur || '', dataset: { keep: 'ov' + t.id } });
        inp.addEventListener('keydown', (e) => e.stopPropagation());
        inp.addEventListener('input', () => ed.setProp((x) => ({ overrides: { ...(x.overrides || {}), [t.id]: { ...((x.overrides || {})[t.id] || {}), text: inp.value } } }), [n.id]));
        s.append(el('label', { class: 'field', style: { marginBottom: '4px' } }, el('span', { class: 'lbl', text: (t.name || 'Texto').slice(0, 10) }), inp));
      }
    }
    const shapes = store.descendants(comp.id).filter((d) => d.fill && d.fill.type === 'solid' && !hasText(d) || d.type === 'sticky');
    if (shapes.length) {
      s.append(el('div', { class: 'hint', text: 'Substituições de cor' }));
      for (const t of shapes.slice(0, 6)) {
        const cur = (n.overrides && n.overrides[t.id] && n.overrides[t.id].fill) || t.fill;
        s.append(el('div', { class: 'row' }, el('span', { class: 'hint', text: (t.name || '').slice(0, 12), style: { width: '70px', margin: 0 } }), this.color(cur.color, cur.alpha, (p) => ed.setProp((x) => ({ overrides: { ...(x.overrides || {}), [t.id]: { ...((x.overrides || {})[t.id] || {}), fill: { ...cur, ...p } } } }), [n.id]), 'ovc' + t.id)));
      }
    }
    if (n.overrides && Object.keys(n.overrides).length) s.append(el('button', { class: 'btn small ghost', onclick: () => ed.setProp({ overrides: {} }, [n.id]) }, 'Restaurar substituições'));
    return s;
  }

  exportSection(sel) {
    const s = el('div', { class: 'section' });
    s.append(el('div', { class: 'section-title' }, 'Exportar'));
    let fmt = 'png';
    let scale = 2;
    s.append(el('div', { class: 'grid2' }, this.select([['png', 'PNG'], ['jpg', 'JPG'], ['svg', 'SVG'], ['pdf', 'PDF']], fmt, (v) => (fmt = v), { key: 'efmt' }), this.select([[1, '1×'], [2, '2×'], [3, '3×'], [4, '4×']], scale, (v) => (scale = Number(v)), { key: 'escale' })));
    s.append(el('button', { class: 'btn small', style: { width: '100%', justifyContent: 'center' }, onclick: async () => {
      try {
        await exportNodes(this.store, sel, fmt, { scale, name: sel.length === 1 ? sel[0].name : this.store.name });
      } catch (e) {
        this.toast(e.message);
      }
    } }, icon('download', 14), `Exportar ${sel.length === 1 ? sel[0].name || '' : sel.length + ' itens'}`));
    return s;
  }

  renderProto(body) {
    const ed = this.ed;
    const store = this.store;
    const sel = ed.selection;
    const frames = presentableFrames(store, ed.page);
    const s = el('div', { class: 'section' });
    s.append(el('div', { class: 'section-title' }, 'Interação'));
    if (!sel.length) s.append(el('div', { class: 'hint', text: 'Selecione um objeto dentro de um frame e escolha para qual frame ele leva ao ser clicado. Depois, use Apresentar.' }));
    else {
      const n = sel[0];
      const link = n.link || {};
      s.append(el('div', { class: 'hint', text: 'Ao clicar, navegar para:' }));
      s.append(this.select([['', 'Nenhum'], ...frames.filter((f) => f.id !== n.id).map((f) => [f.id, f.name || 'Frame'])], link.to || '', (v) => ed.setProp({ link: v ? { ...link, to: v, transition: link.transition || 'dissolve' } : undefined }), { key: 'linkto' }));
      if (link.to) s.append(el('div', { style: { marginTop: '6px' } }, this.select([['dissolve', 'Dissolver'], ['slide-left', 'Deslizar para a esquerda'], ['slide-right', 'Deslizar para a direita'], ['none', 'Instantânea']], link.transition || 'dissolve', (v) => ed.setProp({ link: { ...link, transition: v } }), { label: 'Transição' })));
    }
    body.append(s);
    const p = el('div', { class: 'section' });
    p.append(el('div', { class: 'section-title' }, 'Apresentação'));
    p.append(el('div', { class: 'hint', text: `${frames.length} frames nesta página, na ordem de leitura (de cima para baixo, da esquerda para a direita).` }));
    p.append(el('div', { class: 'row' }, el('button', { class: 'btn small primary', onclick: () => this.startPresent() }, icon('play', 14), 'Apresentar'), el('label', { class: 'chk' }, checkbox(!!ed.emitLinks, (v) => { ed.emitLinks = v; ed.invalidate(); }), 'Mostrar links')));
    body.append(p);
  }

  startPresent() {
    const sel = this.ed.selection[0];
    const start = sel ? (sel.type === 'frame' || sel.type === 'component' || sel.type === 'section' ? sel.id : this.store.ancestors(sel.id).find((a) => !a.parent)?.id) : null;
    if (!present(this.store, this.ed.page, start)) this.toast('Crie ao menos um frame (F) para apresentar');
  }

  renderData(body) {
    const ed = this.ed;
    const store = this.store;
    const s = el('div', { class: 'section' });
    s.append(el('div', { class: 'section-title' }, 'Fontes de dados', el('button', { class: 'btn small ghost', onclick: () => this.importCSV() }, icon('upload', 13), 'CSV')));
    const sources = [...store.dataY.entries()];
    if (!sources.length) s.append(el('div', { class: 'hint', text: 'Importe um CSV para ligar dados às formas. Use {{coluna}} no texto de uma forma para mostrar o valor da linha escolhida.' }));
    for (const [name, ds] of sources) {
      const box = el('div', { class: 'list-item', style: { flexDirection: 'column', alignItems: 'stretch' } });
      box.append(el('div', { class: 'row' }, icon('csv', 15), el('b', { text: name, style: { flex: '1' } }), el('span', { class: 'hint', text: `${ds.rows.length} linhas`, style: { margin: 0 } }), el('button', { class: 'icon-btn', title: 'Excluir fonte', onclick: () => store.transact(() => store.dataY.delete(name)) }, icon('trash', 13))));
      const table = el('table', { class: 'data-table' });
      table.append(el('tr', {}, ...ds.columns.slice(0, 4).map((c) => el('th', { text: c }))));
      for (const r of ds.rows.slice(0, 4)) table.append(el('tr', {}, ...ds.columns.slice(0, 4).map((c) => el('td', { text: r[c] }))));
      box.append(table);
      box.append(el('div', { class: 'row', style: { marginTop: '6px', flexWrap: 'wrap' } },
        el('button', { class: 'btn small', onclick: () => this.shapesFromData(name) }, 'Criar cartões'),
        el('button', { class: 'btn small', onclick: () => this.orgChart(name) }, icon('tree', 13), 'Organograma')));
      s.append(box);
    }
    body.append(s);
    const sel = ed.selection.filter((n) => hasText(n));
    if (sel.length && sources.length) {
      const l = el('div', { class: 'section' });
      l.append(el('div', { class: 'section-title' }, 'Vincular seleção'));
      const n = sel[0];
      const cur = n.data || {};
      l.append(this.select([['', 'Sem vínculo'], ...sources.map(([k]) => [k, k])], cur.source || '', (v) => ed.setProp({ data: v ? { source: v, row: 0 } : undefined }), { key: 'dsrc' }));
      if (cur.source && store.dataY.get(cur.source)) {
        const ds = store.dataY.get(cur.source);
        l.append(el('div', { style: { marginTop: '6px' } }, this.num('Linha', (cur.row | 0) + 1, (v) => ed.setProp({ data: { ...cur, row: clamp(Math.round(v) - 1, 0, ds.rows.length - 1) } }), { min: 1, max: ds.rows.length, key: 'drow' })));
        l.append(el('div', { class: 'hint', text: 'Campos: ' + ds.columns.map((c) => `{{${c}}}`).join(' ') }));
      }
      body.append(l);
    }
    const a = el('div', { class: 'section' });
    a.append(el('div', { class: 'section-title' }, 'Layout automático do diagrama'));
    a.append(el('div', { class: 'hint', text: 'Organiza em camadas as formas selecionadas (ou a página inteira) seguindo os conectores, sem sobreposição.' }));
    a.append(el('div', { class: 'row' }, el('button', { class: 'btn small', onclick: () => ed.autoArrange(0) }, '↓ Cima → baixo'), el('button', { class: 'btn small', onclick: () => ed.autoArrange(1) }, '→ Esquerda → direita')));
    body.append(a);
  }

  async importCSV() {
    const f = await pickFile('.csv,text/csv,text/plain');
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) return this.toast('CSV acima de 5 MB');
    const data = parseCSV(await f.text());
    if (!data.columns.length) return this.toast('CSV vazio');
    const name = f.name.replace(/\.[^.]+$/, '').slice(0, 60) || 'dados';
    this.store.transact(() => this.store.dataY.set(name, { columns: data.columns, rows: data.rows.slice(0, 5000) }));
    this.rightTab = 'data';
    this.renderRight();
    this.toast(`${data.rows.length} linhas importadas de ${f.name}`);
  }

  shapesFromData(name) {
    const ed = this.ed;
    const ds = this.store.dataY.get(name);
    if (!ds) return;
    const c = ed.viewportCenter();
    const cols = ds.columns;
    const ids = [];
    ed.commit(() => {
      ds.rows.slice(0, 200).forEach((r, i) => {
        const x = c.x - 450 + (i % 4) * 230;
        const y = c.y - 100 + Math.floor(i / 4) * 110;
        ids.push(this.store.add({ type: 'shape', shape: 'orgCard', page: ed.page, parent: null, name: String(r[cols[0]] || 'Cartão'), x, y, w: 210, h: 84, fill: { type: 'solid', color: '#FAF6EF', alpha: 1 }, stroke: { color: '#5C4034', alpha: 1 }, strokeWidth: 1.5, text: cols.slice(0, 3).map((k) => `{{${k}}}`).join('\n'), fontSize: 13, data: { source: name, row: i } }));
      });
    });
    ed.select(ids);
  }

  orgChart(name) {
    const ed = this.ed;
    const ds = this.store.dataY.get(name);
    if (!ds) return;
    const find = (...keys) => ds.columns.find((c) => keys.some((k) => c.toLowerCase().includes(k)));
    const idCol = find('id', 'matr', 'código', 'codigo') || ds.columns[0];
    const nameCol = find('nome', 'name') || ds.columns[1] || ds.columns[0];
    const roleCol = find('cargo', 'title', 'função', 'funcao', 'role');
    const mgrCol = find('gestor', 'manager', 'chefe', 'superior', 'líder', 'lider', 'parent');
    if (!mgrCol) return this.toast('O CSV precisa de uma coluna de gestor (gestor, manager, superior…)');
    const c = ed.viewportCenter();
    const map = new Map();
    const ids = [];
    ed.commit(() => {
      ds.rows.slice(0, 300).forEach((r, i) => {
        const id = this.store.add({ type: 'shape', shape: 'orgCard', page: ed.page, parent: null, name: String(r[nameCol] || 'Pessoa'), x: c.x + (i % 10) * 220, y: c.y, w: 200, h: 76, fill: { type: 'solid', color: '#FAF6EF', alpha: 1 }, stroke: { color: '#5C4034', alpha: 1 }, strokeWidth: 1.5, text: roleCol ? `{{${nameCol}}}\n{{${roleCol}}}` : `{{${nameCol}}}`, fontSize: 13, data: { source: name, row: i } });
        map.set(String(r[idCol]).trim(), id);
        ids.push(id);
      });
      ds.rows.slice(0, 300).forEach((r, i) => {
        const m = map.get(String(r[mgrCol] || '').trim());
        if (m && m !== ids[i]) this.store.add({ type: 'connector', page: ed.page, parent: null, name: 'Conector', x: 0, y: 0, w: 0, h: 0, from: { node: m, side: 'bottom' }, to: { node: ids[i], side: 'top' }, routing: 'elbow', startCap: 'none', endCap: 'none', stroke: { color: '#7A6E46', alpha: 1 }, strokeWidth: 1.5, avoid: false });
      });
    });
    ed.select(ids);
    ed.autoArrange(0).then(() => {
      ed.zoomToSelection();
    });
  }

  renderComments(body) {
    const store = this.store;
    const list = [...store.commentsY.values()].filter((c) => c.page === this.ed.page).sort((a, b) => b.createdAt - a.createdAt);
    const s = el('div', { class: 'section' });
    s.append(el('div', { class: 'section-title' }, 'Comentários nesta página', el('button', { class: 'btn small ghost', onclick: () => this.ed.setTool('comment') }, icon('plus', 13), 'Novo')));
    if (!list.length) s.append(el('div', { class: 'hint', text: 'Use a ferramenta Comentário (C) e clique na tela para abrir uma conversa.' }));
    for (const c of list) {
      const item = el('div', { class: 'list-item', style: { cursor: 'pointer', opacity: c.resolved ? 0.55 : 1 } }, el('span', { class: 'avatar', style: { background: c.color, marginLeft: 0 } }, (c.author || '?').slice(0, 1)), el('div', { class: 'grow' }, el('div', {}, el('b', { text: c.author }), ' ', el('span', { class: 'sub', text: when(c.createdAt) })), el('div', { class: 'sub', text: c.body.slice(0, 90) }), c.replies?.length ? el('div', { class: 'sub', text: `${c.replies.length} resposta(s)` }) : ''));
      item.onclick = () => {
        this.ed.animateView(c.x - this.dom.stageHost.clientWidth / 2 / this.ed.zoom, c.y - this.dom.stageHost.clientHeight / 2 / this.ed.zoom, this.ed.zoom);
        setTimeout(() => this.openThread(c.id), 260);
      };
      s.append(item);
    }
    body.append(s);
  }

  newComment(pos) {
    const id = 'c' + uid(10);
    const u = this.store.user;
    this.openThread(null, { id, x: pos.x, y: pos.y, page: this.ed.page, author: u.name, color: u.color });
  }

  openThread(id, draft) {
    this.closeThread();
    const store = this.store;
    const c = id ? store.commentsY.get(id) : null;
    const pos = this.ed.toScreen((c || draft).x, (c || draft).y);
    const r = this.dom.stageHost.getBoundingClientRect();
    const pop = el('div', { class: 'popover thread' });
    pop.style.left = clamp(r.left + pos.x + 18, 8, innerWidth - 320) + 'px';
    pop.style.top = clamp(r.top + pos.y - 30, 8, innerHeight - 380) + 'px';
    if (c) {
      pop.append(el('div', { class: 'bar' }, el('b', { text: 'Conversa' }), el('span', {},
        el('button', { class: 'btn small ghost', title: c.resolved ? 'Reabrir' : 'Resolver', onclick: () => { store.transact(() => store.commentsY.set(c.id, { ...c, resolved: !c.resolved })); this.closeThread(); } }, icon('resolve', 14), c.resolved ? 'Reabrir' : 'Resolver'),
        el('button', { class: 'btn small ghost', title: 'Excluir conversa', onclick: () => { store.transact(() => store.commentsY.delete(c.id)); this.closeThread(); } }, icon('trash', 14)),
        el('button', { class: 'btn small ghost', title: 'Fechar', onclick: () => this.closeThread() }, icon('close', 14)))));
      const msgs = el('div', { class: 'msgs' });
      for (const m of [c, ...(c.replies || [])]) msgs.append(el('div', { class: 'msg' }, el('div', { class: 'who' }, el('span', { class: 'avatar', style: { background: m.color, width: '20px', height: '20px', marginLeft: 0, fontSize: '10px' } }, (m.author || '?').slice(0, 1)), m.author, el('span', { class: 'when', text: when(m.createdAt) })), el('div', { class: 'txt', text: m.body })));
      pop.append(msgs);
    }
    const ta = el('textarea', { placeholder: c ? 'Responder…' : 'Escreva um comentário…', 'aria-label': 'Comentário' });
    const send = () => {
      const body = ta.value.trim().slice(0, 4000);
      if (!body) return;
      const u = store.user;
      store.transact(() => {
        if (c) store.commentsY.set(c.id, { ...c, replies: [...(c.replies || []), { author: u.name, color: u.color, body, createdAt: Date.now() }] });
        else store.commentsY.set(draft.id, { ...draft, body, replies: [], resolved: false, createdAt: Date.now() });
      });
      this.closeThread();
      this.openThread(c ? c.id : draft.id);
    };
    ta.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        send();
      }
      if (e.key === 'Escape') this.closeThread();
    });
    pop.append(el('div', { class: 'compose' }, ta, el('button', { class: 'btn primary small', onclick: send }, 'Enviar')));
    document.body.append(pop);
    this.thread = pop;
    ta.focus();
    setTimeout(() => {
      this.offThread = (e) => {
        if (!pop.contains(e.target) && !e.target.classList?.contains('pin')) this.closeThread();
      };
      addEventListener('pointerdown', this.offThread, true);
    });
  }

  closeThread() {
    if (this.thread) this.thread.remove();
    this.thread = null;
    if (this.offThread) removeEventListener('pointerdown', this.offThread, true);
  }

  positionHtml() {
    const ed = this.ed;
    const layer = this.dom.htmlLayer;
    const seen = new Set();
    let i = 0;
    for (const c of this.store.commentsY.values()) {
      if (c.page !== ed.page) continue;
      i++;
      seen.add(c.id);
      let pin = this.pins.get(c.id);
      if (!pin) {
        pin = el('button', { class: 'pin', title: `${c.author}: ${c.body}`.slice(0, 120) });
        pin.onclick = () => this.openThread(c.id);
        layer.append(pin);
        this.pins.set(c.id, pin);
      }
      const p = ed.toScreen(c.x, c.y);
      pin.style.transform = `translate(${p.x}px, ${p.y}px)`;
      pin.style.background = c.color;
      pin.textContent = (c.author || '?').slice(0, 1).toUpperCase();
      pin.classList.toggle('resolved', !!c.resolved);
    }
    for (const [id, pin] of this.pins) if (!seen.has(id)) {
      pin.remove();
      this.pins.delete(id);
    }
    const seenC = new Set();
    for (const [cid, st] of this.store.awareness.getStates()) {
      if (cid === this.store.doc.clientID || !st.user || !st.cursor || st.cursor.page !== ed.page) continue;
      seenC.add(cid);
      let cur = this.cursors.get(cid);
      if (!cur) {
        cur = el('div', { class: 'cursor' });
        cur.innerHTML = `<svg width="18" height="20" viewBox="0 0 13 13" shape-rendering="crispEdges"><path d="${CURSOR_D}" fill="currentColor" stroke="#fff" stroke-width="0.6"/></svg>`;
        cur.append(el('span'));
        layer.append(cur);
        this.cursors.set(cid, cur);
      }
      const p = ed.toScreen(st.cursor.x, st.cursor.y);
      cur.style.transform = `translate(${p.x}px, ${p.y}px)`;
      cur.style.color = st.user.color;
      const lab = cur.querySelector('span');
      lab.textContent = st.user.name;
      lab.style.background = st.user.color;
    }
    for (const [cid, cur] of this.cursors) if (!seenC.has(cid)) {
      cur.remove();
      this.cursors.delete(cid);
    }
  }

  updateStatus() {
    const ed = this.ed;
    const sb = this.dom.statusbar;
    const nodes = ed.pageNodes().length;
    const sel = ed.selection;
    const info = sel.length === 1 ? `${TYPE_NAME[sel[0].type] || sel[0].type} · ${sel[0].name || ''}` : sel.length ? `${sel.length} selecionados` : 'Nada selecionado';
    const html = [
      el('span', {}, el('b', { text: this.app.renderer.backend || '—' }), ' render'),
      el('span', {}, el('b', { text: this.app.engineMode }), ' núcleo'),
      el('span', {}, el('b', { text: this.store.mode === 'server' ? 'Servidor' : 'Local' }), ' modo'),
      el('span', { text: `${nodes} objetos na página` }),
      el('span', { class: 'grow', text: info }),
      el('span', { text: `X ${Math.round(ed.mouse.x)}  Y ${Math.round(ed.mouse.y)}` }),
      el('span', { text: `${Math.round(ed.zoom * 100)}%` }),
    ];
    sb.replaceChildren(...html);
  }

  bindKeys() {
    addEventListener('keydown', (e) => this.onKey(e));
    addEventListener('keyup', (e) => {
      if (e.code === 'Space') {
        this.ed.spaceDown = false;
        this.ed.overlay.style.cursor = this.ed.tool === 'hand' ? 'grab' : 'default';
      }
    });
    addEventListener('copy', (e) => {
      if (this.isTyping(e)) return;
      const t = this.ed.copy();
      if (t) {
        e.clipboardData.setData('text/plain', t);
        e.preventDefault();
      }
    });
    addEventListener('cut', (e) => {
      if (this.isTyping(e)) return;
      const t = this.ed.copy(true);
      if (t) {
        e.clipboardData.setData('text/plain', t);
        e.preventDefault();
      }
    });
    addEventListener('paste', (e) => this.onPaste(e));
  }

  isTyping(e) {
    const t = e.target;
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  }

  async onPaste(e) {
    if (this.isTyping(e)) return;
    const cd = e.clipboardData;
    if (!cd) return;
    e.preventDefault();
    for (const item of cd.items || []) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const f = item.getAsFile();
        if (f) return this.dropFiles([f], this.ed.viewportCenter());
      }
    }
    const text = cd.getData('text/plain');
    if (text && text.startsWith('GRAFO:')) {
      try {
        const data = JSON.parse(text.slice(6));
        this.ed.paste(data, 20, 20, true);
        return;
      } catch {}
    }
    if (this.ed.clipboard && (!text || text.startsWith('GRAFO:'))) return this.ed.paste(this.ed.clipboard, 20, 20, true);
    if (text && text.trim()) {
      if (/^\s*<svg[\s>]/i.test(text)) {
        const url = await importSvgAsImage(new File([text], 'colado.svg'));
        const img = await loadImage(url);
        const c = this.ed.viewportCenter();
        this.ed.insertImage(url, img.naturalWidth || 200, img.naturalHeight || 200, c.x, c.y, 'SVG colado');
        return;
      }
      const c = this.ed.viewportCenter();
      const id = this.ed.createText(c.x, c.y, text.slice(0, 20000));
      const n = this.store.get(id);
      const fit = fitText(n, this.store);
      if (fit) this.ed.setProp(fit, [id]);
      this.ed.select([id]);
    }
  }

  onKey(e) {
    if (this.isTyping(e)) return;
    if (document.querySelector('.modal-back') || document.querySelector('.present')) return;
    const ed = this.ed;
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const run = (fn) => {
      e.preventDefault();
      fn();
    };
    if (e.code === 'Space' && !e.repeat) {
      ed.spaceDown = true;
      ed.overlay.style.cursor = 'grab';
      e.preventDefault();
      return;
    }
    if (ctrl) {
      if (k === 'z' && !e.shiftKey) return run(() => this.store.undo.undo());
      if ((k === 'z' && e.shiftKey) || k === 'y') return run(() => this.store.undo.redo());
      if (k === 'd') return run(() => ed.duplicate());
      if (k === 'a') return run(() => ed.selectAll());
      if (k === 'g' && e.altKey) return run(() => ed.frameSelection());
      if (k === 'g' && e.shiftKey) return run(() => ed.ungroup());
      if (k === 'g') return run(() => ed.group());
      if (k === 'k' && e.altKey) return run(() => ed.makeComponent());
      if (k === 'b' && e.altKey) return run(() => ed.selection.forEach((n) => ed.detachInstance(n.id)));
      if (k === 'k' && e.shiftKey) return run(() => this.importImage());
      if (k === 's' && e.altKey) return run(() => this.saveVersionDialog());
      if (k === 's') return run(() => saveGrafoFile(this.store));
      if (k === 'o' && e.shiftKey) return run(() => { ed.settings.outlines = !ed.settings.outlines; ed.saveSettings(); });
      if (k === 'o') return run(() => this.openFile());
      if (k === 'e' && e.shiftKey) return run(() => this.exportDialog());
      if (k === 'n' && e.altKey) return run(() => this.app.newFile());
      if (k === 'h' && e.shiftKey) return run(() => this.toggleProp('visible'));
      if (k === 'l' && e.shiftKey) return run(() => this.toggleProp('locked'));
      if (k === 'h' && e.altKey) return run(() => ed.distribute('h'));
      if (k === 'v' && e.altKey) return run(() => ed.distribute('v'));
      if (k === 'y' && e.shiftKey) return run(() => ed.autoArrange(0));
      if (k === 'v' && e.shiftKey && !e.altKey) return run(() => ed.clipboard && ed.paste(ed.clipboard, 0, 0, true));
      if (e.code === 'BracketRight') return run(() => ed.arrange(e.shiftKey ? 'front' : 'forward'));
      if (e.code === 'BracketLeft') return run(() => ed.arrange(e.shiftKey ? 'back' : 'backward'));
      if (k === '=' || k === '+') return run(() => ed.zoomStep(1));
      if (k === '-') return run(() => ed.zoomStep(-1));
      if (k === '0') return run(() => this.zoom100());
      if (k === '/') return run(() => this.shortcutsDialog());
      if (k === '\\') return run(() => this.dom.app.classList.toggle('ui-hidden'));
      if (k === "'") return run(() => { ed.settings.grid = !ed.settings.grid; ed.saveSettings(); });
      if (e.key === 'Enter' && e.altKey) return run(() => this.startPresent());
      return;
    }
    if (e.altKey) {
      const map = { a: 'left', d: 'right', w: 'top', s: 'bottom', h: 'centerH', v: 'centerV' };
      if (map[k]) return run(() => ed.align(map[k]));
      if (k === 't') return run(() => this.app.toggleTheme());
      return;
    }
    if (e.key === 'Escape') {
      if (ed.pen) return run(() => ed.finishPen(false));
      if (ed.tool !== 'select') return run(() => ed.setTool('select'));
      if (ed.entered) {
        const g = ed.entered;
        ed.entered = null;
        return run(() => ed.select([g]));
      }
      const parent = ed.selection[0]?.parent;
      return run(() => ed.select(parent ? [parent] : []));
    }
    if (e.key === 'Enter') {
      if (ed.pen) return run(() => ed.finishPen(false));
      const n = ed.selection[0];
      if (n && (n.type === 'group' || isContainer(n)) && n.type !== 'shape') {
        const kids = this.store.childrenOf(n.id);
        if (kids.length) {
          ed.entered = n.type === 'group' ? n.id : null;
          return run(() => ed.select(kids.map((c) => c.id)));
        }
      }
      if (n && (hasText(n) || n.type === 'connector')) return run(() => ed.editText(n.id));
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') return run(() => ed.remove());
    if (e.key.startsWith('Arrow')) {
      const d = e.shiftKey ? 10 : 1;
      const v = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] }[e.key];
      return run(() => ed.nudge(...v));
    }
    if (e.shiftKey) {
      if (k === '1' || e.code === 'Digit1') return run(() => ed.zoomToFit());
      if (k === '2' || e.code === 'Digit2') return run(() => ed.zoomToSelection());
      if (k === '0' || e.code === 'Digit0') return run(() => this.zoom100());
      if (k === 'a') return run(() => ed.toggleAutoLayout());
      if (k === 'h') return run(() => ed.flip('h'));
      if (k === 'v') return run(() => ed.flip('v'));
      if (k === 's') return run(() => ed.setTool('section'));
      if (k === 'l') return run(() => ed.setTool('arrow'));
      if (k === 'p') return run(() => ed.setTool('pencil'));
      if (k === 'y') return run(() => ed.setTool('polygon'));
      if (k === '*') return run(() => ed.setTool('star'));
      if (k === 'r') return run(() => { ed.settings.rulers = !ed.settings.rulers; ed.saveSettings(); });
      if (k === 'm') return run(() => { ed.settings.minimap = !ed.settings.minimap; ed.saveSettings(); });
      if (k === 'c') return run(() => this.rightTab = 'comments', this.renderRight());
      return;
    }
    const tools = { v: 'select', k: 'scale', f: 'frame', r: 'rect', o: 'ellipse', l: 'line', p: 'pen', t: 'text', s: 'sticky', x: 'connector', h: 'hand', c: 'comment', '*': 'star' };
    if (tools[k]) return run(() => ed.setTool(tools[k]));
    if (k === '+' || k === '=') return run(() => ed.zoomStep(1));
    if (k === '-') return run(() => ed.zoomStep(-1));
    if (/^[0-9]$/.test(k) && ed.sel.size) return run(() => ed.setProp({ opacity: k === '0' ? 1 : Number(k) / 10 }));
  }

  async importImage() {
    const files = await pickFile('image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.svg', true);
    if (files && files.length) this.dropFiles(files, this.ed.viewportCenter());
  }

  async replaceImage(id) {
    const f = await pickFile('image/*');
    if (!f) return;
    const src = f.type === 'image/svg+xml' ? await importSvgAsImage(f) : await readDataURL(f);
    const aid = 'a' + uid(10);
    this.ed.commit(() => {
      this.store.assetsY.set(aid, src);
      this.store.update(id, { src: aid });
    });
  }

  async dropFiles(files, world) {
    let x = world.x;
    for (const f of files) {
      try {
        if (f.name.endsWith('.grafo') || f.type === 'application/json') {
          const data = JSON.parse(await f.text());
          if (!validGrafo(data)) throw new Error('inválido');
          await this.app.newFile(data);
          return;
        }
        if (f.name.endsWith('.csv')) continue;
        if (f.size > 15 * 1024 * 1024) {
          this.toast(`${f.name}: acima de 15 MB`);
          continue;
        }
        const src = f.type === 'image/svg+xml' || f.name.endsWith('.svg') ? await importSvgAsImage(f) : await downscale(await readDataURL(f));
        const img = await loadImage(src);
        this.ed.insertImage(src, img.naturalWidth || 300, img.naturalHeight || 200, x, world.y, f.name.replace(/\.[^.]+$/, ''));
        x += Math.min(800, img.naturalWidth || 300) + 40;
      } catch (err) {
        this.toast(`Não foi possível importar ${f.name}`);
      }
    }
  }

  async openFile() {
    const f = await pickFile('.grafo,application/json');
    if (!f) return;
    let data = null;
    try {
      data = JSON.parse(await f.text());
    } catch {
      data = null;
    }
    if (!validGrafo(data)) return this.toast('Arquivo .grafo inválido');
    await this.app.newFile(data);
  }

  modal(title, content, buttons = []) {
    const back = el('div', { class: 'modal-back' });
    const close = () => {
      back.remove();
      removeEventListener('keydown', esc, true);
    };
    const esc = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    addEventListener('keydown', esc, true);
    const m = el('div', { class: 'modal', role: 'dialog', 'aria-label': title });
    m.append(el('header', {}, title, el('button', { class: 'btn icon ghost', title: 'Fechar', onclick: close }, icon('close', 16))));
    const body = el('div', { class: 'body' }, content);
    m.append(body);
    if (buttons.length) m.append(el('footer', {}, ...buttons.map((b) => el('button', { class: 'btn' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : ''), onclick: () => {
      if (b.run && b.run() === false) return;
      close();
    } }, b.label))));
    back.addEventListener('pointerdown', (e) => {
      if (e.target === back) close();
    });
    back.append(m);
    document.body.append(back);
    const first = m.querySelector('input, textarea, select');
    if (first) setTimeout(() => first.focus(), 30);
    return { close, body };
  }

  prompt(title, label, value, onOk) {
    const input = el('input', { type: 'text', value });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        onOk(input.value);
        m.close();
      }
    });
    const m = this.modal(title, el('label', {}, el('span', { text: label }), input), [{ label: 'Cancelar' }, { label: 'OK', primary: true, run: () => onOk(input.value) }]);
  }

  confirm(title, text, onOk) {
    this.modal(title, el('p', { text }), [{ label: 'Cancelar' }, { label: 'Confirmar', primary: true, run: onOk }]);
  }

  exportDialog(page = false) {
    const ed = this.ed;
    const store = this.store;
    const sel = ed.selection;
    const frames = presentableFrames(store, ed.page);
    const opts = [];
    if (sel.length && !page) opts.push(['sel', `Seleção (${sel.length})`]);
    if (frames.length) opts.push(['frames', `Todos os frames da página (${frames.length})`]);
    opts.push(['page', 'Página inteira']);
    let what = opts[0][0];
    let fmt = 'png';
    let scale = 2;
    let bg = true;
    const content = el('div', {},
      el('label', {}, el('span', { text: 'O que exportar' }), selectEl(opts, what, (v) => (what = v))),
      el('label', {}, el('span', { text: 'Formato' }), selectEl([['png', 'PNG'], ['jpg', 'JPG'], ['svg', 'SVG (vetorial)'], ['pdf', 'PDF (uma página por frame)'], ['grafo', 'Arquivo .grafo (projeto inteiro)']], fmt, (v) => (fmt = v))),
      el('label', {}, el('span', { text: 'Escala (PNG, JPG e PDF)' }), selectEl([[1, '1×'], [2, '2×'], [3, '3×'], [4, '4×']], scale, (v) => (scale = Number(v)))),
      el('label', { class: 'chk' }, checkbox(bg, (v) => (bg = v)), 'Fundo branco'));
    this.modal('Exportar', content, [{ label: 'Cancelar' }, { label: 'Exportar', primary: true, run: () => {
      if (fmt === 'grafo') return void saveGrafoFile(store);
      const roots = what === 'sel' ? sel : what === 'frames' ? frames : store.childrenOf(null, ed.page).filter((n) => n.page === ed.page);
      const asPages = fmt === 'pdf' && what !== 'page' ? roots : null;
      const go = async () => {
        try {
          if (fmt === 'pdf' && what === 'frames') await exportNodes(store, asPages, 'pdf', { scale, background: bg ? '#FFFFFF' : null, name: store.name });
          else if (fmt === 'pdf') await exportNodes(store, roots.length === 1 ? roots : [roots[0]].concat(roots.slice(1)), 'pdf', { scale, background: '#FFFFFF', name: store.name });
          else if (what === 'frames' && fmt !== 'svg') for (const f of roots) await exportNodes(store, [f], fmt, { scale, background: bg ? '#FFFFFF' : null, name: f.name });
          else await exportNodes(store, roots, fmt, { scale, background: bg ? '#FFFFFF' : null, name: store.name });
          this.toast('Exportação concluída');
        } catch (e) {
          this.toast(e.message || 'Falha ao exportar');
        }
      };
      go();
    } }]);
  }

  async copySVG() {
    const { svg } = toSVG(this.store, this.ed.selection, {});
    try {
      await navigator.clipboard.writeText(svg);
      this.toast('SVG copiado');
    } catch {
      download(new Blob([svg], { type: 'image/svg+xml' }), safeName(this.store.name) + '.svg');
    }
  }

  saveVersionDialog() {
    this.prompt('Salvar versão', 'Nome da versão', `Versão de ${new Date().toLocaleString('pt-BR')}`, async (label) => {
      await this.store.saveVersion(label.trim().slice(0, 120));
      this.toast('Versão salva');
    });
  }

  async versionsDialog() {
    const list = await this.store.versions();
    const box = el('div', {});
    if (!list.length) box.append(el('p', { class: 'hint', text: 'Nenhuma versão salva ainda. Use Arquivo → Salvar versão (Ctrl+Alt+S).' }));
    let m;
    for (const v of list) {
      box.append(el('div', { class: 'list-item' }, icon('history', 16), el('div', { class: 'grow' }, el('b', { text: v.label }), el('div', { class: 'sub', text: `${new Date(v.createdAt).toLocaleString('pt-BR')} · ${v.author || ''} · ${Math.round(v.state.byteLength / 1024)} KB` })), el('button', { class: 'btn small', onclick: () => {
        this.confirm('Restaurar versão', `O arquivo volta ao estado de “${v.label}”. Dá para desfazer com Ctrl+Z.`, () => {
          this.store.restoreVersion(v);
          m.close();
          this.ed.setPage(this.store.pages.get(0));
          this.toast('Versão restaurada');
        });
      } }, 'Restaurar')));
    }
    m = this.modal('Histórico de versões', box, [{ label: 'Salvar versão agora', run: () => { this.saveVersionDialog(); } }, { label: 'Fechar', primary: true }]);
  }

  async recentDialog() {
    const list = await Store.recent();
    const box = el('div', {});
    let m;
    if (!list.length) box.append(el('p', { class: 'hint', text: 'Nenhum arquivo salvo neste navegador.' }));
    for (const f of list) {
      box.append(el('div', { class: 'list-item' }, icon('page', 16), el('div', { class: 'grow' }, el('b', { text: f.name }), el('div', { class: 'sub', text: `${new Date(f.updatedAt).toLocaleString('pt-BR')} · ${Math.max(1, Math.round(f.size / 1024))} KB` })),
        f.id === this.store.fileId ? el('span', { class: 'tag', text: 'aberto' }) : el('button', { class: 'btn small', onclick: () => { m.close(); this.app.openFileId(f.id); } }, 'Abrir'),
        f.id === this.store.fileId ? '' : el('button', { class: 'btn small ghost danger', title: 'Apagar deste navegador', onclick: async () => { await Store.removeLocal(f.id); m.close(); this.recentDialog(); } }, icon('trash', 14))));
    }
    m = this.modal('Arquivos recentes', box, [{ label: 'Novo arquivo', run: () => this.app.newFile() }, { label: 'Fechar', primary: true }]);
  }

  shareDialog() {
    const store = this.store;
    const url = location.href;
    const name = el('input', { type: 'text', value: store.user.name, maxlength: 40 });
    const colors = el('div', { class: 'palette-chips' });
    let color = store.user.color;
    for (const c of userColors) {
      const b = el('button', { class: 'chip', style: { background: c, outline: c === color ? '2px solid var(--accent)' : '', outlineOffset: '2px', width: '24px', height: '24px' }, onclick: () => {
        color = c;
        for (const x of colors.children) x.style.outline = '';
        b.style.outline = '2px solid var(--accent)';
      } });
      colors.append(b);
    }
    const link = el('input', { type: 'text', value: url, readonly: true });
    const content = el('div', {},
      el('p', { class: 'hint', text: store.mode === 'server' ? 'Quem abrir este link edita junto com você em tempo real.' : 'Modo local: o arquivo fica neste navegador e as abas abertas com este link colaboram entre si. Rode o servidor (Docker Compose) para colaborar com outras pessoas.' }),
      el('label', {}, el('span', { text: 'Link do arquivo' }), el('div', { class: 'row' }, link, el('button', { class: 'btn', onclick: async () => { try { await navigator.clipboard.writeText(url); this.toast('Link copiado'); } catch { link.select(); } } }, icon('copy', 14), 'Copiar'))),
      el('label', {}, el('span', { text: 'Seu nome' }), name),
      el('label', {}, el('span', { text: 'Sua cor' }), colors));
    this.modal('Compartilhar e colaborar', content, [{ label: 'Fechar' }, { label: 'Salvar', primary: true, run: () => {
      store.setUser({ name: name.value.trim().slice(0, 40) || store.user.name, color });
      this.updateAvatars();
    } }]);
  }

  shortcutsDialog() {
    const rows = [
      ['Mover / Escala', 'V / K'], ['Frame / Seção', 'F / Shift+S'], ['Retângulo / Elipse', 'R / O'], ['Linha / Seta', 'L / Shift+L'], ['Polígono / Estrela', 'Shift+Y / *'], ['Caneta / Lápis', 'P / Shift+P'], ['Texto', 'T'], ['Nota adesiva', 'S'], ['Conector', 'X'], ['Mão', 'H ou Espaço'], ['Comentário', 'C'], ['Imagem', 'Ctrl+Shift+K'],
      ['Desfazer / Refazer', 'Ctrl+Z / Ctrl+Shift+Z'], ['Copiar / Recortar / Colar', 'Ctrl+C / X / V'], ['Colar no lugar', 'Ctrl+Shift+V'], ['Duplicar', 'Ctrl+D (ou Alt+arrastar)'], ['Excluir', 'Delete'], ['Selecionar tudo', 'Ctrl+A'], ['Selecionar dentro', 'Enter / Ctrl+clique'], ['Selecionar o pai', 'Esc'],
      ['Agrupar / Desagrupar', 'Ctrl+G / Ctrl+Shift+G'], ['Frame da seleção', 'Ctrl+Alt+G'], ['Auto layout', 'Shift+A'], ['Criar componente', 'Ctrl+Alt+K'], ['Desanexar instância', 'Ctrl+Alt+B'],
      ['Trazer para frente / Enviar para trás', 'Ctrl+Shift+] / ['], ['Avançar / Recuar', 'Ctrl+] / ['], ['Alinhar (esq., centro, dir.)', 'Alt+A / Alt+H / Alt+D'], ['Alinhar (topo, meio, base)', 'Alt+W / Alt+V / Alt+S'], ['Distribuir', 'Ctrl+Alt+H / V'], ['Espelhar', 'Shift+H / Shift+V'], ['Mover 1 px / 10 px', 'Setas / Shift+Setas'], ['Opacidade 10%–100%', '1 … 0'],
      ['Mostrar/ocultar', 'Ctrl+Shift+H'], ['Bloquear', 'Ctrl+Shift+L'], ['Layout automático do diagrama', 'Ctrl+Shift+Y'],
      ['Zoom', 'Ctrl+roda, Ctrl++ / Ctrl+-'], ['Ajustar tudo / seleção / 100%', 'Shift+1 / Shift+2 / Shift+0'], ['Réguas / Minimapa', 'Shift+R / Shift+M'], ['Grade de pixels', "Ctrl+'"], ['Contornos', 'Ctrl+Shift+O'], ['Ocultar interface', 'Ctrl+\\'], ['Tema', 'Alt+T'],
      ['Salvar cópia .grafo / Abrir', 'Ctrl+S / Ctrl+O'], ['Salvar versão', 'Ctrl+Alt+S'], ['Exportar', 'Ctrl+Shift+E'], ['Apresentar', 'Ctrl+Alt+Enter'], ['Atalhos', 'Ctrl+/'],
      ['Restringir ângulo e proporção', 'Shift ao arrastar'], ['Desenhar do centro', 'Alt ao arrastar'], ['Desligar encaixe', 'Ctrl ao arrastar'],
    ];
    const t = el('table', { class: 'kbd-table' });
    for (const [a, b] of rows) t.append(el('tr', {}, el('td', { text: a }), el('td', { text: b })));
    this.modal('Atalhos de teclado', t, [{ label: 'Fechar', primary: true }]);
  }

  aboutDialog() {
    this.modal('Sobre o Grafo', el('div', {},
      el('div', { style: { display: 'flex', gap: '14px', alignItems: 'center' } }, el('span', { class: 'logo big', style: { background: '#000' } }, logoSvg()), el('div', {}, el('b', { text: 'Grafo 1.0.0', style: { fontSize: '16px' } }), el('div', { class: 'hint', text: 'Copyright (©) 2026 Erik Pimenta. Todos os direitos reservados.' }))),
      el('p', { text: 'Editor colaborativo de design de interfaces e diagramas.' }),
      el('p', { class: 'hint', text: `Render: ${this.app.renderer.backend} · Núcleo geométrico: ${this.app.engineMode} · Modo: ${this.store.mode === 'server' ? 'servidor' : 'local'}` }),
      el('p', { class: 'hint', text: 'Uso permitido nos termos da licença do repositório oficial: github.com/ravelroot/Collaborative-Design-and-Diagram-Editor' })), [{ label: 'Fechar', primary: true }]);
  }
}

const CURSOR_D = 'M0 0h1v1h-1zM0 1h2v1h-2zM0 2h3v1h-3zM0 3h4v1h-4zM0 4h5v1h-5zM0 5h6v1h-6zM0 6h7v1h-7zM0 7h4v1h-4zM0 8h2v1h-2zM3 8h2v1h-2zM0 9h1v1h-1zM3 9h2v1h-2zM4 10h2v1h-2z';

export const logoSvg = () => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '2.5 2.5 20 20');
  s.setAttribute('shape-rendering', 'crispEdges');
  s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('fill', 'currentColor');
  p.setAttribute('d', 'M6 6h1v1h-1zM6 7h2v1h-2zM6 8h3v1h-3zM6 9h4v1h-4zM12 9h1v1h-1zM6 10h5v1h-5zM12 10h2v1h-2zM6 11h5v1h-5zM12 11h3v1h-3zM6 12h5v1h-5zM12 12h4v1h-4zM6 13h3v1h-3zM12 13h5v1h-5zM6 14h1v1h-1zM8 14h2v1h-2zM12 14h6v1h-6zM9 15h2v1h-2zM12 15h7v1h-7zM12 16h3v1h-3zM12 17h1v1h-1zM14 17h2v1h-2zM15 18h2v1h-2z');
  s.append(p);
  return s;
};

const validGrafo = (d) => !!d && d.format === 'grafo' && Array.isArray(d.pages) && d.pages.length > 0 && typeof d.nodes === 'object' && d.nodes !== null;

const checkbox = (val, onChange) => {
  const c = el('input', { type: 'checkbox' });
  c.checked = !!val;
  c.addEventListener('change', () => onChange(c.checked));
  return c;
};

const selectEl = (opts, value, onChange) => {
  const s = el('select');
  for (const [v, t] of opts) s.append(el('option', { value: v, text: t, selected: String(v) === String(value) ? true : undefined }));
  s.addEventListener('change', () => onChange(s.value));
  return s;
};

const scaleXY = (p, sx, sy) => {
  const q = { x: p.x * sx, y: p.y * sy };
  if (p.ix !== undefined) Object.assign(q, { ix: p.ix * sx, iy: p.iy * sy });
  if (p.ox !== undefined) Object.assign(q, { ox: p.ox * sx, oy: p.oy * sy });
  return q;
};

const when = (t) => {
  const d = (Date.now() - t) / 1000;
  if (d < 60) return 'agora';
  if (d < 3600) return `há ${Math.floor(d / 60)} min`;
  if (d < 86400) return `há ${Math.floor(d / 3600)} h`;
  return new Date(t).toLocaleDateString('pt-BR');
};

const downscale = async (src, max = 2400) => {
  const img = await loadImage(src);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (Math.max(w, h) <= max) return src;
  const k = max / Math.max(w, h);
  const c = document.createElement('canvas');
  c.width = Math.round(w * k);
  c.height = Math.round(h * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL(src.startsWith('data:image/png') ? 'image/png' : 'image/jpeg', 0.9);
};

const shapePreview = (id) => {
  const d = shapeDef(id);
  const k = 40 / Math.max(d.w, d.h);
  const w = d.w * k;
  const h = d.h * k;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `${-(44 - w) / 2} ${-(44 - h) / 2} 44 44`);
  const parts = d.parts(w, h, { radius: 0 });
  for (const p of parts) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', p.d);
    path.setAttribute('fill', p.kind === 'accent' ? 'var(--accent)' : p.kind === 'fill' || p.kind === 'dashedFill' ? 'var(--surface)' : p.kind === 'white' ? '#fff' : 'none');
    path.setAttribute('stroke', p.kind === 'accent' || p.kind === 'white' || p.kind === 'ghost' ? 'none' : 'var(--text-muted)');
    path.setAttribute('stroke-width', '1.2');
    if (p.kind === 'dashed' || p.kind === 'dashedFill') path.setAttribute('stroke-dasharray', '3 2');
    path.setAttribute('vector-effect', 'non-scaling-stroke');
    svg.append(path);
  }
  return svg;
};

export { nodeParts };
