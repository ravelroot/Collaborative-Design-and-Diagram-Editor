import { uid } from './util.js';

const solid = (color, alpha = 1) => ({ type: 'solid', color, alpha });
const ink = { color: '#5C4034', alpha: 1 };

export const seedDocument = (store) => {
  store.transact(() => {
    store.meta.set('name', 'Boas-vindas ao Grafo');
    store.meta.set('format', 1);
    const p1 = 'p' + uid(8);
    const p2 = 'p' + uid(8);
    store.pageInfo.set(p1, { id: p1, name: 'Design', bg: '' });
    store.pageInfo.set(p2, { id: p2, name: 'Diagrama', bg: '' });
    store.pages.push([p1, p2]);
    const add = (n) => store.add(n);

    const comp = add({ type: 'component', page: p1, parent: null, name: 'Botão', x: 480, y: -60, w: 160, h: 44, fill: solid('#5D1C16'), radius: 10, clip: true, layout: { mode: 'h', gap: 8, padding: 12, align: 'center', hug: false, hugCross: false, justify: 'center' }, description: 'Botão principal' });
    add({ type: 'text', page: p1, parent: comp, name: 'Rótulo', x: 0, y: 0, w: 80, h: 20, text: 'Começar', fontSize: 16, fontWeight: 600, lineHeight: 1.25, fontFamily: 'Sistema', autoSize: 'width', fill: solid('#FAF3E6') });

    const phone = add({ type: 'frame', page: p1, parent: null, name: 'Início', x: 0, y: 0, w: 390, h: 844, fill: solid('#FAF6EF'), clip: true, radius: 0 });
    add({ type: 'rect', page: p1, parent: phone, name: 'Topo', x: 0, y: 0, w: 390, h: 300, fill: { type: 'linear', angle: 135, stops: [{ o: 0, color: '#F6E4A6' }, { o: 1, color: '#D6BDB8' }], alpha: 1 } });
    add({ type: 'text', page: p1, parent: phone, name: 'Título', x: 24, y: 96, w: 300, h: 80, text: 'Desenhe, conecte\ne colabore.', fontSize: 32, fontWeight: 700, lineHeight: 1.2, fontFamily: 'Sistema', autoSize: 'width', fill: solid('#2B1D17') });
    add({ type: 'text', page: p1, parent: phone, name: 'Subtítulo', x: 24, y: 190, w: 320, h: 44, text: 'Interfaces e diagramas no mesmo arquivo,\ncom todo mundo editando junto.', fontSize: 15, fontWeight: 400, lineHeight: 1.4, fontFamily: 'Sistema', autoSize: 'width', fill: solid('#5C4034') });
    const card = add({ type: 'frame', page: p1, parent: phone, name: 'Cartão', x: 24, y: 330, w: 342, h: 200, fill: solid('#FFFFFF'), radius: 16, clip: true, effects: [{ type: 'shadow', x: 0, y: 8, blur: 24, color: '#5C4034', alpha: 0.18 }], layout: { mode: 'v', gap: 10, padding: 20, align: 'stretch', hug: true, hugCross: false } });
    add({ type: 'text', page: p1, parent: card, name: 'Cartão · título', x: 0, y: 0, w: 302, h: 24, text: 'Auto layout', fontSize: 18, fontWeight: 700, lineHeight: 1.3, fontFamily: 'Sistema', autoSize: 'height', fill: solid('#2B1D17') });
    add({ type: 'text', page: p1, parent: card, name: 'Cartão · texto', x: 0, y: 0, w: 302, h: 40, text: 'Este cartão cresce sozinho conforme o conteúdo. Mude o espaçamento no painel Design.', fontSize: 14, fontWeight: 400, lineHeight: 1.45, fontFamily: 'Sistema', autoSize: 'height', fill: solid('#5C4034') });
    add({ type: 'rect', page: p1, parent: card, name: 'Barra', x: 0, y: 0, w: 302, h: 8, radius: 4, fill: solid('#A3B4BE') });
    add({ type: 'instance', page: p1, parent: phone, componentId: comp, name: 'Botão', x: 24, y: 760, w: 342, h: 52, fill: solid('#5D1C16'), radius: 12, overrides: {} });
    add({ type: 'ellipse', page: p1, parent: phone, name: 'Selo', x: 290, y: 40, w: 72, h: 72, fill: solid('#7A6E46'), stroke: { color: '#FAF6EF', alpha: 1 }, strokeWidth: 4 });

    const phone2 = add({ type: 'frame', page: p1, parent: null, name: 'Detalhes', x: 480, y: 80, w: 390, h: 844, fill: solid('#FAF6EF'), clip: true });
    add({ type: 'text', page: p1, parent: phone2, name: 'Título', x: 504, y: 144, w: 200, h: 40, text: 'Detalhes', fontSize: 28, fontWeight: 700, lineHeight: 1.2, fontFamily: 'Sistema', autoSize: 'width', fill: solid('#2B1D17') });
    for (let i = 0; i < 4; i++) {
      add({ type: 'rect', page: p1, parent: phone2, name: `Item ${i + 1}`, x: 504, y: 210 + i * 92, w: 342, h: 76, radius: 12, fill: solid(i % 2 ? '#E6DDCE' : '#FFFFFF'), stroke: { color: '#CDBFAA', alpha: 1 }, strokeWidth: 1 });
      add({ type: 'text', page: p1, parent: phone2, name: `Item ${i + 1} · texto`, x: 524, y: 238 + i * 92, w: 200, h: 20, text: ['Componentes', 'Protótipos', 'Comentários', 'Versões'][i], fontSize: 16, fontWeight: 600, lineHeight: 1.25, fontFamily: 'Sistema', autoSize: 'width', fill: solid('#2B1D17') });
    }
    add({ type: 'instance', page: p1, parent: phone2, componentId: comp, name: 'Botão', x: 504, y: 840, w: 342, h: 52, fill: solid('#5D1C16'), radius: 12, overrides: {} });
    add({ type: 'sticky', page: p1, parent: null, name: 'Nota', x: 920, y: 80, w: 220, h: 200, fill: solid('#F6E4A6'), text: 'Dica: selecione o botão “Começar” e escolha um destino na aba Protótipo. Depois clique em Apresentar.', fontSize: 16, effects: [{ type: 'shadow', x: 0, y: 3, blur: 10, color: '#5C4034', alpha: 0.25 }] });

    const pool = add({ type: 'shape', shape: 'pool', page: p2, parent: null, name: 'Atendimento', x: -40, y: -60, w: 1100, h: 600, fill: solid('#FAF6EF'), stroke: ink, strokeWidth: 1.5, text: 'Atendimento', fontSize: 14, fontWeight: 600 });
    const s = (shape, x, y, w, h, text, extra = {}) => add({ type: 'shape', shape, page: p2, parent: pool, name: text.split('\n')[0] || shape, x, y, w, h, fill: solid('#FAF6EF'), stroke: ink, strokeWidth: 1.5, text, fontSize: 14, ...extra });
    const a = s('terminator', 40, 20, 150, 56, 'Pedido recebido', { fill: solid('#F6E4A6') });
    const b = s('process', 40, 140, 150, 70, 'Validar dados');
    const c = s('decision', 40, 270, 150, 100, 'Dados ok?', { fill: solid('#D6BDB8') });
    const d = s('process', 300, 285, 160, 70, 'Separar estoque');
    const e = s('database', 560, 270, 110, 110, 'Estoque');
    const f = s('document', 40, 420, 150, 70, 'Pedir correção');
    const g = s('terminator', 780, 292, 160, 56, 'Pedido enviado', { fill: solid('#A3B4BE') });
    const con = (from, to, fs, ts, text = '', extra = {}) => add({ type: 'connector', page: p2, parent: null, name: 'Conector', x: 0, y: 0, w: 0, h: 0, from: { node: from, side: fs }, to: { node: to, side: ts }, routing: 'elbow', startCap: 'none', endCap: 'triangle', stroke: { color: '#2B1D17', alpha: 1 }, strokeWidth: 1.6, text, ...extra });
    con(a, b, 'bottom', 'top');
    con(b, c, 'bottom', 'top');
    con(c, d, 'right', 'left', 'sim');
    con(c, f, 'bottom', 'top', 'não');
    con(f, b, 'left', 'left', '', { dash: [6, 4] });
    con(d, e, 'right', 'left', '', { dash: [6, 4], endCap: 'arrow' });
    con(e, g, 'right', 'left');
    const ent1 = add({ type: 'shape', shape: 'entity', page: p2, parent: null, name: 'pedido', x: 40, y: 640, w: 220, h: 150, fill: solid('#FFFFFF'), stroke: ink, strokeWidth: 1.5, text: 'pedido\nPK id: uuid\nFK cliente_id: uuid\ntotal: numeric(12,2)\ncriado_em: timestamptz', fontSize: 13 });
    const ent2 = add({ type: 'shape', shape: 'entity', page: p2, parent: null, name: 'cliente', x: 420, y: 640, w: 220, h: 130, fill: solid('#FFFFFF'), stroke: ink, strokeWidth: 1.5, text: 'cliente\nPK id: uuid\nnome: varchar(80)\nemail: citext', fontSize: 13 });
    con(ent2, ent1, 'left', 'right', '', { startCap: 'one', endCap: 'many', routing: 'straight' });
    add({ type: 'sticky', page: p2, parent: null, name: 'Nota', x: 760, y: 640, w: 240, h: 170, fill: solid('#D6BDB8'), text: 'Arraste formas da aba Formas. Passe o mouse numa forma e puxe um dos pontos para criar um conector.', fontSize: 15, effects: [{ type: 'shadow', x: 0, y: 3, blur: 10, color: '#5C4034', alpha: 0.25 }] });
  }, 'init');
};
