// SRK Trading — skill logic (JavaScript ports of the Python skills in /skills).
import {
  atr, ema, expectedDailyMove, macd, pct, pivotsCPR, roundTripCharges, rsi, safeDiv, sma, supertrend,
} from './core.js';

// ═══ Market regime ══════════════════════════════════════════════════════════
function trendScore(rows, name) {
  const c = rows.map((r) => r.close);
  const e20 = ema(c, 20).at(-1), e50 = ema(c, 50).at(-1);
  const e200 = c.length >= 200 ? ema(c, 200).at(-1) : null;
  let pts = 0;
  if (c.at(-1) > e20) pts++;
  if (c.at(-1) > e50) pts++;
  if (e20 > e50) pts++;
  if (e200 && c.at(-1) > e200) pts++;
  if (e200 && e50 > e200) pts++;
  const max = e200 ? 5 : 3;
  return {
    score: pts / max,
    note: `${name} ${c.at(-1).toFixed(0)} vs EMA20 ${e20.toFixed(0)} / EMA50 ${e50.toFixed(0)}${e200 ? ` / EMA200 ${e200.toFixed(0)}` : ''}`,
    detail: { close: c.at(-1), prevClose: c.at(-2), ema20: e20, ema50: e50, ema200: e200, rsi14: rsi(c, 14).at(-1),
      chgPct: pct(c.at(-2), c.at(-1)) },
  };
}

export function marketRegime({ nifty, banknifty, vix, flows, breadth, global }) {
  if (!nifty || nifty.length < 60) throw new Error('Need at least 60 days of NIFTY data');
  const comps = {}, weights = {}, notes = [], out = {};
  const n = trendScore(nifty, 'NIFTY');
  comps.nifty = n.score; weights.nifty = 0.30; notes.push(n.note); out.nifty = n.detail;
  if (banknifty?.length >= 60) {
    const b = trendScore(banknifty, 'BANKNIFTY');
    comps.banknifty = b.score; weights.banknifty = 0.15; notes.push(b.note); out.banknifty = b.detail;
  }
  let exp = null;
  if (vix?.length > 6) {
    const v = vix.map((r) => r.close), now = v.at(-1), chg5 = pct(v.at(-6), now);
    let s, label;
    if (now < 12) [s, label] = [0.9, 'very low — option premiums cheap'];
    else if (now < 15) [s, label] = [0.8, 'calm'];
    else if (now < 18) [s, label] = [0.55, 'elevated'];
    else if (now < 22) [s, label] = [0.3, 'high'];
    else [s, label] = [0.1, 'panic zone'];
    if (chg5 > 15) s -= 0.15;
    comps.vix = Math.max(s, 0); weights.vix = 0.20;
    notes.push(`India VIX ${now.toFixed(2)} (${label}), 5-day ${chg5 >= 0 ? '+' : ''}${chg5.toFixed(1)}%`);
    exp = expectedDailyMove(n.detail.close, now);
    out.vix = { value: now, chg5, label, chgPct: pct(v.at(-2), now) };
  }
  if (flows?.length) {
    const last5 = flows.slice(-5);
    const fii5 = last5.reduce((a, r) => a + r.fii, 0), dii5 = last5.reduce((a, r) => a + r.dii, 0);
    const s = 0.5 + Math.max(Math.min(fii5 / 20000, 0.3), -0.3) + Math.max(Math.min((fii5 + dii5) / 30000, 0.2), -0.2);
    comps.flows = Math.max(Math.min(s, 1), 0); weights.flows = 0.15;
    notes.push(`FII 5-day ₹${Math.round(fii5).toLocaleString('en-IN')} cr, DII ₹${Math.round(dii5).toLocaleString('en-IN')} cr`);
    out.flows = { fii5, dii5 };
  }
  if (breadth?.adv && breadth?.dec) {
    const ad = breadth.adv / breadth.dec;
    comps.breadth = Math.max(Math.min((ad - 0.5) / 1.5, 1), 0); weights.breadth = 0.10;
    notes.push(`Advance/decline ${breadth.adv}/${breadth.dec} = ${ad.toFixed(2)}`);
  }
  if (global && Object.keys(global).length) {
    const w = { gift_nifty_pct: 0.35, sp500: 0.15, nasdaq: 0.15, dow: 0.05, eurostoxx: 0.05, brent: -0.1, usdinr: -0.1, dxy: -0.05 };
    const raw = Object.entries(global).reduce((a, [k, v]) => a + (w[k] || 0) * Number(v || 0), 0);
    comps.global = Math.max(Math.min(0.5 + raw / 2, 1), 0); weights.global = 0.10;
    notes.push(`Global cues weighted ${raw >= 0 ? '+' : ''}${raw.toFixed(2)}%`);
    out.global = global;
  }
  const tw = Object.values(weights).reduce((a, b) => a + b, 0);
  const score = Math.round((Object.keys(comps).reduce((a, k) => a + comps[k] * weights[k], 0) / tw) * 100);
  let posture, guidance;
  if (score >= 70) [posture, guidance] = ['aggressive', 'Full size on A+ setups; trend-following longs favoured.'];
  else if (score >= 50) [posture, guidance] = ['normal', 'Normal size; trade with the intraday trend.'];
  else if (score >= 35) [posture, guidance] = ['defensive', 'Half size; book profits quickly; prefer defined-risk option trades.'];
  else [posture, guidance] = ['stand_aside', 'Capital protection first — skip trading or paper-trade.'];
  const scalping = [];
  if (exp) {
    const c = n.detail.close;
    scalping.push(`VIX-implied 1σ Nifty move today ≈ ±${exp.toFixed(0)} pts (${(c - exp).toFixed(0)} – ${(c + exp).toFixed(0)})`);
    scalping.push(`Scalp target ≈ ${(exp * 0.15).toFixed(0)}–${(exp * 0.25).toFixed(0)} pts, stop ≈ ${(exp * 0.1).toFixed(0)}–${(exp * 0.15).toFixed(0)} pts`);
    if (out.vix.value > 20) scalping.push('High VIX: wider stops, fewer trades, smaller size; avoid naked option selling.');
  }
  return { ...out, score, posture, guidance, components: comps, weights, expectedMove: exp, scalping, notes };
}

