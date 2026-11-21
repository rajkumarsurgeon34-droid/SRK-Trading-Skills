// SRK Trading — data layer.
// Sources: Angel One SmartAPI (live, when logged in) with fallback to free
// delayed data (Yahoo Finance for prices, NSE website for option chain / FII-DII).
import { addDays, CONFIG, iso, todayIST } from './core.js';
import { store } from './store.js';
import { b64ToBytes, decodeFrame, PACKET_EXCHANGE } from './pb.js';

// ─── HTTP via the native bridge (no CORS limits); falls back to fetch in a browser ──
let seq = 0;
const pending = new Map();
window.__srkHttp = (id, res) => { const p = pending.get(id); if (p) { pending.delete(id); p(res); } };
window.__srkScrip = (id, res) => { const p = pending.get(id); if (p) { pending.delete(id); p(res); } };
window.__srkLogin = (id, res) => { const p = pending.get(id); if (p) { pending.delete(id); p(res); } };
window.__srkWs = (id, res) => { const p = pending.get(id); if (p) { pending.delete(id); p(res); } };
function nativeCall(fn, timeout, ...args) {
  if (!isNative()) return Promise.reject(new Error('This needs the Android app'));
  const id = fn[0] + (++seq);
  return new Promise((resolve, reject) => {
    const t = timeout ? setTimeout(() => { pending.delete(id); reject(new Error('Timed out')); }, timeout) : null;
    pending.set(id, (r) => { if (t) clearTimeout(t); r && r.error && !r.frames ? reject(new Error(r.error)) : resolve(r); });
    window.SRKNative[fn](id, ...args);
  });
}
export const isNative = () => typeof window.SRKNative !== 'undefined';

export async function http(method, url, { headers = {}, body = null, timeout = 35000 } = {}) {
  if (isNative()) {
    const id = 'h' + (++seq);
    const res = await new Promise((resolve, reject) => {
      const t = setTimeout(() => { pending.delete(id); reject(new Error('Request timed out')); }, timeout);
      pending.set(id, (r) => { clearTimeout(t); resolve(r); });
      window.SRKNative.http(id, method, url, JSON.stringify(headers), body ? (typeof body === 'string' ? body : JSON.stringify(body)) : '');
    });
    if (res.error) throw new Error(res.error);
    return { status: res.status, text: res.body };
  }
  const r = await fetch(url, { method, headers, body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined });
  return { status: r.status, text: await r.text() };
}
async function httpJSON(method, url, opts) {
  const r = await http(method, url, opts);
  let j;
  try { j = JSON.parse(r.text); } catch { throw new Error(`HTTP ${r.status}: not JSON`); }
  if (r.status >= 400) throw new Error(j?.message || `HTTP ${r.status}`);
  return j;
}
function scripSearch(filter) {
  if (!isNative()) return Promise.reject(new Error('Instrument search needs the Android app'));
  const id = 's' + (++seq);
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { pending.delete(id); reject(new Error('Instrument list timed out')); }, 180000);
    pending.set(id, (r) => { clearTimeout(t); r.error ? reject(new Error(r.error)) : resolve(r.items); });
    window.SRKNative.scripSearch(id, JSON.stringify(filter));
  });
}

// ─── cache ──────────────────────────────────────────────────────────────────
const mem = new Map();
async function cached(key, ttlMs, fn) {
  const hit = mem.get(key);
  if (hit && Date.now() - hit.t < ttlMs) return hit.v;
  const v = await fn();
  mem.set(key, { t: Date.now(), v });
  return v;
}
export const clearCache = () => mem.clear();

// ═══ TOTP (RFC 6238) for Angel One login ════════════════════════════════════
function base32(s) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = '';
  for (const ch of s.replace(/[\s=-]/g, '').toUpperCase()) { const v = A.indexOf(ch); if (v < 0) throw new Error('TOTP secret is not valid base32'); bits += v.toString(2).padStart(5, '0'); }
  const out = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  return out;
}
export async function totp(secret, time = Date.now()) {
  const key = await crypto.subtle.importKey('raw', base32(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const counter = Math.floor(time / 30000); const msg = new ArrayBuffer(8); const dv = new DataView(msg);
  dv.setUint32(0, Math.floor(counter / 2 ** 32)); dv.setUint32(4, counter >>> 0);
  const h = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg));
  const o = h[h.length - 1] & 15;
  const code = ((h[o] & 127) << 24 | h[o + 1] << 16 | h[o + 2] << 8 | h[o + 3]) % 1e6;
  return String(code).padStart(6, '0');
}

