// SRK Trading — app shell and screens.
import { CONFIG, holidayCoverageWarning, inr, isTradingDay, iso, lotSize, nowISTTime, num, roundTripCharges, breakevenMove, todayIST, upcomingExpiries } from './core.js';
import * as S from './skills.js';
import * as D from './data.js';
import { store } from './store.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cls = (x) => (x > 0 ? 'up' : x < 0 ? 'dn' : '');
const sgn = (x, dp = 2) => (x > 0 ? '+' : '') + num(x, dp);
const spin = '<span class="spin"></span>';
const view = $('#view');

function toast(msg, ms = 2600) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, ms); }
const settings = () => ({ capital: 200000, riskPct: 1, brokerage: 20, dataSource: 'auto', rules: {}, watchlist: D.DEFAULT_WATCHLIST, ...store.get('settings', {}) });
const saveSettings = (patch) => store.set('settings', { ...store.get('settings', {}), ...patch });
const val = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };
const nval = (id) => { const v = parseFloat(val(id)); return Number.isFinite(v) ? v : null; };
const pillFor = (x) => ({ aggressive: 'g', normal: 'b', defensive: 'y', stand_aside: 'r', GO: 'g', REDUCE: 'y', STOP: 'r', CLEAR: 'g', CAUTION: 'y', BLOCKED: 'r',
  bullish: 'g', 'mildly bullish': 'g', neutral: 'b', 'mildly bearish': 'y', bearish: 'r', Leading: 'g', Improving: 'b', Weakening: 'y', Lagging: 'r' }[x] || 'b');
const errBox = (e) => `<div class="card err">⚠️ ${esc(e.message || e)}</div>`;
const disclaimer = '<div class="disc">Educational decision-support only — not SEBI-registered investment advice. Trading involves risk of loss.</div>';

