from pre_trade_checklist import evaluate

GOOD = {"symbol": "NIFTY", "direction": "long", "instrument": "option", "entry": 110, "stop": 88, "target": 160,
        "setup": "ORB", "regime_posture": "normal", "trend_aligned": True, "risk_guard_status": "GO", "risk_pct": 1,
        "event_risk": False, "liquidity_ok": True, "reason": "15-min ORB above CPR with put OI support"}


def test_clear():
    assert evaluate(GOOD)["verdict"] == "CLEAR"


def test_no_stop_blocks():
    assert evaluate({**GOOD, "stop": 0})["verdict"] == "BLOCKED"


def test_risk_guard_stop_blocks():
    assert evaluate({**GOOD, "risk_guard_status": "STOP"})["verdict"] == "BLOCKED"


def test_poor_rr_cautions():
    r = evaluate({**GOOD, "target": 120})
    assert r["verdict"] == "CAUTION" and r["reward_risk"] < 1.5


def test_short_futures_stop_side():
    plan = {**GOOD, "instrument": "futures", "direction": "short", "entry": 26000, "stop": 26080, "target": 25850}
    assert evaluate(plan)["verdict"] == "CLEAR"