// ═══ Angel One SmartAPI ═════════════════════════════════════════════════════
const ANGEL = 'https://apiconnect.angelone.in';
export const ANGEL_INDEX = { NIFTY: '99926000', BANKNIFTY: '99926009', INDIAVIX: '99926017' };
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function angelHeaders(withAuth = true) {
  const s = store.get('angel', {});
  const h = { 'Content-Type': 'application/json', Accept: 'application/json', 'X-UserType': 'USER', 'X-SourceID': 'WEB',
    'X-ClientLocalIP': '127.0.0.1', 'X-ClientPublicIP': '127.0.0.1', 'X-MACAddress': '00:00:00:00:00:00', 'X-PrivateKey': s.apiKey || '' };
  if (withAuth) h.Authorization = 'Bearer ' + (store.get('angelSession', {}).jwt || '');
  return h;
}
export function angelLoggedIn() {
  const s = store.get('angelSession', null);
  return !!(s && s.jwt && s.day === iso(todayIST()));   // Angel One sessions end daily
}
export async function angelLogin({ totpCode = '' } = {}) {
  const s = store.get('angel', {});
  if (!s.apiKey || !s.clientCode || !s.pin) throw new Error('Enter API key, client ID and PIN in Settings');
  const code = totpCode || (s.totpSecret ? await totp(s.totpSecret) : '');
  if (!code) throw new Error('Enter the 6-digit TOTP from your authenticator app');
  const j = await httpJSON('POST', `${ANGEL}/rest/auth/angelbroking/user/v1/loginByPassword`,
    { headers: angelHeaders(false), body: { clientcode: s.clientCode, password: s.pin, totp: code } });
  if (!j.status || !j.data?.jwtToken) throw new Error(j.message || 'Angel One login failed');
  store.set('angelSession', { jwt: j.data.jwtToken, refresh: j.data.refreshToken, feed: j.data.feedToken, day: iso(todayIST()) });
  return true;
}
export function angelLogout() { store.remove('angelSession'); clearCache(); }

async function angelPost(path, body) {
  const j = await httpJSON('POST', ANGEL + path, { headers: angelHeaders(), body });
  if (!j.status) {
    if (/token|session|invalid/i.test(j.message || '')) angelLogout();
    throw new Error(j.message || 'Angel One request failed');
  }
  return j.data;
}
export async function angelCandles(exchange, token, days = 400, interval = 'ONE_DAY') {
  const to = new Date(Date.now() + 5.5 * 3600000), from = addDays(to, -days);
  const f = (d, t) => `${iso(d)} ${t}`;
  const data = await angelPost('/rest/secure/angelbroking/historical/v1/getCandleData',
    { exchange, symboltoken: String(token), interval, fromdate: f(from, '09:15'), todate: f(to, '15:30') });
  return (data || []).map((c) => ({ date: String(c[0]).slice(0, 10), open: +c[1], high: +c[2], low: +c[3], close: +c[4], volume: +c[5] || 0 }));
}
export async function angelQuote(exchangeTokens, mode = 'FULL') {
  const out = [];
  // max 50 tokens per request
  const flat = Object.entries(exchangeTokens).flatMap(([ex, toks]) => toks.map((t) => [ex, String(t)]));
  for (let i = 0; i < flat.length; i += 50) {
    const chunk = {};
    flat.slice(i, i + 50).forEach(([ex, t]) => { (chunk[ex] ||= []).push(t); });
    const d = await angelPost('/rest/secure/angelbroking/market/v1/quote/', { mode, exchangeTokens: chunk });
    out.push(...(d?.fetched || []));
    if (i + 50 < flat.length) await new Promise((r) => setTimeout(r, 250));
  }
  return out;
}
export async function angelFindEquity(symbol) {
  const key = 'eq:' + symbol;
  const known = store.get('angelTokens', {});
  if (known[key]) return known[key];
  const items = await scripSearch({ exch_seg: 'NSE', symbol: symbol.toUpperCase() + '-EQ' });
  if (!items.length) throw new Error(`${symbol} not found on NSE`);
  known[key] = items[0].token; store.set('angelTokens', known);
  return items[0].token;
}
const angelExpiryToISO = (e) => { const m = /^(\d{2})([A-Z]{3})(\d{4})$/.exec(e || ''); return m ? `${m[3]}-${String(MONTHS.indexOf(m[2]) + 1).padStart(2, '0')}-${m[1]}` : null; };

