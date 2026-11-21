#!/usr/bin/env python3
"""Pre-trade discipline gate. Scores a trade plan before you click buy/sell.

Pass a JSON plan (file or string). Fields:
  symbol, direction (long/short), instrument (equity/futures/option),
  entry, stop, target, setup (name), regime_posture (aggressive/normal/defensive/stand_aside),
  trend_aligned (bool), risk_guard_status (GO/REDUCE/STOP), risk_pct,
  event_risk (bool: results/RBI/Budget/US CPI today), liquidity_ok (bool),
  reason (text), expiry_day (bool), option_dte (int), option_delta (float)

Example:
  python3 pre_trade_checklist.py --plan '{"symbol":"NIFTY","direction":"long","instrument":"option","entry":110,"stop":88,"target":160,"setup":"ORB","regime_posture":"normal","trend_aligned":true,"risk_guard_status":"GO","risk_pct":1,"event_risk":false,"liquidity_ok":true,"reason":"15-min ORB above CPR with rising OI support"}'
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def evaluate(plan: dict) -> dict:
    checks, blockers, warnings = [], [], []

    def chk(name, ok, block=False, why=""):
        checks.append({"check": name, "pass": bool(ok)})
        if not ok:
            (blockers if block else warnings).append(f"{name}{(' — ' + why) if why else ''}")

    entry, stop, target = (float(plan.get(k) or 0) for k in ("entry", "stop", "target"))
    long = str(plan.get("direction", "long")).lower() == "long"
    has_stop = stop > 0 and ((stop < entry) if long else (stop > entry))
    if plan.get("instrument") == "option":
        has_stop = stop > 0 and stop < entry  # premium-based stop for bought options
    chk("Stop-loss defined on the correct side", has_stop, True, "no trade without a stop")
    risk = abs(entry - stop)
    reward = abs(target - entry) if target else 0
    rr = reward / risk if risk else 0
    chk("Reward:risk ≥ 1.5", rr >= 1.5, False, f"R:R is {rr:.2f}")
    chk("Risk per trade ≤ 2%", float(plan.get("risk_pct", 1)) <= 2, True, "oversized")
    gs = str(plan.get("risk_guard_status", "GO")).upper()
    chk("Risk guard not STOP", gs != "STOP", True, "daily limits hit")
    if gs == "REDUCE":
        warnings.append("Risk guard says REDUCE — half size")
    posture = plan.get("regime_posture", "normal")
    chk("Market regime allows new risk", posture != "stand_aside", True, "regime is stand_aside")
    chk("Trade is with the higher-timeframe trend", plan.get("trend_aligned", True), False, "counter-trend: smaller size, quicker exit")
    chk("No major event in the next hours", not plan.get("event_risk", False), False, "results/RBI/Budget/global data can gap the price")
    chk("Liquid instrument / tight spread", plan.get("liquidity_ok", True), True, "illiquid strikes slip badly")
    chk("Named setup", bool(plan.get("setup")), False, "random trades can't be reviewed")
    chk("Written reason (one line)", len(str(plan.get("reason", ""))) >= 15, False, "write why, before entering")
    if plan.get("instrument") == "option":
        dte = plan.get("option_dte")
        delta = plan.get("option_delta")
        if plan.get("expiry_day") and delta is not None and abs(float(delta)) < 0.2:
            warnings.append("Buying a far-OTM option on expiry day — theta decay is brutal")
        if dte is not None and int(dte) <= 1 and plan.get("direction") and long and delta is not None and abs(float(delta)) < 0.3:
            warnings.append("Low-delta option with ≤1 DTE — needs a big fast move")

    score = round(sum(c["pass"] for c in checks) / len(checks) * 100)
    verdict = "BLOCKED" if blockers else "CAUTION" if warnings else "CLEAR"
    return {"symbol": plan.get("symbol"), "verdict": verdict, "score": score,
            "reward_risk": round(rr, 2), "blockers": blockers, "warnings": warnings, "checks": checks}


def to_markdown(r):
    icon = {"CLEAR": "✅", "CAUTION": "⚠️", "BLOCKED": "⛔"}[r["verdict"]]
    out = [f"## {icon} {r['verdict']} — {r['symbol']} (score {r['score']}, R:R {r['reward_risk']})"]
    out += [f"- ⛔ {b}" for b in r["blockers"]] + [f"- ⚠️ {w}" for w in r["warnings"]]
    out += ["", *[f"- [{'x' if c['pass'] else ' '}] {c['check']}" for c in r["checks"]]]
    return "\n".join(out)


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--plan", required=True, help="JSON string or path to JSON file")
    p.add_argument("--json", action="store_true")
    a = p.parse_args(argv)
    plan = json.loads(Path(a.plan).read_text()) if Path(a.plan).exists() else json.loads(a.plan)
    r = evaluate(plan)
    print(json.dumps(r, indent=2) if a.json else to_markdown(r))
    return r


if __name__ == "__main__":
    main()
