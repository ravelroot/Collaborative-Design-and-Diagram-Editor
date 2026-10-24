import { el, icon, storage } from './util.js';
import { TOOLS } from './editor.js';
import { logoSvg } from './panels.js';

const KEY = 'tutorial';

export const tutorialPending = () => storage.get(KEY, null) === null;

const HOW_TO = {
  select: 'Clique para selecionar e arraste para mover. Shift soma à seleção; arraste no vazio para selecionar por área.',
  scale: 'Redimensiona escalando junto o texto, o contorno e o raio.',
  frame: 'Arraste para criar uma tela. Os tamanhos prontos (celular, desktop, A4…) ficam no painel Design.',
  section: 'Agrupa telas e diagramas numa área com nome.',
  rect: 'Arraste para desenhar. Shift faz um quadrado; Alt desenha a partir do centro.',
  ellipse: 'Arraste para desenhar. Shift faz um círculo.',
  line: 'Arraste do ponto inicial ao final. Shift trava em 45°.',
  arrow: 'Igual à linha, já com ponta de seta.',
  polygon: 'Polígono regular; o número de lados fica no painel Design.',
  star: 'Estrela com pontas e raio interno ajustáveis no painel.',
  image: 'Insere uma imagem ou um SVG. Também dá para arrastar arquivos para a tela ou colar.',
  pen: 'Clique para pontos retos e arraste para curvas. Clique no primeiro ponto para fechar; Enter termina.',
  pencil: 'Desenhe à mão livre: ao soltar, o traço é simplificado e suavizado.',
  text: 'Clique e digite. Esc termina; duplo clique edita de novo.',
  sticky: 'Clique para colar uma nota colorida, já pronta para escrever.',
  connector: 'Arraste de uma forma até outra: a linha fica presa nas duas e desvia das outras formas.',
  hand: 'Arraste para passear pela tela. Atalho rápido: segure Espaço.',
  comment: 'Clique para abrir uma conversa naquele ponto.',
};

const toolButton = (id) => document.querySelector(`#tools .tool[data-tool="${id}"]`);
const byText = (selector, text) => [...document.querySelectorAll(selector)].find((n) => n.textContent.trim().startsWith(text)) || null;
const q = (s) => document.querySelector(s);

function steps() {
  const toolStep = (title, text, ids, extra = () => []) => ({
    title,
    text,
    tools: ids.filter((id) => TOOLS.some((t) => t.id === id)),
    anchor: () => ids.map(toolButton),
    targets: () => [...ids.map(toolButton), ...extra()],
  });
  const desktop = !!window.grafoDesktop;
  return [
    toolStep('Selecionar e organizar', 'Clique numa ferramenta ou aperte a tecla dela. Estas criam e organizam as telas do seu arquivo.', ['select', 'scale', 'frame', 'section']),
    toolStep('Formas e imagens', 'Formas vetoriais que você pode pintar, contornar, arredondar e girar.', ['rect', 'ellipse', 'line', 'arrow', 'polygon', 'star', 'image']),
    toolStep('Desenhar e escrever', 'Para ícones, ilustrações e todo o texto das telas.', ['pen', 'pencil', 'text']),
    toolStep('Diagramas', 'Fluxogramas, UML, entidade-relacionamento, BPMN, redes e organogramas ficam na aba Formas, à esquerda: clique ou arraste uma forma para a tela. Passe o mouse numa forma e puxe um dos pontos para ligá-la a outra.', ['sticky', 'connector'], () => [byText('#leftPanel .tab', 'Formas')]),
    {
      title: 'Páginas e camadas',
      text: 'Cada arquivo tem páginas. A árvore de camadas mostra tudo o que está na página: arraste para reordenar, use o olho para ocultar e o cadeado para travar. Duplo clique renomeia.',
      targets: () => [q('#leftPanel')],
    },
    {
      title: 'Propriedades',
      text: 'Design muda posição, tamanho, cores, contorno, texto, auto layout e efeitos do que estiver selecionado. Protótipo liga uma tela à outra, Dados importa CSV e Comentários lista as conversas.',
      targets: () => [q('#rightPanel')],
      prefer: ['left', 'below', 'above', 'right'],
    },
    {
      title: 'Navegar e comentar',
      text: 'A roda do mouse rola a tela e Ctrl + roda (ou a pinça) aproxima no cursor; Shift+1 mostra tudo. O minimapa leva a qualquer ponto. Errou? Ctrl+Z desfaz e Ctrl+Shift+Z refaz.',
      tools: ['hand', 'comment'],
      anchor: () => [toolButton('hand'), toolButton('comment')],
      targets: () => [toolButton('hand'), toolButton('comment'), q('#zoomBtn'), q('#minimap')],
    },
    {
      title: 'Colaborar e apresentar',
      text: 'Compartilhar mostra o link e deixa trocar seu nome e sua cor. Com o servidor, quem abre o link edita junto com você, vendo seu cursor. Apresentar mostra as telas em tela cheia, seguindo os links do protótipo.',
      targets: () => [q('#avatars'), q('#conn'), q('#presentBtn'), q('#shareBtn')],
      prefer: ['below', 'left', 'right', 'above'],
    },
    {
      title: 'Salvar e exportar',
      text: desktop
        ? 'O Grafo salva sozinho a cada mudança. Ctrl+S guarda uma cópia .grafo onde você escolher, Ctrl+Alt+S salva uma versão e Arquivo → Exportar gera PNG, JPG, SVG ou PDF, sempre com a janela Salvar como do Windows. F11 liga e desliga a tela cheia.'
        : 'O Grafo salva sozinho a cada mudança. Ctrl+S guarda uma cópia .grafo, Ctrl+Alt+S salva uma versão com nome e Arquivo → Exportar gera PNG, JPG, SVG ou PDF.',
      targets: () => [byText('#menus .menu-btn', 'Arquivo')],
      prefer: ['below', 'right', 'left', 'above'],
    },
  ];
}

