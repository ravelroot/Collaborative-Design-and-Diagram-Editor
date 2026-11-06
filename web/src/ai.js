import { SHAPES, LIBRARIES } from './shapes.js';
import { diagramBoard, PALETTE_COLORS } from './templates.js';

export const AI_TOOL = 'criar_diagrama';
export const AI_LIMITS = { prompt: 4000, nodes: 80, edges: 160, groups: 12, text: 600, lines: 30, line: 140, label: 80 };

export const AI_PROVIDERS = [
  { id: 'anthropic', name: 'Anthropic (Claude)', kind: 'anthropic', base: 'https://api.anthropic.com', model: 'claude-sonnet-5-5', key: true },
  { id: 'openai', name: 'OpenAI', kind: 'openai', base: 'https://api.openai.com/v1', model: 'gpt-4.1-mini', key: true },
  { id: 'gemini', name: 'Google Gemini', kind: 'openai', base: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash', key: true },
  { id: 'openrouter', name: 'OpenRouter', kind: 'openai', base: 'https://openrouter.ai/api/v1', model: 'openrouter/auto', key: true },
  { id: 'ollama', name: 'Ollama (neste computador)', kind: 'openai', base: 'http://localhost:11434/v1', model: 'llama3.1', key: false, json: true },
  { id: 'lmstudio', name: 'LM Studio (neste computador)', kind: 'openai', base: 'http://localhost:1234/v1', model: '', key: false, json: true },
];

export const AI_ORIGINS = [...new Set(AI_PROVIDERS.map((p) => new URL(p.base).origin).concat(['http://127.0.0.1:11434', 'http://127.0.0.1:1234']))];

export const providerById = (id) => AI_PROVIDERS.find((p) => p.id === id) || AI_PROVIDERS[0];

const EDGE_STYLES = {
  flow: { endCap: 'triangle' },
  association: { endCap: 'arrow' },
  line: { endCap: 'none' },
  bidirectional: { startCap: 'arrow', endCap: 'arrow' },
  inheritance: { endCap: 'triangle', op: '-|>' },
  realization: { endCap: 'triangle', dash: true, op: '..|>' },
  dependency: { endCap: 'arrow', dash: true },
  composition: { startCap: 'diamond', endCap: 'none' },
  aggregation: { startCap: 'diamondOpen', endCap: 'none' },
  'one-to-one': { startCap: 'one', endCap: 'one' },
  'one-to-many': { startCap: 'one', endCap: 'many' },
  'one-to-one-or-many': { startCap: 'one', endCap: 'oneMany' },
  'zero-to-many': { startCap: 'one', endCap: 'zeroMany' },
  'many-to-many': { startCap: 'many', endCap: 'many' },
};

export const EDGE_TYPES = Object.keys(EDGE_STYLES);

const COLORS = { white: 'white', paper: 'paper', linen: 'linen', straw: 'straw', rose: 'rose', slate: 'slate', sage: 'sage', wine: 'wine', coffee: 'coffee', olive: 'olive', ink: 'ink' };
const DARK = new Set(['wine', 'coffee', 'olive', 'ink']);

export const SHAPE_IDS = Object.keys(SHAPES);

export const SPEC_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Título curto do diagrama' },
    direction: { type: 'string', enum: ['TD', 'LR'], description: 'TD de cima para baixo, LR da esquerda para a direita' },
    layout: { type: 'string', enum: ['auto', 'manual'], description: 'auto organiza em camadas; manual usa x, y, w e h de cada forma (telas e wireframes)' },
    nodes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          shape: { type: 'string', enum: SHAPE_IDS },
          name: { type: 'string', description: 'Nome da classe, entidade ou rótulo principal' },
          stereotype: { type: 'string', description: 'interface, abstract, enumeration, entity…' },
          attributes: { type: 'array', items: { type: 'string' } },
          methods: { type: 'array', items: { type: 'string' } },
          text: { type: 'string', description: 'Texto da forma quando não há atributos nem métodos' },
          color: { type: 'string', enum: Object.keys(COLORS) },
          x: { type: 'number' },
          y: { type: 'number' },
          w: { type: 'number' },
          h: { type: 'number' },
        },
        required: ['id', 'shape'],
      },
    },
    edges: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          from: { type: 'string' },
          to: { type: 'string' },
          type: { type: 'string', enum: EDGE_TYPES },
          label: { type: 'string' },
          fromLabel: { type: 'string', description: 'Multiplicidade ou papel na origem, ex.: 1' },
          toLabel: { type: 'string', description: 'Multiplicidade ou papel no destino, ex.: 0..*' },
        },
        required: ['from', 'to', 'type'],
      },
    },
    groups: {
      type: 'array',
      items: { type: 'object', properties: { title: { type: 'string' }, members: { type: 'array', items: { type: 'string' } } }, required: ['title', 'members'] },
    },
  },
  required: ['title', 'nodes', 'edges'],
};

