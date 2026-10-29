// Shared by build and gates: register validation and the public projection.
export const STATES = ['stated', 'absent', 'unconfirmed'];
export const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
export const DATE_KEYS = ['recordedOn', 'checkedOn'];
const VALUE_KEY = /^(value|url|.*Url)$/;

export const isStated = (r) => !!r && r.state === 'stated';

export function validateRegister(reg) {
  const errors = [];
  const recs = (reg && reg.records) || {};
  for (const [id, r] of Object.entries(recs)) {
    if (!STATES.includes(r.state)) errors.push(`${id}: invalid state "${r.state}"`);
    if (r.state !== 'stated') {
      for (const k of Object.keys(r)) if (VALUE_KEY.test(k)) errors.push(`${id}: inert record carries "${k}"`);
    } else if (['x', 'github', 'site'].includes(id)) {
      try { const u = new URL(r.url); if (u.protocol !== 'https:') throw new Error('scheme'); } catch { errors.push(`${id}: stated record needs an https url`); }
    }
    if (id === 'ca' && r.state === 'stated' && !ADDRESS.test(String(r.value))) errors.push('ca: stated value is not an address');
  }
  for (const id of ['site', 'chain', 'ca', 'x', 'github', 'market']) if (!recs[id]) errors.push(`missing record ${id}`);
  return errors;
}

// What ships to the browser: same records minus the date fields, which stay in register.json as data only.
export function publicRegister(reg) {
  const out = { records: {} };
  for (const [id, r] of Object.entries(reg.records)) {
    const c = { ...r };
    for (const k of DATE_KEYS) delete c[k];
    out.records[id] = c;
  }
  return out;
}

export const handleFromUrl = (url) => {
  const seg = new URL(url).pathname.split('/').filter(Boolean)[0];
  return seg ? '@' + seg : '';
};
