// node --test android-app/tests  — checks the app's JS logic against the Python skills
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const W = new URL('../app/src/main/assets/www/js/', import.meta.url);
const core = await import(new URL('core.js', W));
const S = await import(new URL('skills.js', W));
const E = JSON.parse(readFileSync(new URL('./expected.json', import.meta.url)));
const close = (a, b, tol = 0.02, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test('charges match Python', () => {
  for (const [k, args] of [['charges', ['options', 100, 110, 65]], ['charges_fut', ['futures', 56200, 56260, 30]]]) {
    const js = core.roundTripCharges(...args);
    for (const f of ['brokerage', 'stt', 'stamp', 'gst', 'total']) close(js[f], E[k][f === 'exchange' ? 'exchange_txn' : f === 'stamp' ? 'stamp_duty' : f], 0.02, `${k}.${f}`);
  }
  close(core.breakevenMove('options', 100, 65), E.breakeven, 0.02, 'breakeven');
});
test('expiry calendar matches Python', () => {
  for (const s of ['NIFTY', 'BANKNIFTY', 'SENSEX'])
    assert.deepEqual(core.upcomingExpiries(s, core.parseISO('2026-11-21'), 4).map((e) => e.expiry), E.expiries[s]);
});
test('iron condor matches Python', () => {
  const r = S.analyzeStrategy(S.presetLegs('iron_condor', [25600, 25800, 26200, 26400]), 26000, 6, 12, 65);
  close(r.netPerUnit, E.ic.net_premium_per_unit, 0.05, 'net');
  close(r.maxProfit, E.ic.max_profit, 5, 'maxProfit'); close(r.maxLoss, E.ic.max_loss, 5, 'maxLoss');
  r.breakevens.forEach((b, i) => close(b, E.ic.breakevens[i], 0.5, 'be'));
  close(r.greeks.theta, E.ic.theta, 0.5, 'theta');
});
test('position sizes match Python', () => {
  assert.equal(S.sizeDerivative('option-buy', 200000, 1, 65, 110, 85).lots, E.sz);
  assert.equal(S.sizeEquity(300000, 0.5, 1450, 1432, true, 5).shares, E.eq);
});
test('option chain matches Python', () => {
  const rows = E.chain_in.map((r) => ({ strike: r.strike, ceOi: r.ce_oi, ceChgOi: r.ce_chg_oi, ceLtp: r.ce_ltp, ceChg: r.ce_chg, ceIv: r.ce_iv, peOi: r.pe_oi, peChgOi: r.pe_chg_oi, peLtp: r.pe_ltp, peChg: r.pe_chg, peIv: r.pe_iv }));
  const a = S.analyzeChain(rows, 26010);
  close(a.pcr, E.chain.pcr, 0.001, 'pcr'); assert.equal(a.maxPain, E.chain.max_pain);
  assert.equal(a.resistance[0].strike, E.chain.res); assert.equal(a.support[0].strike, E.chain.sup);
  assert.equal(a.bias.replace(' ', '_'), E.chain.bias);
});
test('technicals match Python', () => {
  const t = S.technicals(E.ohlc);
  close(t.rsi14, E.tech.rsi, 0.06, 'rsi'); close(t.atr14, E.tech.atr, 0.01, 'atr'); close(t.supertrend.value, E.tech.st, 0.01, 'supertrend');
  close(t.ema[200], E.tech.ema200, 0.01, 'ema200'); assert.equal(t.score, E.tech.score);
});
test('market regime matches Python', () => {
  const r = S.marketRegime({ nifty: E.ohlc, vix: E.vix, global: { gift_nifty_pct: 0.3, nasdaq: 0.5 } });
  assert.equal(r.score, E.regime.score); assert.equal(r.posture, E.regime.posture); close(r.expectedMove, E.regime.move, 0.1, 'move');
});
test('risk guard rules', () => {
  const T = (...p) => p.map((n, i) => ({ time: `10:0${i}`, net: n }));
  assert.equal(S.riskGuard([], 100000).status, 'GO');
  assert.equal(S.riskGuard(T(-1500, -600), 100000).status, 'STOP');
  assert.equal(S.riskGuard(T(500, -100, -100, -100), 100000).status, 'STOP');
  assert.equal(S.riskGuard([], 100000, {}, { now: '15:10' }).status, 'STOP');
});
test('TOTP matches RFC 6238 test vector', async () => {
  globalThis.window = globalThis.window || {};
  const D = await import(new URL('data.js', W));
  // RFC 6238 SHA-1 secret "12345678901234567890" = base32 GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ, T=59s → 94287082 (8 digits) → 287082
  assert.equal(await D.totp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 59000), '287082');
});
test('INR formatting', () => {
  assert.equal(core.inr(1234567.8, 2), '₹12,34,567.80');
  assert.equal(core.inr(-950), '-₹950');
});
