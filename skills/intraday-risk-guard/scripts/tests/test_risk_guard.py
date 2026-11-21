from datetime import date

from risk_guard import evaluate


def T(*pnls):
    return [{"time": f"10:{i:02d}", "symbol": "NIFTY", "pnl": p} for i, p in enumerate(pnls)]


def test_go_when_fresh():
    assert evaluate([], 100000)["status"] == "GO"


def test_stop_on_daily_loss():
    assert evaluate(T(-1500, -600), 100000)["status"] == "STOP"


def test_stop_on_consecutive_losses():
    r = evaluate(T(500, -100, -100, -100), 100000)
    assert r["status"] == "STOP" and r["consecutive_losses"] == 3


def test_reduce_near_limit():
    assert evaluate(T(-1500), 100000)["status"] == "REDUCE"


def test_profit_giveback_stop():
    r = evaluate(T(4000, -1000, -1500), 100000, rules={"max_consecutive_losses": 5})
    assert r["status"] == "STOP"


def test_time_cutoff_and_holiday():
    assert evaluate([], 100000, now="15:05")["status"] == "STOP"
    assert evaluate([], 100000, today=date(2026, 11, 24))["status"] == "STOP"


def test_drawdown_breaker():
    eq = [(f"2026-11-{d:02d}", v) for d, v in zip(range(1, 8), [100000, 101000, 99000, 96000, 95000, 94000, 93000])]
    assert evaluate([], 100000, equity=eq)["status"] == "STOP"
