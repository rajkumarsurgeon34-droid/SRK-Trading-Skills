// SRK Trading — shared core: config, charges, trading calendar, indicators, formatting.
// JavaScript port of india_common/india_common.py (keep behaviour in sync).
import { CONFIG } from './config.js';

export { CONFIG };
const WD = { MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5 };   // JS getUTCDay()

export function lotSize(symbol) {
  const v = CONFIG.lot_sizes[String(symbol).toUpperCase()];
  if (!v) throw new Error(`No lot size for ${symbol}`);
  return v;
}

// ─── dates (UTC-based ISO strings, no time zones) ───────────────────────────
export const iso = (d) => d.toISOString().slice(0, 10);
export const parseISO = (s) => new Date(s + 'T00:00:00Z');
export const addDays = (d, n) => new Date(d.getTime() + n * 86400000);
export function todayIST() {
  const now = new Date(Date.now() + 5.5 * 3600000);
  return parseISO(now.toISOString().slice(0, 10));
}
export function nowISTTime() {
  return new Date(Date.now() + 5.5 * 3600000).toISOString().slice(11, 16);
}

export function holidays() {
  const s = new Set();
  for (const days of Object.values(CONFIG.holidays || {})) days.forEach((d) => s.add(d));
  return s;
}
export function isTradingDay(d, hol = holidays()) {
  const w = d.getUTCDay();
  return w >= 1 && w <= 5 && !hol.has(iso(d));
}
export function previousTradingDay(d, hol = holidays()) {
  while (!isTradingDay(d, hol)) d = addDays(d, -1);
  return d;
}
function lastWeekdayOfMonth(y, m, wd) { // m: 0-11
  let d = new Date(Date.UTC(y, m + 1, 0));
  while (d.getUTCDay() !== wd) d = addDays(d, -1);
  return d;
}

export function upcomingExpiries(symbol, today = todayIST(), count = 4) {
  const rule = CONFIG.expiry_rules[symbol.toUpperCase()];
  const hol = holidays();
  const items = new Map();
  const end = addDays(today, 130);
  if (rule.monthly) {
    const wd = WD[rule.monthly.split('_')[1]];
    let y = today.getUTCFullYear(), m = today.getUTCMonth();
    for (let i = 0; i < 6; i++) {
      items.set(iso(lastWeekdayOfMonth(y, m, wd)), 'monthly');
      m++; if (m === 12) { m = 0; y++; }
    }
  }
  if (rule.weekly) {
    const wd = WD[rule.weekly];
    let d = addDays(today, -7);
    while (d.getUTCDay() !== wd) d = addDays(d, 1);
    for (; d <= end; d = addDays(d, 7)) if (!items.has(iso(d))) items.set(iso(d), 'weekly');
  }
  const out = [];
  for (const [sched, kind] of [...items.entries()].sort()) {
    const actual = previousTradingDay(parseISO(sched), hol);
    if (actual < today) continue;
    const cal = Math.round((actual - today) / 86400000);
    let tdays = 0;
    for (let i = 0; i <= cal; i++) if (isTradingDay(addDays(today, i), hol)) tdays++;
    out.push({ symbol: symbol.toUpperCase(), kind, scheduled: sched, expiry: iso(actual),
      shifted: iso(actual) !== sched, calendarDaysLeft: cal, tradingDaysLeft: tdays });
    if (out.length >= count) break;
  }
  return out;
}
export function holidayCoverageWarning(today = todayIST()) {
  const years = Object.keys(CONFIG.holidays || {}).map(Number);
  const maxY = Math.max(...years, today.getUTCFullYear());
  if (today.getUTCFullYear() > maxY || (today.getUTCFullYear() === maxY && today.getUTCMonth() >= 10))
    return `Holiday list covers up to ${maxY} only — add next year's NSE holidays in Settings → Rules.`;
  return null;
}

// ─── charges ────────────────────────────────────────────────────────────────
export function roundTripCharges(segment, buy, sell, qty, { brokeragePerOrder = null } = {}) {
  const ch = CONFIG.charges, seg = ch.segments[segment];
  const buyVal = buy * qty, sellVal = sell * qty, turnover = buyVal + sellVal;
  let perOrder = seg.brokerage_per_order ?? ch.brokerage_per_order;
  if (brokeragePerOrder !== null && brokeragePerOrder !== undefined && segment !== 'equity_delivery') perOrder = brokeragePerOrder;
  let brokerage;
  if (segment.startsWith('equity') && ch.brokerage_pct_cap && perOrder)
    brokerage = Math.min(perOrder, buyVal * ch.brokerage_pct_cap) + Math.min(perOrder, sellVal * ch.brokerage_pct_cap);
  else brokerage = perOrder * 2;
  const stt = sellVal * (seg.stt_sell_pct || 0) + buyVal * (seg.stt_buy_pct || 0);
  const exchange = turnover * seg.exchange_txn_pct;
  const sebi = turnover * ch.sebi_fee_pct;
  const stamp = buyVal * seg.stamp_buy_pct;
  const gst = (brokerage + exchange + sebi) * ch.gst_pct;
  const total = brokerage + stt + exchange + sebi + stamp + gst;
  const r2 = (x) => Math.round(x * 100) / 100;
  return { turnover: r2(turnover), brokerage: r2(brokerage), stt: r2(stt), exchange: r2(exchange),
    sebi: r2(sebi), stamp: r2(stamp), gst: r2(gst), total: r2(total) };
}
export function breakevenMove(segment, entry, qty, opts) {
  let lo = 0, hi = Math.max(entry * 0.5, 50);
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (mid * qty >= roundTripCharges(segment, entry, entry + mid, qty, opts).total) hi = mid; else lo = mid;
  }
  return Math.round(hi * 100) / 100;
}