const catalog = () => LIBRARIES.map((lib) => `${lib.name}: ${Object.entries(SHAPES).filter(([, d]) => d.lib === lib.id).map(([id, d]) => `${id} (${d.name})`).join(', ')}`).join('\n');

export const systemPrompt = (json = false) => [
  'Você é o assistente de diagramas do Grafo, um editor de diagramas e interfaces. A pessoa descreve o que quer e você devolve o diagrama completo, pronto para aparecer no quadro, chamando a ferramenta criar_diagrama.',
  'Regras:',
  '- Escreva os textos na mesma língua do pedido.',
  `- Seja completo e fiel ao pedido, com no máximo ${AI_LIMITS.nodes} formas e ${AI_LIMITS.edges} conexões. ids curtos, únicos e sem espaços.`,
  '- Diagrama de classes UML: use umlClass (umlInterface para interfaces), preencha name, attributes com visibilidade e tipo (ex.: "- saldo: Decimal") e methods com parâmetros e retorno (ex.: "+ depositar(valor: Decimal): void"). Use inheritance do filho para o pai, realization da classe para a interface, composition e aggregation do todo para a parte, association ou dependency nos demais casos, e coloque multiplicidades em fromLabel e toLabel.',
  '- Entidade-relacionamento ou banco de dados: use entity com name e attributes no formato "PK id: uuid", "FK cliente_id: uuid", "nome: varchar(120)", e ligue com one-to-one, one-to-many, zero-to-many ou many-to-many.',
  '- Fluxograma e processos: terminator para início e fim, process para etapas, decision para perguntas (com rótulos sim e não nas saídas), data, document e database quando fizer sentido, ligando com flow.',
  '- Casos de uso, estados, BPMN, redes, nuvem e organogramas: use as formas dessas bibliotecas e agrupe com groups quando houver fronteiras (sistema, raia, camada, rede).',
  '- Telas e wireframes: use layout manual, uiPhone ou uiBrowser como fundo e as formas de interface com x, y, w e h em pixels dentro dele; não use conexões.',
  '- Use color só para destacar (ex.: straw para decisões, wine para início e fim, linen para interfaces).',
  'Formas disponíveis (id e nome):',
  catalog(),
  `Tipos de conexão: ${EDGE_TYPES.join(', ')}.`,
  json ? `Responda somente com um objeto JSON válido, sem texto antes ou depois, que siga este esquema: ${JSON.stringify(SPEC_SCHEMA)}` : '',
].filter(Boolean).join('\n');

export const buildRequest = (kind, { prompt, model, maxTokens = 8192, json = false }) => {
  const user = String(prompt || '').slice(0, AI_LIMITS.prompt);
  if (kind === 'anthropic') {
    return {
      model,
      max_tokens: maxTokens,
      system: systemPrompt(false),
      messages: [{ role: 'user', content: user }],
      tools: [{ name: AI_TOOL, description: 'Desenha o diagrama no quadro do Grafo.', input_schema: SPEC_SCHEMA }],
      tool_choice: { type: 'tool', name: AI_TOOL },
    };
  }
  const messages = [{ role: 'system', content: systemPrompt(json) }, { role: 'user', content: user }];
  if (json) return { model, max_tokens: maxTokens, messages, response_format: { type: 'json_object' }, temperature: 0.2 };
  return {
    model,
    max_tokens: maxTokens,
    messages,
    tools: [{ type: 'function', function: { name: AI_TOOL, description: 'Desenha o diagrama no quadro do Grafo.', parameters: SPEC_SCHEMA } }],
    tool_choice: { type: 'function', function: { name: AI_TOOL } },
  };
};

