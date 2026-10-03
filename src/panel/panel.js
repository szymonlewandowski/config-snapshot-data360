// Side panel controller. All Salesforce logic lives in core/ (plain JS, covered by test/);
// browser specifics come from a platform adapter (Chrome, or the fake one in the dev harness).
import { myDomainFromUrl, makeGet, connect, explainError } from '../core/salesforce.js';
import { collect, normalize, MODULES } from '../core/export.js';
import { inventory, estimate, totalCalls } from '../core/estimate.js';
import { bundleZip, bundleName } from '../core/bundle.js';

// @platform-start (scripts/build.js replaces this block with a static Chrome import)
const { platform } = globalThis.chrome?.cookies
  ? await import('../lib/platform-chrome.js')
  : await import('../../dev/platform-fake.js');
// @platform-end

const MODULE_INFO = {
  model: ['Data model', 'DMOs, fields, types, active relationships'],
  ingestion: ['Data streams', 'Streams, DLOs, source → DLO field mappings'],
  mappings: ['DLO → DMO mappings', 'Field mappings per DMO'],
  segments: ['Segments', 'Definitions with parsed filter criteria'],
  activations: ['Activations', 'Targets, attributes, contact points, filters'],
  calculatedInsights: ['Calculated insights', 'SQL, dimensions, measures'],
  identityResolution: ['Identity resolution', 'Match and reconciliation rules'],
  dataGraphs: ['Data graphs', 'Graph trees, joins, recency, refresh'],
};

const COUNT_LABELS = {
  dmos: 'DMOs', relationships: 'relationships', dataStreams: 'streams', dlos: 'DLOs', mappings: 'mappings',
  segments: 'segments', activations: 'activations', activationTargets: 'targets', calculatedInsights: 'insights',
  rulesets: 'rulesets', dataGraphs: 'graphs',
};

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...children) => {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...children.filter((c) => c !== null && c !== undefined));
  return n;
};
const store = {
  get(key, fallback) { try { const v = localStorage.getItem(`d360.${key}`); return v === null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(`d360.${key}`, JSON.stringify(value)); } catch { /* storage unavailable */ } },
};
const fmt = (n) => (n === null || n === undefined ? '?' : Number(n).toLocaleString('en-US'));

const state = {
  phase: 'init', // init | no-tab | no-session | connecting | error | ready | exporting | done
  instanceUrl: null,
  session: null,
  estimates: null,
  abort: null,
  lastZip: null,
  lastName: null,
  seq: 0, // latest detect() call; older calls must not change the state
};

// ---------- org / session ----------

function setOrg({ dot, title, sub = '', hint = '', hintErr = false, facts = null }) {
  $('org-dot').className = `dot ${dot}`;
  $('org-title').textContent = title;
  $('org-sub').textContent = sub;
  const h = $('org-hint');
  h.hidden = !hint;
  h.textContent = hint;
  h.className = `hint${hintErr ? ' err' : ''}`;
  const f = $('org-facts');
  f.hidden = !facts;
  f.replaceChildren(...(facts ? Object.entries(facts).flatMap(([k, v]) => [el('dt', { textContent: k }), el('dd', { textContent: v })]) : []));
}

async function detect({ force = false } = {}) {
  // keep the running export, and the result view until "New export", regardless of tab changes
  if (state.phase === 'exporting' || (state.phase === 'done' && !force)) return;
  const seq = ++state.seq;
  const stale = () => seq !== state.seq;
  const url = await platform.activeTabUrl();
  if (stale()) return;
  const instanceUrl = url ? myDomainFromUrl(url) : null;
  if (!force && instanceUrl && instanceUrl === state.instanceUrl && ['ready', 'connecting'].includes(state.phase)) return;
  state.instanceUrl = instanceUrl;
  state.session = null;
  if (!instanceUrl) {
    state.phase = 'no-tab';
    setOrg({ dot: '', title: 'No Salesforce org in this tab', hint: 'Open a Salesforce org (Lightning or Setup) in the active tab, then click ↻.' });
    return render();
  }
  const host = new URL(instanceUrl).host;
  const token = await platform.sessionId(instanceUrl);
  if (stale()) return;
  if (!token) {
    state.phase = 'no-session';
    setOrg({ dot: 'warn', title: host, hint: `No active session found for ${host}. Log in to the org in this browser and click ↻.` });
    return render();
  }
  state.phase = 'connecting';
  setOrg({ dot: 'busy', title: host, sub: 'Connecting…' });
  render();
  try {
    const get = makeGet({ instanceUrl, token, fetchImpl: platform.fetch });
    const session = await connect(get);
    if (stale()) return; // tab changed meanwhile
    state.session = session;
    state.phase = 'ready';
    showConnected();
    fillDataSpaces(session.dataSpaces);
    render();
    await refreshEstimate(get);
  } catch (e) {
    if (stale()) return;
    state.phase = 'error';
    setOrg({ dot: 'err', title: host, hint: e.message, hintErr: true });
    render();
  }
}

