// Palette sampler: k-means over real pixels, each centroid snapped to the nearest real pixel (x,y reported).
// Usage: node scripts/palette.mjs   (prints JSON; tokens.css is written from this output by hand with provenance)
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const hex = (p) => '#' + p.slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join('');
const lum = ([r, g, b]) => {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

async function load(file, size) {
  const { data, info } = await sharp(file).resize(size, size, { fit: 'fill' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const px = [];
  for (let i = 0; i < data.length; i += 4) {
    const n = i / 4;
    px.push({ c: [data[i], data[i + 1], data[i + 2]], a: data[i + 3], x: n % info.width, y: Math.floor(n / info.width) });
  }
  return { px, w: info.width, h: info.height };
}

function kmeans(pts, k, iters = 30) {
  let cs = Array.from({ length: k }, (_, i) => pts[Math.floor((i + 0.5) * pts.length / k)].c.slice());
  let owner = new Array(pts.length).fill(0);
  for (let it = 0; it < iters; it++) {
    const sum = cs.map(() => [0, 0, 0, 0]);
    pts.forEach((p, n) => {
      let bi = 0, bd = Infinity;
      cs.forEach((q, i) => { const d = (p.c[0] - q[0]) ** 2 + (p.c[1] - q[1]) ** 2 + (p.c[2] - q[2]) ** 2; if (d < bd) { bd = d; bi = i; } });
      owner[n] = bi; sum[bi][0] += p.c[0]; sum[bi][1] += p.c[1]; sum[bi][2] += p.c[2]; sum[bi][3]++;
    });
    cs = cs.map((q, i) => (sum[i][3] ? [sum[i][0] / sum[i][3], sum[i][1] / sum[i][3], sum[i][2] / sum[i][3]] : q));
  }
  return cs.map((q, i) => {
    let bd = Infinity, bp = null;
    for (const p of pts) { const d = (p.c[0] - q[0]) ** 2 + (p.c[1] - q[1]) ** 2 + (p.c[2] - q[2]) ** 2; if (d < bd) { bd = d; bp = p; } }
    return { hex: hex(bp.c), x: bp.x, y: bp.y, share: owner.filter((o) => o === i).length / pts.length };
  }).sort((a, b) => b.share - a.share);
}

const out = {};
const S = 400;
const logoT = await load('brand/LOGO NUOVORA PNG...png', S);
out.logoTransparent_opaquePixels = kmeans(logoT.px.filter((p) => p.a > 250).map((p) => p), 8);
const darkest = logoT.px.filter((p) => p.a > 250).sort((a, b) => lum(a.c) - lum(b.c)).slice(0, 1)[0];
out.darkestOpaque = { hex: hex(darkest.c), x: darkest.x, y: darkest.y, contrastOnWhite: contrast(darkest.c, [255, 255, 255]) };

const bg = await load('brand/LOGO NUOVORA JPG.jpg.jpeg', S);
const at = (x, y) => bg.px[y * S + x];
out.backdropSamples = {};
for (const [name, [x, y]] of Object.entries({ topLeft: [10, 10], topMid: [200, 20], upperMid: [200, 100], horizon: [60, 262], lowerLeft: [60, 380], lowerRight: [390, 390], lowerMid: [200, 360] })) {
  const p = at(x, y); out.backdropSamples[name] = { hex: hex(p.c), x, y };
}

// text-ink candidates: darkest real pixels from the banner wordmark and the slide artwork
for (const f of ['reference/SAMPUL NUOVORA JPG.jpg.jpeg', 'reference/NUOVORA 1.jpg.jpeg']) {
  const m = await sharp(f).metadata();
  const { data, info } = await sharp(f).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const px = [];
  for (let i = 0; i < data.length; i += 4) { const n = i / 4; const c = [data[i], data[i + 1], data[i + 2]]; if (Math.max(...c) - Math.min(...c) > 60) px.push({ c, a: 255, x: n % info.width, y: Math.floor(n / info.width) }); }
  const sub = px.filter((_, i) => i % 7 === 0);
  out[path.basename(f)] = { size: [m.width, m.height], saturatedKmeans: kmeans(sub, 6), darkest: (() => { const d = sub.sort((a, b) => lum(a.c) - lum(b.c))[0]; return { hex: hex(d.c), x: d.x, y: d.y, contrastOnWhite: contrast(d.c, [255, 255, 255]) }; })() };
}
for (const f of fs.readdirSync('reference').filter((n) => /NUOVORA [2-6]/.test(n))) {
  const { data } = await sharp('reference/' + f).raw().toBuffer({ resolveWithObject: true });
  out[f] = { note: 'same slide template as NUOVORA 1; read for layout/copy only' };
}
console.log(JSON.stringify(out, null, 1));
