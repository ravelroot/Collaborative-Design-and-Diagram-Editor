const K = 0.5522847498;
const f = (v) => Math.round(v * 100) / 100;

export const R = (x, y, w, h, r = 0) => {
  if (w < 0) { x += w; w = -w; }
  if (h < 0) { y += h; h = -h; }
  const rr = Array.isArray(r) ? r : [r, r, r, r];
  const m = Math.min(w, h) / 2;
  const [a, b, c, d] = rr.map((v) => Math.max(0, Math.min(v || 0, m)));
  if (!a && !b && !c && !d) return `M${f(x)} ${f(y)}L${f(x + w)} ${f(y)}L${f(x + w)} ${f(y + h)}L${f(x)} ${f(y + h)}Z`;
  const k = 1 - K;
  return `M${f(x + a)} ${f(y)}L${f(x + w - b)} ${f(y)}C${f(x + w - b * k)} ${f(y)} ${f(x + w)} ${f(y + b * k)} ${f(x + w)} ${f(y + b)}` +
    `L${f(x + w)} ${f(y + h - c)}C${f(x + w)} ${f(y + h - c * k)} ${f(x + w - c * k)} ${f(y + h)} ${f(x + w - c)} ${f(y + h)}` +
    `L${f(x + d)} ${f(y + h)}C${f(x + d * k)} ${f(y + h)} ${f(x)} ${f(y + h - d * k)} ${f(x)} ${f(y + h - d)}` +
    `L${f(x)} ${f(y + a)}C${f(x)} ${f(y + a * k)} ${f(x + a * k)} ${f(y)} ${f(x + a)} ${f(y)}Z`;
};

export const E = (cx, cy, rx, ry) => {
  const ox = rx * K;
  const oy = ry * K;
  return `M${f(cx - rx)} ${f(cy)}C${f(cx - rx)} ${f(cy - oy)} ${f(cx - ox)} ${f(cy - ry)} ${f(cx)} ${f(cy - ry)}` +
    `C${f(cx + ox)} ${f(cy - ry)} ${f(cx + rx)} ${f(cy - oy)} ${f(cx + rx)} ${f(cy)}` +
    `C${f(cx + rx)} ${f(cy + oy)} ${f(cx + ox)} ${f(cy + ry)} ${f(cx)} ${f(cy + ry)}` +
    `C${f(cx - ox)} ${f(cy + ry)} ${f(cx - rx)} ${f(cy + oy)} ${f(cx - rx)} ${f(cy)}Z`;
};

export const P = (pts, close = true) => pts.map((p, i) => `${i ? 'L' : 'M'}${f(p[0])} ${f(p[1])}`).join('') + (close ? 'Z' : '');

export const regular = (w, h, n, inset = 0) => {
  const pts = [];
  const cx = w / 2;
  const cy = h / 2;
  const total = inset ? n * 2 : n;
  for (let i = 0; i < total; i++) {
    const a = -Math.PI / 2 + (i * Math.PI * 2) / total;
    const s = inset && i % 2 ? inset : 1;
    pts.push([cx + Math.cos(a) * (w / 2) * s, cy + Math.sin(a) * (h / 2) * s]);
  }
  return pts;
};

const fill = (d) => ({ d, kind: 'fill' });
const line = (d) => ({ d, kind: 'line' });
const accent = (d) => ({ d, kind: 'accent' });

const cyl = (w, h) => {
  const ry = Math.min(h * 0.12, 18);
  const top = `M0 ${ry}C0 ${-ry * 0.33} ${w} ${-ry * 0.33} ${w} ${ry}L${w} ${h - ry}C${w} ${h + ry * 0.33} 0 ${h + ry * 0.33} 0 ${h - ry}Z`;
  return [fill(top), line(`M0 ${ry}C0 ${ry * 2.33} ${w} ${ry * 2.33} ${w} ${ry}`)];
};

const docShape = (w, h) => {
  const t = h * 0.12;
  return `M0 0L${w} 0L${w} ${h - t}C${w * 0.75} ${h - t * 2.6} ${w * 0.5} ${h + t * 0.6} ${w * 0.25} ${h - t * 0.3}C${w * 0.12} ${h - t * 1.2} ${w * 0.05} ${h - t} 0 ${h - t * 0.6}Z`;
};

const cloud = (w, h) => {
  const s = (x, y) => `${f(x * w)} ${f(y * h)}`;
  return `M${s(0.25, 0.85)}C${s(0.05, 0.85)} ${s(0.0, 0.6)} ${s(0.15, 0.5)}C${s(0.08, 0.3)} ${s(0.3, 0.15)} ${s(0.42, 0.25)}C${s(0.5, 0.05)} ${s(0.78, 0.05)} ${s(0.8, 0.3)}C${s(1.0, 0.3)} ${s(1.02, 0.65)} ${s(0.85, 0.72)}C${s(0.85, 0.9)} ${s(0.6, 0.92)} ${s(0.55, 0.82)}C${s(0.45, 0.95)} ${s(0.3, 0.92)} ${s(0.25, 0.85)}Z`;
};

const header = (w, h, hh = 30) => [fill(R(0, 0, w, h, 4)), line(`M0 ${Math.min(hh, h)}L${w} ${Math.min(hh, h)}`)];