function showConnected() {
  const s = state.session;
  setOrg({
    dot: 'ok',
    title: new URL(state.instanceUrl).host,
    sub: s.userName ?? '',
    facts: {
      'Org ID': s.orgId ?? 'unknown',
      API: `v${s.apiVersion}`,
      'Daily API': s.dailyApi ? `${fmt(s.dailyApi.Remaining)} of ${fmt(s.dailyApi.Max)} left` : 'unknown',
    },
  });
}

function fillDataSpaces(spaces) {
  const sel = $('dataspace');
  const saved = store.get('dataspace', 'default');
  sel.replaceChildren(...spaces.map((s) => el('option', { value: s, textContent: s, selected: s === saved })));
}

async function refreshEstimate(get) {
  if (!state.session) return;
  if (!get) {
    const token = await platform.sessionId(state.instanceUrl);
    if (!token) return;
    get = makeGet({ instanceUrl: state.instanceUrl, token, fetchImpl: platform.fetch });
  }
  const inv = await inventory(get, { apiVersion: state.session.apiVersion, dataSpace: $('dataspace').value || 'default' });
  state.estimates = estimate(inv);
  renderModules();
  renderEstimate();
}

// ---------- setup ----------

function selectedModules() {
  return [...document.querySelectorAll('#modules input:checked')].map((i) => i.value);
}

function renderModules() {
  const saved = new Set(store.get('modules', Object.keys(MODULES)));
  const current = document.querySelectorAll('#modules input').length ? new Set(selectedModules()) : saved;
  $('modules').replaceChildren(...Object.keys(MODULES).map((m) => {
    const [name, desc] = MODULE_INFO[m] ?? [m, ''];
    const e = state.estimates?.[m];
    const cost = e ? (e.calls === null ? '?' : `${e.exact ? '' : '≈'}${fmt(e.calls)} req`) : '';
    const input = el('input', { type: 'checkbox', value: m, checked: current.has(m) });
    input.addEventListener('change', () => { store.set('modules', selectedModules()); renderEstimate(); });
    return el('li', {}, el('label', { title: e?.note ?? '' }, input, el('span', {}, el('div', { className: 'mod-name', textContent: name }), el('div', { className: 'mod-desc', textContent: desc })), el('span', { className: 'mod-cost', textContent: cost })));
  }));
}

function renderEstimate() {
  const mods = selectedModules();
  $('export').disabled = !mods.length || state.phase !== 'ready' && state.phase !== 'done';
  const box = $('estimate');
  if (!mods.length) { box.textContent = 'Select at least one module.'; return; }
  if (!state.estimates) { box.textContent = ''; return; }
  const t = totalCalls(state.estimates, mods);
  const remaining = state.session?.dailyApi?.Remaining;
  const share = remaining ? (t.calls / remaining) * 100 : null;
  box.replaceChildren(
    'About ', el('strong', { textContent: `${t.exact ? '' : '≈'}${fmt(t.calls)} API requests` }),
    share !== null ? el('span', { className: share > 25 ? 'warn' : '', textContent: ` · ${share < 0.1 ? '<0.1' : share.toFixed(1)}% of today's remaining limit` }) : '',
  );
}

// ---------- export ----------

