import pytest
from fetch_data import SECTORS, main
from india_common import load_config


def test_config_has_yahoo_symbols():
    syms = load_config()["yahoo_symbols"]
    assert syms["NIFTY"] == "^NSEI" and syms["INDIAVIX"] == "^INDIAVIX"
    assert "NIFTY_IT" in SECTORS


def test_cli_requires_command():
    with pytest.raises(SystemExit):
        main([])