export const SHAPES = {
  rect: { name: 'Retângulo', lib: 'basic', w: 120, h: 80, parts: (w, h, n) => [fill(R(0, 0, w, h, n?.radius || 0))] },
  rounded: { name: 'Retângulo arredondado', lib: 'basic', w: 120, h: 80, parts: (w, h) => [fill(R(0, 0, w, h, Math.min(w, h) * 0.18))] },
  ellipse: { name: 'Elipse', lib: 'basic', w: 100, h: 100, parts: (w, h) => [fill(E(w / 2, h / 2, w / 2, h / 2))] },
  diamond: { name: 'Losango', lib: 'basic', w: 120, h: 90, parts: (w, h) => [fill(P([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]))] },
  triangle: { name: 'Triângulo', lib: 'basic', w: 100, h: 90, parts: (w, h) => [fill(P([[w / 2, 0], [w, h], [0, h]]))] },
  rtriangle: { name: 'Triângulo retângulo', lib: 'basic', w: 100, h: 90, parts: (w, h) => [fill(P([[0, 0], [w, h], [0, h]]))] },
  parallelogram: { name: 'Paralelogramo', lib: 'basic', w: 130, h: 70, parts: (w, h) => [fill(P([[w * 0.2, 0], [w, 0], [w * 0.8, h], [0, h]]))] },
  trapezoid: { name: 'Trapézio', lib: 'basic', w: 130, h: 70, parts: (w, h) => [fill(P([[w * 0.18, 0], [w * 0.82, 0], [w, h], [0, h]]))] },
  pentagon: { name: 'Pentágono', lib: 'basic', w: 100, h: 95, parts: (w, h) => [fill(P(regular(w, h, 5)))] },
  hexagon: { name: 'Hexágono', lib: 'basic', w: 120, h: 90, parts: (w, h) => [fill(P([[w * 0.22, 0], [w * 0.78, 0], [w, h / 2], [w * 0.78, h], [w * 0.22, h], [0, h / 2]]))] },
  octagon: { name: 'Octógono', lib: 'basic', w: 100, h: 100, parts: (w, h) => [fill(P([[w * 0.3, 0], [w * 0.7, 0], [w, h * 0.3], [w, h * 0.7], [w * 0.7, h], [w * 0.3, h], [0, h * 0.7], [0, h * 0.3]]))] },
  star: { name: 'Estrela', lib: 'basic', w: 100, h: 100, parts: (w, h, n) => [fill(P(regular(w, h, n?.points || 5, n?.inner || 0.45)))] },
  cross: { name: 'Cruz', lib: 'basic', w: 90, h: 90, parts: (w, h) => [fill(P([[w * 0.35, 0], [w * 0.65, 0], [w * 0.65, h * 0.35], [w, h * 0.35], [w, h * 0.65], [w * 0.65, h * 0.65], [w * 0.65, h], [w * 0.35, h], [w * 0.35, h * 0.65], [0, h * 0.65], [0, h * 0.35], [w * 0.35, h * 0.35]]))] },
  blockArrow: { name: 'Seta larga', lib: 'basic', w: 130, h: 70, parts: (w, h) => [fill(P([[0, h * 0.28], [w * 0.65, h * 0.28], [w * 0.65, 0], [w, h / 2], [w * 0.65, h], [w * 0.65, h * 0.72], [0, h * 0.72]]))] },
  doubleArrow: { name: 'Seta dupla', lib: 'basic', w: 140, h: 70, parts: (w, h) => [fill(P([[0, h / 2], [w * 0.25, 0], [w * 0.25, h * 0.28], [w * 0.75, h * 0.28], [w * 0.75, 0], [w, h / 2], [w * 0.75, h], [w * 0.75, h * 0.72], [w * 0.25, h * 0.72], [w * 0.25, h]]))] },
  chevron: { name: 'Divisa', lib: 'basic', w: 120, h: 70, parts: (w, h) => [fill(P([[0, 0], [w * 0.75, 0], [w, h / 2], [w * 0.75, h], [0, h], [w * 0.25, h / 2]]))] },
  cloud: { name: 'Nuvem', lib: 'basic', w: 140, h: 90, parts: (w, h) => [fill(cloud(w, h))] },
  callout: { name: 'Balão', lib: 'basic', w: 140, h: 90, parts: (w, h) => [fill(`M8 0L${w - 8} 0Q${w} 0 ${w} 8L${w} ${h * 0.72}Q${w} ${h * 0.8} ${w - 8} ${h * 0.8}L${w * 0.4} ${h * 0.8}L${w * 0.2} ${h}L${w * 0.24} ${h * 0.8}L8 ${h * 0.8}Q0 ${h * 0.8} 0 ${h * 0.72}L0 8Q0 0 8 0Z`)], text: (w, h) => ({ x: 0, y: 0, w, h: h * 0.8 }) },
  heart: { name: 'Coração', lib: 'basic', w: 100, h: 90, parts: (w, h) => [fill(`M${w / 2} ${h}C${w * 0.1} ${h * 0.7} 0 ${h * 0.45} 0 ${h * 0.28}C0 ${h * 0.05} ${w * 0.3} ${-h * 0.05} ${w / 2} ${h * 0.22}C${w * 0.7} ${-h * 0.05} ${w} ${h * 0.05} ${w} ${h * 0.28}C${w} ${h * 0.45} ${w * 0.9} ${h * 0.7} ${w / 2} ${h}Z`)] },
  note: { name: 'Nota', lib: 'basic', w: 120, h: 90, parts: (w, h) => { const c = Math.min(w, h) * 0.2; return [fill(P([[0, 0], [w - c, 0], [w, c], [w, h], [0, h]])), line(`M${w - c} 0L${w - c} ${c}L${w} ${c}`)]; } },

  process: { name: 'Processo', lib: 'flow', w: 140, h: 70, parts: (w, h) => [fill(R(0, 0, w, h, 4))] },
  decision: { name: 'Decisão', lib: 'flow', w: 140, h: 100, parts: (w, h) => [fill(P([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]))], text: (w, h) => ({ x: w * 0.2, y: h * 0.2, w: w * 0.6, h: h * 0.6 }) },
  terminator: { name: 'Início / Fim', lib: 'flow', w: 140, h: 60, parts: (w, h) => [fill(R(0, 0, w, h, h / 2))] },
  data: { name: 'Dados (E/S)', lib: 'flow', w: 140, h: 70, parts: (w, h) => [fill(P([[w * 0.18, 0], [w, 0], [w * 0.82, h], [0, h]]))] },
  predefined: { name: 'Processo predefinido', lib: 'flow', w: 140, h: 70, parts: (w, h) => [fill(R(0, 0, w, h)), line(`M${w * 0.1} 0L${w * 0.1} ${h}M${w * 0.9} 0L${w * 0.9} ${h}`)], text: (w, h) => ({ x: w * 0.1, y: 0, w: w * 0.8, h }) },
  manualInput: { name: 'Entrada manual', lib: 'flow', w: 140, h: 70, parts: (w, h) => [fill(P([[0, h * 0.3], [w, 0], [w, h], [0, h]]))] },
  document: { name: 'Documento', lib: 'flow', w: 140, h: 80, parts: (w, h) => [fill(docShape(w, h))], text: (w, h) => ({ x: 0, y: 0, w, h: h * 0.85 }) },
  multiDocument: { name: 'Vários documentos', lib: 'flow', w: 140, h: 90, parts: (w, h) => [fill(R(w * 0.1, 0, w * 0.9, h * 0.8)), fill(R(w * 0.05, h * 0.06, w * 0.9, h * 0.8)), fill(docShape(w * 0.9, h * 0.88).replace(/(-?[\d.]+) (-?[\d.]+)/g, (m, a, b) => `${f(+a)} ${f(+b + h * 0.12)}`))], text: (w, h) => ({ x: 0, y: h * 0.12, w: w * 0.9, h: h * 0.7 }) },
  database: { name: 'Banco de dados', lib: 'flow', w: 100, h: 110, parts: (w, h) => cyl(w, h), text: (w, h) => ({ x: 0, y: h * 0.2, w, h: h * 0.75 }) },
  manualOperation: { name: 'Operação manual', lib: 'flow', w: 140, h: 70, parts: (w, h) => [fill(P([[0, 0], [w, 0], [w * 0.8, h], [w * 0.2, h]]))] },
  preparation: { name: 'Preparação', lib: 'flow', w: 140, h: 70, parts: (w, h) => [fill(P([[w * 0.15, 0], [w * 0.85, 0], [w, h / 2], [w * 0.85, h], [w * 0.15, h], [0, h / 2]]))] },
  delay: { name: 'Atraso', lib: 'flow', w: 120, h: 70, parts: (w, h) => [fill(`M0 0L${w - h / 2} 0C${w + h * 0.17} 0 ${w + h * 0.17} ${h} ${w - h / 2} ${h}L0 ${h}Z`)] },
  display: { name: 'Exibição', lib: 'flow', w: 140, h: 70, parts: (w, h) => [fill(`M0 ${h / 2}L${w * 0.18} 0L${w * 0.82} 0C${w * 1.04} 0 ${w * 1.04} ${h} ${w * 0.82} ${h}L${w * 0.18} ${h}Z`)] },
  storedData: { name: 'Dados armazenados', lib: 'flow', w: 140, h: 70, parts: (w, h) => [fill(`M${w * 0.15} 0L${w} 0C${w * 0.85} ${h * 0.1} ${w * 0.85} ${h * 0.9} ${w} ${h}L${w * 0.15} ${h}C${-w * 0.03} ${h} ${-w * 0.03} 0 ${w * 0.15} 0Z`)] },
  internalStorage: { name: 'Armazenamento interno', lib: 'flow', w: 120, h: 80, parts: (w, h) => [fill(R(0, 0, w, h)), line(`M${w * 0.15} 0L${w * 0.15} ${h}M0 ${h * 0.2}L${w} ${h * 0.2}`)] },
  offPage: { name: 'Conector de página', lib: 'flow', w: 70, h: 80, parts: (w, h) => [fill(P([[0, 0], [w, 0], [w, h * 0.65], [w / 2, h], [0, h * 0.65]]))] },
  onPage: { name: 'Conector', lib: 'flow', w: 60, h: 60, parts: (w, h) => [fill(E(w / 2, h / 2, w / 2, h / 2))] },
  merge: { name: 'Junção', lib: 'flow', w: 90, h: 80, parts: (w, h) => [fill(P([[0, 0], [w, 0], [w / 2, h]]))] },
  extract: { name: 'Extração', lib: 'flow', w: 90, h: 80, parts: (w, h) => [fill(P([[w / 2, 0], [w, h], [0, h]]))] },
  sort: { name: 'Ordenar', lib: 'flow', w: 90, h: 100, parts: (w, h) => [fill(P([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]])), line(`M0 ${h / 2}L${w} ${h / 2}`)] },
  collate: { name: 'Agrupar', lib: 'flow', w: 90, h: 100, parts: (w, h) => [fill(P([[0, 0], [w, 0], [0, h], [w, h]]))] },
  summing: { name: 'Junção de soma', lib: 'flow', w: 70, h: 70, parts: (w, h) => [fill(E(w / 2, h / 2, w / 2, h / 2)), line(`M${w * 0.15} ${h * 0.15}L${w * 0.85} ${h * 0.85}M${w * 0.85} ${h * 0.15}L${w * 0.15} ${h * 0.85}`)] },
  orShape: { name: 'Ou', lib: 'flow', w: 70, h: 70, parts: (w, h) => [fill(E(w / 2, h / 2, w / 2, h / 2)), line(`M${w / 2} 0L${w / 2} ${h}M0 ${h / 2}L${w} ${h / 2}`)] },
  loopLimit: { name: 'Limite de laço', lib: 'flow', w: 140, h: 70, parts: (w, h) => [fill(P([[w * 0.15, 0], [w * 0.85, 0], [w, h * 0.3], [w, h], [0, h], [0, h * 0.3]]))] },
  annotation: { name: 'Anotação', lib: 'flow', w: 120, h: 70, parts: (w, h) => [{ d: R(0, 0, w, h), kind: 'ghost' }, line(`M${w * 0.15} 0L0 0L0 ${h}L${w * 0.15} ${h}`)] },

  umlClass: { name: 'Classe', lib: 'uml', w: 180, h: 140, table: true, parts: (w, h) => header(w, h, 30), defaults: { text: 'Classe\n+ atributo: Tipo\n+ metodo(): Tipo' } },
  umlInterface: { name: 'Interface', lib: 'uml', w: 180, h: 110, table: true, parts: (w, h) => header(w, h, 30), defaults: { text: '«interface» Contrato\n+ executar(): void' } },
  actor: { name: 'Ator', lib: 'uml', w: 50, h: 100, labelBelow: true, parts: (w, h) => [fill(E(w / 2, h * 0.12, w * 0.22, h * 0.11)), line(`M${w / 2} ${h * 0.23}L${w / 2} ${h * 0.6}M0 ${h * 0.36}L${w} ${h * 0.36}M${w / 2} ${h * 0.6}L${w * 0.08} ${h}M${w / 2} ${h * 0.6}L${w * 0.92} ${h}`)], defaults: { text: 'Usuário' } },
  useCase: { name: 'Caso de uso', lib: 'uml', w: 150, h: 70, parts: (w, h) => [fill(E(w / 2, h / 2, w / 2, h / 2))] },
  umlComponent: { name: 'Componente', lib: 'uml', w: 160, h: 90, parts: (w, h) => [fill(R(12, 0, w - 12, h)), fill(R(0, h * 0.2, 24, 14)), fill(R(0, h * 0.55, 24, 14))], text: (w, h) => ({ x: 24, y: 0, w: w - 24, h }) },
  umlPackage: { name: 'Pacote', lib: 'uml', w: 160, h: 110, parts: (w, h) => [fill(R(0, 0, w * 0.4, 18)), fill(R(0, 18, w, h - 18))], text: (w, h) => ({ x: 0, y: 18, w, h: h - 18 }) },
  umlNote: { name: 'Nota UML', lib: 'uml', w: 140, h: 80, parts: (w, h) => [fill(P([[0, 0], [w - 16, 0], [w, 16], [w, h], [0, h]])), line(`M${w - 16} 0L${w - 16} 16L${w} 16`)] },
  state: { name: 'Estado', lib: 'uml', w: 140, h: 70, parts: (w, h) => [fill(R(0, 0, w, h, 16))] },
  initialState: { name: 'Estado inicial', lib: 'uml', w: 30, h: 30, parts: (w, h) => [accent(E(w / 2, h / 2, w / 2, h / 2))], noText: true },
  finalState: { name: 'Estado final', lib: 'uml', w: 34, h: 34, parts: (w, h) => [line(E(w / 2, h / 2, w / 2, h / 2)), accent(E(w / 2, h / 2, w * 0.3, h * 0.3))], noText: true },
  forkBar: { name: 'Bifurcação', lib: 'uml', w: 140, h: 10, parts: (w, h) => [accent(R(0, 0, w, h, 2))], noText: true },
  lifeline: { name: 'Linha de vida', lib: 'uml', w: 120, h: 260, parts: (w, h) => [fill(R(0, 0, w, 40, 3)), { d: `M${w / 2} 40L${w / 2} ${h}`, kind: 'dashed' }], text: (w) => ({ x: 0, y: 0, w, h: 40 }) },
  activation: { name: 'Ativação', lib: 'uml', w: 16, h: 90, parts: (w, h) => [fill(R(0, 0, w, h))], noText: true },

  entity: { name: 'Entidade', lib: 'er', w: 200, h: 150, table: true, parts: (w, h) => header(w, h, 30), defaults: { text: 'cliente\nPK id: uuid\nnome: varchar(80)\nemail: citext\nFK cidade_id: uuid' } },
  weakEntity: { name: 'Entidade fraca', lib: 'er', w: 150, h: 70, parts: (w, h) => [fill(R(0, 0, w, h)), line(R(5, 5, w - 10, h - 10))] },
  attribute: { name: 'Atributo', lib: 'er', w: 120, h: 60, parts: (w, h) => [fill(E(w / 2, h / 2, w / 2, h / 2))] },
  keyAttribute: { name: 'Atributo chave', lib: 'er', w: 120, h: 60, parts: (w, h) => [fill(E(w / 2, h / 2, w / 2, h / 2))], defaults: { textDecoration: 'underline', text: 'id' } },
  relationship: { name: 'Relacionamento', lib: 'er', w: 130, h: 80, parts: (w, h) => [fill(P([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]))], text: (w, h) => ({ x: w * 0.2, y: h * 0.2, w: w * 0.6, h: h * 0.6 }) },

  bpmnTask: { name: 'Tarefa', lib: 'bpmn', w: 140, h: 80, parts: (w, h) => [fill(R(0, 0, w, h, 10))] },
  bpmnSubprocess: { name: 'Subprocesso', lib: 'bpmn', w: 140, h: 80, parts: (w, h) => [fill(R(0, 0, w, h, 10)), line(R(w / 2 - 7, h - 16, 14, 14) + `M${w / 2} ${h - 13}L${w / 2} ${h - 5}M${w / 2 - 4} ${h - 9}L${w / 2 + 4} ${h - 9}`)] },
  startEvent: { name: 'Evento de início', lib: 'bpmn', w: 44, h: 44, labelBelow: true, parts: (w, h) => [fill(E(w / 2, h / 2, w / 2, h / 2))] },
  intermediateEvent: { name: 'Evento intermediário', lib: 'bpmn', w: 44, h: 44, labelBelow: true, parts: (w, h) => [fill(E(w / 2, h / 2, w / 2, h / 2)), line(E(w / 2, h / 2, w / 2 - 4, h / 2 - 4))] },
  endEvent: { name: 'Evento de fim', lib: 'bpmn', w: 44, h: 44, labelBelow: true, thick: true, parts: (w, h) => [fill(E(w / 2, h / 2, w / 2, h / 2))] },
  gateway: { name: 'Gateway exclusivo', lib: 'bpmn', w: 56, h: 56, labelBelow: true, parts: (w, h) => [fill(P([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]])), line(`M${w * 0.35} ${h * 0.35}L${w * 0.65} ${h * 0.65}M${w * 0.65} ${h * 0.35}L${w * 0.35} ${h * 0.65}`)] },
  parallelGateway: { name: 'Gateway paralelo', lib: 'bpmn', w: 56, h: 56, labelBelow: true, parts: (w, h) => [fill(P([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]])), line(`M${w / 2} ${h * 0.28}L${w / 2} ${h * 0.72}M${w * 0.28} ${h / 2}L${w * 0.72} ${h / 2}`)] },
  dataObject: { name: 'Objeto de dados', lib: 'bpmn', w: 50, h: 64, labelBelow: true, parts: (w, h) => [fill(P([[0, 0], [w - 14, 0], [w, 14], [w, h], [0, h]])), line(`M${w - 14} 0L${w - 14} 14L${w} 14`)] },
  dataStore: { name: 'Depósito de dados', lib: 'bpmn', w: 64, h: 64, labelBelow: true, parts: (w, h) => cyl(w, h) },
  pool: { name: 'Piscina', lib: 'bpmn', w: 640, h: 220, container: true, parts: (w, h) => [fill(R(0, 0, w, h)), line(`M36 0L36 ${h}`)], vertical: true, text: (w, h) => ({ x: 0, y: 0, w: 36, h }) },
  lane: { name: 'Raia', lib: 'bpmn', w: 600, h: 140, container: true, parts: (w, h) => [fill(R(0, 0, w, h)), line(`M30 0L30 ${h}`)], vertical: true, text: (w, h) => ({ x: 0, y: 0, w: 30, h }) },

  server: { name: 'Servidor', lib: 'network', w: 70, h: 90, labelBelow: true, parts: (w, h) => [fill(R(0, 0, w, h, 4)), line(`M0 ${h / 3}L${w} ${h / 3}M0 ${(h * 2) / 3}L${w} ${(h * 2) / 3}`), accent(E(w * 0.8, h / 6, 3, 3) + E(w * 0.8, h / 2, 3, 3) + E(w * 0.8, (h * 5) / 6, 3, 3))] },
  netDatabase: { name: 'Base de dados', lib: 'network', w: 70, h: 86, labelBelow: true, parts: (w, h) => [...cyl(w, h), line(`M0 ${h * 0.45}C0 ${h * 0.58} ${w} ${h * 0.58} ${w} ${h * 0.45}`)] },
  netCloud: { name: 'Nuvem', lib: 'network', w: 120, h: 76, labelBelow: true, parts: (w, h) => [fill(cloud(w, h))] },
  netUser: { name: 'Usuário', lib: 'network', w: 60, h: 70, labelBelow: true, parts: (w, h) => [fill(E(w / 2, h * 0.27, w * 0.24, h * 0.24)), fill(`M0 ${h}C0 ${h * 0.6} ${w * 0.25} ${h * 0.55} ${w / 2} ${h * 0.55}C${w * 0.75} ${h * 0.55} ${w} ${h * 0.6} ${w} ${h}Z`)] },
  laptop: { name: 'Notebook', lib: 'network', w: 90, h: 64, labelBelow: true, parts: (w, h) => [fill(R(w * 0.1, 0, w * 0.8, h * 0.78, 4)), fill(P([[0, h * 0.86], [w, h * 0.86], [w * 0.94, h], [w * 0.06, h]])), line(R(w * 0.16, h * 0.08, w * 0.68, h * 0.62))] },
  mobile: { name: 'Celular', lib: 'network', w: 44, h: 80, labelBelow: true, parts: (w, h) => [fill(R(0, 0, w, h, 8)), line(`M${w * 0.38} ${h * 0.9}L${w * 0.62} ${h * 0.9}`)] },
  router: { name: 'Roteador', lib: 'network', w: 90, h: 50, labelBelow: true, parts: (w, h) => [fill(R(0, h * 0.4, w, h * 0.6, 6)), line(`M${w * 0.25} ${h * 0.4}L${w * 0.15} 0M${w * 0.75} ${h * 0.4}L${w * 0.85} 0`), accent(E(w * 0.2, h * 0.7, 3, 3) + E(w * 0.35, h * 0.7, 3, 3))] },
  firewall: { name: 'Firewall', lib: 'network', w: 80, h: 70, labelBelow: true, parts: (w, h) => [fill(R(0, 0, w, h, 2)), line(`M0 ${h / 3}L${w} ${h / 3}M0 ${(h * 2) / 3}L${w} ${(h * 2) / 3}M${w / 2} 0L${w / 2} ${h / 3}M${w / 4} ${h / 3}L${w / 4} ${(h * 2) / 3}M${(w * 3) / 4} ${h / 3}L${(w * 3) / 4} ${(h * 2) / 3}M${w / 2} ${(h * 2) / 3}L${w / 2} ${h}`)] },
  loadBalancer: { name: 'Balanceador', lib: 'network', w: 70, h: 70, labelBelow: true, parts: (w, h) => [fill(E(w / 2, h / 2, w / 2, h / 2)), line(`M${w * 0.22} ${h / 2}L${w * 0.5} ${h / 2}M${w * 0.5} ${h / 2}L${w * 0.78} ${h * 0.3}M${w * 0.5} ${h / 2}L${w * 0.78} ${h / 2}M${w * 0.5} ${h / 2}L${w * 0.78} ${h * 0.7}`)] },
  queue: { name: 'Fila', lib: 'network', w: 110, h: 50, labelBelow: true, parts: (w, h) => [fill(R(0, 0, w, h, 6)), line(`M${w * 0.25} ${h * 0.2}L${w * 0.25} ${h * 0.8}M${w * 0.45} ${h * 0.2}L${w * 0.45} ${h * 0.8}M${w * 0.65} ${h * 0.2}L${w * 0.65} ${h * 0.8}`)] },
  bucket: { name: 'Armazenamento', lib: 'network', w: 70, h: 76, labelBelow: true, parts: (w, h) => [fill(`M0 ${h * 0.15}L${w * 0.12} ${h}L${w * 0.88} ${h}L${w} ${h * 0.15}Z`), fill(E(w / 2, h * 0.15, w / 2, h * 0.15))] },
  globe: { name: 'Internet', lib: 'network', w: 70, h: 70, labelBelow: true, parts: (w, h) => [fill(E(w / 2, h / 2, w / 2, h / 2)), line(E(w / 2, h / 2, w / 4.5, h / 2) + `M0 ${h / 2}L${w} ${h / 2}M${w * 0.07} ${h * 0.28}L${w * 0.93} ${h * 0.28}M${w * 0.07} ${h * 0.72}L${w * 0.93} ${h * 0.72}`)] },
  containerBox: { name: 'Contêiner', lib: 'network', w: 80, h: 64, labelBelow: true, parts: (w, h) => [fill(R(0, 0, w, h, 4)), line(`M${w * 0.2} ${h * 0.15}L${w * 0.2} ${h * 0.85}M${w * 0.4} ${h * 0.15}L${w * 0.4} ${h * 0.85}M${w * 0.6} ${h * 0.15}L${w * 0.6} ${h * 0.85}M${w * 0.8} ${h * 0.15}L${w * 0.8} ${h * 0.85}`)] },
  lambda: { name: 'Função', lib: 'network', w: 66, h: 66, labelBelow: true, parts: (w, h) => [fill(R(0, 0, w, h, 10)), line(`M${w * 0.3} ${h * 0.22}L${w * 0.42} ${h * 0.22}L${w * 0.7} ${h * 0.8}M${w * 0.5} ${h * 0.45}L${w * 0.3} ${h * 0.8}`)] },
  apiGateway: { name: 'Gateway de API', lib: 'network', w: 80, h: 60, labelBelow: true, parts: (w, h) => [fill(R(0, 0, w, h, 6)), line(`M${w * 0.35} ${h * 0.3}L${w * 0.2} ${h / 2}L${w * 0.35} ${h * 0.7}M${w * 0.65} ${h * 0.3}L${w * 0.8} ${h / 2}L${w * 0.65} ${h * 0.7}`)] },
  boundary: { name: 'Limite de rede', lib: 'network', w: 420, h: 260, container: true, parts: (w, h) => [{ d: R(0, 0, w, h, 8), kind: 'dashedFill' }], text: (w) => ({ x: 10, y: 6, w: w - 20, h: 24 }), align: 'left', valign: 'top' },

  orgCard: { name: 'Cartão de pessoa', lib: 'org', w: 200, h: 76, parts: (w, h) => [fill(R(0, 0, w, h, 8)), accent(E(34, h / 2, 20, 20))], text: (w, h) => ({ x: 62, y: 0, w: w - 70, h }), align: 'left', defaults: { text: 'Nome Sobrenome\nCargo' } },
  orgRole: { name: 'Cargo', lib: 'org', w: 170, h: 60, parts: (w, h) => [fill(R(0, 0, w, h, 6)), accent(R(0, 0, 6, h, 0))] },
  orgTeam: { name: 'Equipe', lib: 'org', w: 360, h: 220, container: true, parts: (w, h) => [fill(R(0, 0, w, h, 10))], text: (w) => ({ x: 12, y: 8, w: w - 24, h: 24 }), align: 'left', valign: 'top' },

  uiButton: { name: 'Botão', lib: 'ui', w: 120, h: 40, parts: (w, h) => [accent(R(0, 0, w, h, 8))], invertText: true, defaults: { text: 'Botão' } },
  uiInput: { name: 'Campo de texto', lib: 'ui', w: 220, h: 40, parts: (w, h) => [fill(R(0, 0, w, h, 6))], align: 'left', text: (w, h) => ({ x: 12, y: 0, w: w - 24, h }), defaults: { text: 'Digite aqui…' } },
  uiCheckbox: { name: 'Caixa de seleção', lib: 'ui', w: 140, h: 24, parts: (w, h) => [fill(R(0, (h - 18) / 2, 18, 18, 4)), line(`M4 ${h / 2}L8 ${h / 2 + 4}L15 ${h / 2 - 4}`)], align: 'left', text: (w, h) => ({ x: 26, y: 0, w: w - 26, h }), defaults: { text: 'Opção' } },
  uiToggle: { name: 'Interruptor', lib: 'ui', w: 52, h: 28, parts: (w, h) => [accent(R(0, 0, w, h, h / 2)), { d: E(w - h / 2, h / 2, h / 2 - 3, h / 2 - 3), kind: 'white' }], noText: true },
  uiSlider: { name: 'Controle deslizante', lib: 'ui', w: 200, h: 24, parts: (w, h) => [fill(R(0, h / 2 - 3, w, 6, 3)), accent(R(0, h / 2 - 3, w * 0.6, 6, 3)), fill(E(w * 0.6, h / 2, 10, 10))], noText: true },
  uiDropdown: { name: 'Lista suspensa', lib: 'ui', w: 200, h: 40, parts: (w, h) => [fill(R(0, 0, w, h, 6)), line(`M${w - 26} ${h / 2 - 3}L${w - 20} ${h / 2 + 3}L${w - 14} ${h / 2 - 3}`)], align: 'left', text: (w, h) => ({ x: 12, y: 0, w: w - 44, h }), defaults: { text: 'Selecionar' } },
  uiCard: { name: 'Cartão', lib: 'ui', w: 240, h: 160, parts: (w, h) => [fill(R(0, 0, w, h, 12))], align: 'left', valign: 'top', text: (w, h) => ({ x: 16, y: 14, w: w - 32, h: h - 28 }), defaults: { text: 'Título do cartão\nTexto de apoio do cartão.' } },
  uiAvatar: { name: 'Avatar', lib: 'ui', w: 48, h: 48, parts: (w, h) => [fill(E(w / 2, h / 2, w / 2, h / 2)), line(E(w / 2, h * 0.4, w * 0.16, h * 0.16) + `M${w * 0.22} ${h * 0.82}C${w * 0.3} ${h * 0.6} ${w * 0.7} ${h * 0.6} ${w * 0.78} ${h * 0.82}`)], noText: true },
  uiImage: { name: 'Imagem (espaço)', lib: 'ui', w: 200, h: 140, parts: (w, h) => [fill(R(0, 0, w, h, 4)), line(`M0 0L${w} ${h}M${w} 0L0 ${h}`)], noText: true },
  uiBrowser: { name: 'Janela do navegador', lib: 'ui', w: 480, h: 320, container: true, parts: (w, h) => [fill(R(0, 0, w, h, 8)), line(`M0 30L${w} 30`), accent(E(16, 15, 5, 5) + E(32, 15, 5, 5) + E(48, 15, 5, 5)), line(R(70, 8, w - 90, 14, 7))], noText: true },
  uiPhone: { name: 'Celular (tela)', lib: 'ui', w: 220, h: 440, container: true, parts: (w, h) => [fill(R(0, 0, w, h, 28)), line(R(w * 0.35, 12, w * 0.3, 10, 5))], noText: true },
  uiNavbar: { name: 'Barra de navegação', lib: 'ui', w: 480, h: 56, parts: (w, h) => [fill(R(0, 0, w, h)), accent(R(16, h / 2 - 10, 20, 20, 4))], align: 'left', text: (w, h) => ({ x: 46, y: 0, w: w - 60, h }), defaults: { text: 'Produto     Recursos     Preços     Contato' } },
  uiTabs: { name: 'Abas', lib: 'ui', w: 300, h: 40, parts: (w, h) => [fill(R(0, 0, w, h)), accent(R(0, h - 3, w / 3, 3))], defaults: { text: 'Visão geral      Detalhes      Ajustes' } },
  uiBadge: { name: 'Etiqueta', lib: 'ui', w: 80, h: 26, parts: (w, h) => [fill(R(0, 0, w, h, h / 2))], defaults: { text: 'Novo' } },
};