// ─── formatting ─────────────────────────────────────────────────────────────
export function inr(x, dp = 0) {
  if (x === null || x === undefined || Number.isNaN(x)) return '—';
  const neg = x < 0;
  const s = Math.abs(x).toFixed(dp);
  let [w, f] = s.split('.');
  if (w.length > 3) {
    const tail = w.slice(-3); let head = w.slice(0, -3); const parts = [];
    while (head.length > 2) { parts.unshift(head.slice(-2)); head = head.slice(0, -2); }
    if (head) parts.unshift(head);
    w = parts.concat(tail).join(',');
  }
  return `${neg ? '-' : ''}₹${w}${f ? '.' + f : ''}`;
}
export const num = (x, dp = 2) => (x === null || x === undefined || Number.isNaN(x) ? '—' :
  Number(x).toLocaleString('en-IN', { minimumFractionDigits: dp, maximumFractionDigits: dp }));
export const pct = (a, b) => (a ? ((b - a) / a) * 100 : 0);
export const safeDiv = (a, b, d = 0) => (b ? a / b : d);

// ─── indicators ─────────────────────────────────────────────────────────────
export function ema(values, period) {
  if (!values.length) return [];
  const k = 2 / (period + 1); const out = [values[0]];
  for (let i = 1; i < values.length; i++) out.push(values[i] * k + out[i - 1] * (1 - k));
  return out;
}
export function sma(values, period) {
  const out = []; let s = 0;
  values.forEach((v, i) => { s += v; if (i >= period) s -= values[i - period]; out.push(i >= period - 1 ? s / period : null); });
  return out;
}
export function rsi(c, period = 14) {
  const out = new Array(c.length).fill(null);
  if (c.length <= period) return out;
  let g = 0, l = 0;
  for (let i = 1; i <= period; i++) { const d = c[i] - c[i - 1]; g += Math.max(d, 0); l += Math.max(-d, 0); }
  let ag = g / period, al = l / period;
  out[period] = al ? 100 - 100 / (1 + ag / al) : 100;
  for (let i = period + 1; i < c.length; i++) {
    const d = c[i] - c[i - 1];
    ag = (ag * (period - 1) + Math.max(d, 0)) / period;
    al = (al * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = al ? 100 - 100 / (1 + ag / al) : 100;
  }
  return out;
}
export function atr(rows, period = 14) {
  const tr = rows.map((r, i) => (i === 0 ? r.high - r.low :
    Math.max(r.high - r.low, Math.abs(r.high - rows[i - 1].close), Math.abs(r.low - rows[i - 1].close))));
  const out = new Array(rows.length).fill(null);
  if (rows.length < period) return out;
  let a = tr.slice(0, period).reduce((x, y) => x + y, 0) / period;
  out[period - 1] = a;
  for (let i = period; i < rows.length; i++) { a = (a * (period - 1) + tr[i]) / period; out[i] = a; }
  return out;
}
export function macd(c, f = 12, s = 26, sig = 9) {
  const ef = ema(c, f), es = ema(c, s);
  const line = ef.map((v, i) => v - es[i]); const signal = ema(line, sig);
  return { line, signal, hist: line.map((v, i) => v - signal[i]) };
}
export function supertrend(rows, period = 10, mult = 3) {
  const a = atr(rows, period); const out = [];
  let fu = null, fl = null, dir = 1;
  rows.forEach((r, i) => {
    if (a[i] === null) { out.push([null, 0]); return; }
    const hl2 = (r.high + r.low) / 2, bu = hl2 + mult * a[i], bl = hl2 - mult * a[i];
    const pc = i ? rows[i - 1].close : r.close;
    fu = fu === null || bu < fu || pc > fu ? bu : fu;
    fl = fl === null || bl > fl || pc < fl ? bl : fl;
    if (dir === 1 && r.close < fl) dir = -1; else if (dir === -1 && r.close > fu) dir = 1;
    out.push([dir === 1 ? fl : fu, dir]);
  });
  return out;
}
export function pivotsCPR(prev) {
  const { high: h, low: l, close: c } = prev; const p = (h + l + c) / 3, bc = (h + l) / 2, tc = 2 * p - bc;
  const r = (x) => Math.round(x * 100) / 100;
  return { pivot: r(p), cprTop: r(Math.max(tc, bc)), cprBottom: r(Math.min(tc, bc)),
    cprWidthPct: Math.round((Math.abs(tc - bc) / p) * 100000) / 1000,
    r1: r(2 * p - l), s1: r(2 * p - h), r2: r(p + (h - l)), s2: r(p - (h - l)), r3: r(h + 2 * (p - l)), s3: r(l - 2 * (h - p)) };
}
export const expectedDailyMove = (spot, vix) => spot * (vix / 100) / Math.sqrt(252);
