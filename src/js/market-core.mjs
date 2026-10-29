// Pure market logic: parsing, ranking, formatting, backoff and the polling controller.
// No DOM access, so the gates can run it under Node with fakes.

export const TOP_N = 10;
export const POLL_MS = 60000;
export const BACKOFF_BASE_MS = 2000;
export const BACKOFF_CAP_MS = 60000;

export const num = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

// Pools carry volume and 24h change; tokens (from included[]) carry symbol, name and logo.
// Each pool is credited to its base token. Volume is summed across a token's pools, change comes from its busiest pool.
export function parseMarkets(json) {
  const tokens = new Map();
  for (const i of (json && json.included) || []) if (i && i.type === 'token' && i.attributes) tokens.set(i.id, i.attributes);
  const out = new Map();
  for (const p of (json && json.data) || []) {
    const at = (p && p.attributes) || {};
    const ref = p && p.relationships && p.relationships.base_token && p.relationships.base_token.data;
    const tok = ref && tokens.get(ref.id);
    if (!tok || !tok.symbol) continue;
    const vol = num(at.volume_usd && at.volume_usd.h24);
    const price = num(tok.price_usd) ?? num(at.base_token_price_usd);
    if (price === null || vol === null) continue;
    const prev = out.get(ref.id);
    if (!prev) {
      out.set(ref.id, { id: ref.id, symbol: String(tok.symbol).toUpperCase(), name: tok.name || tok.symbol, logo: tok.image_url || null, price, change: num(at.price_change_percentage && at.price_change_percentage.h24), volumeUsd: vol, top: vol });
    } else {
      prev.volumeUsd += vol;
      if (vol > prev.top) { prev.top = vol; prev.price = price; prev.change = num(at.price_change_percentage && at.price_change_percentage.h24); }
    }
  }
  return [...out.values()].map(({ top, ...row }) => row);
}

export function rank(rows, n = TOP_N) {
  return rows
    .filter((r) => r.volumeUsd !== null && r.volumeUsd !== undefined)
    .sort((a, b) => b.volumeUsd - a.volumeUsd)
    .slice(0, n);
}

export const marketsRequest = (source) => source.marketsUrl;

export function backoffDelay(failures, rand = Math.random) {
  if (failures <= 0) return POLL_MS;
  return Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** (failures - 1)) + Math.floor(rand() * 250);
}

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 });
export function fmtPrice(p) {
  if (p === null || p === undefined) return '—';
  const d = p >= 1 ? 2 : p >= 0.01 ? 4 : 8;
  return '$' + p.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}
export const fmtChange = (c) => (c === null || c === undefined ? '—' : (c >= 0 ? '+' : '−') + Math.abs(c).toFixed(2) + '%');
export const fmtVolume = (v) => (v === null || v === undefined ? '—' : '$' + compact.format(v));

export async function loadMarkets(fetchFn, source, signal) {
  const res = await fetchFn(marketsRequest(source), { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return parseMarkets(await res.json());
}

// Polling controller. States: loading | live | stale (failed refresh, last good rows kept) | error (no data yet).
export function createMarketController({ source, fetchFn, onState, schedule = setTimeout, cancel = clearTimeout, rand = Math.random }) {
  let rows = [];
  let failures = 0;
  let timer = null;
  let visible = true;
  let inflight = null;
  let started = false;
  let status = 'loading';

  const emit = (extra = {}) => onState({ status, rows, failures, ...extra });

  async function tick() {
    if (!visible) return;
    cancel(timer);
    timer = null;
    const ac = typeof AbortController === 'function' ? new AbortController() : { signal: undefined, abort() {} };
    inflight = ac;
    try {
      const top = rank(await loadMarkets(fetchFn, source, ac.signal));
      if (!top.length) throw new Error('empty');
      rows = top;
      failures = 0;
      status = 'live';
      emit();
    } catch (err) {
      if (ac.signal && ac.signal.aborted) return;
      failures += 1;
      status = rows.length ? 'stale' : 'error';
      emit({ error: String((err && err.message) || err) });
    } finally {
      if (inflight === ac) inflight = null;
    }
    if (visible && started) timer = schedule(tick, backoffDelay(failures, rand));
  }

  return {
    start() { started = true; return tick(); },
    setVisible(v) {
      visible = v;
      if (!started) return undefined;
      if (!v) {
        cancel(timer);
        timer = null;
        if (inflight) inflight.abort();
        return undefined;
      }
      return tick();
    },
    get snapshot() { return { status, rows, failures }; },
  };
}
