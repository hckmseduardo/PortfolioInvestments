from fastapi import APIRouter, Depends, HTTPException, status
from typing import List, Optional, Tuple, Callable, Dict, Any
from datetime import datetime, timedelta
from collections import defaultdict
import re
from rq.exceptions import NoSuchJobError
from app.models.schemas import Expense, ExpenseCreate, Category, CategoryCreate, User
from app.api.auth import get_current_user
from app.database.json_db import get_db
from app.services.job_queue import enqueue_expense_conversion_job, get_job_info

router = APIRouter(prefix="/expenses", tags=["expenses"])

EXPENSE_ACCOUNT_TYPES = {"checking", "credit_card"}

# Default category keywords for auto-categorization
CATEGORY_KEYWORDS = {
    "Groceries": ["grocery", "supermarket", "food", "market", "produce", "walmart", "costco", "loblaws", "metro", "sobeys"],
    "Dining": ["restaurant", "cafe", "coffee", "starbucks", "tim hortons", "mcdonald", "pizza", "burger", "food delivery", "uber eats", "doordash", "skip the dishes"],
    "Transportation": ["gas", "fuel", "transit", "uber", "lyft", "taxi", "parking", "car wash", "vehicle", "auto"],
    "Utilities": ["electric", "hydro", "water", "gas bill", "internet", "phone", "mobile", "bell", "rogers", "telus"],
    "Entertainment": ["movie", "cinema", "netflix", "spotify", "game", "entertainment", "concert", "theatre"],
    "Shopping": ["amazon", "shop", "store", "clothing", "apparel", "electronics"],
    "Healthcare": ["pharmacy", "medical", "doctor", "dental", "health", "prescription", "clinic"],
    "Bills": ["bill payment", "payment for", "insurance", "subscription"],
    "Transfer": ["transfer", "e-transfer", "interac"],
    "ATM": ["atm", "cash withdrawal", "retrait"],
    "Fees": ["fee", "charge", "frais"],
}

def _parse_transaction_date(date_value: Optional[str]) -> Optional[datetime]:
    """Parse transaction date that may include timezone suffixes."""
    if isinstance(date_value, datetime):
        return date_value
    if isinstance(date_value, str) and date_value:
        try:
            return datetime.fromisoformat(date_value.replace('Z', '+00:00'))
        except ValueError:
            return None
    return None


def _dates_within_tolerance(date_a: Optional[str], date_b: Optional[str], tolerance_days: int) -> bool:
    """Check if two dates are within the tolerance window."""
    parsed_a = _parse_transaction_date(date_a)
    parsed_b = _parse_transaction_date(date_b)
    if not parsed_a or not parsed_b:
        return False
    return abs((parsed_a - parsed_b).days) <= tolerance_days


def auto_categorize_expense(description: str, user_id: str) -> Optional[str]:
    """
    Auto-categorize an expense based on description and learning from existing expenses.

    Args:
        description: Transaction description
        user_id: User ID to get user-specific categorizations

    Returns:
        Category name or None if no match found
    """
    if not description:
        return None

    description_lower = description.lower()

    # First, try to learn from existing expenses
    db = get_db()
    existing_expenses = db.find("expenses", {})

    # Build a map of description patterns to categories from user's history
    for expense in existing_expenses:
        if expense.get("category") and expense.get("description"):
            exp_desc = expense.get("description", "").lower()
            exp_category = expense.get("category")

            # If we find a very similar description, use that category
            if exp_desc and len(exp_desc) > 5:
                # Extract key words from the existing description
                key_words = [w for w in exp_desc.split() if len(w) > 3]
                match_count = sum(1 for word in key_words if word in description_lower)

                # If 50% or more words match, use this category
                if key_words and (match_count / len(key_words)) >= 0.5:
                    return exp_category

    # Fall back to keyword-based categorization
    best_match = None
    best_match_count = 0

    for category, keywords in CATEGORY_KEYWORDS.items():
        match_count = sum(1 for keyword in keywords if keyword in description_lower)
        if match_count > best_match_count:
            best_match_count = match_count
            best_match = category

    return best_match

def _is_expense_account(account: Optional[dict]) -> bool:
    """Return True if the account type should appear in expenses."""
    if not account:
        return False
    return account.get("account_type") in EXPENSE_ACCOUNT_TYPES


def _get_expense_accounts(db, user_id: str) -> List[dict]:
    """Return all checking/credit card accounts for the user."""
    all_accounts = db.find("accounts", {"user_id": user_id})
    return [acc for acc in all_accounts if _is_expense_account(acc)]


