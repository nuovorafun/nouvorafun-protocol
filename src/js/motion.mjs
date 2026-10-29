// Motion layer: damped-spring reveals, parallax, spotlight, scroll progress, count-up.
// Every effect checks `reduced` first and falls back to the final state with no movement.

export const reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
export const isReduced = () => reducedQuery.matches;

// Damped harmonic oscillator, semi-implicit Euler at a fixed 1/120 s step.
export function spring({ from = 0, to = 1, stiffness = 170, damping = 22, mass = 1, onUpdate, onDone }) {
  let x = from;
  let v = 0;
  let last = performance.now();
  let acc = 0;
  let raf = 0;
  const dt = 1 / 120;
  const frame = (t) => {
    acc += Math.min(0.05, (t - last) / 1000);
    last = t;
    while (acc >= dt) {
      const a = (-stiffness * (x - to) - damping * v) / mass;
      v += a * dt;
      x += v * dt;
      acc -= dt;
    }
    if (Math.abs(x - to) < 0.0008 && Math.abs(v) < 0.0008) {
      onUpdate(to);
      if (onDone) onDone();
      return;
    }
    onUpdate(x);
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}

function revealOne(el, delay) {
  if (el.classList.contains('in')) return;
  const finish = () => { el.style.opacity = ''; el.style.transform = ''; el.style.animation = ''; el.classList.add('in'); };
  if (isReduced()) { finish(); return; }
  el.style.animation = 'none';
  el.style.opacity = '0';
  el.style.transform = 'translateY(32px) scale(0.985)';
  setTimeout(() => {
    spring({
      from: 0, to: 1,
      onUpdate: (p) => {
        el.style.opacity = String(Math.min(1, Math.max(0, p)));
        el.style.transform = `translateY(${(1 - p) * 32}px) scale(${0.985 + 0.015 * p})`;
      },
      onDone: finish,
    });
  }, delay);
}

export function initReveal() {
  const targets = [];
  document.querySelectorAll('[data-reveal]').forEach((el) => targets.push({ el, kids: null }));
  document.querySelectorAll('[data-reveal-group]').forEach((el) => targets.push({ el, kids: Array.from(el.children) }));
  if (isReduced() || !('IntersectionObserver' in window)) {
    targets.forEach(({ el, kids }) => { el.classList.add('in'); if (kids) kids.forEach((k) => k.classList.add('in')); });
    return;
  }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      const t = targets.find((x) => x.el === e.target);
      if (t.kids) {
        t.el.classList.add('in');
        t.kids.forEach((k, i) => { k.classList.add('rv'); revealGroupChild(k, i * 70); });
      } else {
        revealOne(t.el, 0);
      }
    }
  }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
  targets.forEach(({ el }) => io.observe(el));
}

function revealGroupChild(el, delay) {
  if (isReduced()) { el.style.opacity = ''; el.style.transform = ''; el.style.animation = ''; return; }
  const finish = () => { el.style.opacity = ''; el.style.transform = ''; el.style.animation = ''; };
  el.style.animation = 'none';
  el.style.opacity = '0';
  el.style.transform = 'translateY(32px) scale(0.985)';
  setTimeout(() => spring({
    from: 0, to: 1,
    onUpdate: (p) => {
      el.style.opacity = String(Math.min(1, Math.max(0, p)));
      el.style.transform = `translateY(${(1 - p) * 32}px) scale(${0.985 + 0.015 * p})`;
    },
    onDone: finish,
  }), delay);
}

export function initProgress() {
  const bar = document.getElementById('progress-bar');
  if (!bar) return;
  let ticking = false;
  const paint = () => {
    const h = document.documentElement;
    const max = Math.max(1, h.scrollHeight - h.clientHeight);
    bar.style.transform = `scaleX(${Math.min(1, window.scrollY / max)})`;
    ticking = false;
  };
  addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(paint); } }, { passive: true });
  addEventListener('resize', paint);
  paint();
}

export function initSpotlight() {
  addEventListener('pointermove', (e) => {
    const el = e.target.closest && e.target.closest('[data-spot]');
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${e.clientX - r.left}px`);
    el.style.setProperty('--my', `${e.clientY - r.top}px`);
  }, { passive: true });
}

export function initParallax() {
  const hero = document.getElementById('hero');
  const layers = Array.from(document.querySelectorAll('.layer[data-depth]'));
  if (!hero || !layers.length || isReduced()) return;
  let tx = 0, ty = 0, cx = 0, cy = 0, sy = 0, raf = 0;
  const loop = () => {
    cx += (tx - cx) * 0.08;
    cy += (ty - cy) * 0.08;
    for (const l of layers) {
      const d = parseFloat(l.dataset.depth);
      l.style.transform = `translate3d(${cx * d * 18}px, ${cy * d * 14 + sy * d * -0.08}px, 0)`;
    }
    raf = requestAnimationFrame(loop);
  };
  hero.addEventListener('pointermove', (e) => {
    const r = hero.getBoundingClientRect();
    tx = (e.clientX - r.left) / r.width - 0.5;
    ty = (e.clientY - r.top) / r.height - 0.5;
  }, { passive: true });
  hero.addEventListener('pointerleave', () => { tx = 0; ty = 0; });
  addEventListener('scroll', () => { sy = Math.min(window.scrollY, 900); }, { passive: true });
  const vis = new IntersectionObserver(([e]) => {
    cancelAnimationFrame(raf);
    if (e.isIntersecting) raf = requestAnimationFrame(loop);
  });
  vis.observe(hero);
}

// Count a numeric text node toward `to`. `fmt` renders the number; reduced motion jumps straight there.
export function countTo(el, from, to, fmt, ms = 900) {
  if (isReduced() || from === to || from === null || from === undefined) { el.textContent = fmt(to); return; }
  const t0 = performance.now();
  const step = (t) => {
    const p = Math.min(1, (t - t0) / ms);
    const e = p === 1 ? 1 : 1 - 2 ** (-10 * p);
    el.textContent = fmt(from + (to - from) * e);
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