// ═══ FII / DII ══════════════════════════════════════════════════════════════
export function flowStreak(vals) {
  if (!vals.length) return 0;
  const pos = vals.at(-1) > 0; let n = 0;
  for (let i = vals.length - 1; i >= 0; i--) { if (vals[i] !== 0 && (vals[i] > 0) === pos) n++; else break; }
  return pos ? n : -n;
}
export function analyzeFlows(rows) {
  if (!rows.length) return null;
  const f = rows.map((r) => r.fii), d = rows.map((r) => r.dii);
  const sum = (a, n) => a.slice(-n).reduce((x, y) => x + y, 0);
  const f5 = sum(f, 5), d5 = sum(d, 5);
  let reading;
  if (f5 > 0 && d5 > 0) reading = 'Both FII and DII buying — strong tailwind';
  else if (f5 > 0) reading = 'FII buying, DII booking — foreign-led; watch USDINR';
  else if (f5 < 0 && d5 > Math.abs(f5)) reading = 'FII selling fully absorbed by DII — resilient';
  else if (f5 < 0 && d5 > 0) reading = 'FII selling partly absorbed by DII — choppy';
  else reading = 'Both selling — risk-off';
  return { last: rows.at(-1), fii: { d5: f5, d10: sum(f, 10), d20: sum(f, 20) }, dii: { d5, d10: sum(d, 10), d20: sum(d, 20) },
    fiiStreak: flowStreak(f), diiStreak: flowStreak(d), reading };
}

// ═══ Sector rotation ════════════════════════════════════════════════════════
export function sectorRotation(sectors, bench) {
  const bmap = new Map(bench.map((r) => [r.date, r.close]));
  const out = [];
  for (const [name, rows] of Object.entries(sectors)) {
    const rs = rows.filter((r) => bmap.has(r.date)).map((r) => r.close / bmap.get(r.date));
    if (rs.length < 70) continue;
    const ratio = (rs.at(-1) / ema(rs, 50).at(-1)) * 100, mom = (rs.at(-1) / rs.at(-11)) * 100;
    const c = rows.map((r) => r.close);
    const quadrant = ratio >= 100 && mom >= 100 ? 'Leading' : ratio >= 100 ? 'Weakening' : mom >= 100 ? 'Improving' : 'Lagging';
    out.push({ sector: name, close: c.at(-1), ret1w: pct(c.at(-6), c.at(-1)), ret1m: pct(c.at(-22), c.at(-1)),
      ret3m: c.length > 64 ? pct(c.at(-64), c.at(-1)) : null, ratio, mom, quadrant });
  }
  return out.sort((a, b) => b.ratio + b.mom - (a.ratio + a.mom));
}