def _looks_like_transfer_pair(
    txn_a: dict,
    txn_b: dict,
    account_lookup: Dict[str, Dict[str, Any]]
) -> bool:
    """
    Determine if two transactions are likely part of the same transfer.
    Handles standard debit/credit transfers and credit-card payments where
    institutions sometimes export both legs as withdrawals.
    """
    total_a = txn_a.get("total", 0) or 0
    total_b = txn_b.get("total", 0) or 0
    if total_a == 0 or total_b == 0:
        return False

    # Opposite signs is the classic transfer pattern
    if total_a * total_b < 0:
        return True

    type_a = (txn_a.get("type") or "").lower()
    type_b = (txn_b.get("type") or "").lower()
    if "transfer" in {type_a, type_b}:
        return True

    account_a = account_lookup.get(txn_a.get("account_id"))
    account_b = account_lookup.get(txn_b.get("account_id"))
    account_types = {
        account_a.get("account_type") if account_a else None,
        account_b.get("account_type") if account_b else None,
    }

    # Checking <-> credit card payments often show up as two withdrawals
    if account_types == {"checking", "credit_card"}:
        return True

    # Consider other bank-to-bank transfers when descriptions explicitly say so
    description_combo = f"{txn_a.get('description','').lower()} {txn_b.get('description','').lower()}"
    transfer_keywords = ("transfer", "interac", "etransfer", "e-transfer")
    if any(keyword in description_combo for keyword in transfer_keywords):
        return True

    return False


def detect_transfers(user_id: str, db, days_tolerance: int = 3) -> List[Tuple[str, str]]:
    """
    Detect transfers between accounts by finding matching debit/credit pairs.

    Args:
        user_id: User ID to check transfers for
        db: Database instance
        days_tolerance: Number of days to look for matching transactions

    Returns:
        List of tuples (transaction_id_1, transaction_id_2) that are transfers
    """
    # Get all user accounts
    accounts = db.find("accounts", {"user_id": user_id})
    account_ids = [acc["id"] for acc in accounts]
    account_lookup = {acc["id"]: acc for acc in accounts}

    # Get all transactions for user
    all_transactions = []
    for acc_id in account_ids:
        txns = db.find("transactions", {"account_id": acc_id})
        all_transactions.extend(txns)

    # Group transactions by similar amounts (within 0.01 tolerance)
    amount_groups = defaultdict(list)
    for txn in all_transactions:
        amount = abs(txn.get("total", 0))
        if amount > 0:  # Ignore zero amounts
            # Round to nearest cent for grouping
            amount_key = round(amount, 2)
            amount_groups[amount_key].append(txn)

    transfers = []
    paired_transaction_ids = set()

    # For each group of same-amount transactions, find matching pairs
    for txns in amount_groups.values():
        if len(txns) < 2:
            continue

        sorted_txns = sorted(
            txns,
            key=lambda txn: _parse_transaction_date(txn.get("date")) or datetime.min
        )

        for idx, txn_a in enumerate(sorted_txns):
            id_a = txn_a.get("id")
            if not id_a or id_a in paired_transaction_ids:
                continue

            for txn_b in sorted_txns[idx + 1:]:
                id_b = txn_b.get("id")
                if not id_b or id_b in paired_transaction_ids:
                    continue

                if txn_a.get("account_id") == txn_b.get("account_id"):
                    continue

                if not _dates_within_tolerance(txn_a.get("date"), txn_b.get("date"), days_tolerance):
                    continue

                if not _looks_like_transfer_pair(txn_a, txn_b, account_lookup):
                    continue

                transfers.append((id_a, id_b))
                paired_transaction_ids.add(id_a)
                paired_transaction_ids.add(id_b)
                break

    return transfers

@router.post("", response_model=Expense)
async def create_expense(
    expense: ExpenseCreate,
    current_user: User = Depends(get_current_user)
):
    db = get_db()
    
    account = db.find_one("accounts", {"id": expense.account_id, "user_id": current_user.id})
    if not account:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Account not found"
        )
    
    expense_doc = expense.model_dump()
    created_expense = db.insert("expenses", expense_doc)
    
    return Expense(**created_expense)