export const LIBRARIES = [
  { id: 'basic', name: 'Formas básicas' },
  { id: 'flow', name: 'Fluxograma' },
  { id: 'uml', name: 'UML' },
  { id: 'er', name: 'Entidade-relacionamento' },
  { id: 'bpmn', name: 'BPMN' },
  { id: 'network', name: 'Rede e nuvem' },
  { id: 'org', name: 'Organograma' },
  { id: 'ui', name: 'Wireframe e interface' },
];

export const shapeDef = (id) => SHAPES[id] || SHAPES.rect;

export const nodeParts = (n) => {
  const w = Math.max(n.w, 0.01);
  const h = Math.max(n.h, 0.01);
  switch (n.type) {
    case 'frame':
    case 'component':
    case 'section':
    case 'rect':
    case 'image':
    case 'instance':
      return [fill(R(0, 0, w, h, n.radius || 0))];
    case 'sticky':
      return [{ d: R(0, 0, w, h, 4), kind: 'fill' }];
    case 'ellipse':
      return [fill(E(w / 2, h / 2, w / 2, h / 2))];
    case 'polygon':
      return [fill(P(regular(w, h, Math.max(3, n.sides || 3))))];
    case 'star':
      return [fill(P(regular(w, h, Math.max(3, n.sides || 5), n.inner || 0.45)))];
    case 'shape':
      return shapeDef(n.shape).parts(w, h, n);
    case 'path':
      return [{ d: pathD(n.points || [], n.closed), kind: n.closed ? 'fill' : 'line' }];
    default:
      return [];
  }
};