// ═══ Technical analyst ══════════════════════════════════════════════════════
export function technicals(rows) {
  if (rows.length < 30) throw new Error('Need at least 30 candles');
  const c = rows.map((r) => r.close), last = rows.at(-1), price = last.close;
  const e = Object.fromEntries([9, 20, 50, 200].map((p) => [p, ema(c, p).at(-1)]));
  const r14 = rsi(c, 14).at(-1), m = macd(c), a14 = atr(rows, 14).at(-1);
  const [stVal, stDir] = supertrend(rows).at(-1);
  const vol20 = sma(rows.map((r) => r.volume), 20).at(-1);
  const lb = rows.slice(-252), hi52 = Math.max(...lb.map((r) => r.high)), lo52 = Math.min(...lb.map((r) => r.low));
  const piv = pivotsCPR(last);           // levels for the NEXT session use today's candle
  const has200 = rows.length >= 200;
  let stage;
  if (has200 && price > e[50] && e[50] > e[200] && e[20] > e[50]) stage = 'Stage 2 uptrend';
  else if (has200 && price < e[50] && e[50] < e[200] && e[20] < e[50]) stage = 'Stage 4 downtrend';
  else if (has200) stage = price > e[200] ? 'Above 200 EMA — basing / pullback' : 'Below 200 EMA — weak';
  else stage = 'Short history';
  let score = 0; const notes = [];
  score += price > e[20] ? 1 : -1; score += price > e[50] ? 1 : -1;
  if (has200) score += price > e[200] ? 1 : -1;
  if (stDir === 1) { score++; notes.push(`Supertrend bullish (trail ${stVal.toFixed(2)})`); }
  else if (stDir === -1) { score--; notes.push(`Supertrend bearish (trail ${stVal.toFixed(2)})`); }
  const h = m.hist;
  if (h.at(-1) > 0 && h.at(-1) > h.at(-2)) { score++; notes.push('MACD histogram positive and rising'); }
  else if (h.at(-1) < 0 && h.at(-1) < h.at(-2)) { score--; notes.push('MACD histogram negative and falling'); }
  if (r14 !== null) {
    if (r14 > 70) notes.push(`RSI ${r14.toFixed(1)} overbought — avoid chasing`);
    else if (r14 < 30) notes.push(`RSI ${r14.toFixed(1)} oversold — wait for reversal`);
    else if (r14 > 55) score++; else if (r14 < 45) score--;
  }
  const volX = vol20 ? last.volume / vol20 : null;
  if (volX > 1.5) notes.push(`Volume ${volX.toFixed(1)}× 20-day average`);
  if (piv.cprWidthPct < 0.15) notes.push('Narrow CPR — trending day more likely');
  else if (piv.cprWidthPct > 0.5) notes.push('Wide CPR — range day more likely');
  const bias = score >= 4 ? 'bullish' : score >= 2 ? 'mildly bullish' : score <= -4 ? 'bearish' : score <= -2 ? 'mildly bearish' : 'neutral';
  return { date: last.date, close: price, chgPct: pct(c.at(-2), price), ema: e, rsi14: r14,
    macd: { line: m.line.at(-1), signal: m.signal.at(-1), hist: h.at(-1) }, atr14: a14, atrPct: a14 ? (a14 / price) * 100 : null,
    supertrend: { value: stVal, dir: stDir }, pivots: piv, hi52, lo52, fromHighPct: pct(hi52, price), volX, stage, score, bias, notes,
    stopLong: a14 ? price - 1.5 * a14 : null, stopShort: a14 ? price + 1.5 * a14 : null };
}

// ═══ Stock screener ═════════════════════════════════════════════════════════
export const SCREENS = ['vcp', 'breakout', 'momentum', 'pullback', 'high52', 'relative'];
const ret = (c, n) => (c.length > n ? pct(c.at(-n - 1), c.at(-1)) : null);
export function screenStock(rows, screens, benchC = null, minPrice = 50, minTurnoverCr = 5) {
  if (rows.length < 60) return null;
  const c = rows.map((r) => r.close);
  const turnoverCr = rows.slice(-20).reduce((a, r) => a + r.close * r.volume, 0) / 20 / 1e7;
  if (c.at(-1) < minPrice || turnoverCr < minTurnoverCr) return null;
  const [e20, e50, e150, e200] = [20, 50, 150, 200].map((p) => ema(c, p).at(-1));
  const hi52 = Math.max(...rows.slice(-252).map((r) => r.high)), lo52 = Math.min(...rows.slice(-252).map((r) => r.low));
  const vols = rows.map((r) => r.volume);
  const hits = {};
  const checks = {
    vcp: () => {
      if (rows.length < 200) return null;
      const p = c.at(-1);
      if (!(p > e50 && e50 > e150 && e150 > e200 && e200 > ema(c.slice(0, -20), 200).at(-1) && p >= lo52 * 1.25 && p >= hi52 * 0.75)) return null;
      const rng = (seg) => { const hi = Math.max(...seg.map((r) => r.high)); return ((hi - Math.min(...seg.map((r) => r.low))) / hi) * 100; };
      const w = [rng(rows.slice(-60, -40)), rng(rows.slice(-40, -20)), rng(rows.slice(-20))];
      const v = [[-60, -40], [-40, -20], [-20, undefined]].map(([a, b]) => rows.slice(a, b).reduce((x, r) => x + r.volume, 0) / 20);
      if (w[0] > w[1] && w[1] > w[2] && w[2] < 12 && v[2] < v[0]) {
        const pivot = Math.max(...rows.slice(-20).map((r) => r.high));
        return `contractions ${w.map((x) => x.toFixed(0)).join('→')}%, pivot ${pivot.toFixed(1)}`;
      }
      return null;
    },
    breakout: () => {
      const v20 = sma(vols, 20).at(-2);
      for (const n of [55, 20]) {
        const prior = Math.max(...rows.slice(-n - 1, -1).map((r) => r.high));
        if (c.at(-1) > prior && v20 && rows.at(-1).volume >= 1.5 * v20) return `${n}-day high ${prior.toFixed(1)} on ${(rows.at(-1).volume / v20).toFixed(1)}× vol`;
      }
      return null;
    },
    momentum: () => {
      const r3 = ret(c, 63), r6 = ret(c, 126);
      if (r3 === null || r6 === null) return null;
      return r3 > 15 && r6 > 25 && c.at(-1) >= hi52 * 0.9 && c.at(-1) > e50 && e50 > ema(c.slice(0, -10), 50).at(-1)
        ? `3M ${r3.toFixed(0)}%, 6M ${r6.toFixed(0)}%` : null;
    },
    pullback: () => {
      if (rows.length < 200) return null;
      const r = rsi(c, 14).at(-1);
      if (c.at(-1) > e200 && e50 > e200 && r >= 40 && r <= 55) {
        const near = Math.min(Math.abs(c.at(-1) - e20) / e20, Math.abs(c.at(-1) - e50) / e50) * 100;
        if (near <= 2) return `RSI ${r.toFixed(0)}, ${near.toFixed(1)}% from EMA`;
      }
      return null;
    },
    high52: () => {
      if (rows.length < 120) return null;
      const v20 = sma(vols, 20).at(-1), v50 = sma(vols, 50).at(-1);
      return c.at(-1) >= hi52 * 0.97 && v20 > v50 ? `${pct(hi52, c.at(-1)).toFixed(1)}% from high` : null;
    },
    relative: () => {
      if (!benchC || c.length < 64 || benchC.length < 64) return null;
      const rs = ret(c, 63) - ret(benchC, 63);
      return rs > 10 ? `+${rs.toFixed(0)} pts vs NIFTY (3M)` : null;
    },
  };
  for (const s of screens) { const r = checks[s](); if (r) hits[s] = r; }
  if (!Object.keys(hits).length) return null;
  const a = atr(rows, 14).at(-1);
  return { close: c.at(-1), date: rows.at(-1).date, turnoverCr, atrPct: a ? (a / c.at(-1)) * 100 : null, hits, score: Object.keys(hits).length };
}

