"""
Plaid Replay Service

Utility to replay Plaid syncs from saved debug data without making API calls.
Useful for testing, debugging, and fixing sync issues.
"""
import logging
import json
from pathlib import Path
from typing import Optional, Dict, Any, List
from datetime import datetime

logger = logging.getLogger(__name__)

PLAID_DEBUG_DIR = Path("/app/logs/plaid_debug")


def get_latest_debug_file(user_id: str, plaid_item_id: str, sync_type: str) -> Optional[Path]:
    """
    Find the most recent debug file for a given sync type

    Args:
        user_id: User ID
        plaid_item_id: Plaid item ID
        sync_type: Type of sync ('full_sync', 'incremental_sync', 'investment_sync', 'holdings')

    Returns:
        Path to the most recent debug file, or None if not found
    """
    if not PLAID_DEBUG_DIR.exists():
        logger.warning(f"Debug directory does not exist: {PLAID_DEBUG_DIR}")
        return None

    # Pattern to match debug files
    pattern = f"{sync_type}_{user_id}_{plaid_item_id}_*.json"

    # Find all matching files
    matching_files = list(PLAID_DEBUG_DIR.glob(pattern))

    if not matching_files:
        # Try without user_id/item_id for holdings files (older format)
        if sync_type == "holdings":
            pattern = f"{sync_type}_*.json"
            matching_files = list(PLAID_DEBUG_DIR.glob(pattern))

    if not matching_files:
        logger.warning(f"No debug files found matching pattern: {pattern}")
        return None

    # Sort by modification time, newest first
    matching_files.sort(key=lambda p: p.stat().st_mtime, reverse=True)

    latest_file = matching_files[0]
    logger.info(f"Found latest {sync_type} debug file: {latest_file}")

    return latest_file


def load_debug_data(file_path: Path) -> Optional[Dict[str, Any]]:
    """
    Load debug data from a JSON file

    Args:
        file_path: Path to the debug file

    Returns:
        Parsed JSON data, or None if failed
    """
    try:
        with open(file_path, 'r') as f:
            data = json.load(f)

        logger.info(f"Loaded debug data from {file_path}")
        return data
    except Exception as e:
        logger.error(f"Failed to load debug data from {file_path}: {e}")
        return None


def get_latest_sync_data(user_id: str, plaid_item_id: str) -> Optional[Dict[str, Any]]:
    """
    Load the most recent sync data for replay

    Args:
        user_id: User ID
        plaid_item_id: Plaid item ID

    Returns:
        Dictionary containing all sync data needed for replay
    """
    sync_data = {}

    # Try to find full sync first, then incremental
    full_sync_file = get_latest_debug_file(user_id, plaid_item_id, "full_sync")
    incremental_sync_file = get_latest_debug_file(user_id, plaid_item_id, "incremental_sync")

    # Use whichever is more recent
    transaction_sync_file = None
    if full_sync_file and incremental_sync_file:
        if full_sync_file.stat().st_mtime > incremental_sync_file.stat().st_mtime:
            transaction_sync_file = full_sync_file
        else:
            transaction_sync_file = incremental_sync_file
    elif full_sync_file:
        transaction_sync_file = full_sync_file
    elif incremental_sync_file:
        transaction_sync_file = incremental_sync_file

    if transaction_sync_file:
        sync_data['transactions'] = load_debug_data(transaction_sync_file)

    # Load investment sync data
    investment_sync_file = get_latest_debug_file(user_id, plaid_item_id, "investment_sync")
    if investment_sync_file:
        sync_data['investment_transactions'] = load_debug_data(investment_sync_file)

    # Load holdings data
    holdings_file = get_latest_debug_file(user_id, plaid_item_id, "holdings")
    if holdings_file:
        sync_data['holdings'] = load_debug_data(holdings_file)

    if not sync_data:
        logger.warning(f"No sync data found for user {user_id}, item {plaid_item_id}")
        return None

    logger.info(f"Loaded sync data for replay: {list(sync_data.keys())}")
    return sync_data


def extract_transactions_from_debug_data(debug_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Extract transaction sync data from debug file

    Args:
        debug_data: Debug data from file

    Returns:
        Transaction sync result in the format expected by plaid_sync
    """
    sync_type = debug_data.get('sync_type')

    if sync_type == 'full_resync':
        # Full resync format: raw_plaid_responses is a list of paginated responses
        raw_responses = debug_data.get('raw_plaid_responses', [])

        # Combine all transactions from all pages
        all_transactions = []
        for response in raw_responses:
            transactions = response.get('transactions', [])
            all_transactions.extend(transactions)

        return {
            'added': all_transactions,
            'modified': [],
            'removed': [],
            'next_cursor': None,
            'has_more': False
        }

    elif sync_type == 'incremental':
        # Incremental sync format: single raw_plaid_response
        raw_response = debug_data.get('raw_plaid_response', {})

        return {
            'added': raw_response.get('added', []),
            'modified': raw_response.get('modified', []),
            'removed': raw_response.get('removed', []),
            'next_cursor': raw_response.get('next_cursor'),
            'has_more': raw_response.get('has_more', False)
        }

    else:
        logger.warning(f"Unknown sync type: {sync_type}")
        return {
            'added': [],
            'modified': [],
            'removed': [],
            'next_cursor': None,
            'has_more': False
        }


def extract_investment_transactions_from_debug_data(debug_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Extract investment transaction data from debug file

    Args:
        debug_data: Debug data from file

    Returns:
        Investment transaction result in the format expected by plaid_sync
    """
    raw_responses = debug_data.get('raw_plaid_responses', [])

    # Combine all data from all pages
    all_transactions = []
    all_securities = {}
    all_accounts = []

    for response in raw_responses:
        # Add transactions with proper formatting
        transactions = response.get('investment_transactions', [])

        # Format each transaction to match expected schema
        # Raw Plaid data uses 'investment_transaction_id' but we need 'transaction_id'
        formatted_transactions = []
        for txn in transactions:
            formatted_txn = {
                "transaction_id": txn['investment_transaction_id'],  # Rename field
                "account_id": txn['account_id'],
                "security_id": txn.get('security_id'),
                "date": txn['date'],
                "name": txn.get('name'),
                "type": txn['type'],
                "subtype": txn.get('subtype'),
                "quantity": txn.get('quantity', 0),
                "amount": txn.get('amount', 0),
                "price": txn.get('price', 0),
                "fees": txn.get('fees', 0),
                "iso_currency_code": txn.get('iso_currency_code', 'USD'),
                "unofficial_currency_code": txn.get('unofficial_currency_code'),
            }
            formatted_transactions.append(formatted_txn)

        all_transactions.extend(formatted_transactions)

        # Merge securities
        securities = response.get('securities', [])
        for sec in securities:
            all_securities[sec['security_id']] = sec

        # Use accounts from first response (they're the same across pages)
        if not all_accounts:
            all_accounts = response.get('accounts', [])

    return {
        'transactions': all_transactions,
        'securities': list(all_securities.values()),
        'accounts': all_accounts,
        'total_transactions': len(all_transactions)
    }


def extract_holdings_from_debug_data(debug_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Extract holdings data from debug file

    Args:
        debug_data: Debug data from file

    Returns:
        Holdings data in the format expected by plaid_sync
    """
    return {
        'holdings': debug_data.get('holdings', []),
        'securities': debug_data.get('securities', []),
        'accounts': debug_data.get('accounts', []),
        'cash_balances': {}  # Will be recalculated
    }