async function angelOptionChain(symbol, expiryISO, spot, strikesEachSide = 15) {
  const index = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY', 'NIFTYNXT50'].includes(symbol);
  const items = await cached('scrip:' + symbol, 6 * 3600000, () =>
    scripSearch({ name: symbol, exch_seg: 'NFO', instrumenttype: index ? 'OPTIDX' : 'OPTSTK' }));
  const expiries = [...new Set(items.map((i) => angelExpiryToISO(i.expiry)).filter(Boolean))].sort();
  const exp = expiryISO && expiries.includes(expiryISO) ? expiryISO : expiries.find((e) => e >= iso(todayIST())) || expiries[0];
  const forExp = items.filter((i) => angelExpiryToISO(i.expiry) === exp);
  const strikes = [...new Set(forExp.map((i) => +i.strike / 100))].sort((a, b) => a - b);
  let iAtm = 0; strikes.forEach((k, i) => { if (Math.abs(k - spot) < Math.abs(strikes[iAtm] - spot)) iAtm = i; });
  const pick = new Set(strikes.slice(Math.max(0, iAtm - strikesEachSide), iAtm + strikesEachSide + 1));
  const sel = forExp.filter((i) => pick.has(+i.strike / 100));
  const quotes = await angelQuote({ NFO: sel.map((i) => i.token) });
  const byTok = new Map(quotes.map((q) => [String(q.symbolToken), q]));
  const rows = new Map();
  // Angel quotes don't include change-in-OI → compare with today's first snapshot kept on the phone
  const snapKey = `oiSnap:${symbol}:${exp}:${iso(todayIST())}`;
  const snap = store.get(snapKey, null); const newSnap = snap || {};
  for (const i of sel) {
    const k = +i.strike / 100, q = byTok.get(String(i.token)); if (!q) continue;
    const r = rows.get(k) || { strike: k, ceOi: 0, ceChgOi: 0, ceLtp: 0, ceChg: 0, ceIv: null, peOi: 0, peChgOi: 0, peLtp: 0, peChg: 0, peIv: null };
    const side = i.symbol.endsWith('CE') ? 'ce' : 'pe', oi = +q.opnInterest || 0;
    r[side + 'Oi'] = oi; r[side + 'Ltp'] = +q.ltp || 0; r[side + 'Chg'] = +q.netChange || 0;
    if (snap && snap[i.token] !== undefined) r[side + 'ChgOi'] = oi - snap[i.token];
    if (!snap) newSnap[i.token] = oi;
    rows.set(k, r);
  }
  if (!snap) store.set(snapKey, newSnap);
  return { rows: [...rows.values()], spot, expiry: exp, expiries, source: 'Angel One (live)',
    note: snap ? 'Change in OI = since your first check today' : 'First check today — change in OI will show from your next refresh',
    lot: +forExp[0]?.lotsize || null };
}

// ═══ HDFC Securities (InvestRight Individual API) ═══════════════════════════
// Login: HDFC's own page (with OTP) inside the app → request token → access token.
// Data: /fetch-ltp (LTP + previous close) and the WebSocket feed (OHLC, OI).
// HDFC publishes NO historical candles, so charts/indicators use Yahoo daily data.
const HDFC = 'https://developer.hdfcsec.com';
const HDFC_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';
export const HDFC_INDEX = { NIFTY: '26000', BANKNIFTY: '26009', INDIAVIX: '26017', FINNIFTY: '26037', MIDCPNIFTY: '26074' };
export const HDFC_DEFAULT_REDIRECT = 'https://shazverse.com/srk-trading/callback';

