'use strict';
/* AI System Architecture Designer — zero-dependency client app. */

/* =====================================================================
 * Component catalogue
 * capacity = requests/second one replica can handle, latency = ms per call,
 * cost = USD / month per replica. Defaults are rough placeholders.
 * ===================================================================== */
const W = 184, H = 68, SNAP = 10;

const TYPES = {
  client:       { label: 'Client / Users',       short: 'USR', color: '#64748b', group: 'Entry',     capacity: 0,     latency: 0,    cost: 0,    desc: 'Where requests originate (web app, SDK, batch job). Traffic enters the system here.' },
  api:          { label: 'API Gateway',          short: 'API', color: '#0284c7', group: 'Serving',   capacity: 2000,  latency: 5,    cost: 120,  desc: 'Authentication, rate limiting and routing of requests.' },
  lb:           { label: 'Load Balancer',        short: 'LB',  color: '#0891b2', group: 'Serving',   capacity: 10000, latency: 1,    cost: 60,   desc: 'Splits incoming traffic evenly across all of its targets.' },
  cache:        { label: 'Cache',                short: 'CCH', color: '#d97706', group: 'Serving',   capacity: 8000,  latency: 2,    cost: 90,   hitRate: 0.3, desc: 'Response / semantic cache. Hits return early; only misses continue downstream.' },
  queue:        { label: 'Message Queue',        short: 'MQ',  color: '#a16207', group: 'Serving',   capacity: 5000,  latency: 3,    cost: 80,   desc: 'Buffers work for asynchronous consumers (Kafka, SQS, RabbitMQ…).' },
  orchestrator: { label: 'Orchestrator / Agent', short: 'ORC', color: '#7c3aed', group: 'Retrieval', capacity: 800,   latency: 10,   cost: 150,  desc: 'Coordinates the pipeline: prompts, chains, tools and agent loops.' },
  retriever:    { label: 'Retriever',            short: 'RET', color: '#4f46e5', group: 'Retrieval', capacity: 600,   latency: 15,   cost: 100,  desc: 'Builds the search query and gathers candidate documents.' },
  embedding:    { label: 'Embedding Model',      short: 'EMB', color: '#9333ea', group: 'Retrieval', capacity: 300,   latency: 20,   cost: 250,  desc: 'Turns text into vectors for semantic search.' },
  reranker:     { label: 'Reranker',             short: 'RRK', color: '#0d9488', group: 'Retrieval', capacity: 120,   latency: 60,   cost: 300,  desc: 'Cross-encoder that re-scores retrieved candidates for precision.' },
  vectordb:     { label: 'Vector Database',      short: 'VDB', color: '#2563eb', group: 'Data',      capacity: 400,   latency: 25,   cost: 300,  desc: 'Stores embeddings and serves approximate nearest-neighbour search.' },
  database:     { label: 'SQL / NoSQL DB',       short: 'DB',  color: '#475569', group: 'Data',      capacity: 1500,  latency: 8,    cost: 200,  desc: 'Operational data: users, sessions, chat history, metadata.' },
  storage:      { label: 'Object Storage',       short: 'S3',  color: '#78716c', group: 'Data',      capacity: 3000,  latency: 30,   cost: 40,   desc: 'Raw documents, model weights, logs and datasets.' },
  llm:          { label: 'LLM',                  short: 'LLM', color: '#16a34a', group: 'Model',     capacity: 20,    latency: 1200, cost: 0,    desc: 'Generates the answer. Capacity = requests/sec per replica; latency = full generation time.' },
  guardrails:   { label: 'Guardrails',           short: 'GRD', color: '#be123c', group: 'Model',     capacity: 400,   latency: 25,   cost: 100,  desc: 'Input/output safety filters, PII redaction and policy checks.' },
  gpu:          { label: 'GPU Server',           short: 'GPU', color: '#15803d', group: 'Infra',     capacity: 25,    latency: 0,    cost: 2200, desc: 'Hardware hosting model inference. Capacity = requests/sec per server.' },
  monitoring:   { label: 'Monitoring',           short: 'MON', color: '#db2777', group: 'Ops',       capacity: 20000, latency: 0,    cost: 150,  desc: 'Metrics, traces, logs, LLM evals and alerting (events/sec).' },
};
const GROUPS = ['Entry', 'Serving', 'Retrieval', 'Data', 'Model', 'Infra', 'Ops'];

const EDGE_KINDS = {
  sync:      { label: 'Synchronous call', help: 'The sender waits for the answer, so the time of this call is added to how long the user waits.' },
  async:     { label: 'Async / event',    help: 'The sender does not wait (like posting a letter). The receiver still has to do the work, but the user does not wait for it.' },
  telemetry: { label: 'Telemetry',        help: 'Logs and measurements sent to monitoring. Not part of the request from the user, and carries no traffic further.' },
};

const LABEL_HINTS = {
  'client>api': 'request', 'client>lb': 'request', 'lb>api': 'request', 'api>cache': 'prompt', 'api>orchestrator': 'request',
  'api>guardrails': 'input check', 'api>database': 'session', 'cache>retriever': 'cache miss', 'cache>llm': 'cache miss',
  'cache>orchestrator': 'cache miss', 'retriever>embedding': 'query text', 'embedding>vectordb': 'query vector',
  'retriever>vectordb': 'similarity search', 'vectordb>reranker': 'candidates', 'retriever>reranker': 'candidates',
  'reranker>llm': 'context', 'llm>gpu': 'inference', 'embedding>gpu': 'inference', 'reranker>gpu': 'inference',
  'orchestrator>llm': 'prompt', 'orchestrator>retriever': 'search', 'guardrails>llm': 'safe prompt', 'guardrails>orchestrator': 'safe request',
  'storage>queue': 'new docs', 'queue>embedding': 'chunks', 'queue>orchestrator': 'job',
};

/* =====================================================================
 * Templates
 * ===================================================================== */
const TEMPLATES = {
  rag: {
    rps: 50,
    nodes: [
      ['web', 'client', 'Web / Mobile App'],
      ['api', 'api', 'API Gateway'],
      ['db', 'database', 'Chat History DB'],
      ['cache', 'cache', 'Semantic Cache', { hitRate: 0.3 }],
      ['ret', 'retriever', 'Retriever'],
      ['emb', 'embedding', 'Embedding Model'],
      ['vdb', 'vectordb', 'Vector DB'],
      ['rr', 'reranker', 'Reranker'],
      ['llm', 'llm', 'LLM (70B)', { latency: 1500 }],
      ['gpu', 'gpu', 'GPU Server (8×H100)'],
      ['mon', 'monitoring', 'Observability'],
    ],
    edges: [
      ['web', 'api', 'user question'], ['api', 'db', 'load history'], ['api', 'cache', 'prompt'],
      ['cache', 'ret', 'cache miss'], ['ret', 'emb', 'query text'], ['emb', 'vdb', 'query vector'],
      ['vdb', 'rr', 'top-50 chunks'], ['rr', 'llm', 'top-5 context'], ['llm', 'gpu', 'inference'],
      ['api', 'mon', 'metrics', 'telemetry'], ['vdb', 'mon', 'metrics', 'telemetry'], ['llm', 'mon', 'traces', 'telemetry'],
    ],
  },
  agent: {
    rps: 10,
    nodes: [
      ['app', 'client', 'Slack Bot'],
      ['api', 'api', 'API Gateway'],
      ['grd', 'guardrails', 'Input Guardrails'],
      ['orc', 'orchestrator', 'Agent Orchestrator'],
      ['llm', 'llm', 'Planner LLM', { capacity: 15, latency: 900 }],
      ['gpu', 'gpu', 'GPU Pool', { replicas: 2 }],
      ['ret', 'retriever', 'Tool: Knowledge Search'],
      ['vdb', 'vectordb', 'Vector DB'],
      ['db', 'database', 'Tool: CRM Database'],
      ['q', 'queue', 'Task Queue'],
      ['wrk', 'orchestrator', 'Background Worker', { capacity: 50, latency: 4000 }],
      ['mon', 'monitoring', 'Tracing & Evals'],
    ],
    edges: [
      ['app', 'api', 'message'], ['api', 'grd', 'input check'], ['grd', 'orc', 'safe request'],
      ['orc', 'llm', 'plan / reflect', 'sync', 3], ['llm', 'gpu', 'inference', 'sync', 1],
      ['orc', 'ret', 'search', 'sync', 0.6], ['ret', 'vdb', 'similarity search'], ['orc', 'db', 'lookup', 'sync', 0.4],
      ['orc', 'q', 'long task', 'async', 0.2], ['q', 'wrk', 'job', 'async'],
      ['orc', 'mon', 'traces', 'telemetry'], ['llm', 'mon', 'token usage', 'telemetry'],
    ],
  },
  simple: {
    rps: 120,
    nodes: [
      ['cli', 'client', 'Customers'],
      ['lb', 'lb', 'Load Balancer'],
      ['a1', 'api', 'API Server A', { capacity: 80, latency: 15 }],
      ['a2', 'api', 'API Server B', { capacity: 80, latency: 15 }],
      ['cache', 'cache', 'Response Cache', { hitRate: 0.2 }],
      ['llm', 'llm', 'Hosted LLM API', { capacity: 100, latency: 900, cost: 0 }],
      ['mon', 'monitoring', 'Monitoring'],
    ],
    edges: [
      ['cli', 'lb', 'request'], ['lb', 'a1', 'request'], ['lb', 'a2', 'request'],
      ['a1', 'cache', 'prompt'], ['a2', 'cache', 'prompt'], ['cache', 'llm', 'cache miss'],
      ['a1', 'mon', 'metrics', 'telemetry'], ['a2', 'mon', 'metrics', 'telemetry'], ['llm', 'mon', 'usage', 'telemetry'],
    ],
  },
  ingest: {
    rps: 5,
    nodes: [
      ['s3', 'storage', 'Document Bucket'],
      ['q', 'queue', 'Ingestion Queue'],
      ['parse', 'orchestrator', 'Parser / Chunker', { capacity: 20, latency: 400 }],
      ['emb', 'embedding', 'Embedding Model'],
      ['gpu', 'gpu', 'GPU Server (L4)', { capacity: 150, cost: 700 }],
      ['vdb', 'vectordb', 'Vector DB'],
      ['meta', 'database', 'Metadata DB'],
      ['mon', 'monitoring', 'Pipeline Metrics'],
    ],
    edges: [
      ['s3', 'q', 'new files', 'async'], ['q', 'parse', 'file', 'async'], ['parse', 'emb', 'chunks', 'sync', 20],
      ['emb', 'gpu', 'inference'], ['emb', 'vdb', 'upsert vectors'], ['parse', 'meta', 'doc metadata'],
      ['parse', 'mon', 'metrics', 'telemetry'], ['vdb', 'mon', 'metrics', 'telemetry'],
    ],
  },
  blank: { rps: 50, nodes: [], edges: [] },
};

