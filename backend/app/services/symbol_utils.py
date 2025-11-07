from typing import List, Set


CANADIAN_SUFFIXES = ['.TO', '.TSX', '.V', '.NE', '.CN', '.CA']
COLON_EXCHANGES = ['TSX', 'TSXV', 'CSE', 'NEO']


def _share_class_variants(ticker: str) -> Set[str]:
    ticker = (ticker or '').strip().upper()
    variants: Set[str] = set()
    if not ticker:
        return variants

    variants.add(ticker)

    delimiters = ['.', '-', '/']
    for delimiter in delimiters:
        if delimiter in ticker:
            base, remainder = ticker.split(delimiter, 1)
            remainder = remainder.replace('-', '').replace('.', '').replace('/', '')
            if not base or not remainder:
                continue
            variants.add(f"{base}{remainder}")
            variants.add(f"{base}-{remainder}")
            variants.add(f"{base}.{remainder}")

    return {v for v in variants if v}


def generate_equity_symbol_variants(ticker: str) -> List[str]:
    """
    Generate potential ticker representations across providers (Yahoo, TradingView, etc.).
    """
    seen: Set[str] = set()
    variants: List[str] = []

    def add(symbol: str):
        symbol = (symbol or '').strip().upper()
        if not symbol:
            return
        if symbol not in seen:
            seen.add(symbol)
            variants.append(symbol)

    add(ticker)

    share_variants = _share_class_variants(ticker)

    for variant in share_variants:
        add(variant)
        for suffix in CANADIAN_SUFFIXES:
            add(f"{variant}{suffix}")

    # Hyphenation for Yahoo Canada format (e.g., RCI-B.TO)
    for variant in list(share_variants):
        if '-' not in variant and '.' in variant:
            base, remainder = variant.split('.', 1)
            hyphen_variant = f"{base}-{remainder}"
            add(hyphen_variant)
            for suffix in CANADIAN_SUFFIXES:
                add(f"{hyphen_variant}{suffix}")

    # Colon notation for exchange-specific providers (e.g., TSX:RCI.B)
    for variant in share_variants:
        for exchange in COLON_EXCHANGES:
            add(f"{exchange}:{variant}")

    return variants
