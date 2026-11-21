from synth_data import make_ohlcv
from india_common import load_ohlcv
from market_regime import build


def test_bull_vs_bear_regime(tmp_path):
    bull = load_ohlcv(make_ohlcv(tmp_path / "b.csv", start=24000, drift=0.003, vol=0.005, seed=1))
    bear = load_ohlcv(make_ohlcv(tmp_path / "s.csv", start=24000, drift=-0.003, vol=0.005, seed=2))
    calm = load_ohlcv(make_ohlcv(tmp_path / "v.csv", start=11, drift=0, vol=0.005, seed=3))
    panic = load_ohlcv(make_ohlcv(tmp_path / "p.csv", start=28, drift=0, vol=0.005, seed=4))
    r1 = build(bull, vix=calm, global_cues={"gift_nifty_pct": 0.5})
    r2 = build(bear, vix=panic, global_cues={"gift_nifty_pct": -0.8, "brent": 3})
    assert r1["score"] > 60 and r1["posture"] in ("aggressive", "normal")
    assert r2["score"] < 35 and r2["posture"] == "stand_aside"
    assert r1["expected_daily_move_pts"] > 0


def test_flows_component(tmp_path):
    n = load_ohlcv(make_ohlcv(tmp_path / "n.csv", seed=5))
    f = tmp_path / "f.csv"
    f.write_text("date,fii_net,dii_net\n" + "".join(f"2026-11-{d:02d},-5000,1000\n" for d in range(10, 16)))
    r = build(n, flows=str(f))
    assert r["flows"]["fii_5d_cr"] == -25000
    assert r["components"]["flows"] < 0.5