export const pathD = (pts, closed) => {
  if (!pts.length) return '';
  let d = `M${f(pts[0].x)} ${f(pts[0].y)}`;
  const seg = (a, b) => {
    const c1x = a.ox ?? a.x;
    const c1y = a.oy ?? a.y;
    const c2x = b.ix ?? b.x;
    const c2y = b.iy ?? b.y;
    if (c1x === a.x && c1y === a.y && c2x === b.x && c2y === b.y) d += `L${f(b.x)} ${f(b.y)}`;
    else d += `C${f(c1x)} ${f(c1y)} ${f(c2x)} ${f(c2y)} ${f(b.x)} ${f(b.y)}`;
  };
  for (let i = 1; i < pts.length; i++) seg(pts[i - 1], pts[i]);
  if (closed && pts.length > 2) {
    seg(pts[pts.length - 1], pts[0]);
    d += 'Z';
  }
  return d;
};

export const parseD = (d) => {
  const out = [];
  const re = /([MLCQZ])([^MLCQZ]*)/gi;
  let m;
  while ((m = re.exec(d))) {
    const c = m[1].toUpperCase();
    const nums = (m[2].match(/-?\d*\.?\d+(?:e-?\d+)?/gi) || []).map(Number);
    if (c === 'Z') out.push(['Z']);
    else if (c === 'M' || c === 'L') for (let i = 0; i + 1 < nums.length; i += 2) out.push([i === 0 ? c : 'L', nums[i], nums[i + 1]]);
    else if (c === 'C') for (let i = 0; i + 5 < nums.length; i += 6) out.push(['C', ...nums.slice(i, i + 6)]);
    else if (c === 'Q') for (let i = 0; i + 3 < nums.length; i += 4) out.push(['Q', ...nums.slice(i, i + 4)]);
  }
  return out;
};

