// Builds scripts/ref-fingerprint.json: SHA-1 hashes of the words and word pairs found in a saved copy of the
// reference landing page. Only hashes are stored, never the reference copy itself.
// Usage: node scripts/ref-fingerprint.mjs <saved-reference.html>
import fs from 'node:fs';
import crypto from 'node:crypto';
import { segments } from './text.mjs';

const html = fs.readFileSync(process.argv[2], 'utf8');
const body = html.slice(html.indexOf('<body'))
  .replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ')
  .replace(/<svg[\s\S]*?<\/svg>/g, ' ');
const text = body.replace(/<[^>]+>/g, '\n').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/&[a-z]+;/g, ' ');
const segs = segments(text);
const h = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);
const words = new Set(segs.flat().map(h));
const pairs = new Set();
for (const t of segs) for (let i = 0; i < t.length - 1; i++) pairs.add(h(t[i] + ' ' + t[i + 1]));
fs.writeFileSync(new URL('./ref-fingerprint.json', import.meta.url), JSON.stringify({ words: [...words], pairs: [...pairs] }));
console.log('segments', segs.length, 'unique words', words.size, 'pairs', pairs.size);
