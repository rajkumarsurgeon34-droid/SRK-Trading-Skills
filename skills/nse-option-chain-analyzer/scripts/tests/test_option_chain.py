import json

from option_chain import analyze, buildup, load_nse_json, max_pain


def rows():
    out = []
    for k in range(25700, 26350, 50):
        out.append({"strike": k, "ce_oi": 100000 if k == 26200 else 20000, "ce_chg_oi": 5000, "ce_ltp": max(26000 - k, 0) + 40,
                    "ce_chg": -3, "ce_iv": 12, "pe_oi": 150000 if k == 25800 else 25000, "pe_chg_oi": 9000,
                    "pe_ltp": max(k - 26000, 0) + 40, "pe_chg": 2, "pe_iv": 13})
    return out


def test_walls_and_pcr():
    r = analyze(rows(), 26010)
    assert r["resistance_ce_oi"][0]["strike"] == 26200
    assert r["support_pe_oi"][0]["strike"] == 25800
    assert r["pcr_oi"] > 1
    assert r["atm_strike"] == 26000
    assert r["atm_straddle"] == 80


def test_max_pain_between_walls():
    assert 25800 <= max_pain(rows()) <= 26200


def test_buildup_labels():
    assert buildup(5, 100) == "long_buildup"
    assert buildup(-5, 100) == "short_buildup"
    assert buildup(5, -100) == "short_covering"
    assert buildup(-5, -100) == "long_unwinding"


def test_nse_json_loader(tmp_path):
    data = {"records": {"underlyingValue": 26010, "expiryDates": ["25-Nov-2026"], "data": [
        {"strikePrice": 26000, "expiryDate": "25-Nov-2026", "CE": {"openInterest": 10, "lastPrice": 50}, "PE": {"openInterest": 12, "lastPrice": 45}},
        {"strikePrice": 26000, "expiryDate": "02-Dec-2026", "CE": {"openInterest": 99}, "PE": {"openInterest": 99}}]}}
    p = tmp_path / "c.json"
    p.write_text(json.dumps(data))
    rs, spot, exp = load_nse_json(p)
    assert spot == 26010 and exp == "25-Nov-2026" and len(rs) == 1 and rs[0]["ce_oi"] == 10
