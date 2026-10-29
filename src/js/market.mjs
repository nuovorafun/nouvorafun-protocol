// Market view: ticker, stat tiles and the ranked board. Driven only by the `market` register record.
import { createMarketController, fmtChange, fmtPrice, fmtVolume, TOP_N } from './market-core.mjs';
import { countTo, isReduced } from './motion.mjs';
import { copyText } from './copy.mjs';

const COPY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="3"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>';
const CHECK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l4 4 10-10"/></svg>';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html !== undefined) n.innerHTML = html; return n; };
const dir = (c) => (c === null || c === undefined ? 'flat' : c > 0.004 ? 'up' : c < -0.004 ? 'down' : 'flat');
const arrow = { up: '▲ ', down: '▼ ', flat: '' };
const LABEL = { loading: 'Connecting', live: 'Streaming', stale: 'Reconnecting', error: 'Offline' };
const FEED = { loading: 'Connecting', live: 'Streaming', stale: 'Retrying', error: 'Down' };

function tile(row) {
  const t = el('span', 't-tile');
  t.append(document.createTextNode(row.symbol.slice(0, 1)));
  if (row.logo) {
    const img = el('img');
    img.alt = '';
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    img.onload = () => img.classList.add('ok');
    img.onerror = () => img.remove();
    img.src = row.logo;
    t.append(img);
  }
  return t;
}

function skeletonRow() {
  const li = el('li', 'row skel');
  li.innerHTML = '<span class="c-asset"><i class="sk round"></i><i class="sk w1"></i></span><span class="c-price"><i class="sk w2"></i></span><span class="c-chg"><i class="sk w3"></i></span><span class="c-vol"><i class="sk w4"></i></span><span class="c-copy"></span>';
  return li;
}

function realRow(r, i, animate) {
  const li = el('li', 'row' + (animate ? ' enter' : ''));
  li.dataset.symbol = r.symbol;
  li.setAttribute('data-spot', '');
  if (animate && !isReduced()) li.style.animationDelay = `${i * 55}ms`;
  const asset = el('span', 'c-asset');
  asset.append(tile(r));
  const nm = el('span', 't-name');
  nm.append(el('b', '', ''), el('span', ''));
  nm.firstChild.textContent = r.symbol;
  nm.lastChild.textContent = r.name;
  asset.append(nm);
  const price = el('span', 'c-price num');
  const chg = el('span', 'c-chg');
  const chgPill = el('span', 'chg num');
  chg.append(chgPill);
  const vol = el('span', 'c-vol num');
  const copy = el('span', 'c-copy');
  const btn = el('button', 'copy-sym', COPY_ICON);
  btn.type = 'button';
  btn.setAttribute('aria-label', `Copy ${r.symbol}`);
  btn.addEventListener('click', async () => {
    const ok = await copyText(r.symbol);
    if (!ok) return;
    btn.classList.add('done');
    btn.innerHTML = CHECK_ICON;
    btn.setAttribute('aria-label', `${r.symbol} placed on clipboard`);
    setTimeout(() => { btn.classList.remove('done'); btn.innerHTML = COPY_ICON; btn.setAttribute('aria-label', `Copy ${r.symbol}`); }, 1400);
  });
  copy.append(btn);
  li.append(asset, price, chg, vol, copy);
  li._refs = { price, chgPill, vol, nm, asset, last: { price: null, change: null, volumeUsd: null, name: r.name, logo: r.logo } };
  return li;
}

function paintRow(li, r, first) {
  const { price, chgPill, vol, nm, last } = li._refs;
  const d = dir(r.change);
  chgPill.className = `chg num ${d}`;
  const chgNum = r.change;
  if (first) {
    price.textContent = fmtPrice(r.price);
    chgPill.textContent = arrow[d] + fmtChange(chgNum);
    vol.textContent = fmtVolume(r.volumeUsd);
  } else {
    if (last.price !== r.price) {
      countTo(price, last.price, r.price, fmtPrice, 700);
      const flash = r.price > last.price ? 'flash-up' : 'flash-down';
      li.classList.remove('flash-up', 'flash-down');
      void li.offsetWidth;
      if (!isReduced()) li.classList.add(flash);
    }
    if (last.change !== r.change) countTo(chgPill, last.change, r.change, (v) => arrow[d] + fmtChange(v), 700);
    if (last.volumeUsd !== r.volumeUsd) countTo(vol, last.volumeUsd, r.volumeUsd, fmtVolume, 700);
  }
  nm.lastChild.textContent = r.name;
  Object.assign(last, { price: r.price, change: r.change, volumeUsd: r.volumeUsd, name: r.name });
  li.setAttribute('aria-label', `${r.symbol} ${fmtPrice(r.price)} ${fmtChange(r.change)} volume ${fmtVolume(r.volumeUsd)}`);
}

