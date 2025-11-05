class _StubColumns(list):
    def tolist(self):
        return list(self)


class _StubRow(dict):
    def get(self, key, default=None):
        return super().get(key, default)


class _StubDataFrame:
    def __init__(self, rows):
        self._rows = [_StubRow(r) for r in rows]
        self.columns = _StubColumns(list(rows[0].keys()) if rows else [])

    def iterrows(self):
        for idx, row in enumerate(self._rows):
            yield idx, row

    def __len__(self):
        return len(self._rows)


class _StubPandasModule:
    DataFrame = object  # pragma: no cover - placeholder for typing hints

    class Timestamp:  # pragma: no cover - placeholder to satisfy isinstance checks
        pass

    @staticmethod
    def notna(value):
        return value is not None

    def __init__(self):
        self._rows = []

    def read_csv(self, *args, **kwargs):
        return _StubDataFrame(self._rows)


import sys
from pathlib import Path

BACKEND_PATH = Path(__file__).resolve().parents[2]
if str(BACKEND_PATH) not in sys.path:
    sys.path.insert(0, str(BACKEND_PATH))

PANDAS_STUB = _StubPandasModule()
sys.modules.setdefault("pandas", PANDAS_STUB)

import pytest

from app.parsers.wealthsimple_parser import WealthsimpleParser


@pytest.mark.parametrize(
    "description,expected",
    [
        ("BTC - Purchase of 0.0100 BTC", "BTC"),
        ("Purchase of 0.500 ETH (executed at 2025-01-21)", "ETH"),
        ("Sell 1.2 SOL (executed at 2025-01-22)", "SOL"),
    ],
)
def test_extract_ticker_from_description_crypto(description, expected):
    parser = WealthsimpleParser()

    ticker = parser._extract_ticker_from_description(description)

    assert ticker == expected


def test_parse_csv_crypto_transactions(tmp_path, monkeypatch):
    rows = [
        {
            "date": "2025-01-21",
            "transaction": "TRFIN",
            "description": "Money transfer into the account (executed at 2025-01-21)",
            "amount": 200.0,
            "balance": 200.0,
            "Quantity": None,
        },
        {
            "date": "2025-01-21",
            "transaction": "BUY",
            "description": "Purchase of 0.0012926500 BTC (executed at 2025-01-21), FX Rate: 1.4396, Fee charged $1.98",
            "amount": -200.0,
            "balance": 0.0,
            "Quantity": 0.00129265,
        },
    ]

    PANDAS_STUB._rows = rows
    monkeypatch.setattr("app.parsers.wealthsimple_parser.pd", PANDAS_STUB)

    parser = WealthsimpleParser()
    csv_path = tmp_path / "crypto_transactions.csv"
    csv_path.write_text("placeholder")

    result = parser.parse_csv(str(csv_path))

    assert len(result["transactions"]) == 2

    deposit_txn = result["transactions"][0]
    assert deposit_txn["type"] == "deposit"
    assert deposit_txn["ticker"] == ""
    assert deposit_txn["total"] == 200.0

    buy_txn = result["transactions"][1]
    assert buy_txn["type"] == "buy"
    assert buy_txn["ticker"] == "BTC"
    assert pytest.approx(buy_txn["quantity"], rel=1e-3) == 0.00129265
    assert buy_txn["total"] == -200.0

    # Parser adds a CASH position when deposits are present
    cash_positions = [p for p in result["positions"] if p["ticker"] == "CASH"]
    assert len(cash_positions) == 1
    assert cash_positions[0]["quantity"] == 200.0