// ─── navigation ─────────────────────────────────────────────────────────────
const state = { tab: 'home', sub: { options: 'chain', scan: 'screener', tools: 'sizer', journal: 'today' }, strategySeed: null };
const SUBS = {
  options: [['chain', 'Option chain'], ['strategy', 'Strategy'], ['expiry', 'Expiry']],
  scan: [['screener', 'Screener'], ['sectors', 'Sectors'], ['tech', 'Technicals']],
  tools: [['sizer', 'Position size'], ['charges', 'Charges'], ['checklist', 'Pre-trade check']],
  journal: [['today', 'Today'], ['review', 'Review']],
};
function go(tab, sub) {
  state.tab = tab; if (sub) state.sub[tab] = sub;
  $$('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  render();
}
$('#tabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) go(b.dataset.tab); });
window.srkBack = () => {
  const sh = $('.sheet'); if (sh) { sh.remove(); return true; }
  if (state.tab !== 'home') { go('home'); return true; }
  return false;
};
function segHtml(tab) {
  return `<div class="seg">${SUBS[tab].map(([k, l]) => `<button data-sub="${k}" class="${state.sub[tab] === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
}
function render() {
  updateBadge();
  view.scrollTop = 0;
  const t = state.tab;
  const screen = { home: Home, options: { chain: Chain, strategy: Strategy, expiry: Expiry }, scan: { screener: Screener, sectors: Sectors, tech: Tech },
    tools: { sizer: Sizer, charges: Charges, checklist: Checklist }, journal: { today: JournalToday, review: JournalReview } }[t];
  const fn = typeof screen === 'function' ? screen : screen[state.sub[t]];
  view.innerHTML = (SUBS[t] ? segHtml(t) : '') + '<div id="screen"></div>';
  $$('.seg button', view).forEach((b) => b.addEventListener('click', () => go(t, b.dataset.sub)));
  fn($('#screen'));
}
function updateBadge() {
  const b = $('#srcBadge'); const lb = D.liveBroker(), live = !!lb;
  b.textContent = live ? `● ${D.BROKER_NAME[lb]} live` : '○ Free delayed';
  b.classList.toggle('live', live);
}
$('#srcBadge').addEventListener('click', () => openSettings());
$('#btnSettings').addEventListener('click', () => openSettings());

// ─── journal helpers ────────────────────────────────────────────────────────
const journal = () => store.get('journal', []);
const enriched = () => journal().map((t) => S.enrichTrade(t, settings().brokerage));
function todaysTrades() { const d = iso(todayIST()); return enriched().filter((t) => t.date === d); }
function equityCurve() {
  const cap = settings().capital; const byDay = {};
  enriched().forEach((t) => { byDay[t.date] = (byDay[t.date] || 0) + t.net; });
  let eq = cap; return Object.keys(byDay).sort().map((d) => ({ date: d, equity: (eq += byDay[d]) }));
}
function guardNow() {
  const s = settings(), today = todayIST();
  const expiryDay = ['NIFTY', 'SENSEX', 'BANKNIFTY'].some((x) => upcomingExpiries(x, today, 1)[0]?.calendarDaysLeft === 0);
  return S.riskGuard(todaysTrades(), s.capital, s.rules, { now: nowISTTime(), expiryDay, equity: equityCurve(), holiday: !isTradingDay(today) });
}

// ═══ HOME ═══════════════════════════════════════════════════════════════════
async function Home(el) {
  el.innerHTML = `<div class="card">${spin} Loading market data…</div>`;
  try {
    const [n, b, v] = await Promise.all(['NIFTY', 'BANKNIFTY', 'INDIAVIX'].map((s) => D.candles(s).catch(() => null)));
    if (!n) throw new Error('Could not load NIFTY data. Check internet, or log in to Angel One in Settings.');
    const live = await D.liveIndexQuotes().catch(() => null);
    const patch = (c, q) => {
      if (!c || !q?.ltp) return c; const rows = c.rows.slice(); const d = iso(todayIST()); const last = rows.at(-1);
      const bar = { date: d, open: +q.open || +q.ltp, high: +q.high || +q.ltp, low: +q.low || +q.ltp, close: +q.ltp, volume: last.volume };
      if (last.date === d) rows[rows.length - 1] = bar; else if (isTradingDay(todayIST())) rows.push(bar);
      return { ...c, rows };
    };
    const N = patch(n, live?.NIFTY), B = patch(b, live?.BANKNIFTY), V = patch(v, live?.INDIAVIX);
    await autoFiiDii();
    const flows = store.get('flows', []);
    const global = await D.globalCues().catch(() => ({}));
    const st = settings();
    const R = S.marketRegime({ nifty: N.rows, banknifty: B?.rows, vix: V?.rows, flows, global, breadth: st.breadth });
    store.set('lastRegime', { posture: R.posture, score: R.score, day: iso(todayIST()) });
    const g = guardNow(); const F = S.analyzeFlows(flows);
    const exps = ['NIFTY', 'SENSEX', 'BANKNIFTY'].map((s) => upcomingExpiries(s, todayIST(), 1)[0]).filter(Boolean);
    const warn = holidayCoverageWarning();
    const tile = (k, d) => d ? `<div class="tile"><div class="k">${k}</div><div class="v">${num(d.close ?? d.value, 2)}</div><div class="small ${cls(d.chgPct)}">${sgn(d.chgPct)}%</div></div>` : '';
    el.innerHTML = `
      <div class="card">
        <div class="between"><h3>Market regime <small>${esc(N.rows.at(-1).date)} · ${esc(live && Object.keys(live).length ? D.BROKER_NAME[D.liveBroker()] + ' live' : N.source)}</small></h3>
          <button class="btn sm sec" id="refresh">↻</button></div>
        <div class="between"><span class="big">${R.score}<span class="mut small">/100</span></span><span class="pill ${pillFor(R.posture)}">${R.posture.replace('_', ' ').toUpperCase()}</span></div>
        <div class="gauge"><i style="left:calc(${R.score}% - 2px)"></i></div>
        <div>${esc(R.guidance)}</div>
        <ul class="notes small mut">${R.notes.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      </div>
      <div class="grid3">${tile('NIFTY', R.nifty)}${tile('BANK NIFTY', R.banknifty)}${R.vix ? `<div class="tile"><div class="k">INDIA VIX</div><div class="v">${num(R.vix.value)}</div><div class="small ${cls(-R.vix.chgPct)}">${sgn(R.vix.chgPct)}%</div></div>` : ''}</div>
      ${R.scalping.length ? `<div class="card" style="margin-top:12px"><h3>Intraday / scalping</h3><ul class="notes">${R.scalping.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
      <div class="card" ${R.scalping.length ? '' : 'style="margin-top:12px"'}>
        <div class="between"><h3>Risk guard</h3><span class="pill ${pillFor(g.status)}">${g.status}</span></div>
        <div class="small">Day P&L <b class="${cls(g.pnl)}">${inr(g.pnl)}</b> · trades ${g.trades} (left ${g.tradesLeft}) · max risk next trade <b>${inr(g.nextRisk)}</b></div>
        <ul class="notes small">${g.reasons.concat(g.actions).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      </div>
      <div class="card"><h3>Next expiries</h3>${exps.map((e) => `<div class="between small"><span>${e.symbol} <span class="mut">${e.kind}</span></span><span>${e.expiry} · ${e.calendarDaysLeft === 0 ? '<b class="warn">TODAY</b>' : e.calendarDaysLeft + ' days'}${e.shifted ? ' <span class="warn">(holiday shift)</span>' : ''}</span></div>`).join('')}
        ${warn ? `<div class="small warn" style="margin-top:6px">${esc(warn)}</div>` : ''}</div>
      <div class="card"><h3>FII / DII <small>₹ crore</small></h3>
        ${F ? `<div class="grid2 small"><div>FII 5d <b class="${cls(F.fii.d5)}">${num(F.fii.d5, 0)}</b> · streak ${F.fiiStreak}</div><div>DII 5d <b class="${cls(F.dii.d5)}">${num(F.dii.d5, 0)}</b> · streak ${F.diiStreak}</div></div>
          <div style="margin-top:6px"><b>${esc(F.reading)}</b></div><div class="small mut">Last: ${esc(F.last.date)} FII ${num(F.last.fii, 0)} / DII ${num(F.last.dii, 0)}</div>` : '<div class="small mut">No flow data yet.</div>'}
        <div class="row" style="margin-top:8px"><input id="fDate" type="date" value="${iso(todayIST())}"><input id="fFii" type="number" placeholder="FII net" inputmode="decimal"><input id="fDii" type="number" placeholder="DII net" inputmode="decimal"></div>
        <button class="btn sec" id="addFlow">Save FII/DII</button></div>
      <div class="card small"><h3>Global cues</h3>${Object.keys(global).length ? Object.entries(global).map(([k, x]) => `<span style="margin-right:10px">${k.toUpperCase()} <b class="${cls(k === 'brent' || k === 'usdinr' || k === 'dxy' ? -x : x)}">${sgn(x)}%</b></span>`).join('') : '<span class="mut">Unavailable</span>'}
        <label>GIFT Nifty vs Nifty close (%) — optional, from your broker app</label><div class="row"><input id="gift" type="number" step="0.01" inputmode="decimal" value="${esc(st.giftNiftyPct ?? '')}"><button class="btn sm sec" id="saveGift">Save</button></div></div>
      ${disclaimer}`;
    $('#refresh').onclick = () => { D.clearCache(); Home(el); };
    $('#addFlow').onclick = () => {
      const fii = nval('fFii'), dii = nval('fDii'); if (fii === null || dii === null) return toast('Enter both FII and DII net values');
      saveFlow({ date: val('fDate'), fii, dii }); toast('Saved'); Home(el);
    };
    $('#saveGift').onclick = () => { saveSettings({ giftNiftyPct: val('gift') === '' ? null : +val('gift') }); D.clearCache(); toast('Saved'); Home(el); };
  } catch (e) { el.innerHTML = errBox(e) + `<button class="btn" id="retry">Retry</button>`; $('#retry').onclick = () => Home(el); }
}
function saveFlow(row) {
  const rows = store.get('flows', []).filter((r) => r.date !== row.date); rows.push(row); rows.sort((a, b) => a.date.localeCompare(b.date));
  store.set('flows', rows.slice(-120));
}
async function autoFiiDii() {
  const k = 'fiiAuto:' + iso(todayIST()) + ':' + (new Date().getUTCHours() >= 12 ? 'pm' : 'am');
  if (store.get(k)) return; store.set(k, 1);
  try { const r = await D.nseFiiDii(); saveFlow(r); } catch { /* manual entry still works */ }
}

// ═══ OPTION CHAIN ═══════════════════════════════════════════════════════════
const INDICES = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY'];
async function Chain(el) {
  const last = store.get('chainPrefs', { symbol: 'NIFTY' });
  el.innerHTML = `<div class="card"><div class="row"><select id="cSym">${INDICES.map((s) => `<option ${s === last.symbol ? 'selected' : ''}>${s}</option>`).join('')}<option value="_">Stock…</option></select>
    <input id="cStock" placeholder="e.g. RELIANCE" style="display:${INDICES.includes(last.symbol) ? 'none' : 'block'}" value="${INDICES.includes(last.symbol) ? '' : esc(last.symbol)}"></div>
    <div class="row" style="margin-top:8px"><select id="cExp"><option value="">Nearest expiry</option></select><button class="btn sm" id="cLoad">Load</button></div>
    <div class="small mut" id="cSrc" style="margin-top:6px"></div></div><div id="cOut"></div>`;
  if (!INDICES.includes(last.symbol)) $('#cSym').value = '_';
  $('#cSym').onchange = () => { $('#cStock').style.display = $('#cSym').value === '_' ? 'block' : 'none'; $('#cExp').innerHTML = '<option value="">Nearest expiry</option>'; };
  const load = async () => {
    const sym = ($('#cSym').value === '_' ? val('cStock') : $('#cSym').value).trim().toUpperCase();
    if (!sym) return toast('Enter a stock symbol');
    store.set('chainPrefs', { symbol: sym });
    $('#cOut').innerHTML = `<div class="card">${spin} Loading ${esc(sym)} option chain…${D.liveBroker() ? `<div class="small mut">First load of the day downloads ${D.BROKER_NAME[D.liveBroker()]}’s instrument list (may take ~30 s).</div>` : ''}</div>`;
    try {
      const ch = await D.optionChain(sym, val('cExp') || null);
      if (!ch.rows.length) throw new Error('No option data returned');
      $('#cExp').innerHTML = ch.expiries.slice(0, 8).map((e) => `<option ${e === ch.expiry ? 'selected' : ''}>${e}</option>`).join('');
      $('#cSrc').textContent = `${ch.source} · expiry ${ch.expiry}${ch.note ? ' · ' + ch.note : ''}`;
      const A = S.analyzeChain(ch.rows, ch.spot);
      const lot = ch.lot || CONFIG.lot_sizes[sym] || null;
      const days = Math.max(Math.round((new Date(ch.expiry + 'T10:00:00Z') - todayIST()) / 86400000), 0);
      const iv = A.atmIv.ce || A.atmIv.pe || null;
      state.strategySeed = { symbol: sym, spot: Math.round(A.spot * 100) / 100, days, iv, lot, atm: A.atm, step: guessStep(ch.rows), chain: ch.rows };
      const fmtW = (xs, k) => xs.map((r) => `${r.strike} <span class="mut">(${num(r[k] / 1000, 0)}k)</span>`).join(', ');
      $('#cOut').innerHTML = `
        <div class="card"><div class="between"><h3>${esc(sym)} <small>spot ${num(A.spot)} · ATM ${A.atm}</small></h3><span class="pill ${pillFor(A.bias)}">${A.bias.toUpperCase()}</span></div>
          <div class="grid3"><div class="tile"><div class="k">PCR (OI)</div><div class="v">${num(A.pcr)}</div></div><div class="tile"><div class="k">Max pain</div><div class="v">${A.maxPain}</div></div><div class="tile"><div class="k">ATM straddle</div><div class="v">${num(A.straddle, 1)}</div></div></div>
          <ul class="notes small" style="margin-top:10px">
            <li><b class="dn">Resistance</b> (call OI): ${fmtW(A.resistance, 'ceOi')}${A.freshRes ? ` · fresh writing ${A.freshRes}` : ''}</li>
            <li><b class="up">Support</b> (put OI): ${fmtW(A.support, 'peOi')}${A.freshSup ? ` · fresh writing ${A.freshSup}` : ''}</li>
            <li>Market-implied range to expiry: <b>${num(A.range[0], 0)} – ${num(A.range[1], 0)}</b></li>
            ${A.pcrChg !== null ? `<li>PCR of change in OI: ${num(A.pcrChg)}</li>` : ''}
            ${A.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
          <button class="btn sec" id="toStrat">Build a strategy from this chain →</button></div>
        <div class="card scroll"><table><tr><th>CE OI</th><th>ΔOI</th><th>CE LTP</th><th style="text-align:center">Strike</th><th>PE LTP</th><th>ΔOI</th><th>PE OI</th></tr>
          ${A.near.map((r) => `<tr class="${r.strike === A.atm ? 'atm' : ''}"><td>${num(r.ceOi / 1000, 0)}k</td><td class="${cls(r.ceChgOi)}">${num(r.ceChgOi / 1000, 0)}k</td><td>${num(r.ceLtp, 1)}</td><td style="text-align:center"><b>${r.strike}</b></td><td>${num(r.peLtp, 1)}</td><td class="${cls(r.peChgOi)}">${num(r.peChgOi / 1000, 0)}k</td><td>${num(r.peOi / 1000, 0)}k</td></tr>`).join('')}
        </table><div class="small mut" style="margin-top:6px">OI shows where option writers are positioned — not a guaranteed level.</div></div>`;
      $('#toStrat').onclick = () => go('options', 'strategy');
    } catch (e) {
      $('#cOut').innerHTML = errBox(e) + `<div class="card small mut">If the free NSE source is blocked, log in to Angel One or HDFC Securities in Settings for live option chains.</div>`;
    }
  };
  $('#cLoad').onclick = load;
}
function guessStep(rows) { const k = rows.map((r) => r.strike).sort((a, b) => a - b); const d = k.slice(1).map((x, i) => x - k[i]).filter((x) => x > 0); return d.length ? Math.min(...d) : 50; }

// ═══ STRATEGY ═══════════════════════════════════════════════════════════════
function Strategy(el) {
  const seed = state.strategySeed || {};
  const sym = seed.symbol || 'NIFTY';
  const exp = upcomingExpiries(INDICES.includes(sym) || sym === 'SENSEX' ? sym : 'NIFTY', todayIST(), 1)[0];
  el.innerHTML = `<div class="card">
    <div class="grid2"><div><label>Underlying</label><input id="sSym" value="${esc(sym)}"></div><div><label>Lot size</label><input id="sLot" type="number" value="${seed.lot || CONFIG.lot_sizes[sym] || ''}"></div>
    <div><label>Spot</label><input id="sSpot" type="number" inputmode="decimal" value="${seed.spot || ''}"></div><div><label>Days to expiry</label><input id="sDays" type="number" value="${seed.days ?? exp?.calendarDaysLeft ?? 7}"></div>
    <div><label>IV %</label><input id="sIv" type="number" inputmode="decimal" value="${seed.iv ? num(seed.iv, 1) : 12}"></div><div><label>Lots</label><input id="sLots" type="number" value="1"></div></div>
    <label>Strategy</label><select id="sPre">${Object.entries(S.PRESETS).map(([k, p]) => `<option value="${k}">${p.label}</option>`).join('')}</select>
    <div id="sLegs"></div><button class="btn" id="sGo">Analyse</button></div><div id="sOut"></div>${disclaimer}`;
  const legsUI = () => {
    const p = S.PRESETS[val('sPre')], step = seed.step || (val('sSym').toUpperCase() === 'BANKNIFTY' ? 100 : 50);
    const atm = seed.atm || (nval('sSpot') ? Math.round(nval('sSpot') / step) * step : 0);
    const pre = val('sPre');
    const two = pre.includes('strangle') ? [atm - 4 * step, atm + 4 * step] : pre.includes('put') ? [atm - 4 * step, atm] : [atm, atm + 4 * step];
    const defaults = { 1: [atm], 2: two, 3: [atm - 4 * step, atm, atm + 4 * step], 4: [atm - 8 * step, atm - 4 * step, atm + 4 * step, atm + 8 * step] }[p.n];
    const legs = p.legs([...defaults].sort((a, b) => a - b));
    const prem = (kind, k) => { const r = seed.chain?.find((x) => x.strike === k); const v = r ? (kind === 'CE' ? r.ceLtp : r.peLtp) : null; return v ? Math.round(v * 100) / 100 : ''; };
    $('#sLegs').innerHTML = `<label>Strikes (low → high) and market premiums <span class="mut">(blank = theoretical)</span></label>` +
      legs.map(([side, kind, k], i) => `<div class="row" style="margin-top:6px"><span class="small" style="flex:0 0 76px">${side.toUpperCase()} ${kind}</span><input class="lk" data-i="${i}" type="number" value="${k}"><input class="lp" data-i="${i}" type="number" inputmode="decimal" placeholder="premium" value="${prem(kind, k)}"></div>`).join('');
  };
  $('#sPre').onchange = legsUI; legsUI();
  $('#sGo').onclick = () => {
    try {
      const pre = val('sPre'), p = S.PRESETS[pre];
      const ks = $$('.lk').map((x) => +x.value), ps = $$('.lp').map((x) => (x.value === '' ? null : +x.value));
      const shape = p.legs(ks.map(() => 0));   // side/kind per leg, in display order
      const legs = ks.map((k, i) => ({ side: shape[i][0], kind: shape[i][1], strike: k, premium: ps[i] }));
      const lot = nval('sLot'), spot = nval('sSpot');
      if (!lot || !spot) throw new Error('Enter spot and lot size');
      const R = S.analyzeStrategy(legs, spot, nval('sDays') ?? 7, nval('sIv') || 12, lot, nval('sLots') || 1);
      const f = (x) => (x === Infinity ? 'Unlimited' : x === -Infinity ? 'Unlimited' : inr(x));
      const pts = [-3, -2, -1, -0.5, 0, 0.5, 1, 2, 3].map((q) => Math.round(spot * (1 + q / 100) / 10) * 10);
      $('#sOut').innerHTML = `<div class="card"><h3>${p.label} <small>${R.lots} × ${R.lot}</small></h3>
        <div class="grid2"><div class="tile"><div class="k">Net ${R.netType}</div><div class="v">${inr(Math.abs(R.netTotal))}</div></div><div class="tile"><div class="k">Breakeven</div><div class="v small">${R.breakevens.join(' / ') || '—'}</div></div>
        <div class="tile"><div class="k">Max profit</div><div class="v up">${f(R.maxProfit)}</div></div><div class="tile"><div class="k">Max loss</div><div class="v dn">${f(R.maxLoss)}</div></div></div>
        ${payoffSvg(R)}
        <div class="small">Greeks (position): Δ ${num(R.greeks.delta, 1)} · Γ ${num(R.greeks.gamma, 3)} · Θ/day <b class="${cls(R.greeks.theta)}">${inr(R.greeks.theta)}</b> · Vega/1% ${inr(R.greeks.vega)}</div>
        <div class="small mut">${R.rr ? `Reward:risk ${num(R.rr)} · ` : ''}Est. charges ${inr(R.charges)}${R.legs.some((L) => L.estimated) ? ' · some premiums are theoretical (Black-Scholes)' : ''}</div>
        <table style="margin-top:8px"><tr><th>Spot at expiry</th><th>P&L</th></tr>${pts.map((x) => `<tr><td>${x}</td><td class="${cls(R.payoff(x))}">${inr(R.payoff(x))}</td></tr>`).join('')}</table></div>`;
    } catch (e) { $('#sOut').innerHTML = errBox(e); }
  };
}
function payoffSvg(R) {
  const W = 340, H = 160, pad = 26; const c = R.curve;
  const lo = R.spot * 0.95, hi = R.spot * 1.05; const pts = c.filter((p) => p[0] >= lo && p[0] <= hi);
  const ymin = Math.min(...pts.map((p) => p[1]), 0), ymax = Math.max(...pts.map((p) => p[1]), 0);
  const X = (x) => pad + ((x - lo) / (hi - lo)) * (W - pad - 6), Y = (y) => 8 + (1 - (y - ymin) / ((ymax - ymin) || 1)) * (H - 28);
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;margin:10px 0">
    <line x1="${pad}" x2="${W - 6}" y1="${Y(0)}" y2="${Y(0)}" stroke="#3a4766" stroke-dasharray="3 3"/>
    <line x1="${X(R.spot)}" x2="${X(R.spot)}" y1="6" y2="${H - 20}" stroke="#3b82f6" stroke-dasharray="2 3"/>
    <path d="${path}" fill="none" stroke="#22c55e" stroke-width="2"/>
    <text x="${pad}" y="${H - 6}">${Math.round(lo)}</text><text x="${X(R.spot) - 14}" y="${H - 6}">${Math.round(R.spot)}</text><text x="${W - 40}" y="${H - 6}">${Math.round(hi)}</text>
    <text x="2" y="${Y(ymax) + 4}">${Math.round(ymax / 1000)}k</text><text x="2" y="${Y(ymin)}">${Math.round(ymin / 1000)}k</text></svg>`;
}

// ═══ EXPIRY ═════════════════════════════════════════════════════════════════
function Expiry(el) {
  const warn = holidayCoverageWarning();
  el.innerHTML = Object.keys(CONFIG.expiry_rules).map((s) => `<div class="card"><h3>${s} <small>lot ${CONFIG.lot_sizes[s]}</small></h3>${upcomingExpiries(s, todayIST(), 4).map((e) =>
    `<div class="between small"><span>${e.expiry} <span class="mut">${e.kind}</span></span><span>${e.calendarDaysLeft === 0 ? '<b class="warn">TODAY</b>' : `${e.calendarDaysLeft}d / ${e.tradingDaysLeft} trading`}${e.shifted ? ' <span class="warn">holiday shift</span>' : ''}</span></div>`).join('')}</div>`).join('') +
    (warn ? `<div class="card warn small">${esc(warn)}</div>` : '') + `<div class="small mut">Rules as of ${CONFIG.as_of}: NIFTY weekly Tuesday; BANKNIFTY, FINNIFTY, MIDCPNIFTY monthly (last Tuesday); SENSEX weekly Thursday.</div>`;
}

// ═══ SCREENER ═══════════════════════════════════════════════════════════════
const SCREEN_LABEL = { vcp: 'VCP', breakout: 'Breakout', momentum: 'Momentum', pullback: 'Pullback', high52: '52-week high', relative: 'Beats NIFTY' };
function Screener(el) {
  const st = settings(); const chosen = store.get('screens', ['breakout', 'momentum', 'pullback', 'relative']);
  el.innerHTML = `<div class="card"><h3>Scan your watchlist <small>${st.watchlist.length} stocks · edit in Settings</small></h3>
    ${S.SCREENS.map((s) => `<label class="check"><input type="checkbox" value="${s}" ${chosen.includes(s) ? 'checked' : ''}> ${SCREEN_LABEL[s]}</label>`).join('')}
    <label>Min. average traded value (₹ crore/day)</label><input id="scTo" type="number" value="${store.get('scTurnover', 10)}">
    <button class="btn" id="scGo">Run scan</button></div><div id="scOut"></div>${disclaimer}`;
  $('#scGo').onclick = async () => {
    const screens = $$('.check input', el).filter((x) => x.checked).map((x) => x.value);
    if (!screens.length) return toast('Pick at least one screen');
    store.set('screens', screens); store.set('scTurnover', nval('scTo') ?? 10);
    const out = $('#scOut'); let done = 0;
    out.innerHTML = `<div class="card">${spin} Scanning… <span id="scProg">0/${st.watchlist.length}</span></div>`;
    try {
      const bench = screens.includes('relative') ? (await D.candles('NIFTY')).rows.map((r) => r.close) : null;
      const res = await D.mapLimit(st.watchlist, 4, async (sym) => {
        const c = await D.candles(sym); done++; const p = $('#scProg'); if (p) p.textContent = `${done}/${st.watchlist.length}`;
        const r = S.screenStock(c.rows, screens, bench, 50, nval('scTo') ?? 10); return r ? { sym, ...r } : null;
      });
      const hits = res.filter((r) => r && !r.error).sort((a, b) => b.score - a.score || b.turnoverCr - a.turnoverCr);
      const errs = res.filter((r) => r && r.error).length;
      out.innerHTML = `<div class="card"><h3>${hits.length} matches <small>${errs ? errs + ' failed to load' : ''}</small></h3>${hits.length ? hits.map((h) => `
        <div class="trade" data-sym="${esc(h.sym)}"><div><b>${esc(h.sym)}</b> <span class="mut small">₹${num(h.close)}</span><div class="small mut">${Object.entries(h.hits).map(([k, v]) => `<span class="pill b" style="margin:2px 4px 0 0">${SCREEN_LABEL[k]}</span>${esc(v)}`).join('<br>')}</div></div><div class="small mut">${num(h.turnoverCr, 0)} cr<br>ATR ${num(h.atrPct, 1)}%</div></div>`).join('')
        : '<div class="mut small">Nothing matched today. That is normal in weak markets.</div>'}<div class="small mut" style="margin-top:8px">Tap a stock for its technicals. A scan is a shortlist, not a buy signal.</div></div>`;
      $$('[data-sym]', out).forEach((d) => d.addEventListener('click', () => { store.set('techSym', d.dataset.sym); go('scan', 'tech'); }));
    } catch (e) { out.innerHTML = errBox(e); }
  };
}

// ═══ SECTORS ════════════════════════════════════════════════════════════════
async function Sectors(el) {
  el.innerHTML = `<div class="card">${spin} Loading sector indices…</div>`;
  try {
    const bench = (await D.yahooCandles('^NSEI', '1y'));
    const data = {};
    await D.mapLimit(Object.entries(D.SECTORS), 4, async ([name, t]) => { data[name] = await D.yahooCandles(t, '1y'); });
    const rows = S.sectorRotation(data, bench);
    const q = (name) => rows.filter((r) => r.quadrant === name).map((r) => r.sector).join(', ') || '—';
    el.innerHTML = `<div class="card"><h3>Sector rotation vs NIFTY 50 <small>daily, Yahoo</small></h3>
      <div class="small"><b class="up">Leading:</b> ${q('Leading')}<br><b style="color:#8fb6ff">Improving:</b> ${q('Improving')}<br><b class="warn">Weakening:</b> ${q('Weakening')}<br><b class="dn">Lagging:</b> ${q('Lagging')}</div></div>
      <div class="card scroll"><table><tr><th>Sector</th><th>1W%</th><th>1M%</th><th>3M%</th><th></th></tr>${rows.map((r) => `<tr><td>${esc(r.sector)}</td><td class="${cls(r.ret1w)}">${num(r.ret1w, 1)}</td><td class="${cls(r.ret1m)}">${num(r.ret1m, 1)}</td><td class="${cls(r.ret3m)}">${num(r.ret3m, 1)}</td><td><span class="pill ${pillFor(r.quadrant)}">${r.quadrant}</span></td></tr>`).join('')}</table>
      <div class="small mut" style="margin-top:6px">Look for longs in Leading/Improving sectors; avoid longs in Lagging ones.</div></div>`;
  } catch (e) { el.innerHTML = errBox(e) + '<button class="btn" id="rt">Retry</button>'; $('#rt').onclick = () => Sectors(el); }
}

// ═══ TECHNICALS ═════════════════════════════════════════════════════════════
function Tech(el) {
  el.innerHTML = `<div class="card"><div class="row"><input id="tSym" placeholder="NIFTY, BANKNIFTY or stock e.g. RELIANCE" value="${esc(store.get('techSym', 'NIFTY'))}"><button class="btn sm" id="tGo">Analyse</button></div></div><div id="tOut"></div>${disclaimer}`;
  const run = async () => {
    const sym = val('tSym').trim().toUpperCase(); if (!sym) return; store.set('techSym', sym);
    $('#tOut').innerHTML = `<div class="card">${spin} Loading ${esc(sym)}…</div>`;
    try {
      const c = await D.candles(sym); const T = S.technicals(c.rows); const p = T.pivots;
      $('#tOut').innerHTML = `<div class="card"><div class="between"><h3>${esc(sym)} <small>${T.date} · ${esc(c.source)}</small></h3><span class="pill ${pillFor(T.bias)}">${T.bias.toUpperCase()}</span></div>
        <div class="between"><span class="big">${num(T.close)}</span><span class="${cls(T.chgPct)}">${sgn(T.chgPct)}%</span></div><div class="small mut">${esc(T.stage)}</div>
        <div class="grid3" style="margin-top:10px"><div class="tile"><div class="k">RSI 14</div><div class="v">${num(T.rsi14, 1)}</div></div><div class="tile"><div class="k">ATR</div><div class="v">${num(T.atr14, 1)}</div><div class="small mut">${num(T.atrPct, 2)}%</div></div><div class="tile"><div class="k">Supertrend</div><div class="v ${T.supertrend.dir === 1 ? 'up' : 'dn'}">${T.supertrend.dir === 1 ? 'UP' : 'DOWN'}</div><div class="small mut">${num(T.supertrend.value, 1)}</div></div></div>
        <table style="margin-top:10px"><tr><th>EMA 9</th><th>EMA 20</th><th>EMA 50</th><th>EMA 200</th></tr><tr>${[9, 20, 50, 200].map((k) => `<td class="${T.close > T.ema[k] ? 'up' : 'dn'}">${num(T.ema[k], 1)}</td>`).join('')}</tr></table>
        <h3 style="margin-top:12px">Next session levels</h3><table><tr><th>S2</th><th>S1</th><th>CPR</th><th>R1</th><th>R2</th></tr><tr><td>${num(p.s2, 1)}</td><td>${num(p.s1, 1)}</td><td>${num(p.cprBottom, 1)}–${num(p.cprTop, 1)}</td><td>${num(p.r1, 1)}</td><td>${num(p.r2, 1)}</td></tr></table>
        <ul class="notes small">${T.notes.map((n) => `<li>${esc(n)}</li>`).join('')}<li>52-week high ${num(T.hi52, 1)} (${num(T.fromHighPct, 1)}%), low ${num(T.lo52, 1)}</li><li>ATR stops: long ${num(T.stopLong, 1)} · short ${num(T.stopShort, 1)}</li></ul></div>`;
    } catch (e) { $('#tOut').innerHTML = errBox(e); }
  };
  $('#tGo').onclick = run; run();
}

// ═══ POSITION SIZER ═════════════════════════════════════════════════════════
function Sizer(el) {
  const st = settings();
  el.innerHTML = `<div class="card"><label>Trade type</label><select id="zMode"><option value="option-buy">Option buy</option><option value="futures">Futures</option><option value="option-sell">Option sell</option><option value="equity">Stock (equity)</option></select>
    <div class="grid2"><div><label>Capital ₹</label><input id="zCap" type="number" value="${st.capital}"></div><div><label>Risk % per trade</label><input id="zRisk" type="number" step="0.1" value="${st.riskPct}"></div></div>
    <div id="zFields"></div><button class="btn" id="zGo">Calculate</button></div><div id="zOut"></div>${disclaimer}`;
  const fields = () => {
    const m = val('zMode');
    $('#zFields').innerHTML = m === 'equity'
      ? `<div class="grid2"><div><label>Entry ₹</label><input id="zEn" type="number" inputmode="decimal"></div><div><label>Stop ₹</label><input id="zSl" type="number" inputmode="decimal"></div></div>
         <label class="check"><input type="checkbox" id="zIntra" checked> Intraday (MIS)</label><div class="grid2"><div><label>Intraday leverage ×</label><input id="zLev" type="number" value="5"></div><div><label>Max position % of capital</label><input id="zMaxPos" type="number" value="25"></div></div>`
      : `<div class="grid2"><div><label>Instrument</label><select id="zSym">${Object.keys(CONFIG.lot_sizes).map((s) => `<option>${s}</option>`).join('')}<option value="_">Stock F&O…</option></select></div><div><label>Lot size</label><input id="zLot" type="number" value="${CONFIG.lot_sizes.NIFTY}"></div>
         <div><label>${m === 'futures' ? 'Entry' : 'Entry premium'}</label><input id="zEn" type="number" inputmode="decimal"></div><div><label>${m === 'futures' ? 'Stop' : 'Stop premium'}</label><input id="zSl" type="number" inputmode="decimal"></div></div>
         ${m !== 'option-buy' ? '<label>Margin per lot ₹ (from broker)</label><input id="zMar" type="number">' : ''}`;
    const sym = $('#zSym'); if (sym) sym.onchange = () => { if (sym.value !== '_') $('#zLot').value = CONFIG.lot_sizes[sym.value]; };
  };
  $('#zMode').onchange = fields; fields();
  $('#zGo').onclick = () => {
    try {
      const m = val('zMode'), cap = nval('zCap'), risk = nval('zRisk'), en = nval('zEn'), sl = nval('zSl');
      if (!cap || !risk || !en || !sl) throw new Error('Fill capital, risk, entry and stop');
      const g = guardNow(); let note = '';
      if (g.status === 'STOP') note = '<div class="card err">Risk guard says STOP for today — no new trades.</div>';
      else if (g.status === 'REDUCE') note = '<div class="card warn small">Risk guard says REDUCE — consider half of this size.</div>';
      if (m === 'equity') {
        const r = S.sizeEquity(cap, risk, en, sl, $('#zIntra').checked, nval('zLev') || 1, nval('zMaxPos') || 25, st.brokerage);
        $('#zOut').innerHTML = note + `<div class="card"><h3>Buy <span class="big">${r.shares}</span> shares</h3><div class="small">Value ${inr(r.value)} · risk incl. charges <b>${inr(r.risk)}</b> of ${inr(r.budget)}<br>Limits: risk ${r.byRisk} · position cap ${r.byCap} → <b>${r.binding}</b></div></div>`;
      } else {
        const r = S.sizeDerivative(m, cap, risk, nval('zLot'), en, sl, nval('zMar'), 100, st.brokerage);
        $('#zOut').innerHTML = note + `<div class="card"><h3><span class="big">${r.lots}</span> lot${r.lots === 1 ? '' : 's'} <small>= ${r.qty} qty</small></h3>
          <div class="small">Risk budget ${inr(r.budget)} · ${num(r.pts)} pts × lot + charges ${inr(r.ch1)} = <b>${inr(r.perLot)}</b>/lot<br>Total risk if stopped: <b>${inr(r.totalRisk)}</b> (${num(r.totalRiskPct)}%)
          ${r.outlay !== null ? `<br>Premium outlay ${inr(r.outlay)}` : ''}${r.margin !== null ? `<br>Margin needed ${inr(r.margin)}` : ''}<br>Limits: ${Object.entries(r.limits).map(([k, v]) => `${k} ${v}`).join(' · ')} → <b>${r.binding}</b></div>
          ${r.warnings.length ? `<ul class="notes small warn">${r.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}</div>`;
      }
    } catch (e) { $('#zOut').innerHTML = errBox(e); }
  };
}

// ═══ CHARGES ════════════════════════════════════════════════════════════════
function Charges(el) {
  const st = settings();
  el.innerHTML = `<div class="card"><label>Segment</label><select id="gSeg"><option value="options">Options</option><option value="futures">Futures</option><option value="equity_intraday">Equity intraday</option><option value="equity_delivery">Equity delivery</option></select>
    <div class="grid2"><div><label>Instrument (for lots)</label><select id="gSym"><option value="">— quantity —</option>${Object.keys(CONFIG.lot_sizes).map((s) => `<option>${s}</option>`).join('')}</select></div><div><label id="gQL">Quantity</label><input id="gQty" type="number"></div>
    <div><label>Buy price</label><input id="gBuy" type="number" inputmode="decimal"></div><div><label>Sell price</label><input id="gSell" type="number" inputmode="decimal"></div></div>
    <label>Brokerage per order ₹</label><input id="gBrk" type="number" value="${st.brokerage}"><button class="btn" id="gGo">Calculate</button></div><div id="gOut"></div>
    <div class="small mut">Rates as of ${CONFIG.as_of}: STT 0.15% on options sold, 0.05% on futures sold (from 1 Apr 2026). Verify with your contract note.</div>`;
  $('#gSym').onchange = () => { $('#gQL').textContent = val('gSym') ? 'Lots' : 'Quantity'; };
  $('#gGo').onclick = () => {
    try {
      const seg = val('gSeg'), buy = nval('gBuy'), sell = nval('gSell'); let q = nval('gQty');
      if (!buy || !sell || !q) throw new Error('Fill quantity, buy and sell');
      if (val('gSym')) q = q * lotSize(val('gSym'));
      const c = roundTripCharges(seg, buy, sell, q, { brokeragePerOrder: nval('gBrk') }), gross = (sell - buy) * q;
      $('#gOut').innerHTML = `<div class="card"><h3>${q} qty</h3><table>${[['Brokerage', c.brokerage], ['STT', c.stt], ['Exchange charges', c.exchange], ['SEBI fee', c.sebi], ['Stamp duty', c.stamp], ['GST', c.gst], ['Total charges', c.total]].map(([k, v]) => `<tr><td>${k}</td><td>${inr(v, 2)}</td></tr>`).join('')}</table>
        <div class="grid2" style="margin-top:10px"><div class="tile"><div class="k">Gross P&L</div><div class="v ${cls(gross)}">${inr(gross, 2)}</div></div><div class="tile"><div class="k">Net P&L</div><div class="v ${cls(gross - c.total)}">${inr(gross - c.total, 2)}</div></div></div>
        <div class="small" style="margin-top:8px">Breakeven move: <b>${breakevenMove(seg, buy, q, { brokeragePerOrder: nval('gBrk') })} points</b></div></div>`;
    } catch (e) { $('#gOut').innerHTML = errBox(e); }
  };
}

// ═══ PRE-TRADE CHECKLIST ════════════════════════════════════════════════════
function Checklist(el) {
  const lr = store.get('lastRegime', {}); const posture = lr.day === iso(todayIST()) ? lr.posture : 'normal'; const g = guardNow();
  const exp = upcomingExpiries('NIFTY', todayIST(), 1)[0]?.calendarDaysLeft === 0;
  el.innerHTML = `<div class="card"><div class="small mut">Auto-filled: regime <b>${posture}</b>, risk guard <b>${g.status}</b>${exp ? ', NIFTY expiry today' : ''}</div>
    <div class="grid2"><div><label>Symbol</label><input id="kSym" value="NIFTY"></div><div><label>Instrument</label><select id="kIns"><option value="option">Option (bought)</option><option value="futures">Futures</option><option value="equity">Equity</option></select></div>
    <div><label>Direction</label><select id="kDir"><option value="long">Long / buy</option><option value="short">Short / sell</option></select></div><div><label>Risk %</label><input id="kRisk" type="number" step="0.1" value="${settings().riskPct}"></div>
    <div><label>Entry</label><input id="kEn" type="number" inputmode="decimal"></div><div><label>Stop</label><input id="kSl" type="number" inputmode="decimal"></div><div><label>Target</label><input id="kTg" type="number" inputmode="decimal"></div><div><label>Setup</label><input id="kSet" placeholder="ORB, VWAP, breakout…"></div></div>
    <label>Reason (one line)</label><input id="kWhy" placeholder="Why this trade, now?">
    <label class="check"><input type="checkbox" id="kTrend" checked> With the higher-timeframe trend</label><label class="check"><input type="checkbox" id="kEvent"> Results / RBI / Budget / big global data today</label><label class="check"><input type="checkbox" id="kLiq" checked> Liquid strike, tight bid-ask</label>
    <button class="btn" id="kGo">Check trade</button></div><div id="kOut"></div>`;
  $('#kGo').onclick = () => {
    const r = S.preTradeCheck({ entry: nval('kEn'), stop: nval('kSl'), target: nval('kTg'), direction: val('kDir'), instrument: val('kIns'), riskPct: nval('kRisk'),
      guard: g.status, posture, trendAligned: $('#kTrend').checked, eventRisk: $('#kEvent').checked, liquidityOk: $('#kLiq').checked, setup: val('kSet'), reason: val('kWhy'), expiryDay: exp });
    $('#kOut').innerHTML = `<div class="card"><div class="between"><h3>${{ CLEAR: '✅', CAUTION: '⚠️', BLOCKED: '⛔' }[r.verdict]} ${r.verdict}</h3><span class="mut small">score ${r.score} · R:R ${num(r.rr)}</span></div>
      ${r.blockers.map((b) => `<div class="err">⛔ ${esc(b)}</div>`).join('')}${r.warnings.map((w) => `<div class="warn small">⚠️ ${esc(w)}</div>`).join('')}
      <ul class="notes small">${r.checks.map((c) => `<li>${c.pass ? '✔' : '✘'} ${esc(c.name)}</li>`).join('')}</ul>
      ${r.verdict !== 'BLOCKED' ? '<button class="btn sec" id="kSize">Size this trade →</button>' : ''}</div>`;
    const b = $('#kSize'); if (b) b.onclick = () => go('tools', 'sizer');
  };
}

// ═══ JOURNAL ════════════════════════════════════════════════════════════════
function JournalToday(el) {
  const g = guardNow(), tt = todaysTrades(), now = nowISTTime();
  el.innerHTML = `<div class="card"><div class="between"><h3>Risk guard</h3><span class="pill ${pillFor(g.status)}">${g.status}</span></div>
      <div class="small">Day P&L <b class="${cls(g.pnl)}">${inr(g.pnl)}</b> · loss limit ${inr(-g.limit)} · trades left ${g.tradesLeft} · losing streak ${g.consec}</div>
      <ul class="notes small">${g.reasons.concat(g.actions).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
    <div class="card"><h3>Log a closed trade</h3>
      <div class="grid2"><div><label>Symbol</label><input id="jSym" placeholder="NIFTY 26100 CE"></div><div><label>Segment</label><select id="jSeg"><option value="options">Options</option><option value="futures">Futures</option><option value="equity_intraday">Equity intraday</option><option value="equity_delivery">Equity delivery</option></select></div>
      <div><label>Side</label><select id="jSide"><option>BUY</option><option>SELL</option></select></div><div><label>Quantity</label><input id="jQty" type="number" placeholder="e.g. 65"></div>
      <div><label>Entry</label><input id="jEn" type="number" inputmode="decimal"></div><div><label>Exit</label><input id="jEx" type="number" inputmode="decimal"></div>
      <div><label>Setup</label><input id="jSet" list="setups" placeholder="ORB"></div><div><label>Time</label><input id="jTime" type="time" value="${now}"></div></div>
      <datalist id="setups">${[...new Set(journal().map((t) => t.setup).filter(Boolean))].map((s) => `<option>${esc(s)}</option>`).join('')}</datalist>
      <label>Notes</label><input id="jNote" placeholder="what went right / wrong">
      <button class="btn" id="jAdd">Save trade</button></div>
    <div class="card"><h3>Today's trades <small>${tt.length}</small></h3>${tt.length ? tt.map((t) => `<div class="trade"><div><b>${esc(t.symbol)}</b> <span class="mut small">${esc(t.time)} ${t.side} ${t.qty} @ ${t.entry}→${t.exit} ${esc(t.setup || '')}</span></div><div class="${cls(t.net)}">${inr(t.net)} <button class="icon small" data-del="${esc(t.id)}">✕</button></div></div>`).join('') : '<div class="small mut">No trades logged today.</div>'}</div>`;
  $('#jAdd').onclick = () => {
    const t = { id: String(Date.now()), date: iso(todayIST()), time: val('jTime'), symbol: val('jSym').trim() || 'TRADE', segment: val('jSeg'), side: val('jSide'),
      qty: nval('jQty'), entry: nval('jEn'), exit: nval('jEx'), setup: val('jSet').trim(), notes: val('jNote').trim() };
    if (!t.qty || !t.entry || !t.exit) return toast('Fill quantity, entry and exit');
    const e = S.enrichTrade(t, settings().brokerage);
    store.set('journal', [...journal(), t]); toast(`Saved · net ${inr(e.net)} after ${inr(e.charges)} charges`); JournalToday(el);
  };
  $$('[data-del]', el).forEach((b) => b.addEventListener('click', () => { if (confirm('Delete this trade?')) { store.set('journal', journal().filter((t) => t.id !== b.dataset.del)); JournalToday(el); } }));
}
function JournalReview(el) {
  const period = store.get('reviewPeriod', 'month');
  const all = enriched(), t = todayIST();
  const since = { week: iso(new Date(t.getTime() - ((t.getUTCDay() + 6) % 7) * 86400000)), month: iso(t).slice(0, 8) + '01', all: '0000' }[period];
  const trades = all.filter((x) => x.date >= since);
  const R = S.journalReview(trades), o = R.overall;
  const tbl = (obj) => `<table><tr><th></th><th>Trades</th><th>Win%</th><th>Net</th></tr>${Object.entries(obj).map(([k, s]) => `<tr><td>${esc(k)}</td><td>${s.trades}</td><td>${num(s.winRate, 0)}</td><td class="${cls(s.net)}">${inr(s.net)}</td></tr>`).join('')}</table>`;
  el.innerHTML = `<div class="seg">${[['week', 'This week'], ['month', 'This month'], ['all', 'All time']].map(([k, l]) => `<button data-p="${k}" class="${k === period ? 'on' : ''}">${l}</button>`).join('')}</div>
    ${o.trades ? `<div class="card"><div class="grid2"><div class="tile"><div class="k">Net P&L</div><div class="v ${cls(o.net)}">${inr(o.net)}</div></div><div class="tile"><div class="k">Win rate</div><div class="v">${num(o.winRate, 0)}%</div></div>
      <div class="tile"><div class="k">Expectancy / trade</div><div class="v ${cls(o.expectancy)}">${inr(o.expectancy)}</div></div><div class="tile"><div class="k">Max drawdown</div><div class="v dn">${inr(-o.maxDD)}</div></div></div>
      <div class="small" style="margin-top:8px">${o.trades} trades · payoff ${num(o.payoff)} · profit factor ${o.profitFactor === null ? '—' : num(o.profitFactor)} · gross ${inr(o.gross)} · charges <b>${inr(o.charges)}</b></div></div>
      ${R.insights.length ? `<div class="card"><h3>Insights</h3><ul class="notes">${R.insights.map((i) => `<li>${esc(i)}</li>`).join('')}</ul></div>` : ''}
      <div class="card"><h3>By setup</h3>${tbl(R.bySetup)}</div><div class="card"><h3>By hour</h3>${tbl(R.byHour)}</div><div class="card"><h3>By weekday</h3>${tbl(R.byWeekday)}</div>`
    : '<div class="card mut">No trades in this period.</div>'}
    <div class="row"><button class="btn sec" id="jCsv">Share CSV</button><button class="btn sec" id="jImp">Import CSV</button></div>`;
  $$('[data-p]', el).forEach((b) => b.addEventListener('click', () => { store.set('reviewPeriod', b.dataset.p); JournalReview(el); }));
  $('#jCsv').onclick = () => {
    const f = ['date', 'time', 'symbol', 'segment', 'side', 'qty', 'entry', 'exit', 'setup', 'notes'];
    const csv = [f.join(',')].concat(journal().map((t) => f.map((k) => `"${String(t[k] ?? '').replace(/"/g, '""')}"`).join(','))).join('\n');
    if (D.isNative()) window.SRKNative.share(csv); else navigator.clipboard?.writeText(csv).then(() => toast('Copied CSV'));
  };
  $('#jImp').onclick = () => sheet('Import trades (CSV)', `<div class="small mut">Columns: date,time,symbol,segment,side,qty,entry,exit,setup,notes</div><textarea id="impTxt" rows="12"></textarea><button class="btn" id="impGo">Import</button>`, (b) => {
    $('#impGo', b).onclick = () => {
      const lines = val('impTxt').trim().split(/\r?\n/); const head = lines.shift().split(',').map((h) => h.trim().toLowerCase().replace(/"/g, ''));
      const parse = (l) => (l.match(/("([^"]|"")*"|[^,]*)(,|$)/g) || []).map((c) => c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"'));
      const rows = lines.filter(Boolean).map((l, i) => { const c = parse(l); const o = { id: `${Date.now()}-${i}` }; head.forEach((h, j) => { o[h] = c[j]; }); ['qty', 'entry', 'exit'].forEach((k) => { o[k] = +o[k]; }); return o; })
        .filter((o) => o.date && o.qty && o.entry && o.exit);
      store.set('journal', [...journal(), ...rows]); toast(`Imported ${rows.length} trades`); $('.sheet').remove(); JournalReview(el);
    };
  });
}

// ═══ SETTINGS ═══════════════════════════════════════════════════════════════
function sheet(title, html, mount) {
  const s = document.createElement('div'); s.className = 'sheet';
  s.innerHTML = `<header><button class="icon" data-close>←</button><b>${esc(title)}</b></header><div class="body">${html}</div>`;
  document.body.appendChild(s); $('[data-close]', s).onclick = () => s.remove(); if (mount) mount(s); return s;
}
function openSettings() {
  const st = settings(), a = store.get('angel', {}), h = store.get('hdfc', {}), R = { ...S.DEFAULT_RULES, ...st.rules };
  sheet('Settings', `
    <div class="card"><h3>Live data broker</h3>
      <select id="brk"><option value="angel">Angel One (SmartAPI)</option><option value="hdfc">HDFC Securities (InvestRight API)</option></select>
      <label>When not logged in</label><select id="dSrc"><option value="auto">Use free delayed data</option><option value="free">Always use free delayed data</option></select>
      <div class="small mut" style="margin-top:6px">Your keys stay on this phone and go only to your broker. The app never places orders.</div></div>
    <div class="card" id="cardAngel"><h3>Angel One SmartAPI <small>${D.angelLoggedIn() ? '<span class="up">● logged in today</span>' : 'not logged in'}</small></h3>
      <div class="small mut">Create a free API key at smartapi.angelone.in.</div>
      <label>API key</label><input id="aKey" value="${esc(a.apiKey || '')}" autocomplete="off">
      <label>Client ID</label><input id="aCli" value="${esc(a.clientCode || '')}" autocomplete="off">
      <label>MPIN</label><input id="aPin" type="password" inputmode="numeric" value="${esc(a.pin || '')}" autocomplete="off">
      <label>TOTP secret <span class="mut">(optional — enables one-tap login)</span></label><input id="aTotp" type="password" value="${esc(a.totpSecret || '')}" autocomplete="off">
      <label>…or 6-digit TOTP code now</label><input id="aCode" inputmode="numeric" maxlength="6" placeholder="from your authenticator app">
      <div class="row"><button class="btn" id="aLogin">Save & log in</button>${D.angelLoggedIn() ? '<button class="btn red" id="aOut">Log out</button>' : ''}</div>
      <div id="aMsg" class="small" style="margin-top:6px"></div></div>
    <div class="card" id="cardHdfc"><h3>HDFC Securities <small>${D.hdfcLoggedIn() ? '<span class="up">● logged in today</span>' : 'not logged in'}</small></h3>
      <div class="small mut">One-time setup: open developer.hdfcsec.com → Login with InvestRight + OTP → accept the disclaimer → <b>Create App</b>. Use the redirect URL below exactly, then copy the API key and secret here.</div>
      <label>Redirect URL (enter this when creating the app)</label><div class="row"><input id="hRed" value="${esc(h.redirect || D.HDFC_DEFAULT_REDIRECT)}" autocomplete="off"><button class="btn sm sec" id="hCopy">Copy</button></div>
      <label>API key</label><input id="hKey" value="${esc(h.apiKey || '')}" autocomplete="off">
      <label>API secret</label><input id="hSec" type="password" value="${esc(h.apiSecret || '')}" autocomplete="off">
      <div class="row"><button class="btn" id="hLogin">Save & log in</button>${D.hdfcLoggedIn() ? '<button class="btn red" id="hOut">Log out</button>' : ''}</div>
      <div id="hMsg" class="small" style="margin-top:6px"></div>
      <div class="small mut" style="margin-top:6px">HDFC gives live prices and option open interest, but no historical candles — charts and indicators use Yahoo daily data plus HDFC’s live price.</div></div>
    <div class="card"><h3>Trading</h3><div class="grid2"><div><label>Capital ₹</label><input id="tCap" type="number" value="${st.capital}"></div><div><label>Default risk %</label><input id="tRisk" type="number" step="0.1" value="${st.riskPct}"></div><div><label>Brokerage / order ₹</label><input id="tBrk" type="number" value="${st.brokerage}"></div></div></div>
    <div class="card"><h3>Risk-guard rules</h3><div class="grid2">
      ${[['max_daily_loss_pct', 'Max daily loss %'], ['max_trades_per_day', 'Max trades / day'], ['max_consecutive_losses', 'Stop after losses in a row'], ['profit_lock_pct', 'Profit lock after %'], ['weekly_dd_stop_pct', 'Weekly drawdown stop %'], ['monthly_dd_stop_pct', 'Monthly drawdown stop %']]
        .map(([k, l]) => `<div><label>${l}</label><input data-rule="${k}" type="number" step="0.1" value="${R[k]}"></div>`).join('')}
      <div><label>No trades before</label><input data-rule="no_trade_before" type="time" value="${R.no_trade_before}"></div><div><label>No new trades after</label><input data-rule="no_new_trade_after" type="time" value="${R.no_new_trade_after}"></div></div></div>
    <div class="card"><h3>Screener watchlist</h3><textarea id="wList" rows="5">${esc(st.watchlist.join(' '))}</textarea><div class="small mut">NSE symbols separated by spaces.</div></div>
    <div class="card"><h3>Backup</h3><div class="row"><button class="btn sec" id="bExp">Share backup</button><button class="btn sec" id="bImp">Restore</button></div><div class="small mut">Journal, FII/DII and settings (not your Angel One login).</div></div>
    <button class="btn" id="sSave">Save settings</button>
    <div class="disc">SRK Trading ${D.isNative() ? 'v' + esc(window.SRKNative.version()) : ''} · by Dr. M. Rajkumar · ShazVerse Technologies<br>Rules as of ${CONFIG.as_of}: NIFTY lot ${CONFIG.lot_sizes.NIFTY}, BANKNIFTY lot ${CONFIG.lot_sizes.BANKNIFTY}.<br>Educational decision-support only — not SEBI-registered investment advice. The app never places orders.</div>`, (s) => {
    $('#dSrc', s).value = st.dataSource || 'auto';
    $('#brk', s).value = st.broker || 'angel';
    const showBroker = () => { $('#cardAngel', s).style.display = val('brk') === 'angel' ? 'block' : 'none'; $('#cardHdfc', s).style.display = val('brk') === 'hdfc' ? 'block' : 'none'; };
    $('#brk', s).onchange = () => { saveSettings({ broker: val('brk') }); D.clearCache(); showBroker(); updateBadge(); };
    showBroker();
    const saveAngel = () => store.set('angel', { apiKey: val('aKey').trim(), clientCode: val('aCli').trim().toUpperCase(), pin: val('aPin').trim(), totpSecret: val('aTotp').trim() });
    const saveHdfc = () => store.set('hdfc', { apiKey: val('hKey').trim(), apiSecret: val('hSec').trim(), redirect: val('hRed').trim() });
    $('#hCopy', s).onclick = () => { navigator.clipboard?.writeText(val('hRed')).then(() => toast('Redirect URL copied'), () => toast('Long-press the box to copy')); };
    $('#hLogin', s).onclick = async () => {
      saveHdfc(); saveSettings({ broker: 'hdfc' }); $('#hMsg', s).innerHTML = spin + ' Opening HDFC login…';
      try { await D.hdfcLogin(); D.clearCache(); $('#hMsg', s).innerHTML = '<span class="up">Logged in ✓ — live data on</span>'; updateBadge(); }
      catch (e) { $('#hMsg', s).innerHTML = `<span class="err">${esc(e.message)}</span>`; }
    };
    const hOut = $('#hOut', s); if (hOut) hOut.onclick = () => { D.hdfcLogout(); updateBadge(); s.remove(); openSettings(); };
    $('#aLogin', s).onclick = async () => {
      saveAngel(); $('#aMsg', s).innerHTML = spin + ' Logging in…';
      saveSettings({ broker: 'angel' });
      try { await D.angelLogin({ totpCode: val('aCode').trim() }); D.clearCache(); $('#aMsg', s).innerHTML = '<span class="up">Logged in ✓ — live data on</span>'; updateBadge(); }
      catch (e) { $('#aMsg', s).innerHTML = `<span class="err">${esc(e.message)}</span>`; }
    };
    const out = $('#aOut', s); if (out) out.onclick = () => { D.angelLogout(); updateBadge(); s.remove(); openSettings(); };
    $('#bExp', s).onclick = () => { const txt = JSON.stringify(store.exportAll()); if (D.isNative()) window.SRKNative.share(txt); else navigator.clipboard?.writeText(txt).then(() => toast('Copied')); };
    $('#bImp', s).onclick = () => sheet('Restore backup', '<textarea id="rTxt" rows="10" placeholder="Paste backup text"></textarea><button class="btn" id="rGo">Restore</button>', (b) => {
      $('#rGo', b).onclick = () => { try { store.importAll(JSON.parse(val('rTxt'))); toast('Restored'); b.remove(); s.remove(); render(); } catch { toast('Not a valid backup'); } };
    });
    $('#sSave', s).onclick = () => {
      saveAngel(); saveHdfc();
      const rules = {}; $$('[data-rule]', s).forEach((i) => { rules[i.dataset.rule] = i.type === 'time' ? i.value : +i.value; });
      saveSettings({ broker: val('brk'), dataSource: val('dSrc'), capital: nval('tCap') || 200000, riskPct: nval('tRisk') || 1, brokerage: nval('tBrk') ?? 20, rules,
        watchlist: val('wList').split(/[\s,]+/).map((x) => x.trim().toUpperCase()).filter(Boolean) });
      D.clearCache(); toast('Settings saved'); s.remove(); render();
    };
  });
}

// ─── start ──────────────────────────────────────────────────────────────────
if (!store.get('acceptedDisclaimer')) {
  sheet('Welcome to SRK Trading', `<div class="card"><p><b>SRK Trading</b> brings the SRK Trading Skills to your phone: market regime, option chain, strategies, position sizing, charges, risk guard and journal — for NSE/BSE.</p>
    <p class="small">It is an <b>analysis and discipline tool</b>. It never places orders. It is <b>not SEBI-registered investment advice</b>. F&O trading carries a high risk of loss — SEBI studies show most individual F&O traders lose money.</p>
    <p class="small">For live data, connect Angel One or HDFC Securities in Settings. Without a broker, free delayed data is used.</p></div><button class="btn" id="ok">I understand</button>`, (s) => {
    $('[data-close]', s).style.display = 'none';
    $('#ok', s).onclick = () => { store.set('acceptedDisclaimer', true); s.remove(); };
  });
}
render();