// ═══ Option chain ═══════════════════════════════════════════════════════════
export function maxPain(rows) {
  let best = null, bestLoss = Infinity;
  for (const s of rows) {
    const k = s.strike;
    const loss = rows.reduce((a, r) => a + Math.max(k - r.strike, 0) * r.ceOi + Math.max(r.strike - k, 0) * r.peOi, 0);
    if (loss < bestLoss) { best = k; bestLoss = loss; }
  }
  return best;
}
export function buildup(priceChg, oiChg) {
  if (oiChg > 0 && priceChg > 0) return 'long buildup';
  if (oiChg > 0 && priceChg < 0) return 'short buildup';
  if (oiChg < 0 && priceChg > 0) return 'short covering';
  if (oiChg < 0 && priceChg < 0) return 'long unwinding';
  return 'neutral';
}
export function analyzeChain(rows, spot, window = 10) {
  rows = rows.filter((r) => r.strike > 0).sort((a, b) => a.strike - b.strike);
  if (!rows.length) throw new Error('Option chain is empty');
  if (!spot) {
    const r = rows.filter((x) => x.ceLtp && x.peLtp).sort((a, b) => Math.abs(a.ceLtp - a.peLtp) - Math.abs(b.ceLtp - b.peLtp))[0];
    spot = r ? r.strike + r.ceLtp - r.peLtp : rows[Math.floor(rows.length / 2)].strike;
  }
  let iAtm = 0;
  rows.forEach((r, i) => { if (Math.abs(r.strike - spot) < Math.abs(rows[iAtm].strike - spot)) iAtm = i; });
  const atm = rows[iAtm], near = rows.slice(Math.max(0, iAtm - window), iAtm + window + 1);
  const sum = (k) => rows.reduce((a, r) => a + (r[k] || 0), 0);
  const totCe = sum('ceOi'), totPe = sum('peOi'), chgCe = sum('ceChgOi'), chgPe = sum('peChgOi');
  const pcr = safeDiv(totPe, totCe), pcrChg = chgCe > 0 ? chgPe / chgCe : null;
  const above = near.filter((r) => r.strike >= spot), below = near.filter((r) => r.strike <= spot);
  const res = [...above].sort((a, b) => b.ceOi - a.ceOi).slice(0, 3);
  const sup = [...below].sort((a, b) => b.peOi - a.peOi).slice(0, 3);
  const resAdd = above.reduce((m, r) => (!m || r.ceChgOi > m.ceChgOi ? r : m), null);
  const supAdd = below.reduce((m, r) => (!m || r.peChgOi > m.peChgOi ? r : m), null);
  const straddle = (atm.ceLtp || 0) + (atm.peLtp || 0), mp = maxPain(rows);
  let score = 0; const reasons = [];
  if (pcr > 1.2) { score++; reasons.push(`PCR ${pcr.toFixed(2)} > 1.2 — put writers active (supportive; >1.6 overcrowded)`); }
  else if (pcr < 0.8) { score--; reasons.push(`PCR ${pcr.toFixed(2)} < 0.8 — call writers dominant (capped)`); }
  if (chgPe > chgCe * 1.2 && chgPe > 0) { score++; reasons.push('Fresh put OI adding faster than call OI'); }
  else if (chgCe > chgPe * 1.2 && chgCe > 0) { score--; reasons.push('Fresh call OI adding faster than put OI'); }
  if (mp && spot) { const d = ((mp - spot) / spot) * 100; if (Math.abs(d) > 0.3) reasons.push(`Max pain ${mp} is ${d > 0 ? '+' : ''}${d.toFixed(2)}% from spot (matters most on expiry day)`); }
  const bias = score >= 2 ? 'bullish' : score === 1 ? 'mildly bullish' : score <= -2 ? 'bearish' : score === -1 ? 'mildly bearish' : 'neutral';
  const ceB = {}, peB = {};
  near.forEach((r) => { const a = buildup(r.ceChg, r.ceChgOi), b = buildup(r.peChg, r.peChgOi); ceB[a] = (ceB[a] || 0) + 1; peB[b] = (peB[b] || 0) + 1; });
  return { spot, atm: atm.strike, pcr, pcrChg, totCe, totPe, maxPain: mp, resistance: res, support: sup,
    freshRes: resAdd && resAdd.ceChgOi > 0 ? resAdd.strike : null, freshSup: supAdd && supAdd.peChgOi > 0 ? supAdd.strike : null,
    straddle, range: [spot - straddle, spot + straddle], atmIv: { ce: atm.ceIv, pe: atm.peIv }, ceBuildup: ceB, peBuildup: peB,
    bias, score, reasons, near };
}