/* =====================================================================
 * State
 * ===================================================================== */
const STORAGE_KEY = 'ai-arch-designer:v1';
let state = { nodes: [], edges: [], settings: { rps: 50 } };
let view = { x: 40, y: 40, k: 1 };
let selection = null; // { kind: 'node' | 'edge', id }
let ui = { flow: true, focus: true, critical: true };
let analysis = null;
const hist = { undo: [], redo: [] };

const $ = (s, el = document) => el.querySelector(s);
const uid = (p) => p + Math.random().toString(36).slice(2, 8);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const num = (v, d) => (Number.isFinite(+v) && v !== '' && v !== null ? +v : d);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const getNode = (id) => state.nodes.find((n) => n.id === id);
const getEdge = (id) => state.edges.find((e) => e.id === id);

function fmt(n) {
  if (!Number.isFinite(n)) return '∞';
  if (n >= 10000) return (n / 1000).toFixed(0) + 'k';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  if (n >= 100) return Math.round(n).toString();
  if (n >= 10) return n.toFixed(0);
  return (Math.round(n * 10) / 10).toString();
}
const fmtMs = (ms) => (ms >= 1000 ? (ms / 1000).toFixed(2) + ' s' : Math.round(ms) + ' ms');
const fmtPct = (u) => Math.round(u * 100) + '%';
const fmtMoney = (v) => '$' + Math.round(v).toLocaleString('en-US');
const utilColor = (u) => (u > 1 ? '#dc2626' : u >= 0.75 ? '#d97706' : '#16a34a');

function makeNode(type, x, y, over = {}) {
  const t = TYPES[type];
  const n = { id: uid('n'), type, name: t.label, x: Math.round(x), y: Math.round(y), capacity: t.capacity, latency: t.latency, replicas: 1, cost: t.cost, notes: '' };
  if (type === 'cache') n.hitRate = t.hitRate;
  return Object.assign(n, over);
}
function uniqueName(base) {
  const names = new Set(state.nodes.map((n) => n.name));
  if (!names.has(base)) return base;
  let i = 2;
  while (names.has(`${base} ${i}`)) i++;
  return `${base} ${i}`;
}
function normalizeNode(n) {
  const base = makeNode(n.type, num(n.x, 0), num(n.y, 0));
  return Object.assign(base, {
    id: typeof n.id === 'string' && /^[A-Za-z][\w]*$/.test(n.id) ? n.id : base.id,
    name: String(n.name ?? base.name),
    capacity: Math.max(0, num(n.capacity, base.capacity)),
    latency: Math.max(0, num(n.latency, base.latency)),
    replicas: Math.max(1, Math.round(num(n.replicas, 1))),
    cost: Math.max(0, num(n.cost, base.cost)),
    notes: String(n.notes ?? ''),
  }, n.type === 'cache' ? { hitRate: clamp(num(n.hitRate, 0.3), 0, 0.99) } : {});
}
function normalizeEdge(e) {
  return {
    id: typeof e.id === 'string' && /^[A-Za-z][\w]*$/.test(e.id) ? e.id : uid('e'),
    from: e.from, to: e.to, label: String(e.label ?? ''),
    kind: EDGE_KINDS[e.kind] ? e.kind : 'sync',
    calls: Math.max(0, num(e.calls, 1)),
  };
}
function loadDoc(d) {
  if (!d || !Array.isArray(d.nodes) || !Array.isArray(d.edges)) throw new Error('Not a valid design file');
  const nodes = d.nodes.filter((n) => n && TYPES[n.type]).map(normalizeNode);
  const ids = new Set(nodes.map((n) => n.id));
  const edges = d.edges.filter((e) => e && ids.has(e.from) && ids.has(e.to) && e.from !== e.to).map(normalizeEdge);
  state = { nodes, edges, settings: { rps: Math.max(0, num(d.settings?.rps, 50)) } };
}
const docData = () => ({ app: 'ai-system-architecture-designer', version: 1, nodes: state.nodes, edges: state.edges, settings: state.settings });

/* ---------- history & persistence ---------- */
const snapshot = () => JSON.stringify(docData());
function pushHistory(snap = snapshot()) {
  hist.undo.push(snap);
  if (hist.undo.length > 100) hist.undo.shift();
  hist.redo = [];
}
function mutate(fn) {
  pushHistory();
  fn();
  save();
  render();
}
function restore(snap) {
  loadDoc(JSON.parse(snap));
  if (selection && !(selection.kind === 'node' ? getNode(selection.id) : getEdge(selection.id))) selection = null;
  save();
  render();
}
function undo() { if (!hist.undo.length) return; hist.redo.push(snapshot()); restore(hist.undo.pop()); }
function redo() { if (!hist.redo.length) return; hist.undo.push(snapshot()); restore(hist.redo.pop()); }

let saveTimer = 0;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...docData(), view, ui })); } catch { /* storage full / disabled */ }
  }, 150);
}

/* =====================================================================
 * Analysis: traffic propagation, utilisation, latency, findings
 * ===================================================================== */
function analyze() {
  const { nodes, edges } = state;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const flow = edges.filter((e) => e.kind !== 'telemetry');
  const tele = edges.filter((e) => e.kind === 'telemetry');
  const outs = new Map(nodes.map((n) => [n.id, []]));
  const ins = new Map(nodes.map((n) => [n.id, []]));
  const inDeg = new Map(nodes.map((n) => [n.id, 0]));
  for (const e of flow) { outs.get(e.from).push(e); ins.get(e.to).push(e); inDeg.set(e.to, inDeg.get(e.to) + 1); }

  // Topological order (Kahn). Nodes left over are part of a cycle.
  const order = [];
  const q = nodes.filter((n) => inDeg.get(n.id) === 0).map((n) => n.id);
  while (q.length) {
    const id = q.shift();
    order.push(id);
    for (const e of outs.get(id)) { inDeg.set(e.to, inDeg.get(e.to) - 1); if (inDeg.get(e.to) === 0) q.push(e.to); }
  }
  const inOrder = new Set(order);
  const cycle = new Set(nodes.filter((n) => !inOrder.has(n.id)).map((n) => n.id));

  // Traffic sources.
  let sources = nodes.filter((n) => n.type === 'client');
  if (!sources.length) sources = nodes.filter((n) => n.type !== 'monitoring' && !ins.get(n.id).length && outs.get(n.id).length);
  const rps = state.settings.rps;

  const load = new Map(nodes.map((n) => [n.id, 0]));
  const edgeLoad = new Map();
  for (const s of sources) load.set(s.id, load.get(s.id) + rps / sources.length);
  for (const id of order) {
    const n = byId.get(id);
    const L = load.get(id);
    const os = outs.get(id);
    if (!os.length) continue;
    let out = n.type === 'cache' ? L * (1 - (n.hitRate ?? 0)) : L;
    if (n.type === 'lb') out /= os.length;
    for (const e of os) { const v = out * e.calls; edgeLoad.set(e.id, v); load.set(e.to, load.get(e.to) + v); }
  }
  for (const e of tele) { const v = load.get(e.from) || 0; edgeLoad.set(e.id, v); load.set(e.to, load.get(e.to) + v); }

  // Utilisation.
  const util = new Map();
  for (const n of nodes) {
    const cap = n.capacity * n.replicas;
    if (n.type !== 'client' && cap > 0) util.set(n.id, load.get(n.id) / cap);
  }

  // Latency along synchronous edges (longest path in the DAG).
  const reach = new Set();
  const stack = sources.map((s) => s.id);
  while (stack.length) {
    const id = stack.pop();
    if (reach.has(id)) continue;
    reach.add(id);
    for (const e of outs.get(id)) if (e.kind === 'sync') stack.push(e.to);
  }
  const finish = new Map(), prevEdge = new Map();
  for (const id of order) {
    if (!reach.has(id)) continue;
    const n = byId.get(id);
    let best = n.latency, via = null;
    for (const e of ins.get(id)) {
      if (e.kind !== 'sync' || !finish.has(e.from)) continue;
      const c = finish.get(e.from) + n.latency * Math.max(1, e.calls);
      if (c > best || via === null) { best = c; via = e; }
    }
    finish.set(id, best);
    if (via) prevEdge.set(id, via);
  }
  let end = null;
  for (const [id, f] of finish) if (end === null || f > finish.get(end)) end = id;
  const path = [], pathEdges = new Set();
  for (let cur = end; cur; ) {
    path.unshift(cur);
    const e = prevEdge.get(cur);
    if (!e) break;
    pathEdges.add(e.id);
    cur = e.from;
  }
  const e2e = end ? finish.get(end) : 0;
  let avgLatency = null;
  const pathCache = path.map((id) => byId.get(id)).find((n) => n.type === 'cache');
  if (pathCache) avgLatency = pathCache.hitRate * finish.get(pathCache.id) + (1 - pathCache.hitRate) * e2e;

  // Bottleneck & capacity headroom.
  let bottleneck = null, maxUtil = 0;
  for (const [id, u] of util) if (byId.get(id).type !== 'monitoring' && u > maxUtil) { maxUtil = u; bottleneck = id; }
  const sustainable = maxUtil > 0 ? rps / maxUtil : Infinity;
  const totalCost = nodes.reduce((s, n) => s + n.cost * n.replicas, 0);

  // Findings.
  const F = [];
  const nm = (id) => `“${byId.get(id).name}”`;
  for (const n of nodes) {
    const u = util.get(n.id);
    if (u === undefined || n.type === 'monitoring') continue;
    const need = Math.ceil(load.get(n.id) / n.capacity);
    if (u > 1) F.push({ level: 'error', ids: [n.id], text: `${nm(n.id)} is overloaded at ${fmtPct(u)} (${fmt(load.get(n.id))} rps vs ${fmt(n.capacity * n.replicas)} rps capacity). Scale to ~${Math.ceil(need / 0.75)} replicas for 75% headroom${n.type === 'llm' || n.type === 'gpu' ? ', or add a cache in front' : ''}.` });
    else if (u >= 0.75) F.push({ level: 'warn', ids: [n.id], text: `${nm(n.id)} is near capacity at ${fmtPct(u)}. Traffic spikes will cause queueing; consider ${Math.ceil(load.get(n.id) / n.capacity / 0.6)} replicas.` });
  }
  if (cycle.size) F.push({ level: 'error', ids: [...cycle], text: `Circular dependency between ${[...cycle].map(nm).join(', ')}. Traffic and latency can't be computed for these; break the loop or make one link async.` });
  if (nodes.length && !sources.length) F.push({ level: 'warn', ids: [], text: 'No traffic entry point. Add a “Client / Users” component and connect it to your API.' });

  const spof = path.filter((id) => { const n = byId.get(id); return n.replicas < 2 && !['client', 'monitoring'].includes(n.type); });
  if (spof.length) F.push({ level: 'warn', ids: spof, text: `Single points of failure on the request path (1 replica): ${spof.map(nm).join(', ')}.` });

  const monitors = nodes.filter((n) => n.type === 'monitoring');
  if (nodes.length > 2 && !monitors.length) F.push({ level: 'warn', ids: [], text: 'No monitoring. Add a Monitoring component and send telemetry from the API, retriever and LLM.' });
  else if (monitors.length) {
    const reporting = new Set(tele.filter((e) => byId.get(e.to)?.type === 'monitoring').map((e) => e.from));
    const blind = nodes.filter((n) => ['llm', 'vectordb', 'api', 'retriever', 'orchestrator', 'reranker', 'gpu'].includes(n.type) && !reporting.has(n.id));
    if (blind.length) F.push({ level: 'info', ids: blind.map((n) => n.id), text: `Not sending telemetry: ${blind.map((n) => nm(n.id)).join(', ')}. Connect them to monitoring to see latency and errors.` });
  }

  const ancestors = (id) => {
    const seen = new Set(), st = [id];
    while (st.length) for (const e of ins.get(st.pop())) if (!seen.has(e.from)) { seen.add(e.from); st.push(e.from); }
    return seen;
  };
  const downstream = (id) => {
    const seen = new Set(), st = [id];
    while (st.length) for (const e of outs.get(st.pop())) if (!seen.has(e.to)) { seen.add(e.to); st.push(e.to); }
    return seen;
  };
  for (const n of nodes.filter((x) => x.type === 'llm')) {
    if (![...downstream(n.id)].some((id) => byId.get(id).type === 'gpu'))
      F.push({ level: 'info', ids: [n.id], text: `${nm(n.id)} has no GPU server. Fine for a hosted API (OpenAI, Anthropic, Bedrock…); for self-hosting, connect it to a GPU Server.` });
    const anc = ancestors(n.id);
    if (anc.size && ![...anc].some((id) => byId.get(id).type === 'cache'))
      F.push({ level: 'info', ids: [n.id], text: `No cache in front of ${nm(n.id)}. A semantic/response cache with even a 20–30% hit rate cuts LLM load and cost proportionally.` });
  }
  for (const n of nodes.filter((x) => x.type === 'vectordb')) {
    const near = new Set([...ancestors(n.id), ...downstream(n.id)]);
    if (![...near].some((id) => byId.get(id).type === 'embedding'))
      F.push({ level: 'info', ids: [n.id], text: `${nm(n.id)} has no Embedding Model connected — queries and documents must be embedded before vector search.` });
  }
  const linked = new Set(edges.flatMap((e) => [e.from, e.to]));
  const lonely = nodes.filter((n) => !linked.has(n.id));
  if (lonely.length && nodes.length > 1) F.push({ level: 'warn', ids: lonely.map((n) => n.id), text: `Not connected to anything: ${lonely.map((n) => nm(n.id)).join(', ')}.` });
  if (e2e > 3000) {
    const hog = path.reduce((a, id) => (byId.get(id).latency > (a ? byId.get(a).latency : -1) ? id : a), null);
    F.push({ level: 'warn', ids: hog ? [hog] : [], text: `End-to-end latency is ${fmtMs(e2e)}${hog ? `, dominated by ${nm(hog)}` : ''}. Consider streaming tokens, a smaller model, or parallelising sequential calls.` });
  }
  if (nodes.length && !F.some((f) => f.level === 'error' || f.level === 'warn'))
    F.push({ level: 'ok', ids: [], text: `No bottlenecks at ${fmt(rps)} rps. The design can sustain about ${fmt(sustainable)} rps before the first component saturates.` });
  const rank = { error: 0, warn: 1, info: 2, ok: 3 };
  F.sort((a, b) => rank[a.level] - rank[b.level]);

  return { load, edgeLoad, util, cycle, sources, path, pathEdges, e2e, avgLatency, bottleneck, maxUtil, sustainable, totalCost, findings: F, ancestors, downstream };
}

