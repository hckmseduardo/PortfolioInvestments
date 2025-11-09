"""
Interactive Brokers (IBKR) Activity Statement Parser.

Supports CSV exports that follow the standard IBKR activity statement layout where each
section is identified by the first column (e.g., "Operaciones", "Dividends", etc.).
"""

from __future__ import annotations

import csv
import unicodedata
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional


def _normalize_key(value: str) -> str:
    if not value:
        return ""
    normalized = unicodedata.normalize("NFKD", value)
    ascii_value = normalized.encode("ascii", "ignore").decode("ascii")
    return ascii_value.strip().lower()


def _parse_number(value: Optional[str]) -> Optional[float]:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    cleaned = str(value).strip()
    if not cleaned or cleaned in {"--", "n/a"}:
        return None
    cleaned = cleaned.replace(" ", "").replace(",", "")
    cleaned = cleaned.replace("%", "")
    try:
        return float(cleaned)
    except ValueError:
        return None


def _parse_datetime(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    cleaned = str(value).strip()
    if not cleaned:
        return None
    cleaned = cleaned.replace("EST", "").replace("EDT", "").strip()
    for fmt in ("%Y-%m-%d, %H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(cleaned, fmt)
        except ValueError:
            continue
    return None


class InteractiveBrokersParser:
    TRADE_SECTIONS = {"operaciones", "trades", "operations", "transactions"}
    DEPOSIT_SECTIONS = {"depositos y retiradas", "deposits & withdrawals", "deposits and withdrawals", "depots et retraits"}
    DIVIDEND_SECTIONS = {"dividendos", "dividends", "dividendes"}
    INTEREST_SECTIONS = {"interes", "interest", "interet"}
    POSITIONS_SECTIONS = {"posiciones abiertas", "open positions", "positions ouvertes"}
    ACCOUNT_INFO_SECTIONS = {"informacion sobre la cuenta", "account information", "informations du compte"}

    def __init__(self, file_path: str):
        self.file_path = Path(file_path)
        self.section_headers: Dict[str, List[str]] = {}
        self.transactions: List[Dict[str, Any]] = []
        self.dividends: List[Dict[str, Any]] = []
        self.positions: List[Dict[str, Any]] = []
        self.account_info: Dict[str, Any] = {}

    def parse(self) -> Dict[str, Any]:
        self._parse_file()
        return {
            "account": self.account_info,
            "transactions": self.transactions,
            "positions": self.positions,
            "dividends": self.dividends,
        }

    def _parse_file(self) -> None:
        with self.file_path.open("r", encoding="utf-8-sig", newline="") as handle:
            reader = csv.reader(handle)
            for row in reader:
                if not row or not row[0]:
                    continue

                section_key = _normalize_key(row[0])
                row_type_value = row[1] if len(row) > 1 else ""
                row_type = (row_type_value or "").strip().lower()
                values = row[2:]

                if row_type == "header":
                    self.section_headers[section_key] = [(value or "").strip() for value in values]
                    continue

                if row_type != "data":
                    continue

                headers = self.section_headers.get(section_key, [])
                row_dict = self._build_row_dict(headers, values)

                if section_key in self.ACCOUNT_INFO_SECTIONS:
                    self._handle_account_info(row_dict)
                elif section_key in self.TRADE_SECTIONS:
                    self._handle_trade(row_dict)
                elif section_key in self.DEPOSIT_SECTIONS:
                    self._handle_cash_movement(row_dict)
                elif section_key in self.DIVIDEND_SECTIONS:
                    self._handle_dividend(row_dict)
                elif section_key in self.INTEREST_SECTIONS:
                    self._handle_interest(row_dict)
                elif section_key in self.POSITIONS_SECTIONS:
                    self._handle_position(row_dict)

    @staticmethod
    def _build_row_dict(headers: List[str], values: List[str]) -> Dict[str, str]:
        cleaned_headers = [(header or "").strip() for header in headers]
        cleaned_values = [(value or "").strip() for value in values]
        return {cleaned_headers[idx]: cleaned_values[idx] for idx in range(min(len(cleaned_headers), len(cleaned_values)))}

    def _handle_account_info(self, row: Dict[str, str]) -> None:
        field_name = row.get("Nombre del campo") or row.get("Field Name") or row.get("Nom champ")
        value = row.get("Valor del campo") or row.get("Field Value") or row.get("Valeur champ")
        if not field_name:
            return

        normalized = _normalize_key(field_name)
        if "cuenta" in normalized or ("account" in normalized and "type" not in normalized) or ("compte" in normalized and "type" not in normalized):
            self.account_info["account_number"] = value
        elif ("nombre" in normalized and "campo" not in normalized) or ("name" in normalized and "field" not in normalized) or ("nom" == normalized):
            self.account_info["account_name"] = value
        elif "divisa base" in normalized or "base currency" in normalized or "devise de base" in normalized:
            self.account_info["currency"] = value

    def _handle_trade(self, row: Dict[str, str]) -> None:
        ticker = row.get("Símbolo") or row.get("Symbol") or row.get("Symbole")
        if not ticker:
            return

        trade_date = _parse_datetime(row.get("Fecha/Hora") or row.get("Date/Time") or row.get("Date/Heure"))
        if trade_date is None:
            return

        quantity = _parse_number(row.get("Cantidad") or row.get("Quantity") or row.get("Quantité")) or 0.0
        price = _parse_number(row.get("Precio trans.") or row.get("Trade Price") or row.get("T. Price") or row.get("Prix trans."))
        proceeds = _parse_number(row.get("Productos") or row.get("Proceeds") or row.get("Produit")) or 0.0
        fees = _parse_number(row.get("Tarifa/com.") or row.get("Comm/Fee") or row.get("Fees") or row.get("Comm/Tarif")) or 0.0
        total = proceeds + fees

        txn_type = "buy" if total < 0 else "sell"

        transaction = {
            "date": trade_date,
            "type": txn_type,
            "ticker": ticker,
            "quantity": quantity,
            "price": price,
            "fees": abs(fees),
            "total": total,
            "description": row.get("Categoría de activo", row.get("DataDiscriminator", "")) or "Trade",
        }
        self.transactions.append(transaction)

    def _handle_cash_movement(self, row: Dict[str, str]) -> None:
        currency = row.get("Divisa") or row.get("Currency") or row.get("Devise")
        if currency and currency.strip().lower() == "total":
            return

        amount = _parse_number(row.get("Cantidad") or row.get("Amount") or row.get("Montant"))
        if amount is None or amount == 0:
            return

        movement_date = _parse_datetime(row.get("Fecha de liquidación") or row.get("Settle Date") or row.get("Date de règlement") or row.get("Date"))
        if movement_date is None:
            return

        txn_type = "deposit" if amount > 0 else "withdrawal"
        description = row.get("Descripción") or row.get("Description") or "Cash movement"

        transaction = {
            "date": movement_date,
            "type": txn_type,
            "ticker": None,
            "quantity": None,
            "price": None,
            "fees": 0.0,
            "total": amount,
            "description": description,
        }
        self.transactions.append(transaction)

    def _handle_dividend(self, row: Dict[str, str]) -> None:
        currency = (row.get("Divisa") or row.get("Currency") or row.get("Devise") or "").strip()
        if currency.lower() == "total":
            return

        amount = _parse_number(row.get("Cantidad") or row.get("Amount") or row.get("Montant"))
        if amount is None:
            return

        description = row.get("Descripción") or row.get("Description") or ""
        ticker = self._extract_ticker_from_description(description)
        payment_date = _parse_datetime(row.get("Fecha") or row.get("Date"))
        if payment_date is None:
            return

        dividend = {
            "ticker": ticker,
            "date": payment_date,
            "amount": abs(amount),
            "currency": currency or "CAD",
        }
        self.dividends.append(dividend)

        transaction = {
            "date": payment_date,
            "type": "dividend",
            "ticker": ticker,
            "quantity": None,
            "price": None,
            "fees": 0.0,
            "total": amount,
            "description": description,
        }
        self.transactions.append(transaction)

    def _handle_interest(self, row: Dict[str, str]) -> None:
        currency = (row.get("Divisa") or row.get("Currency") or row.get("Devise") or "").strip()
        if currency.lower() == "total":
            return

        amount = _parse_number(row.get("Cantidad") or row.get("Amount") or row.get("Montant"))
        if amount is None or amount == 0:
            return

        description = row.get("Descripción") or row.get("Description") or "Interest"
        payment_date = _parse_datetime(row.get("Fecha") or row.get("Date"))
        if payment_date is None:
            return

        transaction = {
            "date": payment_date,
            "type": "interest",
            "ticker": None,
            "quantity": None,
            "price": None,
            "fees": 0.0,
            "total": amount,
            "description": description,
        }
        self.transactions.append(transaction)

    def _handle_position(self, row: Dict[str, str]) -> None:
        ticker = row.get("Símbolo") or row.get("Symbol") or row.get("Symbole")
        if not ticker:
            return

        position = {
            "ticker": ticker,
            "name": ticker,
            "quantity": _parse_number(row.get("Cantidad") or row.get("Quantity") or row.get("Quantité")) or 0.0,
            "book_value": _parse_number(row.get("Base de coste") or row.get("Cost Basis") or row.get("Coût d'acquisition")) or 0.0,
            "market_value": _parse_number(row.get("Valor") or row.get("Value") or row.get("Valeur")) or 0.0,
        }
        self.positions.append(position)

    @staticmethod
    def _extract_ticker_from_description(description: str) -> Optional[str]:
        if not description:
            return None
        # IBKR descriptions typically look like "VAB(CA...) Dividend ..."
        if "(" in description:
            ticker = description.split("(", 1)[0].strip()
            return ticker if ticker else None
        return None
