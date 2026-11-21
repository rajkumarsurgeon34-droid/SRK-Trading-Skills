import pytest
from synth_data import make_ohlcv
from india_common import load_ohlcv, pivots_cpr, rsi
from technical_analyst import analyze


def test_uptrend_detected(tmp_path):
    rows = load_ohlcv(make_ohlcv(tmp_path / "up.csv", drift=0.004, vol=0.006, seed=5))
    r = analyze(rows, "UP")
    assert r["bias"] in ("bullish", "mildly_bullish")
    assert r["stage"].startswith("Stage 2")


def test_downtrend_detected(tmp_path):
    rows = load_ohlcv(make_ohlcv(tmp_path / "dn.csv", drift=-0.004, vol=0.006, seed=6))
    assert analyze(rows)["bias"] in ("bearish", "mildly_bearish")


def test_needs_history(tmp_path):
    rows = load_ohlcv(make_ohlcv(tmp_path / "s.csv", n=20))
    with pytest.raises(ValueError):
        analyze(rows)


def test_pivots():
    p = pivots_cpr({"high": 110, "low": 90, "close": 100})
    assert p["pivot"] == 100 and p["r1"] == 110 and p["s1"] == 90


def test_rsi_bounds():
    vals = [r for r in rsi([float(i) for i in range(1, 60)]) if r is not None]
    assert vals[-1] == 100.0