export const extractJSON = (text) => {
  const s = String(text || '').replace(/```(?:json)?/gi, '');
  const start = s.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let quote = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') quote = false;
      continue;
    }
    if (ch === '"') quote = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) {
      try {
        return JSON.parse(s.slice(start, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
};

export class AIError extends Error {}

const providerMessage = (status, data) => {
  const raw = data && (data.error?.message || data.error || data.message);
  const detail = typeof raw === 'string' ? raw.slice(0, 200) : '';
  if (status === 401 || status === 403) return 'O provedor recusou a chave. Confira a chave e o modelo nas configurações da IA.';
  if (status === 404) return `Modelo ou endereço não encontrado no provedor${detail ? `: ${detail}` : '.'}`;
  if (status === 429) return 'Limite de uso atingido. Espere um pouco e tente de novo.';
  if (status === 503 && detail) return detail;
  return `O provedor respondeu com erro ${status}${detail ? `: ${detail}` : '.'}`;
};

export const parseResponse = (kind, status, data) => {
  if (status < 200 || status >= 300) throw new AIError(providerMessage(status, data));
  if (!data || typeof data !== 'object') throw new AIError('Resposta vazia do provedor.');
  if (kind === 'anthropic') {
    const tool = Array.isArray(data.content) && data.content.find((c) => c.type === 'tool_use' && c.input);
    if (tool) return tool.input;
    const text = Array.isArray(data.content) ? data.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n') : '';
    const found = extractJSON(text);
    if (found) return found;
    throw new AIError(data.stop_reason === 'max_tokens' ? 'O diagrama ficou grande demais para uma resposta. Peça algo mais enxuto.' : 'A IA não devolveu um diagrama. Tente reformular o pedido.');
  }
  const msg = data.choices?.[0]?.message;
  const call = msg?.tool_calls?.find((c) => c.function?.arguments);
  if (call) {
    const parsed = typeof call.function.arguments === 'string' ? extractJSON(call.function.arguments) : call.function.arguments;
    if (parsed) return parsed;
  }
  const found = extractJSON(msg?.content);
  if (found) return found;
  throw new AIError(data.choices?.[0]?.finish_reason === 'length' ? 'O diagrama ficou grande demais para uma resposta. Peça algo mais enxuto.' : 'A IA não devolveu um diagrama. Tente reformular o pedido ou escolher outro modelo.');
};

const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim().slice(0, max);
const num = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : d);

export const normalizeSpec = (raw) => {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.nodes)) throw new AIError('A resposta da IA não tem formas para desenhar.');
  const warnings = [];
  const ids = new Map();
  const nodes = [];
  for (const n of raw.nodes) {
    if (!n || typeof n !== 'object') continue;
    if (nodes.length >= AI_LIMITS.nodes) {
      warnings.push(`Só as primeiras ${AI_LIMITS.nodes} formas entraram.`);
      break;
    }
    const attrs = Array.isArray(n.attributes) ? n.attributes.slice(0, AI_LIMITS.lines).map((a) => clean(a, AI_LIMITS.line)).filter(Boolean) : [];
    const methods = Array.isArray(n.methods) ? n.methods.slice(0, AI_LIMITS.lines).map((a) => clean(a, AI_LIMITS.line)).filter(Boolean) : [];
    let shape = SHAPES[n.shape] ? n.shape : attrs.length || methods.length ? 'umlClass' : 'process';
    const name = clean(n.name, 120);
    const stereotype = clean(n.stereotype, 40).replace(/[«»<>]/g, '');
    if (shape === 'umlClass' && /^interface$/i.test(stereotype)) shape = 'umlInterface';
    const head = (stereotype && shape !== 'entity' ? `«${stereotype}» ` : '') + (name || clean(n.text, 120).split('\n')[0] || clean(n.id, 60));
    const table = SHAPES[shape].table;
    const text = table ? [head, ...attrs, ...methods].join('\n') : clean(n.text || name || n.id, AI_LIMITS.text);
    const base = clean(n.id, 60).replace(/\s+/g, '_') || 'n' + nodes.length;
    let key = base;
    for (let i = 2; [...ids.values()].includes(key); i++) key = `${base}_${i}`;
    if (!ids.has(clean(n.id, 60))) ids.set(clean(n.id, 60), key);
    const color = COLORS[n.color];
    nodes.push({
      key,
      shape,
      text: text.slice(0, AI_LIMITS.text * 2),
      ...(color ? { fill: PALETTE_COLORS[color], textColor: DARK.has(color) ? PALETTE_COLORS.light : undefined } : {}),
      x: num(n.x, -20000, 20000, NaN),
      y: num(n.y, -20000, 20000, NaN),
      w: num(n.w, 10, 4000, NaN),
      h: num(n.h, 10, 4000, NaN),
    });
  }
  if (!nodes.length) throw new AIError('A resposta da IA não tem formas para desenhar.');
  const edges = [];
  for (const e of Array.isArray(raw.edges) ? raw.edges : []) {
    if (!e || typeof e !== 'object') continue;
    if (edges.length >= AI_LIMITS.edges) {
      warnings.push(`Só as primeiras ${AI_LIMITS.edges} conexões entraram.`);
      break;
    }
    const from = ids.get(clean(e.from, 60));
    const to = ids.get(clean(e.to, 60));
    if (!from || !to || from === to) continue;
    const type = EDGE_STYLES[e.type] ? e.type : 'flow';
    const { op, ...style } = EDGE_STYLES[type];
    const parts = [clean(e.fromLabel, 20), clean(e.label, AI_LIMITS.label), clean(e.toLabel, 20)].filter(Boolean);
    edges.push({ from, to, label: parts.join('  ·  '), op: op || '>', type, ...style });
  }
  const groups = [];
  for (const g of Array.isArray(raw.groups) ? raw.groups.slice(0, AI_LIMITS.groups) : []) {
    const keys = (Array.isArray(g?.members) ? g.members : []).map((m) => ids.get(clean(m, 60))).filter(Boolean);
    if (keys.length) groups.push({ keys: [...new Set(keys)], label: clean(g.title, 80) || 'Grupo' });
  }
  const manual = raw.layout === 'manual' && nodes.some((n) => Number.isFinite(n.x) && Number.isFinite(n.y));
  return { title: clean(raw.title, 120) || 'Diagrama', direction: raw.direction === 'LR' ? 'LR' : 'TD', manual, nodes, edges, groups, warnings };
};

export const specToBoard = (spec) => {
  const nodes = spec.nodes.map((n, i) => {
    const out = { key: n.key, shape: n.shape, text: n.text };
    if (n.fill) Object.assign(out, { fill: n.fill, textColor: n.textColor });
    if (spec.manual) {
      const def = SHAPES[n.shape] || SHAPES.rect;
      Object.assign(out, { manual: true, x: Number.isFinite(n.x) ? n.x : (i % 5) * 220, y: Number.isFinite(n.y) ? n.y : 2000 + Math.floor(i / 5) * 140, w: Number.isFinite(n.w) ? n.w : def.w, h: Number.isFinite(n.h) ? n.h : def.h });
    }
    return out;
  });
  const opts = { dir: spec.direction === 'LR' ? 'right' : 'down', gx: 70, gy: 90, routing: 'elbow', groups: spec.groups.map((g) => ({ keys: g.keys, label: g.label, pad: 30 })) };
  if (spec.manual) {
    opts.layout = () => {};
    opts.groups = [];
  }
  return diagramBoard(nodes, spec.edges.map(({ type, ...e }) => e), opts);
};

export const summarize = (spec) => {
  const n = spec.nodes.length;
  const e = spec.edges.length;
  return `${n} ${n === 1 ? 'forma' : 'formas'} e ${e} ${e === 1 ? 'conexão' : 'conexões'}`;
};

const KEY_PREFIX = 'grafo:aiKey:';

export const keyStore = {
  get(provider) {
    try {
      return sessionStorage.getItem(KEY_PREFIX + provider) || localStorage.getItem(KEY_PREFIX + provider) || '';
    } catch {
      return '';
    }
  },
  set(provider, key, remember) {
    try {
      sessionStorage.removeItem(KEY_PREFIX + provider);
      localStorage.removeItem(KEY_PREFIX + provider);
      if (key) (remember ? localStorage : sessionStorage).setItem(KEY_PREFIX + provider, key);
    } catch {}
  },
  remembered(provider) {
    try {
      return !!localStorage.getItem(KEY_PREFIX + provider);
    } catch {
      return false;
    }
  },
};

const timeout = (signal, ms) => {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(new AIError('A IA demorou demais para responder.')), ms);
  if (signal) signal.addEventListener('abort', () => ctrl.abort(signal.reason), { once: true });
  return { signal: ctrl.signal, done: () => clearTimeout(t) };
};

const readJSON = async (res) => {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { error: text.slice(0, 200) };
  }
};

export const serverStatus = async () => {
  try {
    const r = await fetch('/api/ai/status', { headers: { Accept: 'application/json' } });
    if (!r.ok) return null;
    const s = await r.json();
    return s && s.enabled ? s : null;
  } catch {
    return null;
  }
};

export const send = async ({ backend, kind, provider, key, body, signal }) => {
  const t = timeout(signal, 180000);
  try {
    if (backend === 'server') {
      const token = new URLSearchParams(location.search).get('token');
      const res = await fetch('/api/ai/request', { method: 'POST', signal: t.signal, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ body }) });
      return { status: res.status, data: await readJSON(res) };
    }
    if (backend === 'desktop') {
      const r = await Promise.race([window.grafoDesktop.ai.request(JSON.stringify(body)), new Promise((_, rej) => t.signal.addEventListener('abort', () => rej(t.signal.reason || new AIError('Cancelado.')), { once: true }))]);
      if (r.error) throw new AIError(r.error);
      let data;
      try {
        data = JSON.parse(r.body || 'null');
      } catch {
        data = { error: String(r.body || '').slice(0, 200) };
      }
      return { status: r.status, data };
    }
    const p = provider;
    const url = kind === 'anthropic' ? `${p.base}/v1/messages` : `${p.base}/chat/completions`;
    const headers = { 'Content-Type': 'application/json' };
    if (kind === 'anthropic') Object.assign(headers, { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' });
    else if (key) headers.Authorization = `Bearer ${key}`;
    const res = await fetch(url, { method: 'POST', signal: t.signal, headers, body: JSON.stringify(body), credentials: 'omit', referrerPolicy: 'no-referrer' });
    return { status: res.status, data: await readJSON(res) };
  } catch (err) {
    if (err instanceof AIError) throw err;
    if (err?.name === 'AbortError' || t.signal.aborted) throw t.signal.reason instanceof AIError ? t.signal.reason : new AIError('Cancelado.');
    throw new AIError(provider && !provider.key ? `Não foi possível falar com ${provider.name}. Confira se ele está aberto e liberado para o Grafo (para o Ollama, OLLAMA_ORIGINS="*").` : 'Não foi possível falar com o provedor de IA. Confira a conexão com a internet.');
  } finally {
    t.done();
  }
};

export const generateDiagram = async ({ prompt, backend, kind, provider, key, model, signal }) => {
  const text = clean(prompt, AI_LIMITS.prompt);
  if (text.length < 3) throw new AIError('Descreva o que você quer criar.');
  const body = buildRequest(kind, { prompt: text, model, json: backend === 'browser' && !!provider?.json });
  const { status, data } = await send({ backend, kind, provider, key, body, signal });
  return normalizeSpec(parseResponse(kind, status, data));
};
