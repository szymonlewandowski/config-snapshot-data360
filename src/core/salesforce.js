// Salesforce session helpers shared by the extension and Node tools. Pure JS: fetch is injected.
// Safety rules: GET only, never follow redirects, never send the token to another origin,
// never log the token.

export const MIN_API_VERSION = 61; // data-model-object-mappings needs v61
// Response shapes were verified on v67.0 (docs/api-quirks.md). Newer versions are not used until tested,
// so a Salesforce release cannot silently change what the export parses.
export const TESTED_API_VERSION = '67.0';
export const REQUEST_TIMEOUT_MS = 90_000;

// Highest available version that is >= MIN and <= TESTED; null if none.
export function pickApiVersion(versions) {
  const ok = versions.map(String).filter((v) => parseFloat(v) >= MIN_API_VERSION && parseFloat(v) <= parseFloat(TESTED_API_VERSION));
  return ok.sort((a, b) => parseFloat(b) - parseFloat(a))[0] ?? null;
}

/**
 * Map a Salesforce UI URL to the My Domain API host whose `sid` cookie works with the REST API
 * (docs/api-quirks.md A1). Returns null for non-Salesforce URLs.
 *   acme.lightning.force.com                  -> acme.my.salesforce.com
 *   acme--uat.sandbox.lightning.force.com     -> acme--uat.sandbox.my.salesforce.com
 *   x-dev-ed.develop.lightning.force.com      -> x-dev-ed.develop.my.salesforce.com
 *   acme.my.salesforce-setup.com              -> acme.my.salesforce.com
 *   acme.my.salesforce.com                    -> acme.my.salesforce.com
 */
export function myDomainFromUrl(url) {
  let host;
  try { host = new URL(url).host.toLowerCase(); } catch { return null; }
  const rules = [
    ['.lightning.force.com', '.my.salesforce.com'],
    ['.my.salesforce-setup.com', '.my.salesforce.com'],
    ['.my.salesforce.com', '.my.salesforce.com'],
  ];
  for (const [suffix, replacement] of rules) {
    if (host.endsWith(suffix) && host.length > suffix.length) {
      const prefix = host.slice(0, -suffix.length);
      if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(prefix)) return null;
      return `https://${prefix}${replacement}`;
    }
  }
  return null;
}

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const onAbort = () => { clearTimeout(t); reject(abortError()); };
  const t = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
  signal?.addEventListener('abort', onAbort, { once: true });
});
const abortError = () => Object.assign(new Error('Export cancelled'), { name: 'AbortError' });
const RETRY_STATUS = new Set([429, 502, 503, 504]);

/**
 * GET client bound to one org. Returns get(path) -> { ok, status, body, errorCode, message, path, durationMs }.
 * Retries 429/502/503/504, network errors and timeouts with backoff; honours Retry-After; supports AbortSignal.
 */
export function makeGet({ instanceUrl, token, fetchImpl = globalThis.fetch, signal, retries = 2, backoffMs = 500, timeoutMs = REQUEST_TIMEOUT_MS, onRequest = () => {} }) {
  const origin = new URL(instanceUrl).origin;
  return async function get(path) {
    const url = path.startsWith('http') ? path : origin + path;
    if (new URL(url).origin !== origin) throw new Error(`Refusing to send the session token to ${new URL(url).origin}`);
    for (let attempt = 0; ; attempt++) {
      if (signal?.aborted) throw abortError();
      const started = Date.now();
      // per-attempt timeout, combined with the caller's cancel signal
      const timer = new AbortController();
      const timeout = setTimeout(() => timer.abort(), timeoutMs);
      const onCancel = () => timer.abort();
      signal?.addEventListener('abort', onCancel, { once: true });
      let res;
      let text;
      try {
        res = await fetchImpl(url, {
          method: 'GET',
          redirect: 'manual',
          credentials: 'omit',
          signal: timer.signal,
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        });
        text = await res.text(); // inside the timeout: a stalled body must not hang the export
      } catch (e) {
        if (signal?.aborted) throw abortError();
        const timedOut = timer.signal.aborted;
        if (attempt < retries) { await sleep(backoffMs * 2 ** attempt, signal); continue; }
        const out = { ok: false, status: 0, body: null, errorCode: timedOut ? 'TIMEOUT' : 'NETWORK_ERROR', message: timedOut ? `No response within ${timeoutMs / 1000} s` : e.message, path, durationMs: Date.now() - started };
        onRequest(out);
        return out;
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', onCancel);
      }
      if (RETRY_STATUS.has(res.status) && attempt < retries) {
        const ra = Number(res.headers?.get?.('retry-after'));
        await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra, 30) * 1000 : backoffMs * 2 ** attempt, signal);
        continue;
      }
      const out = toResult(res, text, path, started);
      onRequest(out);
      return out;
    }
  };
}