function tkItem(r, dup) {
  const a = el('span', 'tk' + (dup ? ' dup' : ''));
  if (dup) a.setAttribute('aria-hidden', 'true');
  const d = dir(r.change);
  a.append(tile(r), el('b', ''), el('span', 'num'), el('span', `tk-chg num ${d}`));
  a.children[1].textContent = r.symbol;
  a.children[2].textContent = fmtPrice(r.price);
  a.children[3].textContent = arrow[d] + fmtChange(r.change);
  return a;
}

export function initMarket(record) {
  const rowsEl = $('rows');
  const track = $('ticker-track');
  const note = $('board-note');
  const pill = $('status-pill');
  const pillText = $('status-text');
  const tiles = { count: $('t-count'), lead: $('t-lead'), vol: $('t-vol'), feed: $('t-feed') };
  let hasData = false;
  const nodes = new Map();
  let volShown = null;

  const showSkeleton = () => {
    rowsEl.replaceChildren(...Array.from({ length: TOP_N }, skeletonRow));
    track.replaceChildren(...Array.from({ length: 8 }, () => el('span', 'tk skel-tk', '<i class="sk w1" style="width:100%"></i>')));
  };
  showSkeleton();

  function setStatus(status) {
    pill.dataset.state = status;
    pillText.textContent = LABEL[status];
    tiles.feed.textContent = FEED[status];
  }

  function render({ status, rows, error }) {
    setStatus(status);
    rowsEl.setAttribute('aria-busy', status === 'loading' ? 'true' : 'false');
    if (!rows.length) {
      if (status === 'error') {
        rowsEl.replaceChildren();
        for (let i = 0; i < 3; i++) {
          const li = el('li', 'row');
          li.innerHTML = '<span class="c-asset"><span class="t-tile">—</span><span class="t-name"><b>—</b><span>No data</span></span></span><span class="c-price">—</span><span class="c-chg"><span class="chg flat">—</span></span><span class="c-vol">—</span><span class="c-copy"></span>';
          rowsEl.append(li);
        }
        track.replaceChildren(el('span', 'tk', '<b>—</b>'));
        tiles.count.textContent = '—';
        tiles.lead.textContent = '—';
        tiles.vol.textContent = '—';
        note.textContent = 'Market feed unavailable. Retries are spaced further apart each time.';
        nodes.clear();
        hasData = false;
      }
      return;
    }
    note.textContent = status === 'stale' ? 'Refresh failed. Holding the previous reading while retrying.' : '';
    if (!hasData) {
      rowsEl.replaceChildren();
      nodes.clear();
    }
    const first = !hasData;
    const seen = new Set();
    rows.forEach((r, i) => {
      seen.add(r.symbol);
      let li = nodes.get(r.symbol);
      let fresh = false;
      if (!li) { li = realRow(r, i, first); nodes.set(r.symbol, li); fresh = true; }
      paintRow(li, r, fresh);
      rowsEl.append(li);
    });
    for (const [k, li] of nodes) if (!seen.has(k)) { li.remove(); nodes.delete(k); }

    track.replaceChildren(...rows.map((r) => tkItem(r, false)), ...rows.map((r) => tkItem(r, true)));

    const total = rows.reduce((s, r) => s + (r.volumeUsd || 0), 0);
    tiles.count.textContent = String(rows.length);
    tiles.lead.textContent = rows[0].symbol;
    countTo(tiles.vol, volShown, total, fmtVolume, 900);
    volShown = total;
    hasData = true;
  }

  if (!record || record.state !== 'stated') {
    pill.dataset.state = 'error';
    pillText.textContent = 'Pending';
    rowsEl.replaceChildren();
    note.textContent = 'Market source pending.';
    return null;
  }

  const ctl = createMarketController({
    source: record,
    fetchFn: (u, o) => fetch(u, o),
    onState: render,
  });
  setStatus('loading');
  ctl.start();
  document.addEventListener('visibilitychange', () => ctl.setVisible(document.visibilityState === 'visible'));
  return ctl;
}
