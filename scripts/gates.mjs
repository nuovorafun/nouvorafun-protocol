// Gate runner. Exit code 0 only when every gate passes. Usage: npm run build && npm run gates
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build, REQUIRED_ASSETS } from './build.mjs';
import { DATE_KEYS, handleFromUrl, isStated, validateRegister } from './lib.mjs';
import { segments, visibleText } from './text.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const tmpRoot = path.join(root, '.gate-tmp');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const register = JSON.parse(read('src/data/register.json'));
const results = [];
const must = (cond, msg) => { if (!cond) throw new Error(msg); };
const record = (name, r, err) => {
  if (err) results.push({ name, ok: false, detail: err.message });
  else results.push({ name, ok: true, detail: (r && r.detail) || '' });
};
const gate = (name, fn) => { try { record(name, fn()); } catch (e) { record(name, null, e); } };
const gateAsync = async (name, fn) => { try { record(name, await fn()); } catch (e) { record(name, null, e); } };

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]));
const rel = (f) => path.relative(root, f).split(path.sep).join('/');

// ---- mutation harness: every anchor is read from the current record at runtime, never hard-coded ----
const TEST_VALUES = {
  ca: () => ({ value: '0x' + 'a1B2c3D4e5'.repeat(4) }),
  x: () => ({ url: 'https://x.com/nuovora_test' }),
  github: () => ({ url: 'https://github.com/nuovora-test/site' }),
};
function flip(reg, id) {
  const copy = JSON.parse(JSON.stringify(reg));
  const cur = copy.records[id];
  copy.records[id] = isStated(cur)
    ? { label: cur.label, state: 'absent', source: cur.source }
    : { label: cur.label, state: 'stated', source: cur.source, ...TEST_VALUES[id]() };
  return copy;
}
let variantN = 0;
function buildVariant(reg) {
  const dir = path.join(tmpRoot, 'v' + variantN++);
  fs.mkdirSync(dir, { recursive: true });
  const rp = path.join(dir, 'register.json');
  fs.writeFileSync(rp, JSON.stringify(reg));
  build({ registerPath: rp, outDir: path.join(dir, 'dist') });
  return { dir: path.join(dir, 'dist'), html: fs.readFileSync(path.join(dir, 'dist/index.html'), 'utf8'), reg };
}
const withoutRegisterJson = (h) => h.replace(/<script type="application\/json" id="register">[\s\S]*?<\/script>/, '');
const caSlotOf = (h) => (h.match(/<div class="ca[^"]*" id="ca-slot"[\s\S]*?(?=\s*<\/header>)/) || [''])[0];

function checkRecord(h0, reg, id) {
  const rec = reg.records[id];
  const h = withoutRegisterJson(h0);
  if (id === 'x' || id === 'github') {
    const tag = (h.match(new RegExp(`<(?:a|span) [^>]*data-social="${id}"[^>]*>`)) || [''])[0];
    must(tag, `${id}: icon missing`);
    if (isStated(rec)) {
      must(/^<a /.test(tag), `${id}: stated must be an anchor`);
      must(tag.includes(`href="${rec.url}"`), `${id}: href must equal register url`);
      must(tag.includes(handleFromUrl(rec.url)), `${id}: handle must derive from url`);
    } else {
      must(/^<span /.test(tag), `${id}: inert must not be an anchor`);
      must(!/href=/.test(tag), `${id}: inert carries href`);
      must(/aria-disabled="true"/.test(tag), `${id}: inert not marked disabled`);
    }
    return `${id}:${rec.state}`;
  }
  const slot = caSlotOf(h0);
  must(slot, 'ca slot missing');
  const btn = (slot.match(/<button class="ca-copy"[^>]*>/) || [''])[0];
  must(btn, 'ca copy button missing');
  if (isStated(rec)) {
    must(slot.includes(`<span class="ca-addr mono">${rec.value}</span>`), 'ca: full address not shown in slot');
    must(!/disabled/.test(btn), 'ca: copy button must be live');
    must(/data-state="stated"/.test(slot), 'ca: slot state attr');
  } else {
    must(/is-inert/.test(slot) && /data-state="inert"/.test(slot), 'ca: slot not inert');
    must(/disabled/.test(btn), 'ca: copy must be disabled');
    must(!/0x[0-9a-fA-F]{20,}/.test(h), 'ca: inert page carries address-shaped text');
    must(/Pending/.test(slot), 'ca: inert slot should say pending');
  }
  return `ca:${rec.state}`;
}

// ---- address scanner: address-shaped strings are matched to the stated registry, the CA slot is exempt ----
function scanAddresses(files, reg) {
  const allowed = isStated(reg.records.ca) ? reg.records.ca.value.toLowerCase() : null;
  const bad = [];
  for (const [name, text] of files) {
    const cleaned = name.endsWith('index.html') ? text.replace(caSlotOf(text), '') : text;
    for (const m of cleaned.matchAll(/0x[0-9a-fA-F]{40}\b/g)) if (m[0].toLowerCase() !== allowed) bad.push(`${name}: ${m[0]}`);
  }
  return bad;
}

// =====================================================================================
fs.rmSync(tmpRoot, { recursive: true, force: true });
fs.mkdirSync(tmpRoot, { recursive: true });
const htmlPath = path.join(dist, 'index.html');
const html = fs.existsSync(htmlPath) ? fs.readFileSync(htmlPath, 'utf8') : '';
const distFiles = fs.existsSync(dist) ? walk(dist) : [];
const cssOf = (n) => (fs.existsSync(path.join(dist, 'css', n)) ? fs.readFileSync(path.join(dist, 'css', n), 'utf8') : '');
const tokensCss = cssOf('tokens.css');
const mainCss = cssOf('main.css');
const jsFiles = distFiles.filter((f) => f.endsWith('.mjs'));
const jsText = jsFiles.map((f) => fs.readFileSync(f, 'utf8')).join('\n');

// --- dist and logo ---
gate('dist/ has index.html, css, js and _headers', () => { for (const f of ['index.html', 'css/tokens.css', 'css/main.css', 'js/main.mjs', '_headers']) must(fs.existsSync(path.join(dist, f)), 'missing dist/' + f); });
gate('build script copies every required asset into dist/', () => { for (const a of REQUIRED_ASSETS) must(fs.existsSync(path.join(dist, a)), 'missing dist/' + a); });
gate('logo in dist/ is byte-identical to the source asset', () => { must(Buffer.compare(fs.readFileSync(path.join(dist, 'assets/nuovora-logo.png')), fs.readFileSync(path.join(root, 'src/assets/nuovora-logo.png'))) === 0, 'logo bytes differ'); });
gate('index.html references the logo by a relative path that exists in dist/', () => {
  const srcs = [...html.matchAll(/(?:src|href)="(assets\/[^"]+|favicon\.svg)"/g)].map((m) => m[1]);
  must(srcs.includes('assets/nuovora-logo.png'), 'logo not referenced');
  must(srcs.includes('assets/nuovora-logo-hero.webp'), 'hero logo not referenced');
  for (const s of srcs) must(fs.existsSync(path.join(dist, s)), 'dangling ' + s);
  must(!/(?:src|href)="(?:\/|https?:)[^"]*nuovora-logo/.test(html), 'logo path is absolute');
  return { detail: srcs.length + ' asset refs resolved' };
});
gate('logo PNG keeps real alpha (RGBA colourtype 6)', () => { const b = fs.readFileSync(path.join(dist, 'assets/nuovora-logo.png')); must(b.slice(1, 4).toString() === 'PNG' && b[25] === 6, 'logo is not colourtype 6'); });
gate('favicon.svg is a 32x32 grid of integer rects, no comments, no double hyphen', () => {
  const s = fs.readFileSync(path.join(dist, 'favicon.svg'), 'utf8');
  must(/width="32" height="32" viewBox="0 0 32 32"/.test(s), 'not 32x32');
  must(!s.includes('<!--') && !s.includes('--'), 'comment or double hyphen present');
  const rects = [...s.matchAll(/<rect x="(\d+)" y="(\d+)" width="(\d+)" height="1"/g)];
  must(rects.length > 100, 'too few traced rects');
  must(rects.every((m) => +m[1] + +m[3] <= 32 && +m[2] < 32), 'rect outside grid');
  return { detail: rects.length + ' rects' };
});
const sampled = JSON.parse(read('scripts/palette.sampled.json')).hex;
gate('favicon fills all come from the sampled palette', () => {
  const s = fs.readFileSync(path.join(dist, 'favicon.svg'), 'utf8');
  const bad = [...new Set([...s.matchAll(/fill="(#[0-9a-f]{6})"/g)].map((m) => m[1]))].filter((f) => !sampled.includes(f));
  must(!bad.length, 'unsampled fill ' + bad);
});