@router.get("", response_model=List[Expense])
async def get_expenses(
    account_id: str = None,
    category: str = None,
    current_user: User = Depends(get_current_user)
):
    db = get_db()
    
    if account_id:
        account = db.find_one("accounts", {"id": account_id, "user_id": current_user.id})
        if not account:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Account not found"
            )
        
        if not _is_expense_account(account):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Expenses are limited to checking and credit card accounts"
            )

        query = {"account_id": account_id}
        if category:
            query["category"] = category
        
        expenses = db.find("expenses", query)
    else:
        user_accounts = _get_expense_accounts(db, current_user.id)
        if not user_accounts:
            return []
        account_ids = [acc["id"] for acc in user_accounts]
        
        expenses = []
        for acc_id in account_ids:
            query = {"account_id": acc_id}
            if category:
                query["category"] = category
            expenses.extend(db.find("expenses", query))
    
    return [Expense(**exp) for exp in expenses]

@router.get("/summary")
async def get_expense_summary(
    account_id: str = None,
    current_user: User = Depends(get_current_user)
):
    db = get_db()
    
    if account_id:
        account = db.find_one("accounts", {"id": account_id, "user_id": current_user.id})
        if not account:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Account not found"
            )
        if not _is_expense_account(account):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Expenses are limited to checking and credit card accounts"
            )
        expenses = db.find("expenses", {"account_id": account_id})
    else:
        user_accounts = _get_expense_accounts(db, current_user.id)
        if not user_accounts:
            return {
                "total_expenses": 0,
                "by_category": {},
                "by_month": {},
                "expense_count": 0
            }
        account_ids = [acc["id"] for acc in user_accounts]
        
        expenses = []
        for acc_id in account_ids:
            expenses.extend(db.find("expenses", {"account_id": acc_id}))
    
    total_expenses = sum(exp.get("amount", 0) for exp in expenses)
    
    by_category = defaultdict(float)
    by_month = defaultdict(float)
    
    for exp in expenses:
        category = exp.get("category", "Uncategorized")
        by_category[category] += exp.get("amount", 0)
        
        date_str = exp.get("date", "")
        if date_str:
            try:
                date = datetime.fromisoformat(date_str.replace('Z', '+00:00'))
                month_key = date.strftime("%Y-%m")
                by_month[month_key] += exp.get("amount", 0)
            except:
                pass
    
    return {
        "total_expenses": total_expenses,
        "by_category": dict(by_category),
        "by_month": dict(by_month),
        "expense_count": len(expenses)
    }

@router.put("/{expense_id}", response_model=Expense)
async def update_expense(
    expense_id: str,
    expense_update: ExpenseCreate,
    current_user: User = Depends(get_current_user)
):
    db = get_db()
    
    existing_expense = db.find_one("expenses", {"id": expense_id})
    if not existing_expense:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Expense not found"
        )
    
    account = db.find_one("accounts", {"id": existing_expense["account_id"], "user_id": current_user.id})
    if not account:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to update this expense"
        )
    
    db.update(
        "expenses",
        {"id": expense_id},
        expense_update.model_dump()
    )
    
    updated_expense = db.find_one("expenses", {"id": expense_id})
    return Expense(**updated_expense)

@router.delete("/{expense_id}")
async def delete_expense(
    expense_id: str,
    current_user: User = Depends(get_current_user)
):
    db = get_db()
    
    existing_expense = db.find_one("expenses", {"id": expense_id})
    if not existing_expense:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Expense not found"
        )
    
    account = db.find_one("accounts", {"id": existing_expense["account_id"], "user_id": current_user.id})
    if not account:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to delete this expense"
        )
    
    db.delete("expenses", {"id": expense_id})
    
    return {"message": "Expense deleted successfully"}

@router.post("/categories", response_model=Category)
async def create_category(
    category: CategoryCreate,
    current_user: User = Depends(get_current_user)
):
    db = get_db()
    
    category_doc = {
        **category.model_dump(),
        "user_id": current_user.id
    }
    
    created_category = db.insert("categories", category_doc)
    return Category(**created_category)

@router.get("/categories", response_model=List[Category])
async def get_categories(current_user: User = Depends(get_current_user)):
    db = get_db()
    categories = db.find("categories", {"user_id": current_user.id})
    return [Category(**cat) for cat in categories]

@router.put("/categories/{category_id}", response_model=Category)
async def update_category(
    category_id: str,
    category_update: CategoryCreate,
    current_user: User = Depends(get_current_user)
):
    db = get_db()

    existing_category = db.find_one("categories", {"id": category_id, "user_id": current_user.id})
    if not existing_category:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Category not found"
        )

    db.update(
        "categories",
        {"id": category_id},
        category_update.model_dump()
    )

    updated_category = db.find_one("categories", {"id": category_id})
    return Category(**updated_category)