// ═══ Options strategy (Black-Scholes) ═══════════════════════════════════════
const ncdf = (x) => 0.5 * (1 + erf(x / Math.SQRT2));
const npdf = (x) => Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI);
function erf(x) { // Abramowitz-Stegun 7.1.26 (|err| < 1.5e-7)
  const s = Math.sign(x); x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}
export function blackScholes(S, K, t, iv, r, kind) {
  if (t <= 0 || iv <= 0) {
    const intr = kind === 'CE' ? Math.max(S - K, 0) : Math.max(K - S, 0);
    return { price: intr, delta: kind === 'CE' ? (S > K ? 1 : 0) : (S < K ? -1 : 0), gamma: 0, theta: 0, vega: 0 };
  }
  const sq = iv * Math.sqrt(t), d1 = (Math.log(S / K) + (r + iv * iv / 2) * t) / sq, d2 = d1 - sq, disc = Math.exp(-r * t);
  const common = -S * npdf(d1) * iv / (2 * Math.sqrt(t));
  if (kind === 'CE') return { price: S * ncdf(d1) - K * disc * ncdf(d2), delta: ncdf(d1), gamma: npdf(d1) / (S * sq),
    theta: (common - r * K * disc * ncdf(d2)) / 365, vega: S * npdf(d1) * Math.sqrt(t) / 100 };
  return { price: K * disc * ncdf(-d2) - S * ncdf(-d1), delta: ncdf(d1) - 1, gamma: npdf(d1) / (S * sq),
    theta: (common + r * K * disc * ncdf(-d2)) / 365, vega: S * npdf(d1) * Math.sqrt(t) / 100 };
}
export const PRESETS = {
  long_call: { n: 1, label: 'Long call', legs: (s) => [['buy', 'CE', s[0]]] },
  long_put: { n: 1, label: 'Long put', legs: (s) => [['buy', 'PE', s[0]]] },
  bull_call_spread: { n: 2, label: 'Bull call spread', legs: (s) => [['buy', 'CE', s[0]], ['sell', 'CE', s[1]]] },
  bear_put_spread: { n: 2, label: 'Bear put spread', legs: (s) => [['buy', 'PE', s[1]], ['sell', 'PE', s[0]]] },
  bull_put_spread: { n: 2, label: 'Bull put spread', legs: (s) => [['sell', 'PE', s[1]], ['buy', 'PE', s[0]]] },
  bear_call_spread: { n: 2, label: 'Bear call spread', legs: (s) => [['sell', 'CE', s[0]], ['buy', 'CE', s[1]]] },
  long_straddle: { n: 1, label: 'Long straddle', legs: (s) => [['buy', 'CE', s[0]], ['buy', 'PE', s[0]]] },
  short_straddle: { n: 1, label: 'Short straddle', legs: (s) => [['sell', 'CE', s[0]], ['sell', 'PE', s[0]]] },
  long_strangle: { n: 2, label: 'Long strangle', legs: (s) => [['buy', 'PE', s[0]], ['buy', 'CE', s[1]]] },
  short_strangle: { n: 2, label: 'Short strangle', legs: (s) => [['sell', 'PE', s[0]], ['sell', 'CE', s[1]]] },
  iron_condor: { n: 4, label: 'Iron condor', legs: (s) => [['buy', 'PE', s[0]], ['sell', 'PE', s[1]], ['sell', 'CE', s[2]], ['buy', 'CE', s[3]]] },
  iron_fly: { n: 3, label: 'Iron fly', legs: (s) => [['buy', 'PE', s[0]], ['sell', 'PE', s[1]], ['sell', 'CE', s[1]], ['buy', 'CE', s[2]]] },
};
export function presetLegs(name, strikes, premiums = []) {
  const p = PRESETS[name];
  if (!p) throw new Error('Unknown strategy');
  if (strikes.length !== p.n) throw new Error(`${p.label} needs ${p.n} strike(s)`);
  const s = [...strikes].sort((a, b) => a - b);
  return p.legs(s).map(([side, kind, strike], i) => ({ side, kind, strike, premium: premiums[i] ?? null }));
}
export function analyzeStrategy(legs, spot, days, ivPct, lot, lots = 1, rate = 0.065) {
  const t = Math.max(days, 0) / 365, iv = ivPct / 100, qty = lot * lots;
  const net = { delta: 0, gamma: 0, theta: 0, vega: 0 }; let debit = 0;
  legs = legs.map((L) => {
    const g = blackScholes(spot, L.strike, t, iv, rate, L.kind);
    const premium = L.premium === null || L.premium === undefined || L.premium === '' || Number.isNaN(L.premium) ? Math.round(g.price * 100) / 100 : Number(L.premium);
    const sign = L.side === 'buy' ? 1 : -1;
    debit += sign * premium;
    for (const k of Object.keys(net)) net[k] += sign * g[k] * qty;
    return { ...L, premium, theoretical: g.price, estimated: L.premium === null || L.premium === undefined || L.premium === '' };
  });
  const payoff = (S) => legs.reduce((a, L) => a + ((L.kind === 'CE' ? Math.max(S - L.strike, 0) : Math.max(L.strike - S, 0)) - L.premium) * (L.side === 'buy' ? 1 : -1), 0) * qty;
  const strikes = [...new Set(legs.map((L) => L.strike))].sort((a, b) => a - b);
  const lo = Math.min(...strikes, spot) * 0.85, hi = Math.max(...strikes, spot) * 1.15;
  const step = Math.max((hi - lo) / 2000, 0.5);
  const grid = []; for (let x = lo; x <= hi; x += step) grid.push(x);
  grid.push(...strikes); grid.sort((a, b) => a - b);
  const vals = grid.map(payoff);
  const up = legs.filter((L) => L.kind === 'CE').reduce((a, L) => a + (L.side === 'buy' ? 1 : -1), 0);
  const dn = legs.filter((L) => L.kind === 'PE').reduce((a, L) => a + (L.side === 'buy' ? 1 : -1), 0);
  const maxProfit = up > 0 || dn > 0 ? Infinity : Math.max(...vals);
  const maxLoss = up < 0 || dn < 0 ? -Infinity : Math.min(...vals);
  const bes = [];
  for (let i = 1; i < grid.length; i++) {
    const a = vals[i - 1], b = vals[i];
    if ((a < 0 && b >= 0) || (a >= 0 && b < 0)) {
      const x = grid[i - 1] + (grid[i] - grid[i - 1]) * (b !== a ? -a / (b - a) : 0);
      if (!bes.length || Math.abs(x - bes.at(-1)) > step * 2) bes.push(Math.round(x * 10) / 10);
    }
  }
  const charges = legs.reduce((a, L) => a + roundTripCharges('options', L.premium, L.premium, qty).total, 0);
  return { legs, spot, days, ivPct, lot, lots, qty, netPerUnit: debit, netType: debit > 0 ? 'debit' : 'credit', netTotal: debit * qty,
    maxProfit, maxLoss, rr: Number.isFinite(maxProfit) && Number.isFinite(maxLoss) && maxLoss < 0 ? maxProfit / -maxLoss : null,
    breakevens: bes, greeks: net, charges, payoff, curve: grid.map((x, i) => [x, vals[i]]) };
}