function toResult(res, text, path, started) {
  // redirect: 'manual' -> browsers expose an opaque redirect (status 0), Node a 3xx
  if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) {
    return { ok: false, status: res.status || 302, body: null, errorCode: 'REDIRECT', message: 'Redirect not followed (wrong domain?)', path, durationMs: Date.now() - started };
  }
  let body = null;
  let parsed = true;
  try { body = text ? JSON.parse(text) : null; } catch { parsed = false; }
  // A 2xx with a non-JSON body (maintenance page, proxy, login page) must not pass as empty data.
  if (res.ok && !parsed) {
    return { ok: false, status: res.status, body: null, errorCode: 'NON_JSON_RESPONSE', message: 'Salesforce returned a non-JSON page (maintenance, proxy or login page?)', path, durationMs: Date.now() - started };
  }
  const out = { ok: res.ok, status: res.status, body, path, durationMs: Date.now() - started };
  if (!res.ok) {
    const err = Array.isArray(body) ? body[0] : body;
    out.errorCode = err?.errorCode || err?.error || `HTTP_${res.status}`;
    out.message = err?.message || err?.error_description || null;
  }
  return out;
}

// User-facing explanation for session-level failures.
export function explainError(res) {
  const code = res?.errorCode;
  if (code === 'INVALID_SESSION_ID') return 'Session expired or not valid for the API. Reload Salesforce in this tab and try again.';
  if (code === 'API_DISABLED_FOR_ORG' || code === 'API_CURRENTLY_DISABLED') return 'API access is disabled for this user or org (needs the "API Enabled" permission).';
  if (code === 'REDIRECT') return 'Salesforce redirected the request. Open the org on its My Domain (*.my.salesforce.com or *.lightning.force.com).';
  if (code === 'NETWORK_ERROR') return 'Network error while calling Salesforce.';
  if (code === 'TIMEOUT') return 'Salesforce did not respond in time. Try again, or lower "Parallel requests".';
  if (code === 'NON_JSON_RESPONSE') return 'Salesforce returned a web page instead of data (maintenance or login page?). Reload Salesforce and try again.';
  if (res?.status === 403) return 'Access denied. The user may lack permissions for Data 360.';
  if (res?.status === 404) return 'Not found. Data 360 may not be enabled in this org.';
  return `${res?.status ?? ''} ${code ?? ''} ${res?.message ?? ''}`.trim();
}

/**
 * Validate the session and read what the UI needs before an export.
 * Throws an Error with a user-facing message when the org cannot be exported.
 */
export async function connect(get) {
  const versions = await get('/services/data/');
  if (!versions.ok || !Array.isArray(versions.body)) throw new Error(explainError(versions));
  const apiVersion = pickApiVersion(versions.body.map((v) => v.version));
  if (!apiVersion) throw new Error(`No supported API version (needs v${MIN_API_VERSION} to v${TESTED_API_VERSION}).`);
  const base = `/services/data/v${apiVersion}`;

  // /services/data/ works without a session (api-quirks A4): /limits proves the token. The three calls are independent.
  const [limits, ui, spaces] = await Promise.all([
    get(`${base}/limits`),
    get('/services/oauth2/userinfo'),
    get(`${base}/ssot/data-spaces?limit=200`),
  ]);
  if (!limits.ok) throw new Error(explainError(limits));
  if (!spaces.ok) throw new Error(`Data 360 is not available: ${explainError(spaces)}`);
  const dataSpaces = (spaces.body?.dataSpaces || []).map((d) => d.name).filter(Boolean);

  return {
    apiVersion,
    orgId: ui.ok ? ui.body?.organization_id ?? null : null,
    userName: ui.ok ? ui.body?.preferred_username ?? ui.body?.name ?? null : null,
    dailyApi: limits.body?.DailyApiRequests ?? null,
    dataSpaces: dataSpaces.length ? dataSpaces : ['default'],
  };
}