export function hdfcLoggedIn() {
  const s = store.get('hdfcSession', null);
  return !!(s && s.token && s.day === iso(todayIST()));
}
export function hdfcLogout() { store.remove('hdfcSession'); clearCache(); }
export async function hdfcLogin() {
  const c = store.get('hdfc', {});
  if (!c.apiKey || !c.apiSecret) throw new Error('Enter HDFC API key and API secret in Settings');
  const redirect = (c.redirect || HDFC_DEFAULT_REDIRECT).trim();
  const r = await nativeCall('brokerLogin', 0, `${HDFC}/oapi/v1/login?api_key=${encodeURIComponent(c.apiKey)}`, redirect);
  const p = r.params || {};
  const reqToken = p.request_token || p.requestToken || p['request-token'] || p.code || p.token;
  if (!reqToken) throw new Error('HDFC did not return a request token' + (Object.keys(p).length ? ` (got: ${Object.keys(p).join(', ')})` : ''));
  const res = await http('POST', `${HDFC}/oapi/v1/access-token?api_key=${encodeURIComponent(c.apiKey)}&request_token=${encodeURIComponent(reqToken)}`,
    { headers: { 'User-Agent': HDFC_UA, 'Content-Type': 'application/json', Accept: 'application/json' }, body: { apiSecret: c.apiSecret } });
  let j; try { j = JSON.parse(res.text); } catch { throw new Error(`HDFC token exchange failed (HTTP ${res.status})`); }
  const token = j.accessToken || j.access_token || j.data?.accessToken || j.data?.access_token;
  if (!token) throw new Error(j.message || j.error || 'HDFC token exchange failed');
  store.set('hdfcSession', { token, day: iso(todayIST()) });
  return true;
}
function hdfcHeaders(json = false) {
  const h = { Authorization: store.get('hdfcSession', {}).token || '', 'User-Agent': HDFC_UA, Accept: 'application/json' };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}
const hdfcKey = () => encodeURIComponent(store.get('hdfc', {}).apiKey || '');