// --- register ---
gate('register validates (states, inert records carry no value or url)', () => { const e = validateRegister(register); must(!e.length, e.join('; ')); });
gate('register dates never reach dist/', () => { for (const f of distFiles) { if (/\.(png|webp)$/.test(f)) continue; const t = fs.readFileSync(f, 'utf8'); for (const k of DATE_KEYS) must(!t.includes(k), `${rel(f)} contains ${k}`); } });

// --- link rule ---
gate('link rule: stated social href equals register url with derived handle, inert has no href', () => { for (const id of ['x', 'github']) checkRecord(html, register, id); });
gate('no empty, hash-only or javascript hrefs', () => { must(!/href="(#|)"|href="javascript:/i.test(html), 'bad href'); });
gate('in-page anchors all hit an existing id, ids are unique', () => {
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  must(new Set(ids).size === ids.length, 'duplicate ids');
  for (const m of html.matchAll(/href="#([^"]+)"/g)) must(ids.includes(m[1]), 'dangling #' + m[1]);
});
gate('social icons: both always present in the header, official X and Octicon paths, no text labels, never hidden by CSS', () => {
  must((html.match(/data-social="x"/g) || []).length === 1 && (html.match(/data-social="github"/g) || []).length === 1, 'icon count');
  must(html.includes('M18.244 2.25h3.308l-7.227 8.26') && html.includes('M8 0C3.58 0 0 3.58 0 8c0 3.54'), 'official paths missing');
  must(!/\.(social|icon-btn)[^{}]*\{[^}]*display:\s*none/.test(mainCss), 'social hidden at a breakpoint');
  must(html.indexOf('class="social"') > 0 && html.indexOf('class="social"') < html.indexOf('<main>'), 'social not in header');
  must(!/<\/svg>\s*[A-Za-z]/.test(html.match(/<nav class="social"[\s\S]*?<\/nav>/)[0]), 'icon carries a text label');
});

// --- both branches, mutated from the runtime record ---
for (const id of ['ca', 'x', 'github']) {
  gate(`branch proof ${id}: current state and flipped state both render correctly`, () => {
    const cur = checkRecord(html, register, id);
    const v = buildVariant(flip(register, id));
    must(register.records[id].state !== v.reg.records[id].state, 'mutation did not flip');
    return { detail: `${cur} -> ${checkRecord(v.html, v.reg, id)}` };
  });
}
gate('branch proof: all three records flipped together', () => {
  let reg = register;
  for (const id of ['ca', 'x', 'github']) reg = flip(reg, id);
  const v = buildVariant(reg);
  return { detail: ['ca', 'x', 'github'].map((id) => checkRecord(v.html, v.reg, id)).join(' ') };
});
gate('market output has zero dependence on CA state', () => {
  const v = buildVariant(flip(register, 'ca'));
  const section = (h) => (h.match(/<section class="block" id="market">[\s\S]*?<\/section>/) || [''])[0];
  const ticker = (h) => (h.match(/<section class="ticker"[\s\S]*?<\/section>/) || [''])[0];
  must(section(html) && section(html) === section(v.html), 'market section differs');
  must(ticker(html) === ticker(v.html), 'ticker differs');
  for (const f of jsFiles.filter((x) => /market|motion|copy/.test(x))) must(Buffer.compare(fs.readFileSync(f), fs.readFileSync(path.join(v.dir, 'js', path.basename(f)))) === 0, 'js differs ' + path.basename(f));
  const pub = (h) => JSON.parse(h.match(/id="register">([\s\S]*?)<\/script>/)[1]).records.market;
  must(JSON.stringify(pub(html)) === JSON.stringify(pub(v.html)), 'market record differs');
  must(!/\bca\b|contract/i.test(read('src/js/market.mjs') + read('src/js/market-core.mjs')), 'market code mentions the contract');
});

// --- gate warning: address scanner ---
gate('address scanner: dist/ carries only addresses matching the stated registry', () => {
  const files = distFiles.filter((f) => /\.(html|css|mjs|svg|json)$/.test(f)).map((f) => [rel(f), fs.readFileSync(f, 'utf8')]);
  const bad = scanAddresses(files, register);
  must(!bad.length, bad.join('; '));
});
gate('address scanner matches against the registry, it is not a blanket 0x reject', () => {
  const v = buildVariant(flip(register, 'ca'));
  const ca = v.reg.records.ca;
  const files = (h) => [['index.html', h]];
  const stray = '<p>0x' + 'f'.repeat(40) + '</p></main>';
  must(scanAddresses(files(v.html.replace('</main>', stray)), v.reg).length === 1, 'stray address not caught');
  if (isStated(ca)) {
    must(scanAddresses(files(v.html), v.reg).length === 0, 'stated address rejected');
    must(scanAddresses(files(v.html.replace('</main>', `<p>${ca.value}</p></main>`)), v.reg).length === 0, 'registry-matching address elsewhere rejected');
  }
});
gate('CA slot is exempt from the address scanner', () => {
  const v = buildVariant(isStated(register.records.ca) ? register : flip(register, 'ca'));
  const bare = withoutRegisterJson(v.html);
  must(/0x[0-9a-fA-F]{40}/.test(bare), 'test page has no address in slot');
  must(scanAddresses([['index.html', bare]], { records: { ca: { state: 'absent' } } }).length === 0, 'slot not exempt');
});

// --- palette rule ---
const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-zA-Z_-])/g;
const COLOR_FN = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/;
const NAMED = /:\s*[^;{}]*\b(white|black|red|green|blue|gray|grey|orange|yellow|purple|pink|silver)\b/;
gate('no colour literals outside tokens.css (css, js, markup attributes)', () => {
  const bad = [];
  for (const f of distFiles) {
    const r = rel(f);
    if (/tokens\.css$|favicon\.svg$|\.(png|webp)$|_headers$/.test(r)) continue;
    let t = fs.readFileSync(f, 'utf8');
    if (r.endsWith('index.html')) t = [...t.matchAll(/\s(?:style|fill|stroke|color|stop-color)="([^"]*)"/g)].map((m) => m[1]).join(' ');
    if (r.endsWith('.css')) t = t.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of t.matchAll(HEX)) bad.push(`${r}: ${m[0]}`);
    if (COLOR_FN.test(t)) bad.push(`${r}: colour function`);
    if (r.endsWith('.css') && NAMED.test(t)) bad.push(`${r}: named colour ${t.match(NAMED)[1]}`);
  }
  must(!bad.length, bad.slice(0, 6).join('; '));
});
gate('every colour in tokens.css is a sampled real pixel', () => {
  const hexes = [...new Set((tokensCss.replace(/\/\*[\s\S]*?\*\//g, '').match(HEX) || []).map((h) => h.toLowerCase()))];
  must(hexes.length >= 10, 'palette too small');
  const bad = hexes.filter((h) => !sampled.includes(h));
  must(!bad.length, 'unsampled: ' + bad.join(','));
  return { detail: hexes.length + ' colours' };
});
gate('tokens.css documents provenance (k-means, snapped, premultiplied)', () => { must(/k-means/.test(tokensCss) && /snapped/.test(tokensCss) && /premultiplied/.test(tokensCss), 'provenance comment missing'); });
gate('ink on paper meets 4.5:1', () => {
  const lum = (h) => { const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const get = (n) => tokensCss.match(new RegExp(`--${n}:\\s*(#[0-9a-f]{6})`))[1];
  const [a, b] = [lum(get('n-ink')), lum(get('n-paper'))].sort((x, y) => y - x);
  const ratio = (a + 0.05) / (b + 0.05);
  must(ratio >= 4.5, 'ratio ' + ratio.toFixed(2));
  return { detail: ratio.toFixed(2) + ':1' };
});

// --- no dates ---
const DATE_PATTERNS = [/\b(19|20)\d{2}\b/, /\b\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}\b/, /\b\d{1,2}:\d{2}(?::\d{2})?\b/, /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d/i, /\b\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*/i, /\bas of\b|\bchecked\b|\bupdated\b|\blast (?:seen|sync)\b|\byesterday\b|\btoday\b|\b\d+\s*(?:s|m|h|d|min|sec|hours?|days?|minutes?|seconds?) ago\b|\bago\b|\b(?:am|pm)\b/i];
const findDate = (text) => { for (const p of DATE_PATTERNS) { const m = text.match(p); if (m) return m[0]; } return null; };
gate('zero dates, timestamps or clock strings in visible text, aria-labels, titles and alt (current build)', () => { const m = findDate(visibleText(html)); must(!m, 'found "' + m + '"'); });
gate('zero dates in the fully flipped build too (CA, X and GitHub stated)', () => { let reg = register; for (const id of ['ca', 'x', 'github']) if (!isStated(reg.records[id])) reg = flip(reg, id); const m = findDate(visibleText(buildVariant(reg).html)); must(!m, 'found "' + m + '"'); });
gate('script never renders dates (no date or time formatting, feed timestamps never read)', () => { const m = jsText.match(/toLocale(?:Date|Time)String|DateTimeFormat|toISOString|toUTCString|getHours|getMinutes|updated_at|new Date\(|RelativeTimeFormat|toTimeString|toDateString/); must(!m, 'found ' + (m && m[0])); });
gate('script string literals (status, error and aria text) carry no date or clock wording', () => { const strings = [...jsText.matchAll(/'([^'\n]{3,90})'/g)].map((m) => m[1]).join(' | '); const m = findDate(strings); must(!m, 'found "' + m + '" in script strings'); });

// --- market logic against fakes, no network ---
const core = await import(pathToFileURL(path.join(root, 'src/js/market-core.mjs')).href);
const SYMS = ['BTC', 'ETH', 'SOL', 'DOGE', 'ADA', 'XRP', 'AVAX', 'LINK', 'LTC', 'BCH', 'XLM', 'SHIB'];
const marketsUrl = 'https://feed.test/pools';
const marketsJson = {
  data: SYMS.map((s, i) => ({ id: 'pool-' + s, attributes: { base_token_price_usd: String(100 + i), price_change_percentage: { h24: i % 2 ? '-1.5' : '2.25' }, volume_usd: { h24: String((i + 1) * 1000) } }, relationships: { base_token: { data: { id: 'tok-' + s } }, quote_token: { data: { id: 'tok-WETH' } } } })),
  included: [...SYMS.map((s) => ({ id: 'tok-' + s, type: 'token', attributes: { symbol: s, name: s + ' coin', image_url: 'https://img.test/' + s + '.png' } })), { id: 'tok-WETH', type: 'token', attributes: { symbol: 'WETH', name: 'Wrapped Ether', image_url: null } }, { id: 'pool-x', type: 'pool', attributes: {} }],
};
const mkFetch = (st) => async (url) => {
  st.calls.push(url);
  if (st.fail) throw new Error('network down');
  return { ok: true, json: async () => marketsJson };
};
const mkCtl = (st) => {
  st.sched = []; st.cancelled = []; st.states = [];
  return core.createMarketController({ source: { marketsUrl }, fetchFn: mkFetch(st), onState: (s) => st.states.push(s), schedule: (fn, ms) => { st.sched.push({ fn, ms }); return st.sched.length; }, cancel: (id) => st.cancelled.push(id), rand: () => 0 });
};
gate('market parse and rank: top 10 by 24h volume, price, change and logo carried through', () => {
  const rows = core.rank(core.parseMarkets(marketsJson));
  must(rows.length === 10, 'not top 10');
  must(rows.every((r, i) => i === 0 || rows[i - 1].volumeUsd >= r.volumeUsd), 'not sorted by volume');
  must(rows[0].symbol === 'SHIB' && rows[0].logo === 'https://img.test/SHIB.png' && rows[0].change === -1.5 && rows[0].price === 111 && !rows.some((r) => r.symbol === 'WETH'), 'field mapping');
  must(core.marketsRequest({ marketsUrl }) === marketsUrl, 'request url comes from the register');
});
await gateAsync('market polls every 60s after a success and emits live rows', async () => { const st = { calls: [], fail: false }; await mkCtl(st).start(); const last = st.states.at(-1); must(last.status === 'live' && last.rows.length === 10, 'not live'); must(st.sched.at(-1).ms === 60000, 'interval ' + st.sched.at(-1).ms); });
await gateAsync('exponential backoff doubles to a 60s cap, last good data is kept, then recovers', async () => {
  const st = { calls: [], fail: false }; await mkCtl(st).start();
  const good = JSON.stringify(st.states.at(-1).rows);
  st.fail = true; const delays = [];
  for (let i = 0; i < 7; i++) { await st.sched.at(-1).fn(); delays.push(st.sched.at(-1).ms); must(st.states.at(-1).status === 'stale', 'status not stale'); must(JSON.stringify(st.states.at(-1).rows) === good, 'last good data lost'); }
  must(delays.join() === '2000,4000,8000,16000,32000,60000,60000', 'delays ' + delays.join());
  st.fail = false; await st.sched.at(-1).fn(); must(st.states.at(-1).status === 'live' && st.sched.at(-1).ms === 60000, 'no recovery');
  return { detail: delays.join('/') };
});
await gateAsync('first-load failure gives an error state with no rows and keeps retrying', async () => { const st = { calls: [], fail: true }; await mkCtl(st).start(); const s = st.states.at(-1); must(s.status === 'error' && s.rows.length === 0 && s.error, 'not an error state'); must(st.sched.at(-1).ms === 2000, 'no retry scheduled'); });
await gateAsync('polling pauses while hidden and fetches immediately when visible', async () => {
  const st = { calls: [], fail: false }; const c = mkCtl(st); await c.start();
  const pending = st.sched.at(-1); const before = st.calls.length;
  c.setVisible(false); must(st.cancelled.length >= 1, 'timer not cancelled');
  await pending.fn(); must(st.calls.length === before, 'fetched while hidden');
  await c.setVisible(true); must(st.calls.length > before, 'no immediate fetch on visible');
});
gate('market source URLs live in the register only, code and markup hold none', () => {
  must(isStated(register.records.market) && register.records.market.marketsUrl, 'market record incomplete');
  must(!/robinhood\.com|coingecko\.com|https?:\/\//i.test(jsText), 'hard-coded source URL in script'); must(![...withoutRegisterJson(html).matchAll(/href="(https?:[^"]+)"/g)].some((m) => /robinhood|coingecko/i.test(m[1])), 'market source linked from markup');
});
gate('market UI: skeletons, stagger fade-in, flash on change, letter tile fallback, copy per symbol', () => {
  const m = read('src/js/market.mjs');
  must(/skeletonRow/.test(m) && /animationDelay/.test(m) && /flash-up/.test(m) && /onerror/.test(m) && /slice\(0, 1\)/.test(m) && /copy-sym/.test(m), 'ui piece missing');
  must(/\.sk\b/.test(mainCss) && /@keyframes shimmer/.test(mainCss) && /@keyframes rowIn/.test(mainCss), 'css piece missing');
});
gate('ticker is built from the same live rows and shows a dash on failure', () => { const m = read('src/js/market.mjs'); must(/tkItem\(r, false\)/.test(m) && /\\u2014|—/.test(m), 'ticker wiring'); must(/<section class="ticker"/.test(html), 'ticker section'); });

// --- motion ---
gate('reduced motion: CSS removes animation and transition, reveal state forced visible', () => { const b = mainCss.match(/@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*\}\s*(?:\.sr[\s\S]*)?$/); must(b && /animation:\s*none\s*!important/.test(b[0]) && /transition:\s*none\s*!important/.test(b[0]) && /opacity:\s*1/.test(b[0]), 'reduce block incomplete'); });
gate('reduced motion: every script effect has an instant path', () => { const m = read('src/js/motion.mjs'); must((m.match(/isReduced\(\)/g) || []).length >= 5 && /matchMedia\('\(prefers-reduced-motion: reduce\)'\)/.test(m), 'missing checks'); });
gate('visual layer present: spring solver, parallax (pointer and scroll), mesh, progress bar, spotlight, count-up, live dot', () => {
  const m = read('src/js/motion.mjs');
  must(/stiffness/.test(m) && /damping/.test(m) && /initParallax/.test(m) && /pointermove/.test(m) && /scrollY/.test(m) && /countTo/.test(m) && /initSpotlight/.test(m) && /initProgress/.test(m), 'script piece');
  must(/\.mesh/.test(mainCss) && /@keyframes drift/.test(mainCss) && /\.progress/.test(mainCss) && /\[data-spot\]::before/.test(mainCss) && /@keyframes pulse/.test(mainCss), 'css piece');
});

// --- mobile (static half; the browser half is measured separately) ---
gate('no ch units anywhere in css', () => { must(!/\d(?:\.\d+)?ch\b/.test(tokensCss + mainCss), 'ch unit found'); });
gate('tap targets: interactive classes declare at least 44px', () => {
  const need = [['.icon-btn', /width:\s*44px;\s*height:\s*44px/], ['.chip, .cta', /min-height:\s*44px/], ['.ca-copy', /min-width:\s*44px;\s*min-height:\s*44px/], ['.copy-sym', /width:\s*44px;\s*height:\s*44px/], ['.tablist button', /min-height:\s*44px/], ['.reg-chip', /min-height:\s*44px/], ['.brand', /min-height:\s*44px/]];
  for (const [sel, re] of need) { const i = mainCss.indexOf(sel + ' {'); must(i >= 0 && re.test(mainCss.slice(i, mainCss.indexOf('}', i))), sel + ' under 44px'); }
});
gate('CA slot sits in the sticky header above main, large font, wraps to show the full address', () => {
  must(html.indexOf('id="ca-slot"') > 0 && html.indexOf('id="ca-slot"') < html.indexOf('<main>'), 'slot not above main');
  must(/\.top\s*\{[^}]*position:\s*sticky/.test(mainCss), 'header not sticky');
  const f = mainCss.match(/\.ca-addr\s*\{[^}]*font-size:\s*clamp\((\d+)px,\s*[\d.]+vw,\s*(\d+)px\)/); must(f && +f[2] >= 24 && +f[1] >= 14, 'font too small');
  must(/\.ca-addr\s*\{[^}]*overflow-wrap:\s*anywhere/.test(mainCss), 'address would be clipped');
});

// --- reference copy distance ---
const fp = JSON.parse(read('scripts/ref-fingerprint.json'));
const h12 = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);
const STOP = new Set('a about above after again all also am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers herself him himself his how i if in into is it its itself just me more most my myself no nor not now of off on once only or other our ours ourselves out over own same she should so some such than that the their theirs them themselves then there these they this those through to too under until up very was we were what when where which while who whom why will with you your yours yourself yourselves s t d ll m o re ve y one two three four'.split(' '));
const BRAND_OK = new Set(['nuovora', 'robinhood', 'chain', 'x', 'github', 'fun', 'usd']);
const jsStrings = [...jsText.matchAll(/'([A-Z][^'\n]{2,})'/g)].map((m) => m[1]).concat([...jsText.matchAll(/`([A-Z][^`\n]*)`/g)].map((m) => m[1].replace(/\$\{[^}]*\}/g, ' '))).join(' . ');
const siteSegs = segments(visibleText(html) + '\n' + jsStrings.split(' . ').join('\n'));
const siteTokens = siteSegs.flat();
const PAIR_OK = new Set(['robinhood chain']);
gate('copy: zero shared 2-grams with the reference page', () => { const shared = []; for (const s of siteSegs) for (let i = 0; i < s.length - 1; i++) { const p = s[i] + ' ' + s[i + 1]; if (!PAIR_OK.has(p) && fp.pairs.includes(h12(p))) shared.push(p); } must(!shared.length, 'shared: ' + [...new Set(shared)].join(', ')); });
gate('copy: zero shared content words with the reference page (function words and brand names excluded)', () => { const shared = [...new Set(siteTokens.filter((w) => !STOP.has(w) && !BRAND_OK.has(w) && fp.words.includes(h12(w)) && w.length > 1))]; must(!shared.length, 'shared words: ' + shared.join(', ')); });

// --- repo hygiene ---
const repoFiles = walk(root).filter((f) => !/node_modules|\.gate-tmp|[\\/]brand[\\/]|[\\/]reference[\\/]|package-lock\.json/.test(f));
gate('no CLAUDE.md and no .claude directory anywhere in the repo', () => { const hit = walk(root).filter((f) => !/node_modules/.test(f) && (/(^|[\\/])CLAUDE\.md$/i.test(f) || /[\\/]\.claude[\\/]/.test(f))); must(!hit.length, hit.join(',')); });
gate('no AI attribution or tool names in any repo text file', () => {
  const rx = /claude|anthropic|co-authored-by|generated (?:by|with)|chatgpt|openai|\bllm\b/i; const hit = [];
  for (const f of repoFiles) { if (/\.(png|webp|jpe?g|jpeg|ico)$/i.test(f) || rel(f) === 'scripts/gates.mjs') continue; if (rx.test(fs.readFileSync(f, 'utf8'))) hit.push(rel(f)); }
  must(!hit.length, hit.join(','));
});
gate('README.md, docs/whitepaper.md and LICENSE exist at the root and none is inside dist/', () => {
  for (const f of ['README.md', 'docs/whitepaper.md', 'LICENSE']) must(fs.existsSync(path.join(root, f)), 'missing ' + f);
  for (const f of distFiles) must(!/README|LICENSE|whitepaper|[\\/]docs[\\/]|[\\/]brand[\\/]|[\\/]reference[\\/]|scripts/i.test(rel(f)), 'repo file leaked into dist: ' + rel(f));
});
gate('LICENSE is MIT with copyright Nuovora, 2026', () => { const l = read('LICENSE'); must(/MIT License/.test(l) && /Nuovora, 2026/.test(l), 'license text'); });
gate('README content: tagline, site badge, Robinhood chain, CA placeholder, Overview, Features, Links', () => { const r = read('README.md'); must(/^# Nuovora/m.test(r) && /img\.shields\.io/.test(r) && /nuovora\.fun/.test(r) && /Robinhood/.test(r) && /Contract/i.test(r) && /^## Overview/m.test(r) && /^## Features/m.test(r) && /^## Links/m.test(r), 'readme incomplete'); });
gate('whitepaper content: vision, mission, tokenomics placeholders, 3-4 phases, team placeholder', () => { const w = read('docs/whitepaper.md'); const phases = (w.match(/^### Phase \d/gm) || []).length; must(/Vision/i.test(w) && /Mission/i.test(w) && /Tokenomics/i.test(w) && /placeholder/i.test(w) && phases >= 3 && phases <= 4 && /Team/i.test(w), 'whitepaper incomplete, phases=' + phases); });
gate('repo docs never use the word AI', () => { for (const f of ['README.md', 'docs/whitepaper.md', 'LICENSE']) must(!/\bAI\b/.test(read(f)), f + ' mentions AI'); });
gate('script syntax: every dist module parses', () => { for (const f of jsFiles) execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); return { detail: jsFiles.length + ' modules' }; });
gate('document basics: lang, viewport, title, alt on every image', () => { must(/<html lang="en"/.test(html) && /name="viewport"/.test(html) && /<title>Nuovora<\/title>/.test(html), 'head'); for (const m of html.matchAll(/<img\b[^>]*>/g)) must(/\balt=/.test(m[0]), 'img without alt'); });

// ----------------------------------------------------------------------------------
fs.rmSync(tmpRoot, { recursive: true, force: true });
let failed = 0;
results.forEach((r, i) => { if (!r.ok) failed++; console.log(`${String(i + 1).padStart(2, '0')} ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  [' + r.detail + ']' : ''}`); });
console.log(`\ngates: ${results.length} run, ${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
