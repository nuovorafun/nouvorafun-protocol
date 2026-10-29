// One-off asset prep. Source: brand/LOGO NUOVORA PNG...png (RGBA, colourtype 6, 3,563,271 pure-black fully
// transparent px). Resizes are premultiplied so the black RGB under alpha 0 cannot bleed into edges.
import sharp from 'sharp';
import fs from 'node:fs';

const SRC = 'brand/LOGO NUOVORA PNG...png';
const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
let x0 = info.width, y0 = info.height, x1 = 0, y1 = 0;
for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
  if (data[(y * info.width + x) * 4 + 3] > 8) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
}
const pad = 24;
const left = Math.max(0, x0 - pad), top = Math.max(0, y0 - pad);
const w = Math.min(info.width - left, x1 - x0 + 1 + pad * 2), h = Math.min(info.height - top, y1 - y0 + 1 + pad * 2);
console.log('alpha bbox', { x0, y0, x1, y1 }, 'crop', { left, top, w, h });

const cropRaw = await sharp(SRC).ensureAlpha().extract({ left, top, width: w, height: h }).raw().toBuffer();
for (let i = 0; i < cropRaw.length; i += 4) { const a = cropRaw[i + 3] / 255; cropRaw[i] = Math.round(cropRaw[i] * a); cropRaw[i + 1] = Math.round(cropRaw[i + 1] * a); cropRaw[i + 2] = Math.round(cropRaw[i + 2] * a); }
const pm = (width, height) => sharp(cropRaw, { raw: { width: w, height: h, channels: 4, premultiplied: true } })
  .resize(width, height, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel: 'lanczos3' });

await pm(512, Math.round(512 * h / w)).png({ compressionLevel: 9 }).toFile('src/assets/nuovora-logo.png');
await pm(1024, Math.round(1024 * h / w)).webp({ quality: 90, alphaQuality: 100 }).toFile('src/assets/nuovora-logo-hero.webp');
await pm(180, 180).png().toFile('src/assets/apple-touch-icon.png');

// favicon: 32x32 grid sampled straight from the cropped logo pixels, snapped to real logo-palette pixels
const GRID = 32;
const sq = await pm(GRID, GRID).raw().toBuffer({ resolveWithObject: true });
const palette = ['#76bfed', '#66b6e9', '#56ace2', '#3796d2', '#46a2db', '#8bcaf2', '#a8d9f8', '#dcf3fd'].map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));
const names = ['#76bfed', '#66b6e9', '#56ace2', '#3796d2', '#46a2db', '#8bcaf2', '#a8d9f8', '#dcf3fd'];
const cell = [];
for (let y = 0; y < GRID; y++) {
  cell.push([]);
  for (let x = 0; x < GRID; x++) {
    const i = (y * GRID + x) * 4;
    if (sq.data[i + 3] < 128) { cell[y].push(null); continue; }
    let bi = 0, bd = Infinity;
    palette.forEach((p, k) => { const d = (p[0] - sq.data[i]) ** 2 + (p[1] - sq.data[i + 1]) ** 2 + (p[2] - sq.data[i + 2]) ** 2; if (d < bd) { bd = d; bi = k; } });
    cell[y].push(names[bi]);
  }
}
const rects = [];
for (let y = 0; y < GRID; y++) {
  let x = 0;
  while (x < GRID) {
    const c = cell[y][x];
    if (!c) { x++; continue; }
    let e = x; while (e + 1 < GRID && cell[y][e + 1] === c) e++;
    rects.push(`<rect x="${x}" y="${y}" width="${e - x + 1}" height="1" fill="${c}"/>`);
    x = e + 1;
  }
}
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" shape-rendering="crispEdges">${rects.join('')}</svg>\n`;
fs.writeFileSync('src/favicon.svg', svg);
console.log('favicon rects', rects.length, 'bytes', svg.length, 'has -- :', svg.includes('--'));
