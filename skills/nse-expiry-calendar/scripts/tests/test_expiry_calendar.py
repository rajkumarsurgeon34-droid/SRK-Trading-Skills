from datetime import date

from expiry_calendar import build
from india_common import upcoming_expiries


def test_nifty_monthly_shifts_for_guru_nanak_jayanti():
    ex = upcoming_expiries("NIFTY", date(2026, 11, 21), 2)
    assert ex[0]["expiry"] == "2026-11-23" and ex[0]["shifted"] and ex[0]["kind"] == "monthly"
    assert ex[1]["expiry"] == "2026-12-01"


def test_nifty_weekly_moves_for_balipratipada():
    ex = upcoming_expiries("NIFTY", date(2026, 11, 5), 1)
    assert ex[0]["expiry"] == "2026-11-09"


def test_banknifty_monthly_only():
    ex = upcoming_expiries("BANKNIFTY", date(2026, 12, 1), 2)
    assert all(e["kind"] == "monthly" for e in ex)
    assert ex[0]["expiry"] == "2026-12-29"


def test_sensex_thursday():
    ex = upcoming_expiries("SENSEX", date(2026, 11, 21), 1)
    assert ex[0]["expiry"] == "2026-11-26"


def test_expiry_today_flag():
    r = build(date(2026, 12, 1), ["NIFTY"], 1)
    assert r["expiry_today"] == ["NIFTY"]