@router.delete("/categories/{category_id}")
async def delete_category(
    category_id: str,
    current_user: User = Depends(get_current_user)
):
    db = get_db()

    existing_category = db.find_one("categories", {"id": category_id, "user_id": current_user.id})
    if not existing_category:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Category not found"
        )

    db.delete("categories", {"id": category_id})

    return {"message": "Category deleted successfully"}

@router.post("/categories/init-defaults")
async def initialize_default_categories(current_user: User = Depends(get_current_user)):
    """Initialize default expense categories for a user."""
    db = get_db()

    # Check if user already has categories
    existing_categories = db.find("categories", {"user_id": current_user.id})
    if existing_categories:
        return {"message": "Categories already exist", "count": len(existing_categories)}

    # Define default categories with colors
    default_categories = [
        # Income categories
        {"name": "Income", "type": "income", "color": "#4CAF50", "budget_limit": None},

        # Investment categories
        {"name": "Investment In", "type": "investment", "color": "#1976D2", "budget_limit": None},
        {"name": "Investment Out", "type": "investment", "color": "#0D47A1", "budget_limit": None},

        # Expense categories
        {"name": "Groceries", "type": "expense", "color": "#8BC34A", "budget_limit": None},
        {"name": "Dining", "type": "expense", "color": "#FF9800", "budget_limit": None},
        {"name": "Transportation", "type": "expense", "color": "#2196F3", "budget_limit": None},
        {"name": "Utilities", "type": "expense", "color": "#9C27B0", "budget_limit": None},
        {"name": "Entertainment", "type": "expense", "color": "#E91E63", "budget_limit": None},
        {"name": "Shopping", "type": "expense", "color": "#00BCD4", "budget_limit": None},
        {"name": "Healthcare", "type": "expense", "color": "#F44336", "budget_limit": None},
        {"name": "Bills", "type": "expense", "color": "#795548", "budget_limit": None},
        {"name": "Transfer", "type": "transfer", "color": "#607D8B", "budget_limit": None},
        {"name": "ATM", "type": "expense", "color": "#9E9E9E", "budget_limit": None},
        {"name": "Fees", "type": "expense", "color": "#FF5722", "budget_limit": None},
        {"name": "Uncategorized", "type": "expense", "color": "#757575", "budget_limit": None},
    ]

    created_categories = []
    for cat_data in default_categories:
        category_doc = {
            **cat_data,
            "user_id": current_user.id
        }
        created_cat = db.insert("categories", category_doc)
        created_categories.append(created_cat)

    return {
        "message": "Default categories created successfully",
        "count": len(created_categories),
        "categories": [Category(**cat) for cat in created_categories]
    }

@router.patch("/{expense_id}/category")
async def update_expense_category(
    expense_id: str,
    category: str,
    current_user: User = Depends(get_current_user)
):
    """Update just the category of an expense."""
    db = get_db()

    existing_expense = db.find_one("expenses", {"id": expense_id})
    if not existing_expense:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Expense not found"
        )

    account = db.find_one("accounts", {"id": existing_expense["account_id"], "user_id": current_user.id})
    if not account:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to update this expense"
        )

    db.update(
        "expenses",
        {"id": expense_id},
        {"category": category}
    )

    updated_expense = db.find_one("expenses", {"id": expense_id})
    return Expense(**updated_expense)