/* =====================================================================
 * Canvas rendering (SVG)
 * ===================================================================== */
const SVG_CSS = `
.node-body{fill:#fff;stroke:#cbd5e1;stroke-width:1.5}
.node:hover .node-body{stroke:#94a3b8}
.node.warn .node-body{fill:#fffbeb;stroke:#d97706;stroke-width:2}
.node.over .node-body{fill:#fef2f2;stroke:#dc2626;stroke-width:2.5}
.node.cyc .node-body{stroke-dasharray:6 4}
.node.sel .node-body{stroke:#2563eb;stroke-width:3}
.node{cursor:move}
.node-title{font:600 12.5px Inter,'Segoe UI',system-ui,sans-serif;fill:#0f172a}
.node-sub{font:11px Inter,'Segoe UI',system-ui,sans-serif;fill:#64748b}
.node-icon{font:800 10px Inter,'Segoe UI',system-ui,sans-serif;fill:#fff;text-anchor:middle;dominant-baseline:central}
.util-text{font:700 10px Inter,'Segoe UI',system-ui,sans-serif;text-anchor:end}
.bar-bg{fill:#e2e8f0}
.edge{fill:none;stroke:#94a3b8}
.edge.async{stroke-dasharray:8 6}
.edge.telemetry{stroke:#f472b6;stroke-dasharray:2 5;stroke-linecap:round}
.edge.crit{stroke:#7c3aed}
.edge.hot{stroke:#dc2626}
.edge.sel{stroke:#2563eb}
.edge-hit{fill:none;stroke:transparent;stroke-width:14;cursor:pointer}
.edge-flow{fill:none;stroke:#fff;stroke-opacity:.9;stroke-width:2;stroke-dasharray:3 15;stroke-linecap:round;pointer-events:none;animation:aiad-flow 1s linear infinite}
@keyframes aiad-flow{to{stroke-dashoffset:-18}}
.edge-label-bg{fill:#fff;stroke:#e2e8f0}
.edge-g.sel .edge-label-bg{stroke:#2563eb}
.edge-label{font:11px Inter,'Segoe UI',system-ui,sans-serif;fill:#334155;text-anchor:middle;dominant-baseline:central}
.edge-g{cursor:pointer}
.dim{opacity:.16}
.port{fill:#fff;stroke:#64748b;stroke-width:1.5;cursor:crosshair}
.port:hover,.node.target .port{fill:#2563eb;stroke:#2563eb}
.node.target .node-body{stroke:#2563eb;stroke-width:3}
.ghost{fill:none;stroke:#2563eb;stroke-width:2;stroke-dasharray:6 4;pointer-events:none}
.export-title{font:700 16px Inter,'Segoe UI',system-ui,sans-serif;fill:#0f172a}
.export-sub{font:12px Inter,'Segoe UI',system-ui,sans-serif;fill:#64748b}
`;

const svg = $('#canvas');
svg.innerHTML = `
  <style>${SVG_CSS}</style>
  <defs>
    <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#cbd5e1"/></pattern>
    ${[['def', '#94a3b8'], ['hot', '#dc2626'], ['crit', '#7c3aed'], ['sel', '#2563eb'], ['tel', '#f472b6']].map(([k, c]) =>
      `<marker id="arrow-${k}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="11" markerHeight="11" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${c}"/></marker>`).join('')}
  </defs>
  <rect class="bg-grid" width="100%" height="100%" fill="url(#grid)"/>
  <g id="viewport"><g id="edges"></g><g id="nodes"></g><g id="labels"></g><path id="ghost" class="ghost" d=""/></g>`;
const vp = $('#viewport'), gEdges = $('#edges'), gNodes = $('#nodes'), gLabels = $('#labels'), ghost = $('#ghost'), gridPat = $('#grid');

function setViewTransform() {
  vp.setAttribute('transform', `translate(${view.x},${view.y}) scale(${view.k})`);
  gridPat.setAttribute('patternTransform', `translate(${view.x},${view.y}) scale(${view.k})`);
  $('#zoom-label').textContent = Math.round(view.k * 100) + '%';
}

function edgeGeom(a, b) {
  const ax = a.x + W / 2, ay = a.y + H / 2, bx = b.x + W / 2, by = b.y + H / 2;
  const dx = bx - ax, dy = by - ay;
  let s, t, c1, c2;
  if (Math.abs(dx) >= Math.abs(dy) * 1.2 || Math.abs(dy) < H + 16) {
    const d = dx >= 0 ? 1 : -1;
    s = { x: d > 0 ? a.x + W : a.x, y: ay };
    t = { x: d > 0 ? b.x : b.x + W, y: by };
    const c = Math.max(40, Math.abs(t.x - s.x) / 2);
    c1 = { x: s.x + d * c, y: s.y }; c2 = { x: t.x - d * c, y: t.y };
  } else {
    const d = dy >= 0 ? 1 : -1;
    s = { x: ax, y: d > 0 ? a.y + H : a.y };
    t = { x: bx, y: d > 0 ? b.y : b.y + H };
    const c = Math.max(30, Math.abs(t.y - s.y) / 2);
    c1 = { x: s.x, y: s.y + d * c }; c2 = { x: t.x, y: t.y - d * c };
  }
  return {
    d: `M${s.x},${s.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${t.x},${t.y}`,
    mx: (s.x + 3 * c1.x + 3 * c2.x + t.x) / 8,
    my: (s.y + 3 * c1.y + 3 * c2.y + t.y) / 8,
  };
}

function computeFocus() {
  if (!ui.focus || selection?.kind !== 'node' || !getNode(selection.id)) return null;
  const id = selection.id, nodes = new Set([id]), edges = new Set();
  const walk = (start, dir) => {
    const seen = new Set([start]), st = [start];
    while (st.length) {
      const cur = st.pop();
      for (const e of state.edges) {
        if (e.kind === 'telemetry') continue;
        const [here, there] = dir === 'down' ? [e.from, e.to] : [e.to, e.from];
        if (here !== cur) continue;
        edges.add(e.id); nodes.add(there);
        if (!seen.has(there)) { seen.add(there); st.push(there); }
      }
    }
  };
  walk(id, 'down'); walk(id, 'up');
  for (const e of state.edges) if (e.kind === 'telemetry' && (e.from === id || e.to === id)) { edges.add(e.id); nodes.add(e.from); nodes.add(e.to); }
  return { nodes, edges };
}

