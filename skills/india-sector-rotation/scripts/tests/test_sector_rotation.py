from synth_data import make_ohlcv
from sector_rotation import run


def test_leader_and_laggard(tmp_path):
    d = tmp_path / "sec"
    d.mkdir()
    make_ohlcv(d / "NIFTY_IT.csv", drift=0.004, vol=0.006, seed=1)
    make_ohlcv(d / "NIFTY_METAL.csv", drift=-0.003, vol=0.006, seed=2)
    bench = make_ohlcv(tmp_path / "NIFTY.csv", drift=0.0005, vol=0.005, seed=3)
    r = run(d, bench)
    q = {s["sector"]: s["quadrant"] for s in r["sectors"]}
    assert q["NIFTY IT"] in ("Leading", "Weakening")
    assert q["NIFTY METAL"] in ("Lagging", "Improving")
    assert r["sectors"][0]["sector"] == "NIFTY IT"