@router.get("/monthly-comparison")
async def get_monthly_expense_comparison(
    months: int = 6,
    account_id: str = None,
    current_user: User = Depends(get_current_user)
):
    """Get monthly expense comparison for the last N months."""
    db = get_db()

    if account_id:
        account = db.find_one("accounts", {"id": account_id, "user_id": current_user.id})
        if not account:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Account not found"
            )
        if not _is_expense_account(account):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Expenses are limited to checking and credit card accounts"
            )
        expenses = db.find("expenses", {"account_id": account_id})
    else:
        user_accounts = _get_expense_accounts(db, current_user.id)
        if not user_accounts:
            return {
                "months": [],
                "total_months": 0
            }
        account_ids = [acc["id"] for acc in user_accounts]

        expenses = []
        for acc_id in account_ids:
            expenses.extend(db.find("expenses", {"account_id": acc_id}))

    # Organize expenses by month and category
    monthly_data = defaultdict(lambda: {"total": 0, "by_category": defaultdict(float)})

    for exp in expenses:
        date_str = exp.get("date", "")
        if date_str:
            try:
                date = datetime.fromisoformat(date_str.replace('Z', '+00:00'))
                month_key = date.strftime("%Y-%m")
                category = exp.get("category", "Uncategorized")
                amount = abs(exp.get("amount", 0))

                monthly_data[month_key]["total"] += amount
                monthly_data[month_key]["by_category"][category] += amount
            except:
                pass

    # Sort by month and get last N months
    sorted_months = sorted(monthly_data.keys(), reverse=True)[:months]
    sorted_months.reverse()  # Show oldest to newest

    result = []
    for month in sorted_months:
        result.append({
            "month": month,
            "total": monthly_data[month]["total"],
            "by_category": dict(monthly_data[month]["by_category"])
        })

    return {
        "months": result,
        "total_months": len(result)
    }

@router.post("/detect-transfers")
async def detect_and_mark_transfers(current_user: User = Depends(get_current_user)):
    """
    Detect transfers between accounts and mark them in transactions.
    This helps exclude transfers from expense totals.
    """
    db = get_db()

    # Detect transfers
    transfers = detect_transfers(current_user.id, db, days_tolerance=5)

    # Mark transactions as transfers
    marked_count = 0
    for txn_id1, txn_id2 in transfers:
        # Update both transactions to mark them as part of a transfer pair
        db.update("transactions", {"id": txn_id1}, {"is_transfer": True, "transfer_pair_id": txn_id2})
        db.update("transactions", {"id": txn_id2}, {"is_transfer": True, "transfer_pair_id": txn_id1})
        marked_count += 2

    return {
        "message": f"Detected and marked {len(transfers)} transfer pairs",
        "transfer_pairs": len(transfers),
        "transactions_marked": marked_count
    }