function renderCanvas() {
  setViewTransform();
  const A = analysis;
  const byId = new Map(state.nodes.map((n) => [n.id, n]));
  const focus = computeFocus();
  const crit = ui.critical ? A.pathEdges : new Set();

  let eh = '', lh = '';
  for (const e of state.edges) {
    const a = byId.get(e.from), b = byId.get(e.to);
    if (!a || !b) continue;
    const g = edgeGeom(a, b);
    const load = A.edgeLoad.get(e.id) || 0;
    const tel = e.kind === 'telemetry';
    const hot = !tel && (A.util.get(b.id) || 0) > 1;
    const sel = selection?.kind === 'edge' && selection.id === e.id;
    const isCrit = crit.has(e.id);
    const cls = ['edge', e.kind, isCrit && 'crit', hot && 'hot', sel && 'sel'].filter(Boolean).join(' ');
    const marker = sel ? 'sel' : hot ? 'hot' : isCrit ? 'crit' : tel ? 'tel' : 'def';
    const sw = tel ? 1.8 : 1.8 + Math.min(3.2, Math.log10(1 + load) * 1.2) + (isCrit ? 1 : 0);
    const parts = [e.label, e.calls !== 1 ? `×${e.calls}` : '', !tel ? `${fmt(load)} rps` : ''].filter(Boolean);
    const label = parts.join(' · ');
    const lw = label.length * 6 + 14;
    const dur = clamp(2.4 - Math.log10(load + 1) * 0.7, 0.35, 2.4).toFixed(2);
    const gcls = `edge-g${sel ? ' sel' : ''}${focus && !focus.edges.has(e.id) ? ' dim' : ''}`;
    const etip = ` data-tip="${esc(edgeTip(e))}"`;
    eh += `<g class="${gcls}" data-edge="${e.id}"${etip}>
      <path class="${cls}" d="${g.d}" style="stroke-width:${sw.toFixed(1)}" marker-end="url(#arrow-${marker})"/>
      ${ui.flow && !tel && load > 0 ? `<path class="edge-flow" d="${g.d}" style="animation-duration:${dur}s"/>` : ''}
      <path class="edge-hit" d="${g.d}"/>
    </g>`;
    if (label) lh += `<g class="${gcls}" data-edge="${e.id}"${etip}><rect class="edge-label-bg" x="${(g.mx - lw / 2).toFixed(1)}" y="${(g.my - 9).toFixed(1)}" width="${lw}" height="18" rx="9"/>
      <text class="edge-label" x="${g.mx.toFixed(1)}" y="${g.my.toFixed(1)}">${esc(label)}</text></g>`;
  }
  gEdges.innerHTML = eh;
  gLabels.innerHTML = lh;

  let nh = '';
  for (const n of state.nodes) {
    const t = TYPES[n.type];
    const u = A.util.get(n.id);
    const status = u === undefined || n.type === 'monitoring' ? '' : u > 1 ? 'over' : u >= 0.75 ? 'warn' : '';
    const sel = selection?.kind === 'node' && selection.id === n.id;
    const cls = ['node', status, sel && 'sel', focus && !focus.nodes.has(n.id) && 'dim', A.cycle.has(n.id) && 'cyc'].filter(Boolean).join(' ');
    const sub = n.type === 'client'
      ? `${fmt(A.load.get(n.id))} rps out`
      : `${t.label}${n.replicas > 1 ? ` ×${n.replicas}` : ''} · ${n.latency} ms`;
    const bar = u === undefined ? '' : `
      <rect class="bar-bg" x="58" y="50" width="86" height="5" rx="2.5"/>
      <rect x="58" y="50" width="${(86 * Math.min(u, 1)).toFixed(1)}" height="5" rx="2.5" fill="${utilColor(u)}"/>
      <text class="util-text" x="${W - 10}" y="55" fill="${utilColor(u)}">${fmtPct(u)}</text>`;
    nh += `<g class="${cls}" data-node="${n.id}" transform="translate(${n.x},${n.y})" data-tip="${esc(nodeTip(n))}">
      <rect class="node-body" width="${W}" height="${H}" rx="12"/>
      <rect x="12" y="16" width="36" height="36" rx="9" fill="${t.color}"/>
      <text class="node-icon" x="30" y="34">${t.short}</text>
      <text class="node-title" x="58" y="${u === undefined ? 30 : 25}">${esc(trunc(n.name, 17))}</text>
      <text class="node-sub" x="58" y="${u === undefined ? 47 : 41}">${esc(trunc(sub, 22))}</text>
      ${bar}
      <circle class="port" cx="${W}" cy="${H / 2}" r="6.5"${tip('port')}/>
    </g>`;
  }
  gNodes.innerHTML = nh;
  $('#empty-hint').style.display = state.nodes.length ? 'none' : '';
}

/* =====================================================================
 * Hover help (tooltips) — plain-English explanations for everything
 * ===================================================================== */
const TIPS = {
  name: 'The label shown on the box.\nPick anything that helps you recognise it. It does not change any numbers.',
  capacity: 'How many requests per second ONE copy of this part can handle before it gets too busy.\n\nExample: 20 means one copy can answer about 20 requests every second.',
  latency: 'How long ONE request takes inside this part, in milliseconds (1000 ms = 1 second).\n\nExample: 1500 means each answer takes 1.5 seconds.',
  replicas: 'How many copies of this part you run side by side.\nMore copies = more requests handled at the same time.\n\nTotal capacity = capacity per copy × number of copies.\nExample: 20 rps × 3 copies = 60 rps.',
  cost: 'How much ONE copy costs per month, in US dollars.\n\nCost of this part = cost per copy × number of copies.',
  hitRate: 'Out of every 100 requests, how many the cache can answer by itself from memory.\nOnly the rest (the "misses") are sent on to the next parts.\n\nExample: 30% means 70 out of 100 requests continue.',
  notes: 'Free text for yourself, e.g. which model or product you plan to use.\nIt does not change any numbers.',
  clientNote: 'A Client is where requests come from (your app or your users).\nIt sends the number in the toolbar\'s Traffic box. If you have several Clients, the traffic is shared equally between them.',
  m_load: 'How many requests per second actually arrive at this part.\n\nHow it is worked out: start with the Traffic number at the Client and follow the arrows. Every part passes its traffic along its arrows. Caches pass on only their misses, load balancers split traffic evenly, and "calls per request" multiplies it.',
  m_capacity: 'The most this part can handle right now:\ncapacity per copy × number of copies.',
  m_util: 'How busy this part is:\nrequests arriving ÷ total capacity.\n\nGreen = under 75% (fine)\nAmber = 75–100% (getting full)\nRed = over 100% (overloaded: requests will wait or fail)',
  m_cost: 'Monthly cost of this part:\ncost per copy × number of copies.',
  m_emitted: 'How many requests per second this Client sends into the system.\nIt comes from the Traffic box in the toolbar.',
  callsTo: 'The parts this box sends requests or data to (its arrows going OUT).\nThis box needs them to do its job.',
  calledBy: 'The parts that send requests or data to this box (arrows coming IN).\nThey need this box to do their job.',
  blast: '"Depends on" = how many parts come after this one in the chain. If any of them break, this box is affected.\n\n"Blast radius" = how many parts come before it. If this box breaks, all of them are affected.',
  dup: 'Make a copy of this box with the same settings.\nShortcut: Ctrl + D',
  del: 'Remove this from the diagram. You can undo with Ctrl + Z.',
  e_label: 'A short note about what travels along this arrow, e.g. "top-5 context".\nIt is only for display and does not change any numbers.',
  e_kind: 'What kind of connection this is:\n\n• Synchronous: the sender waits for the answer. Its time is added to how long the user waits.\n• Async: the sender does not wait (like posting a letter). It still uses the receiver\'s capacity, but adds no waiting time.\n• Telemetry: logs and measurements sent to monitoring. Not part of the user\'s request.',
  e_calls: 'How many times this call happens for each incoming request. The traffic on the arrow is multiplied by this number.\n\n3 = called three times per request (e.g. an agent asking the LLM three times)\n1 = once (normal)\n0.2 = only 20% of requests use this arrow',
  e_load: 'How many requests per second travel along this arrow.\n(For telemetry: how many measurement events per second.)',
  e_crit: 'This arrow is part of the slowest chain of calls. That chain decides how long the user waits for an answer.',
  reverse: 'Flip the arrow so it points the other way.',
  a_traffic: 'The requests per second coming into the system. You set it in the toolbar\'s Traffic box.\n\n"Entry points" are the Client boxes where traffic starts.',
  a_latency: 'Roughly how long a user waits for an answer.\n\nHow it is worked out: add up the time of every waiting (synchronous) call along the slowest chain. Where the chain splits, the slower branch counts.\n\n"Avg with cache hits" also counts the fast answers that come straight from the cache.',
  a_max: 'The most traffic this design can take before the first part becomes overloaded.\n\nHow it is worked out: current traffic ÷ how busy the busiest part is.\nExample: 50 rps ÷ 175% ≈ 29 rps.',
  a_cost: 'Estimated monthly bill.\n\nHow it is worked out: for every box, cost per copy × number of copies, all added together.',
  a_bottleneck: 'The busiest part (highest utilisation). It is the first thing that breaks when traffic grows, so fix this one first.\n\nWays to fix: add copies (replicas), put a cache in front of it, or use a faster option.',
  a_critical: 'The slowest chain of waiting (synchronous) calls, from the user to the end. Its total time is the end-to-end latency.\n\nTo make answers faster, speed up the boxes on this path. Speeding up boxes that are not on it will not help.',
  a_findings: 'Automatic checks of your design:\n\nRed = must fix (overloaded, loops)\nAmber = risky (almost full, only one copy, no monitoring)\nBlue = suggestion\nGreen = all good\n\nClick an item to select the box it is about.',
  a_loadTable: 'Every box, from busiest to least busy:\nrequests per second arriving, and how full it is (utilisation = arriving ÷ capacity).\n\nClick a name to select that box.',
  f_error: 'Must fix: this will break or give wrong results at the current traffic.',
  f_warn: 'Risky: works today, but may fail under more traffic or when something goes down.',
  f_info: 'Suggestion: something worth checking or improving.',
  f_ok: 'All good at the current traffic.',
  port: 'Drag from this circle onto another box to connect them.\nThe arrow means "sends requests or data to".',
};
const tip = (key) => ` data-tip="${esc(TIPS[key] ?? key)}"`;
const qi = '<i class="tip-i" aria-hidden="true">?</i>';

