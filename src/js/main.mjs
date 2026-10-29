import { initMarket } from './market.mjs';
import { initParallax, initProgress, initReveal, initSpotlight, isReduced } from './motion.mjs';
import { copyText } from './copy.mjs';

const register = JSON.parse(document.getElementById('register').textContent);
const rec = (id) => register.records[id];

initProgress();
initSpotlight();
initParallax();
initReveal();
initMarket(rec('market'));

// CA slot: click-to-copy with feedback. Inert (no button wired) until the record is stated.
const ca = rec('ca');
const caBtn = document.getElementById('ca-copy');
const caBody = document.getElementById('ca-body');
if (ca && ca.state === 'stated' && caBtn && caBody) {
  const label = caBtn.textContent;
  const live = document.getElementById('ca-live');
  const run = async () => {
    const ok = await copyText(ca.value);
    if (!ok) return;
    caBtn.classList.add('done');
    caBtn.textContent = 'Placed';
    if (live) live.textContent = 'Address placed on clipboard';
    setTimeout(() => { caBtn.classList.remove('done'); caBtn.textContent = label; if (live) live.textContent = ''; }, 1600);
  };
  caBtn.addEventListener('click', run);
  caBody.addEventListener('click', run);
}

// Tabs with roving focus and a sliding ink.
const tablist = document.querySelector('.tablist');
if (tablist) {
  const tabs = Array.from(tablist.querySelectorAll('[role="tab"]'));
  const place = () => {
    const on = tabs.find((t) => t.getAttribute('aria-selected') === 'true');
    if (!on) return;
    tablist.style.setProperty('--ink-x', `${on.offsetLeft}px`);
    tablist.style.setProperty('--ink-w', `${on.offsetWidth}px`);
  };
  const select = (tab, focus) => {
    tabs.forEach((t) => {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      const panel = document.getElementById(t.getAttribute('aria-controls'));
      panel.hidden = !on;
      panel.classList.toggle('is-on', on);
    });
    if (focus) tab.focus();
    place();
  };
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => select(t, false));
    t.addEventListener('keydown', (e) => {
      const k = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (k) { e.preventDefault(); select(tabs[(i + k + tabs.length) % tabs.length], true); }
      if (e.key === 'Home') { e.preventDefault(); select(tabs[0], true); }
      if (e.key === 'End') { e.preventDefault(); select(tabs[tabs.length - 1], true); }
    });
  });
  addEventListener('resize', place);
  requestAnimationFrame(place);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(place);
}

if (isReduced()) document.documentElement.classList.add('reduced');
