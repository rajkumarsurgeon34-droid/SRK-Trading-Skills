"""Compute reference results with the Python skills; the JS tests must match them."""
import json, sys
from datetime import date
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
for s in ["nse-fno-charges", "nse-options-strategy-advisor", "nse-position-sizer", "nse-option-chain-analyzer", "nse-technical-analyst", "india-market-regime", "nse-expiry-calendar"]:
    sys.path.insert(0, str(ROOT / "skills" / s / "scripts"))
sys.path.insert(0, str(ROOT / "skills/nse-technical-analyst/scripts/tests"))
from india_common import round_trip_charges, breakeven_move, upcoming_expiries, load_ohlcv
from options_strategy import analyze, preset_legs
from position_sizer import size_derivative, size_equity
from option_chain import analyze as chain
from technical_analyst import analyze as tech
from market_regime import build
from synth_data import make_ohlcv

out = {}
out["charges"] = round_trip_charges("options", 100, 110, 65).as_dict()
out["charges_fut"] = round_trip_charges("futures", 56200, 56260, 30).as_dict()
out["breakeven"] = breakeven_move("options", 100, 65)
out["expiries"] = {s: [e["expiry"] for e in upcoming_expiries(s, date(2026, 11, 21), 4)] for s in ["NIFTY", "BANKNIFTY", "SENSEX"]}
ic = analyze(preset_legs("iron_condor", [25600, 25800, 26200, 26400], None), 26000, 6, 12, 65)
out["ic"] = {k: ic[k] for k in ["net_premium_per_unit", "max_profit", "max_loss", "breakevens"]} | {"theta": ic["greeks_total"]["theta"]}
out["sz"] = size_derivative("option-buy", 200000, 1, 65, 110, 85)["lots"]
out["eq"] = size_equity(300000, 0.5, 1450, 1432, intraday=True, leverage=5)["shares"]
rows = []
for k in range(25700, 26350, 50):
    rows.append({"strike": k, "ce_oi": 100000 if k == 26200 else 20000 + k % 7 * 1000, "ce_chg_oi": 5000, "ce_ltp": max(26000 - k, 0) + 40, "ce_chg": -3, "ce_iv": 12,
                 "pe_oi": 150000 if k == 25800 else 25000, "pe_chg_oi": 9000, "pe_ltp": max(k - 26000, 0) + 40, "pe_chg": 2, "pe_iv": 13})
c = chain(rows, 26010)
out["chain_in"] = rows
out["chain"] = {"pcr": c["pcr_oi"], "max_pain": c["max_pain"], "res": c["resistance_ce_oi"][0]["strike"], "sup": c["support_pe_oi"][0]["strike"], "bias": c["bias"]}
tmp = Path("/tmp/srk_t"); tmp.mkdir(exist_ok=True)
ohlc = load_ohlcv(make_ohlcv(tmp / "n.csv", start=24000, drift=0.001, vol=0.008, seed=11))
vix = load_ohlcv(make_ohlcv(tmp / "v.csv", start=13, drift=0, vol=0.02, seed=12))
t = tech(ohlc)
out["ohlc"], out["vix"] = ohlc, vix
out["tech"] = {"rsi": t["rsi14"], "atr": t["atr14"], "st": t["supertrend"]["value"], "score": t["score"], "ema200": t["ema"][200]}
r = build(ohlc, vix=vix, global_cues={"gift_nifty_pct": 0.3, "nasdaq": 0.5})
out["regime"] = {"score": r["score"], "posture": r["posture"], "move": r["expected_daily_move_pts"]}
json.dump(out, open(Path(__file__).with_name("expected.json"), "w"))
print("expected.json written")