def run_expense_conversion(
    user_id: str,
    account_id: Optional[str] = None,
    progress_callback: Optional[Callable[[str], None]] = None
) -> Dict[str, Any]:
    """
    Core logic that converts transactions to expenses for a user.
    Designed to be executed by a background worker.
    """
    db = get_db()

    def notify(stage: str):
        if progress_callback:
            progress_callback(stage)

    notify("detecting_transfers")
    transfers = detect_transfers(user_id, db, days_tolerance=5)
    transfer_transaction_ids = set()
    for txn_id1, txn_id2 in transfers:
        transfer_transaction_ids.add(txn_id1)
        transfer_transaction_ids.add(txn_id2)

    if account_id:
        account = db.find_one("accounts", {"id": account_id, "user_id": user_id})
        if not account or not _is_expense_account(account):
            raise ValueError("Checking or credit card account not found")
        accounts = [account]
    else:
        accounts = _get_expense_accounts(db, user_id)

    if not accounts:
        return {
            "message": "No checking or credit card accounts found",
            "expenses_created": 0,
            "expenses_updated": 0,
            "transfers_excluded": 0,
            "transfer_expenses_removed": 0,
            "transactions_processed": 0,
        }

    account_ids = [acc["id"] for acc in accounts]

    notify("loading_transactions")
    transactions = []
    for acc_id in account_ids:
        txns = db.find("transactions", {"account_id": acc_id})
        transactions.extend([t for t in txns if t.get("type") in ["withdrawal", "fee"]])

    transaction_by_id = {
        txn.get("id"): txn
        for txn in transactions
        if txn.get("id")
    }

    transfer_expense_keys = set()
    for txn_id in transfer_transaction_ids:
        txn = transaction_by_id.get(txn_id)
        if not txn:
            continue
        transfer_expense_keys.add((
            txn.get("account_id"),
            txn.get("date"),
            abs(txn.get("total", 0)),
            txn.get("description")
        ))

    notify("loading_expenses")
    existing_expenses = []
    for acc_id in account_ids:
        existing_expenses.extend(db.find("expenses", {"account_id": acc_id}))

    existing_by_txn_id = {}
    existing_expense_keys = set()
    for exp in existing_expenses:
        if exp.get("transaction_id"):
            existing_by_txn_id[exp.get("transaction_id")] = exp

        key = (
            exp.get("account_id"),
            exp.get("date"),
            exp.get("amount"),
            exp.get("description")
        )
        existing_expense_keys.add(key)

    notify("cleaning_transfer_expenses")
    transfer_expenses_removed = 0
    if transfer_transaction_ids:
        for exp in list(existing_expenses):
            txn_id = exp.get("transaction_id")
            key = (
                exp.get("account_id"),
                exp.get("date"),
                exp.get("amount"),
                exp.get("description")
            )

            matches_transfer = False
            if txn_id and txn_id in transfer_transaction_ids:
                matches_transfer = True
            elif key in transfer_expense_keys:
                matches_transfer = True

            if matches_transfer:
                db.delete("expenses", {"id": exp["id"]})
                transfer_expenses_removed += 1
                if txn_id:
                    existing_by_txn_id.pop(txn_id, None)
                if key in existing_expense_keys:
                    existing_expense_keys.remove(key)
                existing_expenses.remove(exp)

    notify("converting_transactions")
    expenses_created = 0
    expenses_updated = 0
    transfers_skipped = 0
    for txn in transactions:
        if txn.get("id") in transfer_transaction_ids:
            transfers_skipped += 1
            continue

        txn_id = txn.get("id")

        if txn_id and txn_id in existing_by_txn_id:
            existing_exp = existing_by_txn_id[txn_id]
            update_data = {
                "date": txn.get("date"),
                "description": txn.get("description", ""),
                "amount": abs(txn.get("total", 0)),
                "category": existing_exp.get("category", "Uncategorized"),
                "transaction_id": txn_id
            }

            db.update("expenses", {"id": existing_exp["id"]}, update_data)
            expenses_updated += 1
            continue

        txn_key = (
            txn.get("account_id"),
            txn.get("date"),
            abs(txn.get("total", 0)),
            txn.get("description")
        )

        if txn_key in existing_expense_keys:
            matching_exp = next((e for e in existing_expenses
                               if e.get("account_id") == txn.get("account_id")
                               and e.get("date") == txn.get("date")
                               and e.get("amount") == abs(txn.get("total", 0))
                               and e.get("description") == txn.get("description")), None)

            if matching_exp and txn_id:
                db.update("expenses", {"id": matching_exp["id"]}, {"transaction_id": txn_id})
                expenses_updated += 1
            continue

        category = auto_categorize_expense(txn.get("description", ""), user_id)

        expense_doc = {
            "date": txn.get("date"),
            "description": txn.get("description", ""),
            "amount": abs(txn.get("total", 0)),
            "category": category or "Uncategorized",
            "account_id": txn.get("account_id"),
            "transaction_id": txn_id,
            "notes": f"Imported from transaction (type: {txn.get('type')})"
        }

        db.insert("expenses", expense_doc)
        expenses_created += 1

    notify("completed")
    return {
        "message": (
            f"Converted {expenses_created} new transactions to expenses, "
            f"updated {expenses_updated} existing expenses "
            f"({transfers_skipped} transfers excluded, "
            f"{transfer_expenses_removed} transfer expenses removed)"
        ),
        "expenses_created": expenses_created,
        "expenses_updated": expenses_updated,
        "transfers_excluded": transfers_skipped,
        "transfer_expenses_removed": transfer_expenses_removed,
        "transactions_processed": len(transactions),
        "user_id": user_id,
        "account_id": account_id,
    }


@router.post("/convert-transactions")
async def convert_transactions_to_expenses(
    account_id: Optional[str] = None,
    current_user: User = Depends(get_current_user)
):
    db = get_db()

    if account_id:
        account = db.find_one("accounts", {"id": account_id, "user_id": current_user.id})
        if not account or not _is_expense_account(account):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Checking or credit card account not found"
            )

    job = enqueue_expense_conversion_job(current_user.id, account_id)
    job.meta = job.meta or {}
    job.meta["user_id"] = current_user.id
    if account_id:
        job.meta["account_id"] = account_id
    job.meta["stage"] = "queued"
    job.save_meta()

    return {
        "job_id": job.id,
        "status": job.get_status(),
        "meta": job.meta
    }


@router.get("/convert-transactions/jobs/{job_id}")
async def get_conversion_job_status(
    job_id: str,
    current_user: User = Depends(get_current_user)
):
    try:
        job_info = get_job_info(job_id)
    except NoSuchJobError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Job not found"
        )
    job_meta = job_info.get("meta") or {}

    if job_meta.get("user_id") != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Job not found"
        )

    result = job_info.get("result")
    if isinstance(result, dict):
        sanitized_result = result.copy()
        sanitized_result.pop("user_id", None)
        job_info["result"] = sanitized_result

    return job_info