function nodeTip(n) {
  const t = TYPES[n.type], L = analysis.load.get(n.id) || 0, u = analysis.util.get(n.id);
  const lines = [`${n.name}  (${t.label})`, t.desc, ''];
  if (n.type === 'client') lines.push(`Sends ${fmt(L)} requests per second into the system.`);
  else {
    lines.push(`Requests arriving: ${fmt(L)} per second`);
    lines.push(`Can handle: ${fmt(n.capacity * n.replicas)} per second (${fmt(n.capacity)} × ${n.replicas} cop${n.replicas === 1 ? 'y' : 'ies'})`);
    if (u !== undefined && n.type !== 'monitoring') lines.push(`How busy: ${fmtPct(u)} — ${u > 1 ? 'OVERLOADED, requests will wait or fail' : u >= 0.75 ? 'almost full' : 'fine'}`);
    lines.push(`Time per request: ${fmtMs(n.latency)}`);
    if (n.type === 'cache') lines.push(`Answers ${Math.round(n.hitRate * 100)}% of requests itself and passes on the rest`);
    lines.push(`Cost: ${fmtMoney(n.cost * n.replicas)} per month`);
  }
  if (analysis.cycle.has(n.id)) lines.push('', 'Part of a loop, so its numbers cannot be worked out.');
  lines.push('', 'Click to edit · drag to move · drag the circle on the right to connect');
  return lines.join('\n');
}
function edgeTip(e) {
  const a = getNode(e.from), b = getNode(e.to), L = analysis.edgeLoad.get(e.id) || 0;
  const lines = [`${a.name} → ${b.name}${e.label ? `  (${e.label})` : ''}`, `${EDGE_KINDS[e.kind].label}: ${EDGE_KINDS[e.kind].help}`, ''];
  lines.push(e.kind === 'telemetry' ? `Sends about ${fmt(L)} events per second to monitoring` : `Carries ${fmt(L)} requests per second`);
  if (e.calls !== 1 && e.kind !== 'telemetry') lines.push(`Called ${e.calls}× per request`);
  if (analysis.pathEdges.has(e.id)) lines.push('Purple = on the slowest path, which decides how long users wait');
  if (e.kind !== 'telemetry' && (analysis.util.get(b.id) || 0) > 1) lines.push(`Red = “${b.name}” gets more than it can handle`);
  lines.push('', 'Click to edit this connection');
  return lines.join('\n');
}

const tipEl = Object.assign(document.createElement('div'), { className: 'tooltip' });
tipEl.setAttribute('role', 'tooltip');
document.body.appendChild(tipEl);
let tipTarget = null, tipTimer = 0, mouse = { x: 0, y: 0 };
function hideTip() { clearTimeout(tipTimer); tipEl.classList.remove('show'); }
function placeTip() {
  const r = tipEl.getBoundingClientRect(), gap = 16;
  let x = mouse.x + gap, y = mouse.y + gap;
  if (x + r.width > innerWidth - 8) x = mouse.x - r.width - gap;
  if (y + r.height > innerHeight - 8) y = mouse.y - r.height - gap;
  tipEl.style.left = Math.max(8, x) + 'px';
  tipEl.style.top = Math.max(8, y) + 'px';
}
document.addEventListener('mousemove', (e) => {
  mouse = { x: e.clientX, y: e.clientY };
  const t = drag ? null : e.target.closest?.('[data-tip]') || null;
  if (t !== tipTarget) {
    tipTarget = t;
    hideTip();
    if (t) tipTimer = setTimeout(() => {
      if (tipTarget !== t || !t.isConnected) return;
      tipEl.textContent = t.dataset.tip;
      tipEl.classList.add('show');
      placeTip();
    }, 350);
  } else if (tipEl.classList.contains('show')) placeTip();
});
for (const ev of ['pointerdown', 'wheel', 'keydown', 'scroll']) document.addEventListener(ev, () => { tipTarget = null; hideTip(); }, { capture: true, passive: true });
document.documentElement.addEventListener('mouseleave', () => { tipTarget = null; hideTip(); });

/* =====================================================================
 * Side panels
 * ===================================================================== */
const inspector = $('#inspector'), analysisEl = $('#analysis');
const chip = (n, text) => `<button class="chip" data-select-node="${n.id}" data-tip="${esc(text || `${n.name} (${TYPES[n.type].label})\nClick to select it.`)}"><span class="dot" style="background:${TYPES[n.type].color}"></span>${esc(trunc(n.name, 24))}</button>`;

function renderInspector() {
  if (selection?.kind === 'node' && getNode(selection.id)) return renderNodeInspector(getNode(selection.id));
  if (selection?.kind === 'edge' && getEdge(selection.id)) return renderEdgeInspector(getEdge(selection.id));
  inspector.innerHTML = `
    <h3>Inspector</h3>
    <ul class="tips">
      <li>Click a component or arrow to edit it here.</li>
      <li>Drag from a component's <b>right-side handle</b> to connect it.</li>
      <li>Set expected <b>Traffic</b> in the toolbar to find bottlenecks.</li>
      <li>Selecting a component highlights its <b>dependencies</b>.</li>
    </ul>`;
}

function renderNodeInspector(n) {
  const t = TYPES[n.type];
  const callees = state.edges.filter((e) => e.from === n.id).map((e) => getNode(e.to));
  const callers = state.edges.filter((e) => e.to === n.id).map((e) => getNode(e.from));
  const blast = analysis.ancestors(n.id).size;
  const deps = analysis.downstream(n.id).size;
  inspector.innerHTML = `
    <div class="insp-head">
      <div class="insp-icon" style="background:${t.color}">${t.short}</div>
      <div><div class="insp-type">${esc(t.label)}</div><div class="insp-desc">${esc(t.desc)}</div></div>
    </div>
    <label class="field"${tip('name')}><span>Name${qi}</span><input data-f="name" value="${esc(n.name)}" /></label>
    ${n.type === 'client' ? `<p class="small muted"${tip('clientNote')}>Client nodes emit the toolbar's traffic (split evenly if there are several). ${qi}</p>` : `
    <div class="field-row">
      <label class="field"${tip('capacity')}><span>Capacity / replica <i>rps</i>${qi}</span><input type="number" min="0" step="any" data-f="capacity" value="${n.capacity}" /></label>
      <label class="field"${tip('latency')}><span>Latency <i>ms</i>${qi}</span><input type="number" min="0" step="any" data-f="latency" value="${n.latency}" /></label>
    </div>
    <div class="field-row">
      <label class="field"${tip('replicas')}><span>Replicas${qi}</span><input type="number" min="1" step="1" data-f="replicas" value="${n.replicas}" /></label>
      <label class="field"${tip('cost')}><span>Cost / replica <i>$/mo</i>${qi}</span><input type="number" min="0" step="any" data-f="cost" value="${n.cost}" /></label>
    </div>`}
    ${n.type === 'cache' ? `
    <label class="field"${tip('hitRate')}><span>Cache hit rate <i id="hit-out">${Math.round(n.hitRate * 100)}%</i>${qi}</span>
      <input type="range" min="0" max="95" step="1" data-f="hitRate" value="${Math.round(n.hitRate * 100)}" />
      <span class="help">Only misses (${100 - Math.round(n.hitRate * 100)}%) continue downstream.</span></label>` : ''}
    <label class="field"${tip('notes')}><span>Notes${qi}</span><textarea data-f="notes" rows="2" placeholder="e.g. Llama 3 70B on vLLM, 4k context">${esc(n.notes)}</textarea></label>
    <div id="insp-metrics"></div>
    <h4${tip('callsTo')}>Calls / sends to (${callees.length})${qi}</h4>
    <div class="chips">${callees.map((c) => chip(c, `${n.name} sends requests or data to ${c.name}.\nClick to select it.`)).join('') || '<span class="small muted">Nothing — this is a leaf.</span>'}</div>
    <h4${tip('calledBy')}>Called by (${callers.length})${qi}</h4>
    <div class="chips">${callers.map((c) => chip(c, `${c.name} sends requests or data to ${n.name}.\nClick to select it.`)).join('') || '<span class="small muted">Nothing — this is an entry point.</span>'}</div>
    <p class="small muted" style="margin:10px 0 0"${tip('blast')}>Depends on <b>${deps}</b> component${deps === 1 ? '' : 's'} downstream.
      Blast radius: if it fails, <b>${blast}</b> upstream component${blast === 1 ? '' : 's'} ${blast === 1 ? 'is' : 'are'} affected. ${qi}</p>
    <div class="btn-row"><button data-act="dup"${tip('dup')}>Duplicate</button><button data-act="del" class="danger"${tip('del')}>Delete</button></div>`;
  renderInspectorMetrics();
}

function renderInspectorMetrics() {
  const box = $('#insp-metrics');
  if (!box || selection?.kind !== 'node') return;
  const n = getNode(selection.id);
  if (!n) return;
  const L = analysis.load.get(n.id) || 0, u = analysis.util.get(n.id);
  if (n.type === 'client') { box.innerHTML = `<div class="metric-box"><div class="metric-line"${tip('m_emitted')}><span>Traffic emitted${qi}</span><b>${fmt(L)} rps</b></div></div>`; return; }
  const cap = n.capacity * n.replicas;
  const ex = (s) => ` data-tip="${esc(s)}"`;
  box.innerHTML = `<div class="metric-box">
    <div class="metric-line"${ex(`${TIPS.m_load}\n\nHere: ${fmt(L)} requests per second arrive.`)}><span>Incoming load${qi}</span><b>${fmt(L)} rps</b></div>
    <div class="metric-line"${ex(`${TIPS.m_capacity}\n\nHere: ${fmt(n.capacity)} × ${n.replicas} = ${fmt(cap)} rps.`)}><span>Total capacity${qi}</span><b>${fmt(cap)} rps</b></div>
    ${u !== undefined ? `<div class="bar"><span style="width:${Math.min(100, u * 100)}%;background:${utilColor(u)}"></span></div>
    <div class="metric-line"${ex(`${TIPS.m_util}\n\nHere: ${fmt(L)} ÷ ${fmt(cap)} = ${fmtPct(u)}.`)}><span>Utilisation${qi}</span><b style="color:${utilColor(u)}">${fmtPct(u)}</b></div>` : ''}
    <div class="metric-line"${ex(`${TIPS.m_cost}\n\nHere: ${fmtMoney(n.cost)} × ${n.replicas} = ${fmtMoney(n.cost * n.replicas)}.`)}><span>Monthly cost${qi}</span><b>${fmtMoney(n.cost * n.replicas)}</b></div>
  </div>`;
}