/** LTP + previous close for [{exchange, token}] (exchange: NSE, NFO, BSE, BFO, NSE_INDEX, BSE_INDEX). */
export async function hdfcLtp(instruments) {
  const out = new Map();
  for (let i = 0; i < instruments.length; i += 100) {
    const batch = instruments.slice(i, i + 100);
    const r = await http('PUT', `${HDFC}/oapi/v1/fetch-ltp?api_key=${hdfcKey()}`, { headers: hdfcHeaders(true), body: { data: batch } });
    if (r.status === 401 || r.status === 403) { hdfcLogout(); throw new Error('HDFC session expired — log in again in Settings'); }
    let j; try { j = JSON.parse(r.text); } catch { throw new Error(`HDFC LTP failed (HTTP ${r.status})`); }
    if (r.status >= 400) throw new Error(j.message || `HDFC LTP failed (HTTP ${r.status})`);
    const asked = new Map(batch.map((b) => [String(b.token), b.exchange]));
    for (const row of j.data || []) {
      const tok = String(row.token), ex = String(row.exchange || asked.get(tok) || '').toUpperCase();
      out.set(`${ex}:${tok}`, { ltp: +row.ltp || 0, prevClose: +row.prev_close || 0 });
    }
  }
  return out;
}
const WS_PREFIX = { NSE: 'NSE', BSE: 'BSE', NFO: 'NFO', BFO: 'BFO', NSE_INDEX: 'NSE_INDEX', BSE_INDEX: 'BSE_INDEX' };
/** Short live-feed snapshot: [{exchange, token}] → Map "EX:token" → {ltp, open, high, low, close, volume, oi}. */
export async function hdfcFeedSnapshot(instruments, waitMs = 4000) {
  const token = store.get('hdfcSession', {}).token;
  const url = `${HDFC.replace('https://', 'wss://')}/wsapi/v1/session?token=${encodeURIComponent(token)}&api_key=${hdfcKey()}`;
  const frames = [];
  for (let i = 0; i < instruments.length; i += 100) {
    frames.push(JSON.stringify({ subscribe: instruments.slice(i, i + 100).map((x) => ({ scripId: `${WS_PREFIX[x.exchange]}_${x.token}`, type: 'ALL' })) }));
  }
  frames.push(JSON.stringify({ heart_beat: true }));
  const r = await nativeCall('wsSnapshot', waitMs + 25000, url, JSON.stringify({ 'User-Agent': HDFC_UA }), JSON.stringify(frames), waitMs);
  const out = new Map();
  for (const b64 of r.frames || []) {
    for (const p of decodeFrame(b64ToBytes(b64))) {
      if (!p.instrumentId || p.packetType === 16) continue;
      const ex = PACKET_EXCHANGE[p.packetType]; if (!ex) continue;
      const key = `${ex}:${p.instrumentId}`, cur = out.get(key) || {};
      if (p.index) Object.assign(cur, { ltp: p.index.ltp, open: p.index.open, high: p.index.high, low: p.index.low, close: p.index.close });
      if (p.mbp) {
        if (p.mbp.ltp) Object.assign(cur, { ltp: p.mbp.ltp, open: p.mbp.open, high: p.mbp.high, low: p.mbp.low, close: p.mbp.close, volume: p.mbp.volume });
        if (p.mbp.oi) cur.oi = p.mbp.oi;
      }
      out.set(key, cur);
    }
  }
  if (!out.size && r.error) throw new Error('HDFC live feed: ' + r.error);
  return out;
}
async function hdfcMaster(filter) {
  const r = await nativeCall('hdfcMasterSearch', 180000, JSON.stringify(filter));
  return r.items || [];
}
async function hdfcFindEquity(symbol) {
  const known = store.get('hdfcTokens', {});
  if (known[symbol]) return known[symbol];
  const rows = (await hdfcMaster({ exchange: 'NSE', instrument_segment: 'EQUITY', symbol_name: symbol.toUpperCase() }))
    .filter((r) => /^\d+$/.test(r.exch_security_id));
  if (!rows.length) throw new Error(`${symbol} not found in HDFC security master`);
  const best = rows.find((r) => /EQ/i.test(r.security_id)) || rows[0];
  known[symbol] = best.exch_security_id; store.set('hdfcTokens', known);
  return best.exch_security_id;
}
async function hdfcSpot(sym) {
  const inst = HDFC_INDEX[sym] ? { exchange: 'NSE_INDEX', token: HDFC_INDEX[sym] } : { exchange: 'NSE', token: await hdfcFindEquity(sym) };
  const m = await hdfcLtp([inst]);
  return m.get(`${inst.exchange}:${inst.token}`)?.ltp || null;
}
async function hdfcOptionChain(symbol, expiryISO, spot, each = 15) {
  const index = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY', 'NIFTYNXT50'].includes(symbol);
  const rows = await cached('hdfcopt:' + symbol, 6 * 3600000, () =>
    hdfcMaster({ exchange: 'NSE', instrument_segment: index ? 'OPTIDX' : 'OPTSTK', symbol_name: symbol }));
  if (!rows.length) throw new Error(`No ${symbol} options in HDFC security master`);
  const expiries = [...new Set(rows.map((r) => r.expiry_date).filter(Boolean))].sort();
  const exp = expiryISO && expiries.includes(expiryISO) ? expiryISO : expiries.find((e) => e >= iso(todayIST())) || expiries[0];
  const forExp = rows.filter((r) => r.expiry_date === exp && /^\d+$/.test(r.exch_security_id));
  const strikes = [...new Set(forExp.map((r) => +r.strike_price))].sort((a, b) => a - b);
  if (!spot) spot = await hdfcSpot(symbol);
  let iAtm = 0; strikes.forEach((k, i) => { if (Math.abs(k - spot) < Math.abs(strikes[iAtm] - spot)) iAtm = i; });
  const pick = new Set(strikes.slice(Math.max(0, iAtm - each), iAtm + each + 1));
  const sel = forExp.filter((r) => pick.has(+r.strike_price));
  const inst = sel.map((r) => ({ exchange: 'NFO', token: r.exch_security_id }));
  const [ltp, feed] = await Promise.all([hdfcLtp(inst), hdfcFeedSnapshot(inst, 4500).catch(() => new Map())]);
  const snapKey = `oiSnap:hdfc:${symbol}:${exp}:${iso(todayIST())}`;
  const snap = store.get(snapKey, null), newSnap = snap || {};
  const by = new Map();
  for (const r of sel) {
    const k = +r.strike_price, key = `NFO:${r.exch_security_id}`, q = ltp.get(key) || {}, f = feed.get(key) || {};
    const row = by.get(k) || { strike: k, ceOi: 0, ceChgOi: 0, ceLtp: 0, ceChg: 0, ceIv: null, peOi: 0, peChgOi: 0, peLtp: 0, peChg: 0, peIv: null };
    const side = String(r.option_type).toUpperCase() === 'CE' ? 'ce' : 'pe';
    const oi = +f.oi || 0, last = q.ltp || f.ltp || 0;
    row[side + 'Oi'] = oi; row[side + 'Ltp'] = last; row[side + 'Chg'] = q.prevClose ? last - q.prevClose : 0;
    if (snap && snap[r.exch_security_id] !== undefined && oi) row[side + 'ChgOi'] = oi - snap[r.exch_security_id];
    if (!snap && oi) newSnap[r.exch_security_id] = oi;
    by.set(k, row);
  }
  const gotOi = [...by.values()].some((r) => r.ceOi || r.peOi);
  if (!snap && gotOi) store.set(snapKey, newSnap);
  return { rows: [...by.values()], spot, expiry: exp, expiries, source: 'HDFC Securities (live)', lot: +forExp[0]?.lot_size || null,
    note: !gotOi ? 'Open interest not received from the live feed — prices only' : snap ? 'Change in OI = since your first check today' : 'First check today — change in OI will show from your next refresh' };
}