const visible = (node) => {
  if (!node) return null;
  const r = node.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? r : null;
};

const union = (rects) => (rects.length ? { left: Math.min(...rects.map((r) => r.left)), top: Math.min(...rects.map((r) => r.top)), right: Math.max(...rects.map((r) => r.right)), bottom: Math.max(...rects.map((r) => r.bottom)) } : null);

function place(card, area, avoid = [], prefer = ['right', 'left', 'below', 'above']) {
  const margin = 12;
  const gap = 14;
  const width = card.offsetWidth;
  const height = card.offsetHeight;
  const fitsX = (x) => x >= margin && x + width <= innerWidth - margin;
  const fitsY = (y) => y >= margin && y + height <= innerHeight - margin;
  const clampX = (x) => Math.max(margin, Math.min(x, innerWidth - width - margin));
  const clampY = (y) => Math.max(margin, Math.min(y, innerHeight - height - margin));
  const hits = (x, y) => avoid.filter((b) => x < b.x + b.width && x + width > b.x && y < b.y + b.height && y + height > b.y);
  let spot = [(innerWidth - width) / 2, (innerHeight - height) / 2];
  if (area) {
    const candidates = {
      right: () => fitsX(area.right + gap) && [area.right + gap, clampY(area.top)],
      left: () => fitsX(area.left - gap - width) && [area.left - gap - width, clampY(area.top)],
      below: () => fitsY(area.bottom + gap) && [clampX(area.left), area.bottom + gap],
      above: () => fitsY(area.top - gap - height) && [clampX(area.left), area.top - gap - height],
    };
    let fallback = null;
    for (const side of prefer) {
      const found = candidates[side]();
      if (!found) continue;
      let [x, y] = found;
      let blocking = hits(x, y);
      if (blocking.length && (side === 'right' || side === 'left')) {
        const below = Math.max(...blocking.map((b) => b.y + b.height)) + gap;
        if (fitsY(below) && !hits(x, below).length) [y, blocking] = [below, []];
      }
      if (!blocking.length) {
        spot = [x, y];
        fallback = null;
        break;
      }
      fallback = fallback || [x, y];
    }
    if (fallback) spot = fallback;
  }
  card.style.left = `${Math.round(clampX(spot[0]))}px`;
  card.style.top = `${Math.round(clampY(spot[1]))}px`;
}

function merge(boxes) {
  const area = (b) => b.width * b.height;
  const list = boxes.map((b) => ({ ...b }));
  for (let changed = true; changed; ) {
    changed = false;
    for (let i = 0; i < list.length && !changed; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (a.x > b.x + b.width || b.x > a.x + a.width || a.y > b.y + b.height || b.y > a.y + a.height) continue;
        const x = Math.min(a.x, b.x);
        const y = Math.min(a.y, b.y);
        const joined = { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
        if (area(joined) > 1.1 * (area(a) + area(b))) continue;
        list[i] = joined;
        list.splice(j, 1);
        changed = true;
        break;
      }
    }
  }
  return list;
}

const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};

let running = null;