// ═══ Position sizer ═════════════════════════════════════════════════════════
export function sizeDerivative(mode, capital, riskPct, lot, entry, stop, marginPerLot = null, maxCapitalPct = 100, brokerage = null) {
  if (mode === 'option-buy' && stop >= entry) throw new Error('Stop premium must be below entry for option buying');
  if (mode === 'option-sell' && stop <= entry) throw new Error('Stop premium must be above entry for option selling');
  if (entry === stop) throw new Error('Entry and stop cannot be equal');
  const seg = mode === 'futures' ? 'futures' : 'options', opts = { brokeragePerOrder: brokerage };
  const budget = (capital * riskPct) / 100, pts = Math.abs(entry - stop);
  const ch1 = mode === 'option-sell' ? roundTripCharges(seg, stop, entry, lot, opts).total
    : roundTripCharges(seg, Math.min(entry, stop), Math.max(entry, stop), lot, opts).total;
  const perLot = pts * lot + ch1;
  const limits = { risk: Math.floor(budget / perLot) };
  const capBudget = (capital * maxCapitalPct) / 100;
  if (mode === 'option-buy') limits.capital = Math.floor(capBudget / (entry * lot));
  if (marginPerLot) limits.margin = Math.floor(capBudget / marginPerLot);
  const binding = Object.keys(limits).reduce((a, k) => (limits[k] < limits[a] ? k : a));
  const lots = Math.max(0, limits[binding]);
  const warnings = [];
  if ((mode === 'futures' || mode === 'option-sell') && !marginPerLot) warnings.push("Margin per lot not given — check your broker's margin before trading.");
  if (lots === 0) warnings.push('Even 1 lot exceeds your risk budget. Tighten the stop, raise risk %, or skip the trade.');
  if (mode === 'option-sell') warnings.push('Short options can gap beyond your stop — consider a hedge (spread).');
  return { mode, budget, pts, ch1, perLot, limits, binding, lots, qty: lots * lot, totalRisk: lots * perLot,
    totalRiskPct: (lots * perLot / capital) * 100, outlay: mode === 'option-buy' ? entry * lots * lot : null,
    margin: marginPerLot ? marginPerLot * lots : null, warnings };
}
export function sizeEquity(capital, riskPct, entry, stop, intraday = false, leverage = 1, maxPositionPct = 25, brokerage = null) {
  if (stop >= entry) throw new Error('Stop must be below entry for a long trade');
  const seg = intraday ? 'equity_intraday' : 'equity_delivery', opts = { brokeragePerOrder: brokerage };
  const budget = (capital * riskPct) / 100, per = entry - stop;
  let shares = Math.floor(budget / per);
  while (shares > 0 && shares * per + roundTripCharges(seg, stop, entry, shares, opts).total > budget) shares--;
  const byCap = Math.floor((capital * (intraday ? leverage : 1) * maxPositionPct) / 100 / entry);
  const final = Math.max(0, Math.min(shares, byCap));
  return { budget, shares: final, byRisk: shares, byCap, binding: shares <= byCap ? 'risk' : 'position cap',
    value: final * entry, risk: final ? final * per + roundTripCharges(seg, stop, entry, final, opts).total : 0 };
}