async function runExport() {
  const modules = selectedModules();
  if (!modules.length || !state.session) return;
  const token = await platform.sessionId(state.instanceUrl);
  if (!token) { await detect({ force: true }); return; }

  state.phase = 'exporting';
  state.abort = new AbortController();
  render();

  const dataSpace = $('dataspace').value || 'default';
  const redact = $('redact').checked;
  const includeRaw = $('include-raw').checked && !redact;
  const concurrency = Number($('concurrency').value);
  store.set('dataspace', dataSpace);
  store.set('includeRaw', $('include-raw').checked);
  store.set('redact', redact);
  store.set('concurrency', concurrency);

  const expected = Math.max(1, totalCalls(state.estimates ?? {}, modules).calls || modules.length);
  let requests = 0;
  const rows = Object.fromEntries(modules.map((m) => [m, { phase: 'pending' }]));
  const started = Date.now();
  const tick = () => {
    $('run-counter').textContent = `${fmt(requests)} requests · ${((Date.now() - started) / 1000).toFixed(0)} s`;
    const pct = Math.min(95, (requests / expected) * 100);
    $('bar').style.width = `${pct}%`;
    $('bar-track').setAttribute('aria-valuenow', String(Math.round(pct)));
  };
  const timer = setInterval(tick, 500);
  $('run-title').textContent = 'Exporting…';
  $('warnings').hidden = true;
  renderRunList(rows);

  try {
    const get = makeGet({
      instanceUrl: state.instanceUrl, token, fetchImpl: platform.fetch, signal: state.abort.signal,
      onRequest: () => { requests++; },
    });
    const collected = await collect(get, {
      apiVersion: state.session.apiVersion, dataSpace, modules, concurrency,
      onProgress: (msg) => { $('run-step').textContent = msg; },
      onModule: (name, phase, entry) => { rows[name] = { phase, entry }; renderRunList(rows); tick(); },
    });
    $('run-step').textContent = 'Normalizing…';
    const normalized = normalize(collected);
    const errors = Object.values(collected.manifest.modules).map((m) => m.error).filter(Boolean);
    const sessionLost = errors.some((e) => /INVALID_SESSION_ID|\b401\b/.test(e));
    if (!Object.keys(normalized.snapshot).length) {
      // nothing usable: do not download an empty bundle
      for (const [name, entry] of Object.entries(collected.manifest.modules)) rows[name] = { phase: 'error', entry };
      renderRunList(rows);
      throw new Error(sessionLost ? 'The Salesforce session expired. Reload Salesforce in this tab and export again.' : `All modules failed: ${errors[0] ?? 'unknown error'}`);
    }
    $('run-step').textContent = 'Compressing…';
    const zip = await bundleZip({ ...normalized, raw: collected.raw }, { includeRaw, redact });
    state.lastZip = zip;
    state.lastName = bundleName(normalized.manifest, new Date(), state.instanceUrl);
    platform.download(state.lastName, zip);

    for (const [name, counts] of Object.entries(normalized.manifest.counts)) rows[name].counts = counts;
    renderRunList(rows);
    const failed = Object.values(normalized.manifest.modules).filter((m) => m.error).length;
    $('run-title').textContent = failed ? `Done with ${failed} failed module${failed > 1 ? 's' : ''}` : 'Export ready';
    $('run-step').textContent = `${state.lastName} · ${(zip.length / 1024).toFixed(0)} KB${sessionLost ? ' · session expired during the export: reload Salesforce and export the failed modules again' : ''}`;
    renderWarnings(normalized);
    state.phase = 'done';
  } catch (e) {
    for (const r of Object.values(rows)) if (r.phase === 'start') r.phase = 'cancelled';
    renderRunList(rows);
    if (e.name === 'AbortError') {
      $('run-title').textContent = 'Export cancelled';
      $('run-step').textContent = 'Nothing was downloaded.';
    } else {
      $('run-title').textContent = 'Export failed';
      $('run-step').textContent = e.message;
    }
    state.lastZip = null;
    state.phase = 'done';
  } finally {
    clearInterval(timer);
    tick();
    if (state.lastZip) { $('bar').style.width = '100%'; $('bar-track').setAttribute('aria-valuenow', '100'); }
    state.abort = null;
    render();
    refreshLimits(token); // background: a slow /limits call must not hold the UI
  }
}

