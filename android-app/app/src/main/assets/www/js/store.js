// Local storage on the phone (nothing is sent anywhere except to Angel One/NSE/Yahoo when fetching data).
const PREFIX = 'srk.';
const memory = new Map();
function ls() { try { return window.localStorage; } catch { return null; } }

export const store = {
  get(key, fallback = null) {
    try {
      const s = ls(); const raw = s ? s.getItem(PREFIX + key) : memory.get(key);
      return raw === null || raw === undefined ? fallback : JSON.parse(raw);
    } catch { return fallback; }
  },
  set(key, value) {
    const raw = JSON.stringify(value);
    try { const s = ls(); if (s) s.setItem(PREFIX + key, raw); else memory.set(key, raw); } catch { memory.set(key, raw); }
  },
  remove(key) { try { const s = ls(); if (s) s.removeItem(PREFIX + key); } catch { /* ignore */ } memory.delete(key); },
  exportAll() {
    const out = {}; const s = ls(); if (!s) return out;
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k.startsWith(PREFIX) && !['srk.angel', 'srk.angelSession', 'srk.hdfc', 'srk.hdfcSession'].includes(k)) out[k.slice(PREFIX.length)] = JSON.parse(s.getItem(k));
    }
    return out;
  },
  importAll(obj) { Object.entries(obj || {}).forEach(([k, v]) => { if (!['angel', 'angelSession', 'hdfc', 'hdfcSession'].includes(k)) this.set(k, v); }); },
};
