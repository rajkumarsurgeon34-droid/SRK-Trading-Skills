import pytest
from fno_charges import calculate
from india_common import breakeven_move, fmt_inr, lot_size, round_trip_charges


def test_lot_sizes_2026():
    assert lot_size("NIFTY") == 65
    assert lot_size("banknifty") == 30
    assert lot_size("FINNIFTY") == 60


def test_option_round_trip_matches_hand_calc():
    ch = round_trip_charges("options", 100, 110, 65)
    # brokerage 40, STT 0.15% of 7150 sell value
    assert ch.brokerage == 40
    assert ch.stt == pytest.approx(10.725)
    assert ch.total == pytest.approx(63.78, abs=0.05)


def test_futures_stt_is_sell_side_only():
    ch = round_trip_charges("futures", 26000, 26000, 65)
    assert ch.stt == pytest.approx(26000 * 65 * 0.0005)


def test_net_pnl_and_breakeven():
    r = calculate("options", 100, 110, 65)
    assert r["net_pnl"] == pytest.approx(650 - r["charges"]["total"], abs=0.01)
    assert 0.5 < breakeven_move("options", 100, 65) < 2


def test_equity_brokerage_capped_at_pct():
    ch = round_trip_charges("equity_intraday", 100, 101, 10)  # tiny order
    assert ch.brokerage == pytest.approx(100 * 10 * 0.0025 + 101 * 10 * 0.0025)


def test_fmt_inr_indian_grouping():
    assert fmt_inr(1234567.8) == "₹12,34,567.80"
    assert fmt_inr(-950) == "-₹950.00"
