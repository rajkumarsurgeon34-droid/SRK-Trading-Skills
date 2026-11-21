from synth_data import make_ohlcv
from stock_screener import run


def test_screener_finds_strong_stock(tmp_path):
    d = tmp_path / "stocks"
    d.mkdir()
    make_ohlcv(d / "STRONG.NS.csv", drift=0.004, vol=0.008, seed=7)
    make_ohlcv(d / "WEAK.NS.csv", drift=-0.003, vol=0.008, seed=8)
    bench = make_ohlcv(tmp_path / "NIFTY.csv", drift=0.0005, vol=0.006, seed=9)
    r = run(d, ["momentum", "relative", "high52"], benchmark=bench, min_turnover_cr=0)
    names = [x["symbol"] for x in r["results"]]
    assert "STRONG" in names and "WEAK" not in names
    assert r["scanned"] == 2


def test_liquidity_filter(tmp_path):
    d = tmp_path / "s"
    d.mkdir()
    make_ohlcv(d / "THIN.csv", drift=0.004, vol=0.008, seed=7, vbase=100)
    assert run(d, ["momentum"], min_turnover_cr=5)["matches"] == 0