// Update the remaining daily API in the org card (1 request); failures keep the previous value.
async function refreshLimits(token) {
  const session = state.session;
  if (!session) return;
  try {
    const limits = await makeGet({ instanceUrl: state.instanceUrl, token, fetchImpl: platform.fetch, retries: 0 })(`/services/data/v${session.apiVersion}/limits`);
    if (limits.ok && limits.body?.DailyApiRequests && state.session === session) { session.dailyApi = limits.body.DailyApiRequests; showConnected(); }
  } catch { /* keep the previous value */ }
}

function renderRunList(rows) {
  const icon = { pending: '○', start: '◐', done: '✓', error: '✕', cancelled: '–' };
  $('run-list').replaceChildren(...Object.entries(rows).map(([m, r]) => {
    const meta = r.entry?.calls !== undefined ? `${fmt(r.entry.calls)} req · ${(r.entry.durationMs / 1000).toFixed(1)} s` : r.phase === 'start' ? 'running…' : r.phase === 'cancelled' ? 'cancelled' : '';
    const counts = r.counts ? Object.entries(r.counts).filter(([k, v]) => k !== 'warnings' && v !== undefined).map(([k, v]) => `${fmt(v)} ${COUNT_LABELS[k] ?? k}`).join(', ') : '';
    const detail = r.phase === 'error' ? el('div', { className: 'detail err', textContent: r.entry?.error ?? 'failed' }) : counts ? el('div', { className: 'detail', textContent: counts }) : null;
    return el('li', {}, el('span', { className: `st ${r.phase}`, textContent: icon[r.phase] ?? '·' }), el('span', { textContent: MODULE_INFO[m]?.[0] ?? m }), el('span', { className: 'meta', textContent: meta }), detail);
  }));
}

function renderWarnings({ snapshot, manifest }) {
  const items = [
    ...Object.values(snapshot).flatMap((p) => p.warnings.map((w) => `${p.module}: ${w.code} ${w.ref}`)),
    ...manifest.linkWarnings.map((w) => `link: ${w.code} ${w.ref}`),
  ];
  $('warnings').hidden = !items.length;
  $('warnings-title').textContent = `${items.length} warning${items.length === 1 ? '' : 's'} (details in manifest.json and snapshot files)`;
  $('warnings-list').replaceChildren(...items.slice(0, 200).map((t) => el('li', { textContent: t })));
}

// ---------- layout ----------

function render() {
  const p = state.phase;
  $('setup').hidden = p !== 'ready';
  $('run').hidden = !(p === 'exporting' || p === 'done');
  $('cancel').hidden = p !== 'exporting';
  $('download-again').hidden = !(p === 'done' && state.lastZip);
  $('new-export').hidden = p !== 'done';
  $('refresh').disabled = p === 'exporting';
  renderEstimate();
}

// ---------- events ----------

const ver = platform.version();
$('version').textContent = /^\d/.test(ver) ? `v${ver}` : ver;
$('include-raw').checked = store.get('includeRaw', false);
$('redact').checked = store.get('redact', false);
// redaction excludes raw responses (they contain the original values)
const syncRawOption = () => { $('include-raw').disabled = $('redact').checked; };
$('redact').addEventListener('change', syncRawOption);
syncRawOption();
$('concurrency').value = String(store.get('concurrency', 4));
$('refresh').addEventListener('click', () => detect({ force: true }));
$('export').addEventListener('click', runExport);
$('cancel').addEventListener('click', () => state.abort?.abort());
$('download-again').addEventListener('click', () => state.lastZip && platform.download(state.lastName, state.lastZip));
// the active tab may now show another org: always re-detect
$('new-export').addEventListener('click', () => { state.phase = 'init'; $('run').hidden = true; detect({ force: true }); });
$('dataspace').addEventListener('change', () => { store.set('dataspace', $('dataspace').value); refreshEstimate(); });
$('all').addEventListener('click', () => { document.querySelectorAll('#modules input').forEach((i) => { i.checked = true; }); store.set('modules', selectedModules()); renderEstimate(); });
$('none').addEventListener('click', () => { document.querySelectorAll('#modules input').forEach((i) => { i.checked = false; }); store.set('modules', []); renderEstimate(); });
// Chrome fires several tab events per navigation (and Lightning navigates often): debounce them.
let tabTimer;
platform.onTabChange(() => { clearTimeout(tabTimer); tabTimer = setTimeout(() => detect(), 300); });

renderModules();
detect();