// ═══ Intraday risk guard ════════════════════════════════════════════════════
export const DEFAULT_RULES = {
  max_daily_loss_pct: 2, max_trades_per_day: 6, max_consecutive_losses: 3, profit_lock_pct: 3,
  no_trade_before: '09:20', no_new_trade_after: '15:00', expiry_day_size_factor: 0.5,
  weekly_dd_stop_pct: 5, monthly_dd_stop_pct: 10, reduce_at_dd_pct: 6,
};
export function riskGuard(trades, capital, rules = {}, { now = null, expiryDay = false, equity = null, holiday = false } = {}) {
  const R = { ...DEFAULT_RULES, ...rules };
  trades = [...trades].sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  const pnl = trades.reduce((a, t) => a + t.net, 0);
  let peak = 0, run = 0;
  trades.forEach((t) => { run += t.net; peak = Math.max(peak, run); });
  let consec = 0;
  for (let i = trades.length - 1; i >= 0 && trades[i].net < 0; i--) consec++;
  const limit = (capital * R.max_daily_loss_pct) / 100;
  let status = 'GO'; const reasons = [], actions = [];
  const stop = (m) => { status = 'STOP'; reasons.push(m); };
  const reduce = (m) => { if (status !== 'STOP') status = 'REDUCE'; reasons.push(m); };
  if (holiday) stop('Market holiday / weekend');
  if (-pnl >= limit) stop(`Daily loss hit the ${R.max_daily_loss_pct}% limit`);
  else if (-pnl >= 0.7 * limit) reduce(`Daily loss at ${Math.round((-pnl / limit) * 100)}% of limit — half size, A+ setups only`);
  if (trades.length >= R.max_trades_per_day) stop(`Max trades reached (${trades.length}/${R.max_trades_per_day})`);
  if (consec >= R.max_consecutive_losses) stop(`${consec} losses in a row — take a break`);
  else if (consec === R.max_consecutive_losses - 1 && consec > 0) reduce(`${consec} losses in a row — next trade half size`);
  const lock = (capital * R.profit_lock_pct) / 100;
  if (peak >= lock && pnl < peak * 0.5) stop('Gave back over half of the day’s peak profit — lock the rest');
  else if (peak >= lock) actions.push(`Profit lock: stop if day P&L falls below ₹${Math.round(peak * 0.5).toLocaleString('en-IN')}`);
  if (now) {
    if (now < R.no_trade_before && now >= '09:00') reduce(`Before ${R.no_trade_before} — let the opening settle`);
    if (now >= R.no_new_trade_after) stop(`After ${R.no_new_trade_after} — no new intraday positions`);
  }
  if (expiryDay) actions.push(`Expiry day: size × ${R.expiry_day_size_factor}; avoid far-OTM buying after 13:30; no naked ATM shorts`);
  let dd = null;
  if (equity?.length > 1) {
    const v = equity.map((e) => e.equity), cur = v.at(-1);
    const ddp = (arr) => ((Math.max(...arr) - cur) / Math.max(...arr)) * 100;
    dd = { fromPeak: ddp(v), week: ddp(v.slice(-6)), month: ddp(v.slice(-22)) };
    if (dd.month >= R.monthly_dd_stop_pct) stop(`Monthly drawdown ${dd.month.toFixed(1)}% — circuit breaker: paper-trade until review`);
    else if (dd.week >= R.weekly_dd_stop_pct) stop(`Weekly drawdown ${dd.week.toFixed(1)}% — stop for the week`);
    else if (dd.fromPeak >= R.reduce_at_dd_pct) reduce(`Drawdown ${dd.fromPeak.toFixed(1)}% from peak — half size`);
  }
  const left = Math.max(limit + pnl, 0);
  return { status, pnl, peak, trades: trades.length, tradesLeft: Math.max(R.max_trades_per_day - trades.length, 0), consec, limit,
    riskLeft: left, nextRisk: status === 'STOP' ? 0 : Math.min(left, capital * 0.01) * (status === 'REDUCE' || expiryDay ? 0.5 : 1),
    dd, reasons: reasons.length ? reasons : ['All rules within limits'], actions, rules: R };
}

