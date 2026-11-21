import pytest
from position_sizer import size_derivative, size_equity


def test_option_buy_risk_limited():
    r = size_derivative("option-buy", 200000, 1, 65, 110, 85)
    assert r["lots"] == 1
    assert r["total_risk"] <= r["risk_budget"]


def test_option_buy_capital_limit_binds():
    r = size_derivative("option-buy", 50000, 10, 65, 300, 290, max_capital_pct=50)
    assert r["binding_limit"] == "capital"
    assert r["premium_outlay"] <= 25000


def test_futures_margin_limit_and_warning():
    r = size_derivative("futures", 500000, 2, 30, 56200, 56100, margin_per_lot=120000)
    assert r["lots"] <= 4
    r2 = size_derivative("futures", 500000, 1, 30, 56200, 56100)
    assert any("Margin" in w for w in r2["warnings"])


def test_option_sell_requires_stop_above():
    with pytest.raises(ValueError):
        size_derivative("option-sell", 500000, 1, 65, 60, 40)


def test_zero_lots_warns():
    r = size_derivative("option-buy", 20000, 0.5, 65, 200, 100)
    assert r["lots"] == 0 and r["warnings"]


def test_equity_size_includes_charges():
    r = size_equity(300000, 0.5, 1450, 1432, intraday=True, leverage=5)
    assert r["shares"] == 78
    assert r["total_risk_incl_charges"] <= 1500