function renderEdgeInspector(e) {
  const a = getNode(e.from), b = getNode(e.to);
  inspector.innerHTML = `
    <h3>Connection</h3>
    <div class="chips" style="margin-bottom:12px">${chip(a)}<span class="chip-arrow">→</span>${chip(b)}</div>
    <label class="field"${tip('e_label')}><span>Label <i>what flows here</i>${qi}</span><input data-ef="label" value="${esc(e.label)}" placeholder="e.g. top-5 context" /></label>
    <label class="field"${tip('e_kind')}><span>Type${qi}</span>
      <select data-ef="kind">${Object.entries(EDGE_KINDS).map(([k, v]) => `<option value="${k}" ${k === e.kind ? 'selected' : ''}>${v.label}</option>`).join('')}</select>
      <span class="help">${EDGE_KINDS[e.kind].help}</span></label>
    ${e.kind !== 'telemetry' ? `<label class="field"${tip('e_calls')}><span>Calls per request <i>multiplier</i>${qi}</span><input type="number" min="0" step="any" data-ef="calls" value="${e.calls}" />
      <span class="help">e.g. 3 if an agent calls the LLM three times, 0.2 if only 20% of requests use this path.</span></label>` : ''}
    <div id="insp-metrics-edge"></div>
    <div class="btn-row"><button data-act="reverse"${tip('reverse')}>Reverse direction</button><button data-act="del" class="danger"${tip('del')}>Delete</button></div>`;
  renderEdgeMetrics();
}
function renderEdgeMetrics() {
  const box = $('#insp-metrics-edge');
  if (!box || selection?.kind !== 'edge') return;
  const e = getEdge(selection.id);
  if (!e) return;
  box.innerHTML = `<div class="metric-box"><div class="metric-line"${tip('e_load')}><span>${e.kind === 'telemetry' ? 'Events carried' : 'Traffic carried'}${qi}</span><b>${fmt(analysis.edgeLoad.get(e.id) || 0)} ${e.kind === 'telemetry' ? 'ev/s' : 'rps'}</b></div>
    ${analysis.pathEdges.has(e.id) ? `<div class="metric-line"${tip('e_crit')}><span>On critical path${qi}</span><b style="color:#7c3aed">yes</b></div>` : ''}</div>`;
}

function renderAnalysis() {
  const A = analysis;
  if (!state.nodes.length) {
    analysisEl.innerHTML = '<h3>Analysis</h3><p class="small muted">Add components to see data flow, latency, cost and bottleneck analysis.</p>';
    return;
  }
  const b = A.bottleneck ? getNode(A.bottleneck) : null;
  const rows = state.nodes.filter((n) => A.util.has(n.id) && n.type !== 'monitoring').sort((x, y) => A.util.get(y.id) - A.util.get(x.id));
  analysisEl.innerHTML = `
    <h3>Analysis</h3>
    <div class="cards4">
      <div class="stat"${tip('a_traffic')}><div class="stat-label">Traffic in${qi}</div><div class="stat-value">${fmt(state.settings.rps)} rps</div><div class="stat-sub">${A.sources.length} entry point${A.sources.length === 1 ? '' : 's'}</div></div>
      <div class="stat"${tip('a_latency')}><div class="stat-label">End-to-end latency${qi}</div><div class="stat-value">${fmtMs(A.e2e)}</div><div class="stat-sub">${A.avgLatency !== null ? `avg with cache hits ${fmtMs(A.avgLatency)}` : 'slowest sync path'}</div></div>
      <div class="stat ${A.maxUtil > 1 ? 'bad' : ''}"${tip(TIPS.a_max + (b ? `\n\nHere: ${fmt(state.settings.rps)} rps ÷ ${fmtPct(A.maxUtil)} (${b.name}) ≈ ${fmt(A.sustainable)} rps.` : ''))}><div class="stat-label">Max sustainable${qi}</div><div class="stat-value">${fmt(A.sustainable)} rps</div><div class="stat-sub">${b ? `limited by ${esc(trunc(b.name, 18))}` : 'no limit found'}</div></div>
      <div class="stat"${tip('a_cost')}><div class="stat-label">Infra cost${qi}</div><div class="stat-value">${fmtMoney(A.totalCost)}</div><div class="stat-sub">per month (estimate)</div></div>
    </div>
    ${b ? `<h4${tip('a_bottleneck')}>Primary bottleneck${qi}</h4><div class="chips">${chip(b, `${b.name} is the busiest part: ${fmt(A.load.get(b.id))} rps arriving ÷ ${fmt(b.capacity * b.replicas)} rps capacity = ${fmtPct(A.maxUtil)}.\nClick to select it and change its replicas.`)}<span class="small" style="align-self:center;color:${utilColor(A.maxUtil)};font-weight:700">${fmtPct(A.maxUtil)} utilised</span></div>` : ''}
    ${A.path.length > 1 ? `<h4${tip('a_critical')}>Critical path · ${fmtMs(A.e2e)}${qi}</h4>
      <div class="chips">${A.path.map((id) => { const n = getNode(id); return chip(n, `${n.name} adds ${fmtMs(n.latency)} to the wait.\nClick to select it.`); }).join('<span class="chip-arrow">→</span>')}</div>` : ''}
    <h4${tip('a_findings')}>Findings${qi}</h4>
    <ul class="findings">${A.findings.map((f, i) => `<li class="finding ${f.level}${f.ids.length ? ' clickable' : ''}" data-finding="${i}"${tip(TIPS['f_' + f.level] + (f.ids.length ? '\nClick to select the box this is about.' : ''))}>
      <span class="ico">${{ error: '!', warn: '!', info: 'i', ok: '✓' }[f.level]}</span><span>${esc(f.text)}</span></li>`).join('')}</ul>
    ${rows.length ? `<h4${tip('a_loadTable')}>Load per component${qi}</h4><table class="load-table">${rows.map((n) => {
      const u = A.util.get(n.id);
      return `<tr${tip(`${n.name}\n${fmt(A.load.get(n.id))} rps arriving ÷ ${fmt(n.capacity * n.replicas)} rps capacity (${fmt(n.capacity)} × ${n.replicas}) = ${fmtPct(u)} busy.\nClick the name to select it.`)}><td class="name" data-select-node="${n.id}">${esc(n.name)}</td><td class="num">${fmt(A.load.get(n.id))} rps</td>
        <td class="barcell"><div class="bar"><span style="width:${Math.min(100, u * 100)}%;background:${utilColor(u)}"></span></div></td>
        <td class="num" style="color:${utilColor(u)};font-weight:700">${fmtPct(u)}</td></tr>`;
    }).join('')}</table>` : ''}`;
}

function render({ inspector: withInspector = true } = {}) {
  analysis = analyze();
  renderCanvas();
  renderAnalysis();
  if (withInspector) renderInspector();
  else { renderInspectorMetrics(); renderEdgeMetrics(); }
  $('#rps-input').value = state.settings.rps;
  $('#btn-undo').disabled = !hist.undo.length;
  $('#btn-redo').disabled = !hist.redo.length;
}

function select(sel) { selection = sel; render(); }

/* =====================================================================
 * Mutations
 * ===================================================================== */
let cascade = 0;
function addNode(type, x, y) {
  const n = makeNode(type, x, y, { name: uniqueName(TYPES[type].label) });
  n.x = Math.round(n.x / SNAP) * SNAP; n.y = Math.round(n.y / SNAP) * SNAP;
  mutate(() => state.nodes.push(n));
  select({ kind: 'node', id: n.id });
}
function connect(fromId, toId) {
  if (fromId === toId) return;
  if (state.edges.some((e) => e.from === fromId && e.to === toId)) return toast('These components are already connected');
  const a = getNode(fromId), b = getNode(toId);
  const kind = b.type === 'monitoring' ? 'telemetry' : a.type === 'queue' || b.type === 'queue' ? 'async' : 'sync';
  const e = { id: uid('e'), from: fromId, to: toId, label: b.type === 'monitoring' ? 'metrics' : LABEL_HINTS[`${a.type}>${b.type}`] || '', kind, calls: 1 };
  mutate(() => state.edges.push(e));
  select({ kind: 'edge', id: e.id });
}
function deleteSelection() {
  if (!selection) return;
  const { kind, id } = selection;
  mutate(() => {
    if (kind === 'node') {
      state.nodes = state.nodes.filter((n) => n.id !== id);
      state.edges = state.edges.filter((e) => e.from !== id && e.to !== id);
    } else state.edges = state.edges.filter((e) => e.id !== id);
  });
  select(null);
}
function duplicateSelection() {
  if (selection?.kind !== 'node') return;
  const src = getNode(selection.id);
  const n = { ...src, id: uid('n'), name: uniqueName(src.name), x: src.x + 30, y: src.y + 30 };
  mutate(() => state.nodes.push(n));
  select({ kind: 'node', id: n.id });
}

function autoLayout() {
  const flow = state.edges.filter((e) => e.kind !== 'telemetry');
  const depth = new Map(state.nodes.map((n) => [n.id, 0]));
  // Longest-path layering; bounded relaxation so cycles terminate.
  for (let i = 0; i < state.nodes.length; i++) {
    let changed = false;
    for (const e of flow) {
      const d = depth.get(e.from) + 1;
      if (d > depth.get(e.to) && d < state.nodes.length) { depth.set(e.to, d); changed = true; }
    }
    if (!changed) break;
  }
  const main = state.nodes.filter((n) => n.type !== 'monitoring');
  const mons = state.nodes.filter((n) => n.type === 'monitoring');
  const layers = [];
  for (const n of main) (layers[depth.get(n.id)] ||= []).push(n);
  const layerList = layers.filter(Boolean);
  // Order within a layer by the average position of predecessors to reduce crossings.
  // Long pipelines wrap into rows that snake back and forth so the diagram stays readable.
  const COL_W = 320, ROW_GAP = 70, NODE_GAP = 110;
  const rowsN = layerList.length > 6 ? Math.ceil(layerList.length / 5) : 1;
  const cols = Math.max(1, Math.ceil(layerList.length / rowsN));
  const rowH = [];
  layerList.forEach((layer, li) => { const r = Math.floor(li / cols); rowH[r] = Math.max(rowH[r] || 0, layer.length * NODE_GAP); });
  const rowTop = [];
  rowH.forEach((h, r) => { rowTop[r] = r ? rowTop[r - 1] + rowH[r - 1] + ROW_GAP : 0; });
  const pos = new Map();
  let maxY = 0;
  layerList.forEach((layer, li) => {
    layer.sort((a, b) => {
      const avg = (n) => {
        const ps = flow.filter((e) => e.to === n.id && pos.has(e.from)).map((e) => pos.get(e.from));
        return ps.length ? ps.reduce((s, v) => s + v, 0) / ps.length : n.y;
      };
      return avg(a) - avg(b);
    });
    const r = Math.floor(li / cols);
    const c = r % 2 ? cols - 1 - (li % cols) : li % cols;
    layer.forEach((n, i) => {
      n.x = 40 + c * COL_W;
      n.y = Math.round(rowTop[r] + rowH[r] / 2 + (i - (layer.length - 1) / 2) * NODE_GAP - H / 2);
      pos.set(n.id, n.y);
      maxY = Math.max(maxY, n.y);
    });
  });
  const width = cols * COL_W;
  mons.forEach((n, i) => {
    n.x = Math.round(40 + width / 2 - W / 2 + (i - (mons.length - 1) / 2) * 250);
    n.y = maxY + 150;
  });
}