// ═══ Pre-trade checklist ════════════════════════════════════════════════════
export function preTradeCheck(p) {
  const checks = [], blockers = [], warnings = [];
  const chk = (name, ok, block, why) => { checks.push({ name, pass: !!ok }); if (!ok) (block ? blockers : warnings).push(why ? `${name} — ${why}` : name); };
  const entry = +p.entry || 0, stop = +p.stop || 0, target = +p.target || 0, long = (p.direction || 'long') === 'long';
  let hasStop = stop > 0 && (long ? stop < entry : stop > entry);
  if (p.instrument === 'option') hasStop = stop > 0 && stop < entry;
  chk('Stop-loss on the correct side', hasStop, true, 'no trade without a stop');
  const risk = Math.abs(entry - stop), reward = target ? Math.abs(target - entry) : 0, rr = risk ? reward / risk : 0;
  chk('Reward:risk ≥ 1.5', rr >= 1.5, false, `R:R is ${rr.toFixed(2)}`);
  chk('Risk per trade ≤ 2%', (+p.riskPct || 1) <= 2, true, 'oversized');
  chk('Risk guard not STOP', p.guard !== 'STOP', true, 'daily limits hit');
  if (p.guard === 'REDUCE') warnings.push('Risk guard says REDUCE — half size');
  chk('Market regime allows new risk', p.posture !== 'stand_aside', true, 'regime is stand_aside');
  chk('With the higher-timeframe trend', p.trendAligned !== false, false, 'counter-trend: smaller size, quicker exit');
  chk('No major event in the next hours', !p.eventRisk, false, 'results / RBI / Budget / US data can gap the price');
  chk('Liquid strike / tight spread', p.liquidityOk !== false, true, 'illiquid strikes slip badly');
  chk('Named setup', !!p.setup, false, "random trades can't be reviewed");
  chk('Written reason', String(p.reason || '').length >= 15, false, 'write why, before entering');
  if (p.instrument === 'option' && p.expiryDay && long) warnings.push('Buying options on expiry day — theta decay is brutal after 1:30 pm');
  const score = Math.round((checks.filter((c) => c.pass).length / checks.length) * 100);
  return { verdict: blockers.length ? 'BLOCKED' : warnings.length ? 'CAUTION' : 'CLEAR', score, rr, blockers, warnings, checks };
}

// ═══ Trade journal ══════════════════════════════════════════════════════════
export function enrichTrade(t, brokerage = null) {
  const q = +t.qty, e = +t.entry, x = +t.exit, long = String(t.side || 'BUY').toUpperCase().startsWith('B');
  const gross = long ? (x - e) * q : (e - x) * q;
  const [buy, sell] = long ? [e, x] : [x, e];
  const charges = roundTripCharges(t.segment || 'options', buy, sell, q, { brokeragePerOrder: brokerage }).total;
  return { ...t, gross, charges, net: gross - charges };
}
export function tradeStats(trades) {
  if (!trades.length) return { trades: 0 };
  const nets = trades.map((t) => t.net), wins = nets.filter((n) => n > 0), losses = nets.filter((n) => n <= 0);
  let eq = 0, pk = 0, mdd = 0; nets.forEach((n) => { eq += n; pk = Math.max(pk, eq); mdd = Math.max(mdd, pk - eq); });
  const s = (a) => a.reduce((x, y) => x + y, 0), avgW = safeDiv(s(wins), wins.length), avgL = safeDiv(s(losses), losses.length);
  return { trades: nets.length, net: s(nets), gross: s(trades.map((t) => t.gross)), charges: s(trades.map((t) => t.charges)),
    winRate: (wins.length / nets.length) * 100, avgWin: avgW, avgLoss: avgL, payoff: safeDiv(avgW, Math.abs(avgL)),
    profitFactor: losses.length && s(losses) !== 0 ? s(wins) / Math.abs(s(losses)) : null, expectancy: s(nets) / nets.length,
    maxDD: mdd, best: Math.max(...nets), worst: Math.min(...nets) };
}
export function journalReview(trades) {
  const group = (fn) => { const g = {}; trades.forEach((t) => { (g[fn(t)] ||= []).push(t); }); return Object.fromEntries(Object.entries(g).sort().map(([k, v]) => [k, tradeStats(v)])); };
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const overall = tradeStats(trades), bySetup = group((t) => t.setup || 'untagged');
  const byHour = group((t) => (t.time || '??').slice(0, 2) + ':00');
  const insights = [];
  if (overall.trades) {
    if (overall.charges > 0.3 * Math.max(Math.abs(overall.gross), 1)) insights.push(`Charges are ${Math.round((overall.charges / Math.max(Math.abs(overall.gross), 1)) * 100)}% of gross P&L — trade less, aim for bigger moves`);
    const ent = Object.entries(bySetup);
    const best = ent.reduce((a, b) => (b[1].net > a[1].net ? b : a)), worst = ent.reduce((a, b) => (b[1].net < a[1].net ? b : a));
    if (best[1].net > 0) insights.push(`Best setup: ${best[0]} — do more of this`);
    if (worst[1].net < 0) insights.push(`Worst setup: ${worst[0]} — cut or fix it`);
    if (overall.payoff < 1 && overall.winRate < 55) insights.push('Average loss bigger than average win — cut losers faster, let winners run');
    const bad = Object.entries(byHour).filter(([, s]) => s.net < 0 && s.trades >= 3).map(([h]) => h);
    if (bad.length) insights.push(`Losing hours: ${bad.join(', ')} — consider not trading then`);
  }
  return { overall, bySetup, byHour, byWeekday: group((t) => days[new Date(t.date + 'T00:00:00Z').getUTCDay()]), insights };
}
