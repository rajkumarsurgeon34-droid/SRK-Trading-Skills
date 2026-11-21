import pytest
from options_strategy import analyze, bs, preset_legs


def test_put_call_parity():
    c = bs(26000, 26000, 7 / 365, 0.12, 0.065, "CE")[0]
    p = bs(26000, 26000, 7 / 365, 0.12, 0.065, "PE")[0]
    import math
    assert c - p == pytest.approx(26000 - 26000 * math.exp(-0.065 * 7 / 365), abs=0.01)


def test_bull_call_spread_limits():
    legs = preset_legs("bull_call_spread", [26000, 26200], [140, 62])
    r = analyze(legs, 26000, 6, 12, 65)
    assert r["max_loss"] == pytest.approx(-(140 - 62) * 65, abs=1)
    assert r["max_profit"] == pytest.approx((200 - 78) * 65, abs=1)
    assert r["breakevens"][0] == pytest.approx(26078, abs=1)


def test_short_straddle_unlimited_loss():
    r = analyze(preset_legs("short_straddle", [26000], [120, 115]), 26000, 6, 12, 65)
    assert r["max_loss"] == "unlimited" and r["net_type"] == "credit"
    assert len(r["breakevens"]) == 2


def test_iron_condor_defined_risk():
    r = analyze(preset_legs("iron_condor", [25600, 25800, 26200, 26400], None), 26000, 6, 12, 65)
    assert isinstance(r["max_loss"], float) and isinstance(r["max_profit"], float)
    assert r["greeks_total"]["theta"] > 0


def test_wrong_strike_count():
    with pytest.raises(ValueError):
        preset_legs("iron_condor", [1, 2], None)
