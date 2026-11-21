from flow_tracker import add_row, analyze, streak


def test_streak():
    assert streak([1, -2, -3, -1]) == -3
    assert streak([-1, 2, 3]) == 2


def test_absorbed_reading(tmp_path):
    p = tmp_path / "f.csv"
    for d in range(1, 8):
        add_row(p, f"2026-11-{d:02d}", -1000, 2000)
    r = analyze(add_row(p, "2026-11-08", -1000, 2000))
    assert r["fii_sum"]["5d"] == -5000 and "absorbed" in r["reading"]
    assert r["fii_streak_days"] == -8


def test_add_replaces_same_date(tmp_path):
    p = tmp_path / "f.csv"
    add_row(p, "2026-11-01", 100, 100)
    rows = add_row(p, "2026-11-01", 500, 0)
    assert len(rows) == 1 and rows[0]["fii_net"] == 500