function fitView() {
  const r = svg.getBoundingClientRect();
  if (!state.nodes.length || !r.width) { view = { x: 40, y: 40, k: 1 }; setViewTransform(); return; }
  const xs = state.nodes.map((n) => n.x), ys = state.nodes.map((n) => n.y);
  const minX = Math.min(...xs), minY = Math.min(...ys), maxX = Math.max(...xs) + W, maxY = Math.max(...ys) + H;
  const pad = 50;
  const k = clamp(Math.min((r.width - pad * 2) / (maxX - minX), (r.height - pad * 2) / (maxY - minY)), 0.25, 1.25);
  view = { k, x: r.width / 2 - ((minX + maxX) / 2) * k, y: r.height / 2 - ((minY + maxY) / 2) * k };
  setViewTransform();
  save();
}
function zoomBy(f, cx, cy) {
  const r = svg.getBoundingClientRect();
  const mx = cx ?? r.width / 2, my = cy ?? r.height / 2;
  const k2 = clamp(view.k * f, 0.25, 2.5);
  view.x = mx - ((mx - view.x) * k2) / view.k;
  view.y = my - ((my - view.y) * k2) / view.k;
  view.k = k2;
  setViewTransform();
  save();
}

function applyTemplate(key) {
  const T = TEMPLATES[key];
  const keys = {};
  const nodes = T.nodes.map(([k, type, name, over]) => { const n = makeNode(type, 0, 0, { name, ...(over || {}) }); keys[k] = n.id; return n; });
  const edges = T.edges.map(([a, b, label, kind = 'sync', calls = 1]) => ({ id: uid('e'), from: keys[a], to: keys[b], label, kind, calls }));
  state = { nodes, edges, settings: { rps: T.rps } };
  selection = null;
  autoLayout();
}

/* =====================================================================
 * Export
 * ===================================================================== */
function tint(hex, amt) {
  const v = parseInt(hex.slice(1), 16);
  const ch = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((c) => Math.round(c + (255 - c) * amt));
  return '#' + ch.map((c) => c.toString(16).padStart(2, '0')).join('');
}
const MERMAID_SHAPES = {
  client: ['(["', '"])'], api: ['{{"', '"}}'], lb: ['{{"', '"}}'], cache: ['[("', '")]'], queue: ['[/"', '"/]'],
  orchestrator: ['[["', '"]]'], llm: ['[["', '"]]'], guardrails: ['[/"', '"\\]'], vectordb: ['[("', '")]'],
  database: ['[("', '")]'], storage: ['[("', '")]'], reranker: ['("', '")'], monitoring: ['>"', '"]'],
};
function toMermaid({ dir = 'LR', annotate = true } = {}) {
  const A = analysis;
  const q = (s) => String(s).replace(/"/g, '#quot;').replace(/</g, '#lt;').replace(/>/g, '#gt;').replace(/\r?\n/g, ' ');
  const L = ['%% Generated by AI System Architecture Designer'];
  if (annotate) {
    L.push(`%% Traffic: ${fmt(state.settings.rps)} rps | End-to-end latency: ${fmtMs(A.e2e)} | Max sustainable: ${fmt(A.sustainable)} rps | Cost: ${fmtMoney(A.totalCost)}/mo`);
    if (A.bottleneck) L.push(`%% Primary bottleneck: ${getNode(A.bottleneck).name} (${fmtPct(A.maxUtil)})`);
  }
  L.push(`flowchart ${dir}`);
  for (const n of state.nodes) {
    const t = TYPES[n.type];
    const [o, c] = MERMAID_SHAPES[n.type] || ['["', '"]'];
    let sub = t.label + (n.replicas > 1 ? ` ×${n.replicas}` : '');
    const u = A.util.get(n.id);
    if (annotate && u !== undefined && n.type !== 'monitoring') sub += ` · ${fmtPct(u)}`;
    if (annotate && n.type === 'client') sub += ` · ${fmt(A.load.get(n.id))} rps`;
    L.push(`    ${n.id}${o}${q(n.name)}<br/>${q(sub)}${c}`);
  }
  const linkStyles = [];
  state.edges.forEach((e, i) => {
    const arrow = e.kind === 'sync' ? '-->' : '-.->';
    const parts = [e.label, e.calls !== 1 ? `×${e.calls}` : '', annotate && e.kind !== 'telemetry' ? `${fmt(A.edgeLoad.get(e.id) || 0)} rps` : ''].filter(Boolean);
    L.push(`    ${e.from} ${arrow}${parts.length ? `|"${q(parts.join(' · '))}"|` : ''} ${e.to}`);
    if (e.kind === 'telemetry') linkStyles.push(`    linkStyle ${i} stroke:#f472b6,stroke-dasharray:3 3`);
    else if (annotate && (A.util.get(e.to) || 0) > 1) linkStyles.push(`    linkStyle ${i} stroke:#dc2626,stroke-width:2.5px`);
    else if (annotate && A.pathEdges.has(e.id)) linkStyles.push(`    linkStyle ${i} stroke:#7c3aed,stroke-width:2.5px`);
  });
  const used = [...new Set(state.nodes.map((n) => n.type))];
  for (const t of used) L.push(`    classDef ${t} fill:${tint(TYPES[t].color, 0.85)},stroke:${TYPES[t].color},color:#0f172a`);
  for (const t of used) L.push(`    class ${state.nodes.filter((n) => n.type === t).map((n) => n.id).join(',')} ${t}`);
  if (annotate) {
    const over = state.nodes.filter((n) => n.type !== 'monitoring' && (A.util.get(n.id) || 0) > 1).map((n) => n.id);
    const warn = state.nodes.filter((n) => { const u = A.util.get(n.id) || 0; return n.type !== 'monitoring' && u >= 0.75 && u <= 1; }).map((n) => n.id);
    if (over.length) L.push('    classDef overloaded fill:#fee2e2,stroke:#dc2626,stroke-width:3px,color:#7f1d1d', `    class ${over.join(',')} overloaded`);
    if (warn.length) L.push('    classDef nearcap fill:#fef3c7,stroke:#d97706,stroke-width:2px,color:#78350f', `    class ${warn.join(',')} nearcap`);
  }
  return [...L, ...linkStyles].join('\n');
}

function download(name, content, mime) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = Object.assign(document.createElement('textarea'), { value: text });
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
  }
  toast('Copied to clipboard');
}

function openMermaidModal() {
  if (!state.nodes.length) return toast('Add some components first');
  openModal('Export as Mermaid', `
    <div class="modal-opts">
      <label>Direction <select id="mm-dir"><option value="LR">Left → right</option><option value="TB">Top → bottom</option></select></label>
      <label class="toggle"><input type="checkbox" id="mm-annot" checked /> Include traffic &amp; bottleneck annotations</label>
    </div>
    <textarea class="code-area" id="mm-code" readonly spellcheck="false"></textarea>
    <div class="modal-actions">
      <button class="primary" id="mm-copy">Copy code</button>
      <button id="mm-dl">Download .mmd</button>
      <button id="mm-md">Download .md</button>
      <span class="muted">Paste into GitHub/GitLab markdown, Notion, Confluence or mermaid.live.</span>
    </div>`);
  const gen = () => { $('#mm-code').value = toMermaid({ dir: $('#mm-dir').value, annotate: $('#mm-annot').checked }); };
  gen();
  $('#mm-dir').onchange = gen;
  $('#mm-annot').onchange = gen;
  $('#mm-copy').onclick = () => copyText($('#mm-code').value);
  $('#mm-dl').onclick = () => download('architecture.mmd', $('#mm-code').value, 'text/plain');
  $('#mm-md').onclick = () => download('architecture.md', '# AI System Architecture\n\n```mermaid\n' + $('#mm-code').value + '\n```\n', 'text/markdown');
}

function exportSVG() {
  if (!state.nodes.length) return toast('Add some components first');
  const prev = { selection, flow: ui.flow };
  selection = null; ui.flow = false;
  renderCanvas();
  const bb = vp.getBBox();
  const clone = svg.cloneNode(true);
  selection = prev.selection; ui.flow = prev.flow;
  renderCanvas();

  clone.querySelectorAll('.port, .edge-hit, #ghost, .bg-grid, title').forEach((el) => el.remove());
  clone.querySelectorAll('[data-tip]').forEach((el) => el.removeAttribute('data-tip'));
  const cv = clone.querySelector('#viewport');
  cv.removeAttribute('transform');
  const pad = 40, head = 56;
  const x = bb.x - pad, y = bb.y - pad - head, w = Math.max(bb.width + pad * 2, 420), h = bb.height + pad * 2 + head;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
  clone.setAttribute('width', Math.round(w));
  clone.setAttribute('height', Math.round(h));
  clone.removeAttribute('id');
  clone.removeAttribute('class');
  const A = analysis;
  const b = A.bottleneck ? getNode(A.bottleneck) : null;
  const meta = `Traffic ${fmt(state.settings.rps)} rps · End-to-end ${fmtMs(A.e2e)} · Max sustainable ${fmt(A.sustainable)} rps${b ? ` (limited by ${b.name})` : ''} · ${fmtMoney(A.totalCost)}/mo`;
  const bg = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#ffffff"/>
    <text class="export-title" x="${x + pad}" y="${y + pad}">AI System Architecture</text>
    <text class="export-sub" x="${x + pad}" y="${y + pad + 20}">${esc(meta)}</text>`;
  cv.insertAdjacentHTML('beforebegin', bg);
  const out = '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone);
  download('architecture.svg', out, 'image/svg+xml');
  toast('SVG downloaded');
}

/* =====================================================================
 * Modal & toast
 * ===================================================================== */
const modal = $('#modal');
function openModal(title, html) { $('#modal-title').textContent = title; $('#modal-body').innerHTML = html; modal.hidden = false; }
function closeModal() { modal.hidden = true; $('#modal-body').innerHTML = ''; }
$('#modal-close').onclick = closeModal;
modal.addEventListener('pointerdown', (e) => { if (e.target === modal) closeModal(); });
let toastTimer = 0;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

/* =====================================================================
 * Palette
 * ===================================================================== */
function buildPalette(filter = '') {
  const f = filter.trim().toLowerCase();
  let html = '';
  for (const g of GROUPS) {
    const items = Object.entries(TYPES).filter(([k, t]) => t.group === g && (!f || (t.label + ' ' + t.desc + ' ' + k).toLowerCase().includes(f)));
    if (!items.length) continue;
    html += `<div class="pal-group">${g}</div>`;
    html += items.map(([k, t]) => `<button class="pal-item" draggable="true" data-type="${k}" data-tip="${esc(`${t.label}
${t.desc}

Drag onto the canvas, or click to add it.`)}">
      <span class="pal-icon" style="background:${t.color}">${t.short}</span><span class="pal-name">${esc(t.label)}</span></button>`).join('');
  }
  $('#palette-list').innerHTML = html || '<p class="small muted">No matching components.</p>';
}
$('#palette-search').addEventListener('input', (e) => buildPalette(e.target.value));
$('#palette-list').addEventListener('click', (e) => {
  const it = e.target.closest('.pal-item');
  if (!it) return;
  const r = svg.getBoundingClientRect();
  const off = (cascade++ % 6) * 24;
  addNode(it.dataset.type, (r.width / 2 - view.x) / view.k - W / 2 + off, (r.height / 2 - view.y) / view.k - H / 2 + off);
});
$('#palette-list').addEventListener('dragstart', (e) => {
  const it = e.target.closest('.pal-item');
  if (!it) return;
  e.dataTransfer.setData('application/x-aiad-type', it.dataset.type);
  e.dataTransfer.effectAllowed = 'copy';
});
const wrap = $('#canvas-wrap');
wrap.addEventListener('dragover', (e) => {
  if (!e.dataTransfer.types.includes('application/x-aiad-type')) return;
  e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; wrap.classList.add('drop-target');
});
wrap.addEventListener('dragleave', (e) => { if (!wrap.contains(e.relatedTarget)) wrap.classList.remove('drop-target'); });
wrap.addEventListener('drop', (e) => {
  wrap.classList.remove('drop-target');
  const type = e.dataTransfer.getData('application/x-aiad-type');
  if (!TYPES[type]) return;
  e.preventDefault();
  const p = toWorld(e);
  addNode(type, p.x - W / 2, p.y - H / 2);
});