// ═══ Yahoo Finance (free, delayed) ══════════════════════════════════════════
const YAHOO_UA = { 'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36', Accept: 'application/json' };
export async function yahooCandles(ticker, range = '2y', interval = '1d') {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=${range}&interval=${interval}&includePrePost=false`;
  const j = await httpJSON('GET', url, { headers: YAHOO_UA });
  const r = j?.chart?.result?.[0];
  if (!r) throw new Error(j?.chart?.error?.description || `No data for ${ticker}`);
  const q = r.indicators.quote[0], out = [];
  r.timestamp.forEach((ts, i) => {
    if (q.close[i] === null || q.open[i] === null) return;
    out.push({ date: new Date((ts + (r.meta.gmtoffset || 19800)) * 1000).toISOString().slice(0, 10),
      open: q.open[i], high: q.high[i], low: q.low[i], close: q.close[i], volume: q.volume[i] || 0 });
  });
  return out;
}

// ═══ NSE website (free; may block at times) ═════════════════════════════════
const NSE_H = { 'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36',
  Accept: 'application/json,text/plain,*/*', 'Accept-Language': 'en-US,en;q=0.9', Referer: 'https://www.nseindia.com/option-chain' };
let nseWarm = 0;
async function nseGet(path) {
  if (Date.now() - nseWarm > 5 * 60000) { await http('GET', 'https://www.nseindia.com/option-chain', { headers: { ...NSE_H, Accept: 'text/html' } }); nseWarm = Date.now(); }
  return httpJSON('GET', 'https://www.nseindia.com' + path, { headers: NSE_H });
}
const NSE_MON = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
const nseDateToISO = (s) => { const m = /^(\d{2})-([A-Za-z]{3})-(\d{4})$/.exec(s || ''); return m ? `${m[3]}-${NSE_MON[m[2]]}-${m[1]}` : null; };
const isoToNse = (s) => { const [y, m, d] = s.split('-'); return `${d}-${Object.keys(NSE_MON)[+m - 1]}-${y}`; };

function parseNseChain(j, expiryISO) {
  const rec = j.records || j; const data = rec.data || j.filtered?.data || [];
  const expiries = (rec.expiryDates || [...new Set(data.map((d) => d.expiryDate || d.expiryDates))]).map(nseDateToISO).filter(Boolean).sort();
  const exp = expiryISO || expiries[0];
  const rows = [];
  let spot = rec.underlyingValue;
  for (const it of data) {
    const e = nseDateToISO(it.expiryDate || it.expiryDates);
    if (exp && e && e !== exp) continue;
    const ce = it.CE || {}, pe = it.PE || {};
    spot = spot || ce.underlyingValue || pe.underlyingValue;
    rows.push({ strike: +it.strikePrice, ceOi: +ce.openInterest || 0, ceChgOi: +ce.changeinOpenInterest || 0, ceLtp: +ce.lastPrice || 0,
      ceChg: +ce.change || 0, ceIv: +ce.impliedVolatility || null, peOi: +pe.openInterest || 0, peChgOi: +pe.changeinOpenInterest || 0,
      peLtp: +pe.lastPrice || 0, peChg: +pe.change || 0, peIv: +pe.impliedVolatility || null });
  }
  return { rows, spot, expiry: exp, expiries };
}
async function nseOptionChain(symbol, expiryISO) {
  const index = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY', 'NIFTYNXT50'].includes(symbol);
  // newer NSE API (v3) first, then the classic endpoint
  try {
    const info = await nseGet(`/api/option-chain-contract-info?symbol=${symbol}`);
    const expiries = (info.expiryDates || []).map(nseDateToISO).filter(Boolean).sort();
    const exp = expiryISO && expiries.includes(expiryISO) ? expiryISO : expiries[0];
    const j = await nseGet(`/api/option-chain-v3?type=${index ? 'Indices' : 'Equity'}&symbol=${symbol}&expiry=${isoToNse(exp)}`);
    const p = parseNseChain(j, exp); p.expiries = expiries.length ? expiries : p.expiries;
    if (p.rows.length) return { ...p, source: 'NSE website (delayed)' };
  } catch { /* fall through */ }
  const j = await nseGet(index ? `/api/option-chain-indices?symbol=${symbol}` : `/api/option-chain-equities?symbol=${symbol}`);
  return { ...parseNseChain(j, expiryISO), source: 'NSE website (delayed)' };
}
export async function nseFiiDii() {
  const j = await nseGet('/api/fiidiiTradeReact');
  const row = { date: null, fii: null, dii: null };
  for (const r of j || []) {
    const cat = String(r.category || '').toUpperCase();
    const d = nseDateToISO(r.date); if (d) row.date = d;
    if (cat.startsWith('FII') || cat.includes('FPI')) row.fii = +r.netValue;
    if (cat.startsWith('DII')) row.dii = +r.netValue;
  }
  if (row.fii === null || row.dii === null || !row.date) throw new Error('Unexpected FII/DII format');
  return row;
}

// ═══ Unified API used by the screens ════════════════════════════════════════
export const YAHOO = { NIFTY: '^NSEI', BANKNIFTY: '^NSEBANK', INDIAVIX: '^INDIAVIX', FINNIFTY: 'NIFTY_FIN_SERVICE.NS', SENSEX: '^BSESN' };
export const SECTORS = {
  'Nifty Bank': '^NSEBANK', 'Nifty IT': '^CNXIT', 'Nifty Auto': '^CNXAUTO', 'Nifty Pharma': '^CNXPHARMA', 'Nifty FMCG': '^CNXFMCG',
  'Nifty Metal': '^CNXMETAL', 'Nifty Realty': '^CNXREALTY', 'Nifty Energy': '^CNXENERGY', 'Nifty PSU Bank': '^CNXPSUBANK',
  'Nifty Media': '^CNXMEDIA', 'Nifty Infra': '^CNXINFRA', 'Nifty Fin Service': 'NIFTY_FIN_SERVICE.NS',
};
export const GLOBAL = { sp500: '^GSPC', nasdaq: '^IXIC', dow: '^DJI', eurostoxx: '^STOXX50E', brent: 'BZ=F', usdinr: 'INR=X', dxy: 'DX-Y.NYB' };

/** Which broker supplies live data right now: 'angel' | 'hdfc' | null. */
export function liveBroker() {
  const s = store.get('settings', {});
  if ((s.dataSource || 'auto') === 'free') return null;
  const b = s.broker || 'angel';
  if (b === 'angel' && angelLoggedIn()) return 'angel';
  if (b === 'hdfc' && hdfcLoggedIn()) return 'hdfc';
  return null;
}
export const preferAngel = () => liveBroker() === 'angel';
export const BROKER_NAME = { angel: 'Angel One', hdfc: 'HDFC Securities' };

/** Daily candles for an index (NIFTY/BANKNIFTY/INDIAVIX/…) or an NSE stock symbol. */
export async function candles(symbol, { days = 400 } = {}) {
  const sym = symbol.toUpperCase();
  return cached('c:' + sym, 5 * 60000, async () => {
    if (preferAngel()) {
      try {
        if (ANGEL_INDEX[sym]) return { rows: await angelCandles('NSE', ANGEL_INDEX[sym], days), source: 'Angel One' };
        if (!YAHOO[sym]) return { rows: await angelCandles('NSE', await angelFindEquity(sym), days), source: 'Angel One' };
      } catch (e) { console.warn('Angel candles failed, using Yahoo', e); }
    }
    const t = YAHOO[sym] || (sym.startsWith('^') || sym.includes('.') ? sym : sym + '.NS');
    return { rows: await yahooCandles(t, days > 400 ? '5y' : '2y'), source: 'Yahoo (delayed)' };
  });
}

/** Live last price for indices when Angel is on — patches today's candle. */
export async function liveIndexQuotes() {
  const b = liveBroker();
  if (b === 'hdfc') {
    const inst = ['NIFTY', 'BANKNIFTY', 'INDIAVIX'].map((n) => ({ exchange: 'NSE_INDEX', token: HDFC_INDEX[n] }));
    const [l, f] = await Promise.all([hdfcLtp(inst), hdfcFeedSnapshot(inst, 3000).catch(() => new Map())]);
    const out = {};
    ['NIFTY', 'BANKNIFTY', 'INDIAVIX'].forEach((n) => {
      const key = `NSE_INDEX:${HDFC_INDEX[n]}`, q = l.get(key), fd = f.get(key) || {};
      if (q?.ltp || fd.ltp) out[n] = { ltp: q?.ltp || fd.ltp, open: fd.open, high: fd.high, low: fd.low };
    });
    return out;
  }
  if (b !== 'angel') return null;
  const q = await angelQuote({ NSE: Object.values(ANGEL_INDEX) });
  const out = {};
  for (const [name, tok] of Object.entries(ANGEL_INDEX)) { const r = q.find((x) => String(x.symbolToken) === tok); if (r) out[name] = r; }
  return out;
}

export async function optionChain(symbol, expiryISO = null, spot = null) {
  const sym = symbol.toUpperCase();
  if (liveBroker() === 'hdfc') {
    try { return await hdfcOptionChain(sym, expiryISO, spot); } catch (e) { console.warn('HDFC chain failed, trying NSE', e); }
  }
  if (preferAngel()) {
    try {
      let s = spot;
      if (!s) {
        if (ANGEL_INDEX[sym]) s = +(await angelQuote({ NSE: [ANGEL_INDEX[sym]] }, 'LTP'))[0]?.ltp;
        else s = +(await angelQuote({ NSE: [await angelFindEquity(sym)] }, 'LTP'))[0]?.ltp;
      }
      return await angelOptionChain(sym, expiryISO, s);
    } catch (e) { console.warn('Angel chain failed, trying NSE', e); }
  }
  return nseOptionChain(sym, expiryISO);
}

export async function globalCues() {
  return cached('global', 15 * 60000, async () => {
    const out = {};
    await Promise.all(Object.entries(GLOBAL).map(async ([k, t]) => {
      try { const r = await yahooCandles(t, '5d'); if (r.length >= 2) out[k] = Math.round(((r.at(-1).close / r.at(-2).close) - 1) * 10000) / 100; } catch { /* skip */ }
    }));
    const gift = store.get('settings', {}).giftNiftyPct;
    if (gift !== undefined && gift !== '' && gift !== null) out.gift_nifty_pct = +gift;
    return out;
  });
}

export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; try { out[k] = await fn(items[k], k); } catch (e) { out[k] = { error: e.message }; } }
  }));
  return out;
}

export const DEFAULT_WATCHLIST = ('RELIANCE HDFCBANK ICICIBANK INFY TCS BHARTIARTL ITC LT SBIN AXISBANK KOTAKBANK HINDUNILVR ' +
  'BAJFINANCE M&M MARUTI SUNPHARMA HCLTECH NTPC TATAMOTORS ULTRACEMCO TITAN POWERGRID ONGC ASIANPAINT ADANIENT ' +
  'ADANIPORTS BAJAJFINSV TRENT JSWSTEEL TATASTEEL COALINDIA NESTLEIND GRASIM WIPRO HINDALCO TECHM SBILIFE CIPLA ' +
  'HDFCLIFE DRREDDY BEL EICHERMOT APOLLOHOSP BAJAJ-AUTO SHRIRAMFIN TATACONSUM INDUSINDBK HEROMOTOCO BPCL').split(' ');
export { CONFIG };
