export const tokens = (s) => s.toLowerCase().replace(/[’']/g, '').split(/[^a-z0-9]+/).filter(Boolean);

// Phrase-sized segments, so word pairs never straddle two separate elements or two sentences.
export const segments = (s) => s.split(/[\n.!?:;|]+/).map((x) => tokens(x)).filter((x) => x.length);

// Visible text of built HTML: no scripts, styles or markup, but attribute text (aria-label, alt, title, content) included.
// Each element boundary becomes a line break.
export function visibleText(html) {
  const body = html.slice(html.indexOf('<body'))
    .replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ');
  const head = html.slice(0, html.indexOf('<body'));
  const attrs = [...(head + body).matchAll(/\s(?:aria-label|alt|title|placeholder|content)="([^"]*)"/g)].map((m) => m[1]);
  const text = body.replace(/<svg[\s\S]*?<\/svg>/g, ' ').replace(/<[^>]+>/g, '\n');
  return decode(text + '\n' + attrs.join('\n'));
}
const decode = (s) => s.replace(/&nbsp;/g, ' ').replace(/&mdash;/g, '—').replace(/&middot;/g, '·').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