/* =====================================================================
 * Canvas interaction
 * ===================================================================== */
function toWorld(e) {
  const r = svg.getBoundingClientRect();
  return { x: (e.clientX - r.left - view.x) / view.k, y: (e.clientY - r.top - view.y) / view.k };
}
let drag = null;
let hoverTarget = null;

svg.addEventListener('pointerdown', (e) => {
  if (e.button === 2) return;
  const p = toWorld(e);
  const nodeEl = e.target.closest('[data-node]');
  const edgeEl = e.target.closest('[data-edge]');
  if (e.button === 1 || (!nodeEl && !edgeEl)) {
    drag = { mode: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false };
    svg.classList.add('panning');
    return;
  }
  e.preventDefault();
  if (nodeEl && e.target.closest('.port')) {
    drag = { mode: 'connect', from: nodeEl.dataset.node };
    updateGhost(p);
    return;
  }
  if (nodeEl) {
    const id = nodeEl.dataset.node;
    if (e.shiftKey && selection?.kind === 'node' && selection.id !== id) return connect(selection.id, id);
    const n = getNode(id);
    drag = { mode: 'node', id, ox: p.x - n.x, oy: p.y - n.y, snap: snapshot(), moved: false, sx: e.clientX, sy: e.clientY };
    if (!(selection?.kind === 'node' && selection.id === id)) select({ kind: 'node', id });
    return;
  }
  select({ kind: 'edge', id: edgeEl.dataset.edge });
});

window.addEventListener('pointermove', (e) => {
  if (!drag) return;
  if (drag.mode === 'pan') {
    const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    if (Math.hypot(dx, dy) > 3) drag.moved = true;
    view.x = drag.vx + dx; view.y = drag.vy + dy;
    setViewTransform();
  } else if (drag.mode === 'node') {
    if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 3) return;
    drag.moved = true;
    const p = toWorld(e), n = getNode(drag.id);
    n.x = Math.round((p.x - drag.ox) / SNAP) * SNAP;
    n.y = Math.round((p.y - drag.oy) / SNAP) * SNAP;
    renderCanvas();
  } else if (drag.mode === 'connect') {
    updateGhost(toWorld(e));
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('[data-node]');
    const id = el && el.dataset.node !== drag.from ? el.dataset.node : null;
    if (id !== hoverTarget) {
      gNodes.querySelector('.node.target')?.classList.remove('target');
      hoverTarget = id;
      if (id) gNodes.querySelector(`[data-node="${id}"]`)?.classList.add('target');
    }
  }
});

window.addEventListener('pointerup', () => {
  if (!drag) return;
  const d = drag;
  drag = null;
  svg.classList.remove('panning');
  if (d.mode === 'pan') { if (!d.moved && selection) select(null); save(); }
  else if (d.mode === 'node') { if (d.moved) { pushHistory(d.snap); save(); render({ inspector: false }); } }
  else if (d.mode === 'connect') {
    ghost.setAttribute('d', '');
    const target = hoverTarget;
    hoverTarget = null;
    gNodes.querySelector('.node.target')?.classList.remove('target');
    if (target) connect(d.from, target);
  }
});

function updateGhost(p) {
  const n = getNode(drag.from);
  const sx = n.x + W, sy = n.y + H / 2, c = Math.max(40, Math.abs(p.x - sx) / 2);
  ghost.setAttribute('d', `M${sx},${sy} C${sx + c},${sy} ${p.x - c},${p.y} ${p.x},${p.y}`);
}

svg.addEventListener('wheel', (e) => {
  e.preventDefault();
  const r = svg.getBoundingClientRect();
  zoomBy(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
}, { passive: false });

window.addEventListener('keydown', (e) => {
  if (!modal.hidden) { if (e.key === 'Escape') closeModal(); return; }
  if (e.target.closest('input, textarea, select')) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
  else if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSelection(); }
  else if (e.key === 'Delete' || e.key === 'Backspace') { if (selection) { e.preventDefault(); deleteSelection(); } }
  else if (e.key === 'Escape') { if (drag?.mode === 'connect') { drag = null; ghost.setAttribute('d', ''); } select(null); }
  else if (!mod && e.key.toLowerCase() === 'f') fitView();
});

/* ---------- inspector & analysis events ---------- */
let editSnap = null;
inspector.addEventListener('focusin', (e) => { if (e.target.matches('[data-f],[data-ef]')) editSnap = snapshot(); });
inspector.addEventListener('change', () => {
  if (editSnap && editSnap !== snapshot()) pushHistory(editSnap);
  editSnap = snapshot();
  render({ inspector: false });
});
inspector.addEventListener('input', (e) => {
  const t = e.target;
  if (t.dataset.f && selection?.kind === 'node') {
    const n = getNode(selection.id), f = t.dataset.f;
    if (!n) return;
    if (f === 'name' || f === 'notes') n[f] = t.value;
    else if (f === 'hitRate') {
      n.hitRate = clamp(+t.value / 100, 0, 0.99);
      $('#hit-out').textContent = Math.round(n.hitRate * 100) + '%';
      t.parentElement.querySelector('.help').textContent = `Only misses (${100 - Math.round(n.hitRate * 100)}%) continue downstream.`;
    } else if (f === 'replicas') n.replicas = Math.max(1, Math.round(num(t.value, 1)));
    else n[f] = Math.max(0, num(t.value, 0));
  } else if (t.dataset.ef && selection?.kind === 'edge') {
    const ed = getEdge(selection.id), f = t.dataset.ef;
    if (!ed) return;
    if (f === 'calls') ed.calls = Math.max(0, num(t.value, 1));
    else ed[f] = t.value;
    if (f === 'kind') { pushHistory(editSnap || snapshot()); editSnap = snapshot(); save(); return render(); }
  } else return;
  save();
  render({ inspector: false });
});
inspector.addEventListener('click', (e) => {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'del') deleteSelection();
  else if (act === 'dup') duplicateSelection();
  else if (act === 'reverse') {
    const ed = getEdge(selection.id);
    if (state.edges.some((x) => x.from === ed.to && x.to === ed.from)) return toast('A connection in the other direction already exists');
    mutate(() => { [ed.from, ed.to] = [ed.to, ed.from]; });
  }
});
document.addEventListener('click', (e) => {
  const s = e.target.closest('[data-select-node]');
  if (s && getNode(s.dataset.selectNode)) return select({ kind: 'node', id: s.dataset.selectNode });
  const f = e.target.closest('[data-finding]');
  if (f) {
    const finding = analysis.findings[+f.dataset.finding];
    if (finding?.ids.length) select({ kind: 'node', id: finding.ids[0] });
  }
});

/* ---------- toolbar ---------- */
$('#template-select').addEventListener('change', (e) => {
  const key = e.target.value;
  e.target.value = '';
  if (!TEMPLATES[key]) return;
  if (state.nodes.length && !confirm('Replace the current diagram with this template? (You can undo.)')) return;
  mutate(() => applyTemplate(key));
  requestAnimationFrame(fitView);
});
$('#rps-input').addEventListener('change', (e) => {
  const v = Math.max(0, num(e.target.value, state.settings.rps));
  mutate(() => { state.settings.rps = v; });
});
$('#rps-input').addEventListener('input', (e) => {
  if (e.target.value === '') return;
  state.settings.rps = Math.max(0, num(e.target.value, state.settings.rps));
  render({ inspector: false });
});
for (const [id, key] of [['tg-flow', 'flow'], ['tg-critical', 'critical'], ['tg-focus', 'focus']]) {
  $('#' + id).addEventListener('change', (e) => { ui[key] = e.target.checked; save(); renderCanvas(); });
}
$('#btn-layout').onclick = () => { if (!state.nodes.length) return; mutate(autoLayout); requestAnimationFrame(fitView); };
$('#btn-undo').onclick = undo;
$('#btn-redo').onclick = redo;
$('#btn-mermaid').onclick = openMermaidModal;
$('#btn-svg').onclick = exportSVG;
$('#btn-save').onclick = () => download('architecture.json', JSON.stringify(docData(), null, 2), 'application/json');
$('#btn-open').onclick = () => $('#file-input').click();
$('#file-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    pushHistory();
    loadDoc(data);
    selection = null;
    save(); render();
    requestAnimationFrame(fitView);
    toast(`Opened ${file.name}`);
  } catch (err) {
    toast('Could not open file: ' + err.message);
  }
});
$('#btn-clear').onclick = () => {
  if (!state.nodes.length) return;
  if (!confirm('Remove all components and connections? (You can undo.)')) return;
  mutate(() => { state.nodes = []; state.edges = []; });
  selection = null;
  render();
};
$('#zoom-in').onclick = () => zoomBy(1.2);
$('#zoom-out').onclick = () => zoomBy(1 / 1.2);
$('#zoom-fit').onclick = fitView;
window.addEventListener('resize', () => setViewTransform());

/* =====================================================================
 * Boot
 * ===================================================================== */
(function init() {
  buildPalette();
  let restored = false;
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (saved) {
      loadDoc(saved);
      if (saved.view && Number.isFinite(saved.view.k)) view = { x: +saved.view.x, y: +saved.view.y, k: clamp(+saved.view.k, 0.25, 2.5) };
      if (saved.ui) ui = { ...ui, ...saved.ui };
      restored = true;
    }
  } catch { /* corrupted storage — start fresh */ }
  if (!restored) applyTemplate('rag');
  $('#tg-flow').checked = ui.flow;
  $('#tg-critical').checked = ui.critical;
  $('#tg-focus').checked = ui.focus;
  render();
  if (!restored) requestAnimationFrame(fitView);
})();