export const flattenD = (d, tol = 1) => {
  const rings = [];
  let ring = null;
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  for (const c of parseD(d)) {
    if (c[0] === 'M') {
      if (ring && ring.length > 1) rings.push(ring);
      ring = [{ x: c[1], y: c[2] }];
      cx = sx = c[1];
      cy = sy = c[2];
    } else if (c[0] === 'L') {
      ring.push({ x: c[1], y: c[2] });
      cx = c[1];
      cy = c[2];
    } else if (c[0] === 'C' || c[0] === 'Q') {
      const cubic = c[0] === 'C';
      const [x1, y1, x2, y2, x3, y3] = cubic ? c.slice(1) : [c[1], c[2], c[1], c[2], c[3], c[4]];
      const len = Math.hypot(x1 - cx, y1 - cy) + Math.hypot(x2 - x1, y2 - y1) + Math.hypot(x3 - x2, y3 - y2);
      const steps = Math.max(4, Math.min(64, Math.ceil(len / (tol * 6))));
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const u = 1 - t;
        ring.push({ x: u * u * u * cx + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3, y: u * u * u * cy + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3 });
      }
      cx = x3;
      cy = y3;
    } else if (c[0] === 'Z') {
      if (ring && ring.length > 1) rings.push(ring);
      ring = null;
      cx = sx;
      cy = sy;
    }
  }
  if (ring && ring.length > 1) rings.push(ring);
  return rings;
};
