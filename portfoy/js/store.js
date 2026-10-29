// Kişisel veriler yalnızca bu cihazda (localStorage) tutulur; sunucuya/GitHub'a gitmez.
const KEY = 'portfoy.v1';

export const DEFAULT = {
  v: 1,
  funds: [],            // { code, name?, tax?, txs: [{ id, date, type:'buy'|'sell', qty, price, fee? }] }
  manual: {},           // { SERI_ID: { 'YYYY-MM-DD': değer } } — el ile fiyat/kur
  snapshots: {},        // { 'YYYY-MM-DD': { value, cost, gross, net, usd, prices:{} } }
  others: { assets: [], vals: [] }, // assets: {id,name,cat}; vals: {date, usd, values:{id:tutar}}
  settings: { tax: 0.175, deposit: 0.40, ccy: 'TRY', compare: ['USD', 'ALTIN', 'XU100'], olcerHedef: 0.5 },
  scenario: null,
};

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch { /* bozuk veri */ }
  return structuredClone(DEFAULT);
}

export function normalize(s) {
  const d = structuredClone(DEFAULT);
  return {
    ...d, ...s,
    settings: { ...d.settings, ...(s.settings || {}) },
    others: { assets: s.others?.assets || [], vals: s.others?.vals || [] },
    manual: s.manual || {}, snapshots: s.snapshots || {}, funds: s.funds || [],
  };
}

export function save(state) {
  try { localStorage.setItem(KEY, JSON.stringify(state)); return true; } catch { return false; }
}

export const uid = () => Math.random().toString(36).slice(2, 10);

// URL #veri=... ile tek seferlik içe aktarma (hash sunucuya gönderilmez)
export function encodeShare(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function decodeShare(str) {
  const b = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = Uint8Array.from(b, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}