export function startTutorial({ welcome = false } = {}) {
  if (running) return running;
  storage.set(KEY, 'shown');
  const list = steps();
  const dialog = el('dialog', { class: 'tour', 'aria-labelledby': 'tour-title' });
  const shade = svg('svg', { class: 'tour-shade', 'aria-hidden': 'true' });
  const holes = svg('g');
  const mask = svg('mask', { id: 'tour-mask', maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: '100%', height: '100%' });
  mask.append(svg('rect', { width: '100%', height: '100%', fill: 'white' }), holes);
  const defs = svg('defs');
  defs.append(mask);
  shade.append(defs, svg('rect', { class: 'tour-dim', width: '100%', height: '100%', mask: 'url(#tour-mask)' }));
  const rings = el('div', { class: 'tour-rings', 'aria-hidden': 'true' });
  const card = el('section', { class: 'tour-card' });
  dialog.append(shade, rings, card);
  let index = welcome ? -1 : 0;
  let current = null;

  running = new Promise((resolve) => {
    const finish = (result) => {
      storage.set(KEY, result);
      removeEventListener('resize', render);
      dialog.close();
      dialog.remove();
      running = null;
      resolve(result);
    };
    const button = (label, className, onclick) => el('button', { type: 'button', class: className, onclick }, label);
    const ringAt = (box, className = 'tour-ring') => el('div', { class: className, style: { left: `${box.x}px`, top: `${box.y}px`, width: `${box.width}px`, height: `${box.height}px` } });

    function highlight(nodes) {
      rings.replaceChildren();
      const pad = 4;
      current = [];
      for (const node of nodes) {
        const r = visible(node);
        if (r) current.push({ node, box: { x: r.left - pad, y: r.top - pad, width: r.width + pad * 2, height: r.height + pad * 2 } });
      }
      const boxes = merge(current.map((c) => c.box));
      holes.replaceChildren(...boxes.map((b) => svg('rect', { x: b.x, y: b.y, width: b.width, height: b.height, rx: 8, fill: 'black' })));
      for (const box of boxes) rings.append(ringAt(box));
      return boxes;
    }

    function focusTool(id, on) {
      rings.querySelector('.tour-ring.focus')?.remove();
      const target = on && current && current.find((c) => c.node === toolButton(id));
      if (target) rings.append(ringAt(target.box, 'tour-ring focus'));
    }

    function welcomeCard() {
      highlight([]);
      card.className = 'tour-card tour-welcome';
      const start = button('Ver tutorial', 'btn primary', () => go(0));
      card.replaceChildren(
        el('div', { class: 'tour-logo' }, logoSvg()),
        el('h2', { id: 'tour-title' }, 'Bem-vindo ao Grafo!'),
        el('p', {}, 'Quer um tutorial rápido? Em menos de um minuto você vê o que cada ferramenta faz, onde ficam os painéis e como salvar o seu trabalho.'),
        el('div', { class: 'tour-actions tour-actions-center' }, button('Agora não', 'btn', () => finish('declined')), start),
        el('p', { class: 'tour-note' }, 'Se mudar de ideia, ele fica em Ajuda → Tutorial rápido.'),
      );
      place(card, null, []);
      start.focus();
    }

    function stepCard() {
      const step = list[index];
      const lit = highlight(step.targets());
      card.className = 'tour-card';
      const last = index === list.length - 1;
      const next = button(last ? 'Começar a criar' : 'Próximo', 'btn primary', () => (last ? finish('finished') : go(index + 1)));
      const body = [el('div', { class: 'tour-step' }, `${index + 1} de ${list.length}`), el('h2', { id: 'tour-title' }, step.title), el('p', {}, step.text)];
      if (step.tools && step.tools.length) {
        body.push(el('ul', { class: 'tour-tools' }, step.tools.map((id) => {
          const tool = TOOLS.find((t) => t.id === id);
          return el('li', { onmouseenter: () => focusTool(id, true), onmouseleave: () => focusTool(id, false) },
            el('span', { class: 'tour-tool-icon' }, icon(tool.icon, 18)),
            el('span', { class: 'tour-tool-text' }, el('strong', {}, tool.name), ' ', el('kbd', {}, tool.key), el('span', { class: 'tour-tool-how' }, HOW_TO[id] || '')));
        })));
      }
      body.push(
        el('div', { class: 'tour-actions' }, button('Pular tutorial', 'tour-skip', () => finish('declined')), el('span', { class: 'tour-spacer' }), index > 0 ? button('Voltar', 'btn', () => go(index - 1)) : null, next),
        el('div', { class: 'tour-dots', 'aria-hidden': 'true' }, list.map((_, i) => el('span', { class: i === index ? 'on' : '' }))),
      );
      card.replaceChildren(...body);
      const anchor = step.anchor ? step.anchor() : step.targets().slice(0, 1);
      place(card, union(anchor.map(visible).filter(Boolean)), lit, step.prefer);
      next.focus();
    }

    function render() {
      if (index < 0) welcomeCard();
      else stepCard();
    }

    function go(i) {
      index = i < 0 && welcome ? -1 : Math.max(0, Math.min(list.length - 1, i));
      card.classList.remove('tour-enter');
      render();
      void card.offsetWidth;
      card.classList.add('tour-enter');
    }

    dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      finish(index < 0 ? 'declined' : 'finished');
    });
    dialog.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (index < 0) return;
      if (e.key === 'ArrowRight') go(index + 1);
      else if (e.key === 'ArrowLeft' && index > 0) go(index - 1);
      else return;
      e.preventDefault();
    });
    addEventListener('resize', render);
    document.body.append(dialog);
    dialog.showModal();
    go(index);
  });
  return running;
}
