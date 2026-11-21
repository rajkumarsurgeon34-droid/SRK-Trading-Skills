import pytest
from trade_journal import add, enrich, load, review


def t(date, time, side, entry, exit_, setup, segment="options", qty=65):
    return {"date": date, "time": time, "symbol": "NIFTY CE", "segment": segment, "side": side,
            "qty": str(qty), "entry": str(entry), "exit": str(exit_), "setup": setup, "notes": ""}


def test_short_trade_pnl():
    e = enrich(t("2026-11-20", "10:00", "SELL", 100, 90, "x"))
    assert e["gross"] == 650 and e["net"] < 650


def test_review_stats(tmp_path):
    p = tmp_path / "j.csv"
    add(p, t("2026-11-17", "09:30", "BUY", 100, 120, "ORB"))
    add(p, t("2026-11-18", "10:30", "BUY", 100, 90, "VWAP"))
    add(p, t("2026-11-19", "11:30", "BUY", 100, 115, "ORB"))
    r = review(load(p))
    o = r["overall"]
    assert o["trades"] == 3
    assert o["win_rate_pct"] == pytest.approx(66.7)
    assert r["by_setup"]["ORB"]["trades"] == 2
    assert any("Best setup: ORB" in i for i in r["insights"])


def test_date_filter(tmp_path):
    p = tmp_path / "j.csv"
    add(p, t("2026-10-01", "09:30", "BUY", 100, 120, "ORB"))
    add(p, t("2026-11-01", "09:30", "BUY", 100, 120, "ORB"))
    assert review(load(p), start="2026-11-01")["overall"]["trades"] == 1
