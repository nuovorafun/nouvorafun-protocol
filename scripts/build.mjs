// Static build. Output is dist/, the folder that gets deployed. Zero runtime dependencies.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADDRESS, handleFromUrl, isStated, publicRegister, validateRegister } from './lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The logo and icons are copied by explicit name so a missing file fails the build instead of shipping a broken page.
export const REQUIRED_ASSETS = ['assets/nuovora-logo.png', 'assets/nuovora-logo-hero.webp', 'assets/apple-touch-icon.png', 'favicon.svg'];

const X_PATH = 'M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z';
const GH_PATH = 'M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z';
const ICONS = {
  x: `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${X_PATH}"/></svg>`,
  github: `<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path fill-rule="evenodd" d="${GH_PATH}"/></svg>`,
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function social(id, rec, name) {
  if (isStated(rec)) {
    return `<a class="icon-btn" href="${esc(rec.url)}" target="_blank" rel="noopener noreferrer" aria-label="${name} (${esc(handleFromUrl(rec.url))})" data-social="${id}">${ICONS[id]}</a>`;
  }
  return `<span class="icon-btn is-inert" role="img" aria-disabled="true" aria-label="${name}, pending" data-social="${id}">${ICONS[id]}</span>`;
}

function caSlot(rec) {
  if (isStated(rec)) {
    return `<div class="ca" id="ca-slot" data-state="stated"><span class="ca-label">Contract</span><button class="ca-body" id="ca-body" type="button" aria-label="Copy contract address"><span class="ca-addr mono">${esc(rec.value)}</span></button><button class="ca-copy" id="ca-copy" type="button">Copy</button><span class="sr" id="ca-live" aria-live="polite"></span></div>`;
  }
  return `<div class="ca is-inert" id="ca-slot" data-state="inert"><span class="ca-label">Contract</span><div class="ca-body" id="ca-body"><span class="ca-pending">Pending</span></div><button class="ca-copy" id="ca-copy" type="button" disabled aria-disabled="true">Copy</button></div>`;
}

const stateChip = (rec, on, off) => (isStated(rec) ? `<span class="state-chip is-on">${on}</span>` : `<span class="state-chip">${off}</span>`);

function linkChip(label, rec, id) {
  if (isStated(rec) && rec.url) {
    return `<a class="reg-chip" href="${esc(rec.url)}" target="_blank" rel="noopener noreferrer" data-reg="${id}"><span>${label}</span><span class="state-chip is-on">${esc(handleFromUrl(rec.url) || new URL(rec.url).host)}</span></a>`;
  }
  if (isStated(rec)) return `<span class="reg-chip" data-reg="${id}"><span>${label}</span><span class="state-chip is-on">Listed</span></span>`;
  return `<span class="reg-chip is-inert" data-reg="${id}"><span>${label}</span><span class="state-chip">Pending</span></span>`;
}

export function render(template, reg) {
  const r = reg.records;
  const chain = isStated(r.chain) ? esc(r.chain.value) : 'Chain pending';
  const site = isStated(r.site) ? `<a href="${esc(r.site.url)}">${esc(r.site.value)}</a>` : '<span class="state-chip">Pending</span>';
  const map = {
    CHAIN_NAME: chain,
    SOCIAL: social('x', r.x, 'X') + social('github', r.github, 'GitHub'),
    CA_SLOT: caSlot(r.ca),
    CA_CHIP: stateChip(r.ca, 'Listed above', 'Pending'),
    SITE_ROW: site,
    LINK_CHIPS: linkChip('Contract', r.ca, 'ca') + linkChip('X', r.x, 'x') + linkChip('GitHub', r.github, 'github') + linkChip('Home', r.site, 'site'),
    REGISTER_JSON: JSON.stringify(publicRegister(reg)).replace(/</g, '\\u003c'),
  };
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (_, k) => {
    if (!(k in map)) throw new Error(`unknown placeholder ${k}`);
    return map[k];
  });
}

export function build({ registerPath = path.join(root, 'src/data/register.json'), outDir = path.join(root, 'dist'), srcDir = path.join(root, 'src') } = {}) {
  const reg = JSON.parse(fs.readFileSync(registerPath, 'utf8'));
  const errors = validateRegister(reg);
  if (errors.length) throw new Error('register invalid: ' + errors.join('; '));
  if (isStated(reg.records.ca) && !ADDRESS.test(reg.records.ca.value)) throw new Error('ca value is not address-shaped');

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  for (const dir of ['css', 'js']) fs.cpSync(path.join(srcDir, dir), path.join(outDir, dir), { recursive: true });
  for (const rel of REQUIRED_ASSETS) {
    const from = path.join(srcDir, rel);
    if (!fs.existsSync(from)) throw new Error(`required asset missing: ${rel}`);
    fs.mkdirSync(path.dirname(path.join(outDir, rel)), { recursive: true });
    fs.copyFileSync(from, path.join(outDir, rel));
  }
  const html = render(fs.readFileSync(path.join(srcDir, 'index.html'), 'utf8'), reg);
  fs.writeFileSync(path.join(outDir, 'index.html'), html);
  fs.writeFileSync(path.join(outDir, '_headers'), '/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n');
  return { outDir, files: REQUIRED_ASSETS };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const res = build();
  console.log('built', path.relative(root, res.outDir) + '/', 'with', res.files.join(', '));
}
