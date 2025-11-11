from fastapi import APIRouter, Depends, HTTPException, status
from typing import List, Optional, Tuple, Callable, Dict, Any
from datetime import datetime, timedelta
from collections import defaultdict
import re
from sqlalchemy.orm import Session
from rq.exceptions import NoSuchJobError
from app.models.schemas import Expense, ExpenseCreate, Category, CategoryCreate, User
from app.api.auth import get_current_user
from app.database.postgres_db import get_db as get_session
from app.database.db_service import get_db_service
from app.services.job_queue import enqueue_expense_conversion_job, get_job_info

router = APIRouter(prefix="/expenses", tags=["expenses"])

EXPENSE_ACCOUNT_TYPES = {"checking", "credit_card"}

# Enhanced category keywords for intelligent auto-categorization
# Based on Categorization Rules.md decision tree and keyword recognition
CATEGORY_KEYWORDS = {
    # === INCOME KEYWORDS (Amount > 0) ===
    "Income": [
        "payroll", "deposit", "salary", "bonus", "refund", "dividend", "interest",
        "transfer from", "payment received", "reimbursement", "cashback", "rebate",
        "credit interest", "tax refund", "income", "earnings", "wages", "commission"
    ],

    # === INVESTMENT KEYWORDS ===
    "Investment": [
        "etf", "stock", "crypto", "investment", "wealthsimple", "questrade",
        "tfsa", "rrsp", "rrif", "resp", "fhsa", "buy", "sell", "trade",
        "mutual fund", "bond", "security", "brokerage", "portfolio"
    ],

    # === TRANSFER KEYWORDS ===
    "Transfer": [
        "transfer to", "transfer from", "internal transfer", "interac", "e-transfer",
        "to savings", "to chequing", "to checking", "to credit card", "self transfer",
        "account transfer", "between accounts"
    ],

    # === CREDIT CARD PAYMENT (Higher priority than general Transfer) ===
    "Credit Card Payment": [
        "credit card payment", "card balance", "payment to credit", "cc payment",
        "visa payment", "mastercard payment", "amex payment"
    ],

    # === EXPENSE CATEGORIES (Amount < 0) ===
    "Groceries": [
        "grocery", "supermarket", "food", "market", "produce", "epicerie",
        # Major chains
        "walmart", "costco", "loblaws", "metro", "sobeys", "safeway", "foodland",
        "no frills", "freshco", "real canadian", "giant tiger", "dollarama food",
        "farm boy", "whole foods", "trader joe", "iga", "maxi", "provigo", "super c",
        # Generic terms
        "groceries", "food market", "foods", "mart"
    ],
    "Dining": [
        "restaurant", "cafe", "coffee", "dining", "eatery", "bistro", "pub", "bar",
        # Major chains
        "starbucks", "tim hortons", "tims", "mcdonald", "mcdo", "burger king",
        "wendy", "a&w", "kfc", "pizza", "domino", "pizza hut", "subway",
        "taco bell", "chipotle", "panera", "dunkin",
        # Food delivery
        "uber eats", "doordash", "skip the dishes", "grubhub", "food delivery",
        "deliveroo", "seamless", "postmates",
        # Generic terms
        "meal", "takeout", "take-out", "dine"
    ],
    "Transportation": [
        "gas", "fuel", "essence", "petro", "shell", "esso", "chevron", "mobil",
        "transit", "ttc", "stm", "ctrain", "skytrain", "metro", "subway fare",
        "uber", "lyft", "taxi", "cab", "parking", "stationnement",
        "car wash", "vehicle", "auto", "garage", "mechanic", "oil change",
        "registration", "license", "toll", "highway", "autoroute"
    ],
    "Utilities": [
        "electric", "electricity", "hydro", "enbridge", "hydro one", "bc hydro",
        "water", "eaux", "gas bill", "natural gas",
        "internet", "wifi", "broadband", "fibre",
        "phone", "mobile", "cell", "telephone", "wireless",
        "bell", "rogers", "telus", "fido", "virgin", "koodo", "shaw", "videotron",
        "utility", "utilities", "public utilities"
    ],
    "Entertainment": [
        "movie", "cinema", "cineplex", "theatre", "theater", "imax",
        "netflix", "spotify", "apple music", "youtube", "prime video", "disney",
        "hbo", "crave", "paramount", "hulu",
        "game", "gaming", "playstation", "xbox", "nintendo", "steam",
        "entertainment", "concert", "show", "event", "ticket", "ticketmaster",
        "sports", "gym", "fitness", "membership"
    ],
    "Shopping": [
        "amazon", "ebay", "etsy", "aliexpress", "wish",
        "shop", "store", "boutique", "magasin", "retail",
        "clothing", "apparel", "fashion", "shoes", "clothes",
        "electronics", "best buy", "apple store", "microsoft store",
        "home depot", "lowes", "canadian tire", "rona",
        "winners", "marshalls", "tj maxx", "hudson bay", "sears"
    ],
    "Healthcare": [
        "pharmacy", "pharmacie", "shoppers", "rexall", "jean coutu", "uniprix",
        "medical", "doctor", "dr ", "clinic", "hospital", "health",
        "dental", "dentist", "orthodont", "hygienist",
        "prescription", "rx", "medicine", "medication",
        "physiotherapy", "massage", "chiropractor", "optometrist",
        "lab", "test", "xray", "x-ray", "scan"
    ],
    "Insurance": [
        "insurance", "assurance", "policy", "premium",
        "life insurance", "car insurance", "auto insurance", "home insurance",
        "health insurance", "dental insurance", "travel insurance",
        "manulife", "sunlife", "desjardins insurance", "td insurance",
        "allstate", "state farm", "geico", "progressive"
    ],
    "Bills": [
        "bill payment", "payment for", "online bill payment", "paiement",
        "subscription", "membership fee", "annual fee", "monthly fee",
        "service charge", "account fee", "bill", "payment"
    ],
    "Housing": [
        "rent", "loyer", "lease", "mortgage", "property tax", "condo fee",
        "maintenance fee", "hoa", "home insurance", "tenant insurance",
        "furnishing", "furniture", "ikea", "wayfair", "article",
        "home improvement", "renovation", "repair"
    ],
    "Education": [
        "tuition", "school", "ecole", "university", "college", "course",
        "textbook", "book", "educational", "student", "learning",
        "training", "certification", "udemy", "coursera", "skillshare"
    ],
    "Personal Care": [
        "salon", "spa", "barber", "haircut", "hair", "beauty",
        "cosmetic", "makeup", "sephora", "ulta",
        "personal care", "hygiene", "toiletries"
    ],
    "Gifts": [
        "gift", "cadeau", "present", "donation", "charity",
        "birthday", "anniversary", "wedding", "holiday"
    ],
    "ATM": ["atm", "cash withdrawal", "retrait", "cash advance", "guichet"],
    "Fees": [
        "fee", "fees", "charge", "frais", "commission",
        "service fee", "transaction fee", "banking fee", "overdraft",
        "nsf", "insufficient funds", "late fee", "penalty"
    ],
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


def auto_categorize_expense(
    description: str,
    user_id: str,
    db,
    skip_special_categories: bool = False,
    transaction_amount: Optional[float] = None,
    account_type: Optional[str] = None
) -> Optional[str]:
    """
    Intelligently auto-categorize a transaction based on description, amount direction,
    and account type, following the Categorization Rules decision tree.

    Args:
        description: Transaction description
        user_id: User ID to get user-specific categorizations
        db: Database service instance
        skip_special_categories: If True, skip Transfer/Income/Investment categories
        transaction_amount: Transaction amount (for direction-based categorization)
        account_type: Account type (checking, credit_card, investment, savings)

    Returns:
        Category name or None if no match found
    """
    if not description:
        return None

    description_lower = description.lower()

    # Remove common noise words and clean description
    noise_words = {"from", "to", "at", "the", "a", "an", "in", "on", "for", "with", "and", "or"}
    cleaned_words = [w for w in description_lower.split() if w not in noise_words and len(w) > 2]

    # Extract merchant name (usually first significant words)
    merchant_name = " ".join(cleaned_words[:3]) if len(cleaned_words) >= 3 else " ".join(cleaned_words)

    # First, try to learn from user's history with exact merchant match
    existing_expenses = db.find("expenses", {})

    # Build merchant -> category mapping from history
    merchant_categories = {}
    for expense in existing_expenses:
        exp_cat = expense.get("category")
        exp_desc = expense.get("description", "").lower()

        # Skip special categories if requested
        if skip_special_categories and exp_cat in ["Transfer", "Investment In", "Investment Out", "Income", "Investment", "Credit Card Payment"]:
            continue

        # Skip uncategorized
        if not exp_cat or exp_cat == "Uncategorized":
            continue

        if exp_desc and len(exp_desc) > 5:
            # Extract merchant from historical expense
            exp_words = [w for w in exp_desc.split() if w not in noise_words and len(w) > 2]
            exp_merchant = " ".join(exp_words[:3]) if len(exp_words) >= 3 else " ".join(exp_words)

            # Exact merchant match
            if exp_merchant and exp_merchant in description_lower:
                if exp_merchant not in merchant_categories:
                    merchant_categories[exp_merchant] = {}
                merchant_categories[exp_merchant][exp_cat] = merchant_categories[exp_merchant].get(exp_cat, 0) + 1

    # If we found matching merchants, use the most common category for that merchant
    if merchant_categories:
        for merchant, categories in merchant_categories.items():
            if categories:
                most_common_category = max(categories.items(), key=lambda x: x[1])[0]
                return most_common_category

    # Intelligent keyword-based categorization with weighted scoring
    # Priority order: Credit Card Payment > Transfer > Income/Investment > Expense categories
    category_scores = {}

    # Define priority tiers (higher number = higher priority)
    priority_categories = {
        "Credit Card Payment": 100,  # Highest priority
        "Transfer": 50,
        "Income": 40,
        "Investment": 40,
    }

    for category, keywords in CATEGORY_KEYWORDS.items():
        # Skip special categories if requested
        if skip_special_categories and category in ["Transfer", "Income", "Investment", "Credit Card Payment"]:
            continue

        score = 0
        for keyword in keywords:
            keyword_lower = keyword.lower()

            # Exact word match (highest weight)
            if f" {keyword_lower} " in f" {description_lower} ":
                score += 10
            # Exact substring match
            elif keyword_lower in description_lower:
                score += 5
            # Partial match (any word contains keyword)
            elif any(keyword_lower in word for word in cleaned_words):
                score += 2

        # Apply priority boost for high-priority categories
        if category in priority_categories and score > 0:
            score += priority_categories[category]

        if score > 0:
            category_scores[category] = score

    # Filter based on transaction amount direction (decision tree logic)
    if transaction_amount is not None and category_scores:
        if transaction_amount > 0:
            # Positive amount: Income or Transfer In
            # Keep only Income, Transfer, and Credit Card Payment categories
            category_scores = {
                cat: score for cat, score in category_scores.items()
                if cat in ["Income", "Transfer", "Credit Card Payment", "Investment"]
            }
        else:
            # Negative amount: Expense, Transfer Out, or Investment
            # Exclude Income category
            category_scores = {
                cat: score for cat, score in category_scores.items()
                if cat != "Income"
            }

    # Return category with highest score if score is significant
    if category_scores:
        best_category = max(category_scores.items(), key=lambda x: x[1])
        # Only return if confidence score is reasonable (at least 5 points)
        if best_category[1] >= 5:
            return best_category[0]

    # No confident match found
    return None

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
    Implements account relationship rules from Categorization Rules.md:
    - Checking <-> Credit Card: Credit card payment
    - Checking <-> Savings: Savings transfer
    - Checking <-> Investment: Investment movement
    - Same amount on same date: Internal transfer
    """
    total_a = txn_a.get("total", 0) or 0
    total_b = txn_b.get("total", 0) or 0
    if total_a == 0 or total_b == 0:
        return False

    # Get account types
    account_a = account_lookup.get(txn_a.get("account_id"))
    account_b = account_lookup.get(txn_b.get("account_id"))

    if not account_a or not account_b:
        return False

    account_type_a = (account_a.get("account_type") or "").lower()
    account_type_b = (account_b.get("account_type") or "").lower()
    account_types = {account_type_a, account_type_b}

    # Opposite signs is the classic transfer pattern
    if total_a * total_b < 0:
        # Verify it matches expected account relationships
        valid_transfer_pairs = [
            {"checking", "credit_card"},     # Credit card payment
            {"checking", "savings"},          # Savings transfer
            {"checking", "investment"},       # Investment movement
            {"credit_card", "investment"},    # Credit card to investment (rare but possible)
            {"savings", "investment"},        # Savings to investment
        ]
        if account_types in valid_transfer_pairs:
            return True

    # Explicit TRANSFER transaction type
    type_a = (txn_a.get("type") or "").lower()
    type_b = (txn_b.get("type") or "").lower()
    if "transfer" in {type_a, type_b}:
        return True

    # Checking <-> credit card payments can show up as two withdrawals
    # (some institutions export both sides as debits)
    if account_types == {"checking", "credit_card"}:
        return True

    # Checking <-> Savings or Investment transfers with same sign
    # (some institutions may not use opposite signs)
    if account_types in [{"checking", "savings"}, {"checking", "investment"}, {"savings", "investment"}]:
        # Check if descriptions indicate a transfer
        description_combo = f"{txn_a.get('description','').lower()} {txn_b.get('description','').lower()}"
        transfer_keywords = ("transfer", "interac", "etransfer", "e-transfer", "to savings",
                           "to chequing", "to checking", "to investment", "from savings",
                           "from chequing", "from checking", "from investment")
        if any(keyword in description_combo for keyword in transfer_keywords):
            return True

    # Consider other transfers when descriptions explicitly say so
    description_combo = f"{txn_a.get('description','').lower()} {txn_b.get('description','').lower()}"
    transfer_keywords = ("transfer", "interac", "etransfer", "e-transfer", "internal transfer")
    if any(keyword in description_combo for keyword in transfer_keywords):
        return True

    return False


def detect_transfers(user_id: str, db, days_tolerance: int = 3) -> List[Tuple[str, str]]:
    """
    Detect transfers between accounts by finding matching debit/credit pairs.

    Args:
        user_id: User ID to check transfers for
        db: Database service instance
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
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    db = get_db_service(session)

    account = db.find_one("accounts", {"id": expense.account_id, "user_id": current_user.id})
    if not account:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Account not found"
        )

    expense_doc = expense.model_dump()
    created_expense = db.insert("expenses", expense_doc)
    session.commit()

    return Expense(**created_expense)

@router.get("", response_model=List[Expense])
async def get_expenses(
    account_id: str = None,
    category: str = None,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    db = get_db_service(session)

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
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    db = get_db_service(session)

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
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    db = get_db_service(session)

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

    session.commit()
    updated_expense = db.find_one("expenses", {"id": expense_id})
    return Expense(**updated_expense)

@router.delete("/{expense_id}")
async def delete_expense(
    expense_id: str,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    db = get_db_service(session)

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
    session.commit()

    return {"message": "Expense deleted successfully"}

@router.post("/categories", response_model=Category)
async def create_category(
    category: CategoryCreate,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    db = get_db_service(session)

    category_doc = {
        **category.model_dump(),
        "user_id": current_user.id
    }

    created_category = db.insert("categories", category_doc)
    session.commit()
    return Category(**created_category)

@router.get("/categories", response_model=List[Category])
async def get_categories(
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    db = get_db_service(session)
    categories = db.find("categories", {"user_id": current_user.id})
    return [Category(**cat) for cat in categories]

@router.put("/categories/{category_id}", response_model=Category)
async def update_category(
    category_id: str,
    category_update: CategoryCreate,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    db = get_db_service(session)

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

    session.commit()
    updated_category = db.find_one("categories", {"id": category_id})
    return Category(**updated_category)

@router.delete("/categories/{category_id}")
async def delete_category(
    category_id: str,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    db = get_db_service(session)

    existing_category = db.find_one("categories", {"id": category_id, "user_id": current_user.id})
    if not existing_category:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Category not found"
        )

    db.delete("categories", {"id": category_id})
    session.commit()

    return {"message": "Category deleted successfully"}

@router.post("/categories/init-defaults")
async def initialize_default_categories(
    force_refresh: bool = False,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    """Initialize default expense categories for a user.

    Args:
        force_refresh: If True, deletes existing categories and recreates defaults.
                      If False, only creates defaults if no categories exist.
    """
    db = get_db_service(session)

    # Check if user already has categories
    existing_categories = db.find("categories", {"user_id": current_user.id})
    if existing_categories:
        if not force_refresh:
            return {"message": "Categories already exist", "count": len(existing_categories)}
        else:
            # Delete all existing categories for this user
            for cat in existing_categories:
                db.delete("categories", cat["id"])
            session.commit()

    # Define default categories with colors - separated by type
    # Aligned with Categorization Rules.md
    default_categories = [
        # Income categories (Amount > 0)
        {"name": "Income", "type": "income", "color": "#4CAF50", "budget_limit": None},
        {"name": "Salary", "type": "income", "color": "#66BB6A", "budget_limit": None},
        {"name": "Bonus", "type": "income", "color": "#81C784", "budget_limit": None},
        {"name": "Freelance", "type": "income", "color": "#A5D6A7", "budget_limit": None},
        {"name": "Dividends", "type": "income", "color": "#C8E6C9", "budget_limit": None},
        {"name": "Interest", "type": "income", "color": "#8BC34A", "budget_limit": None},
        {"name": "Other Income", "type": "income", "color": "#CDDC39", "budget_limit": None},

        # Investment categories (Investment movements)
        {"name": "Investment", "type": "investment", "color": "#1976D2", "budget_limit": None},
        {"name": "Investment In", "type": "investment", "color": "#2196F3", "budget_limit": None},
        {"name": "Investment Out", "type": "investment", "color": "#0D47A1", "budget_limit": None},
        {"name": "Stock Purchase", "type": "investment", "color": "#42A5F5", "budget_limit": None},
        {"name": "ETF Purchase", "type": "investment", "color": "#64B5F6", "budget_limit": None},
        {"name": "Crypto Purchase", "type": "investment", "color": "#1565C0", "budget_limit": None},
        {"name": "Stock Sale", "type": "investment", "color": "#1E88E5", "budget_limit": None},
        {"name": "ETF Sale", "type": "investment", "color": "#1976D2", "budget_limit": None},
        {"name": "Crypto Sale", "type": "investment", "color": "#1565C0", "budget_limit": None},
        {"name": "Other Investment", "type": "investment", "color": "#90CAF9", "budget_limit": None},

        # Transfer categories (Internal transfers between accounts)
        {"name": "Transfer", "type": "transfer", "color": "#607D8B", "budget_limit": None},
        {"name": "Credit Card Payment", "type": "transfer", "color": "#78909C", "budget_limit": None},
        {"name": "Bank Transfer", "type": "transfer", "color": "#90A4AE", "budget_limit": None},
        {"name": "Account Transfer", "type": "transfer", "color": "#B0BEC5", "budget_limit": None},
        {"name": "E-Transfer", "type": "transfer", "color": "#CFD8DC", "budget_limit": None},

        # Expense categories (Amount < 0, goods and services)
        {"name": "Groceries", "type": "expense", "color": "#8BC34A", "budget_limit": None},
        {"name": "Dining", "type": "expense", "color": "#FF9800", "budget_limit": None},
        {"name": "Transportation", "type": "expense", "color": "#2196F3", "budget_limit": None},
        {"name": "Utilities", "type": "expense", "color": "#9C27B0", "budget_limit": None},
        {"name": "Entertainment", "type": "expense", "color": "#E91E63", "budget_limit": None},
        {"name": "Shopping", "type": "expense", "color": "#00BCD4", "budget_limit": None},
        {"name": "Healthcare", "type": "expense", "color": "#F44336", "budget_limit": None},
        {"name": "Bills", "type": "expense", "color": "#795548", "budget_limit": None},
        {"name": "ATM", "type": "expense", "color": "#9E9E9E", "budget_limit": None},
        {"name": "Fees", "type": "expense", "color": "#FF5722", "budget_limit": None},
        {"name": "Insurance", "type": "expense", "color": "#3F51B5", "budget_limit": None},
        {"name": "Housing", "type": "expense", "color": "#673AB7", "budget_limit": None},
        {"name": "Education", "type": "expense", "color": "#009688", "budget_limit": None},
        {"name": "Personal Care", "type": "expense", "color": "#CDDC39", "budget_limit": None},
        {"name": "Gifts", "type": "expense", "color": "#FFC107", "budget_limit": None},
        {"name": "Other Expense", "type": "expense", "color": "#757575", "budget_limit": None},
    ]

    created_categories = []
    for cat_data in default_categories:
        category_doc = {
            **cat_data,
            "user_id": current_user.id
        }
        created_cat = db.insert("categories", category_doc)
        created_categories.append(created_cat)

    session.commit()
    return {
        "message": "Default categories created successfully",
        "count": len(created_categories),
        "categories": [Category(**cat) for cat in created_categories]
    }

@router.patch("/{expense_id}/category")
async def update_expense_category(
    expense_id: str,
    category: str,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    """Update just the category of an expense."""
    db = get_db_service(session)

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

    session.commit()
    updated_expense = db.find_one("expenses", {"id": expense_id})
    return Expense(**updated_expense)

@router.get("/monthly-comparison")
async def get_monthly_expense_comparison(
    months: int = 6,
    account_id: str = None,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    """Get monthly expense comparison for the last N months."""
    db = get_db_service(session)

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

    # Get user categories to determine types
    user_categories = db.find("categories", {"user_id": current_user.id})
    category_types = {cat["name"]: cat.get("type", "expense") for cat in user_categories}

    # Organize expenses by month, separating by type
    monthly_data = defaultdict(lambda: {
        "income": 0,
        "expenses": 0,
        "investments": 0,
        "by_category": defaultdict(float)
    })

    for exp in expenses:
        category = exp.get("category", "Uncategorized")
        category_type = category_types.get(category, "expense")

        date_str = exp.get("date", "")
        if date_str:
            try:
                date = datetime.fromisoformat(date_str.replace('Z', '+00:00'))
                month_key = date.strftime("%Y-%m")
                amount = abs(exp.get("amount", 0))

                # Add to appropriate type total
                if category_type == "income":
                    monthly_data[month_key]["income"] += amount
                elif category_type == "investment":
                    monthly_data[month_key]["investments"] += amount
                elif category_type == "expense":
                    monthly_data[month_key]["expenses"] += amount

                # Also track by category for detailed breakdown
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
            "income": monthly_data[month]["income"],
            "expenses": monthly_data[month]["expenses"],
            "investments": monthly_data[month]["investments"],
            "by_category": dict(monthly_data[month]["by_category"])
        })

    return {
        "months": result,
        "total_months": len(result)
    }

@router.post("/detect-transfers")
async def detect_and_mark_transfers(
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    """
    Detect transfers between accounts and mark them in transactions.
    This helps exclude transfers from expense totals.
    """
    db = get_db_service(session)

    # Detect transfers
    transfers = detect_transfers(current_user.id, db, days_tolerance=5)

    # Mark transactions as transfers
    marked_count = 0
    for txn_id1, txn_id2 in transfers:
        # Update both transactions to mark them as part of a transfer pair
        db.update("transactions", {"id": txn_id1}, {"is_transfer": True, "transfer_pair_id": txn_id2})
        db.update("transactions", {"id": txn_id2}, {"is_transfer": True, "transfer_pair_id": txn_id1})
        marked_count += 2

    session.commit()
    return {
        "message": f"Detected and marked {len(transfers)} transfer pairs",
        "transfer_pairs": len(transfers),
        "transactions_marked": marked_count
    }

def run_expense_conversion(
    user_id: str,
    account_id: Optional[str] = None,
    progress_callback: Optional[Callable[[str], None]] = None,
    db = None
) -> Dict[str, Any]:
    """
    Core logic that converts transactions to expenses for a user.
    Designed to be executed by a background worker.
    """
    if db is None:
        raise ValueError("Database service is required")

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
    # Load all relevant transaction types:
    # - WITHDRAWAL, FEE: Expenses
    # - DEPOSIT, DIVIDEND, INTEREST: Income (excluding transfers)
    # - TRANSFER: Transfers between accounts (credit card payments, bank transfers, investment movements)
    transactions = []
    for acc_id in account_ids:
        txns = db.find("transactions", {"account_id": acc_id})
        transactions.extend([t for t in txns if t.get("type") in ["WITHDRAWAL", "FEE", "DEPOSIT", "DIVIDEND", "INTEREST", "TRANSFER"]])

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
    transfers_processed = 0

    # Ensure special categories exist (aligned with Categorization Rules.md)
    special_categories = [
        {"name": "Income", "type": "income", "color": "#4CAF50"},
        {"name": "Investment", "type": "investment", "color": "#1976D2"},
        {"name": "Investment In", "type": "investment", "color": "#2196F3"},
        {"name": "Investment Out", "type": "investment", "color": "#0D47A1"},
        {"name": "Transfer", "type": "transfer", "color": "#607D8B"},
        {"name": "Credit Card Payment", "type": "transfer", "color": "#78909C"},
    ]

    for cat_data in special_categories:
        existing_cat = db.find_one("categories", {"user_id": user_id, "name": cat_data["name"]})
        if not existing_cat:
            category_doc = {
                "user_id": user_id,
                "name": cat_data["name"],
                "type": cat_data["type"],
                "color": cat_data["color"],
                "budget_limit": None
            }
            db.insert("categories", category_doc)

    # Get all accounts for investment movement detection
    all_user_accounts = db.find("accounts", {"user_id": user_id})
    account_map = {acc["id"]: acc for acc in all_user_accounts}

    # Create a set to track which transaction IDs have already been processed as part of a transfer pair
    processed_transfer_txn_ids = set()

    # Helper function to determine default category based on transaction type
    # Implements Categorization Rules.md account relationship rules
    def get_default_category_for_transaction(txn, is_transfer: bool, paired_account_type: Optional[str] = None) -> str:
        txn_type = txn.get("type")
        current_account = account_map.get(txn.get("account_id"))
        current_account_type = current_account.get("account_type", "").lower() if current_account else ""

        if is_transfer and paired_account_type:
            # Define account type groups
            investment_types = {"investment", "savings"}
            checking_types = {"checking"}

            # Account Relationship Rules from Categorization Rules.md:

            # 1. Checking <-> Credit Card: Credit Card Payment
            if {current_account_type, paired_account_type} == {"checking", "credit_card"}:
                return "Credit Card Payment"

            # 2. Checking <-> Savings: Transfer
            if {current_account_type, paired_account_type} == {"checking", "savings"}:
                return "Transfer"

            # 3. Checking <-> Investment: Investment movement
            if current_account_type == "checking" and paired_account_type == "investment":
                # Money leaving checking TO investment (Investment In)
                return "Investment In"
            elif current_account_type == "investment" and paired_account_type == "checking":
                # Money coming FROM investment TO checking (Investment Out)
                return "Investment Out"

            # 4. Savings <-> Investment: Investment movement
            if current_account_type == "savings" and paired_account_type == "investment":
                return "Investment In"
            elif current_account_type == "investment" and paired_account_type == "savings":
                return "Investment Out"

            # Default to generic Transfer for other combinations
            return "Transfer"
        elif is_transfer:
            # Transfer without paired account info
            return "Transfer"
        elif txn_type in ["DEPOSIT", "DIVIDEND", "INTEREST"]:
            # Income transactions (not transfers)
            return "Income"
        elif txn_type in ["WITHDRAWAL", "FEE"]:
            # Expense transactions - will be categorized by auto_categorize_expense
            return "Uncategorized"
        return "Uncategorized"

    for txn in transactions:
        txn_id = txn.get("id")
        txn_type = txn.get("type")
        is_transfer = txn_id in transfer_transaction_ids

        # Skip if this transaction was already processed as part of a transfer pair
        if txn_id in processed_transfer_txn_ids:
            continue

        # Determine if this is an investment movement
        paired_txn_id = None
        paired_account_type = None
        paired_account_id = None
        paired_txn = None

        if is_transfer:
            # Find the paired transaction
            for tid1, tid2 in transfers:
                if tid1 == txn_id:
                    paired_txn_id = tid2
                    break
                elif tid2 == txn_id:
                    paired_txn_id = tid1
                    break

            # Get both accounts
            current_account = account_map.get(txn.get("account_id"))
            paired_account = None

            if paired_txn_id:
                # Find the paired transaction
                for t in db.find("transactions", {}):
                    if t.get("id") == paired_txn_id:
                        paired_txn = t
                        paired_account = account_map.get(t.get("account_id"))
                        paired_account_id = t.get("account_id")
                        break

            # Check account types for proper categorization
            if current_account and paired_account:
                current_type = current_account.get("account_type", "").lower()
                paired_type = paired_account.get("account_type", "").lower()
                paired_account_type = paired_type

                # Mark both transaction IDs as processed so we only create ONE expense record
                processed_transfer_txn_ids.add(txn_id)
                if paired_txn_id:
                    processed_transfer_txn_ids.add(paired_txn_id)

                # For transfers, we create only ONE expense record representing the transfer
                # The "primary" transaction is chosen based on account type priority:
                # 1. For investment movements: use the checking account side as primary
                # 2. For regular transfers: use the source (debit/withdrawal) side as primary

                investment_types = {"investment", "savings"}
                checking_types = {"checking", "credit_card"}

                # Determine which side should be the primary expense record
                use_current_as_primary = True
                if current_type in investment_types and paired_type in checking_types:
                    # Investment account side - use the checking account as primary instead
                    use_current_as_primary = False
                elif txn.get("total", 0) > 0 and paired_txn and paired_txn.get("total", 0) < 0:
                    # Current is credit (destination), paired is debit (source) - use paired as primary
                    use_current_as_primary = False

                # If the paired side should be primary, swap the transactions
                if not use_current_as_primary and paired_txn:
                    # Swap so the primary transaction is processed
                    txn, paired_txn = paired_txn, txn
                    txn_id, paired_txn_id = paired_txn_id, txn_id
                    current_account, paired_account = paired_account, current_account
                    paired_account_id = paired_txn.get("account_id")

        # Calculate category for both new and existing expenses
        # IMPORTANT: For transfers, always use the transfer categorization logic, not auto-categorization
        # This ensures credit card payments, investment movements, etc. are properly categorized
        txn_amount = txn.get("total", 0)
        current_account = account_map.get(txn.get("account_id"))
        current_account_type = current_account.get("account_type", "").lower() if current_account else None

        if is_transfer:
            category = get_default_category_for_transaction(txn, is_transfer, paired_account_type)
            # Failsafe: if categorization somehow returns Uncategorized for a transfer, force it to Transfer
            if category == "Uncategorized":
                category = "Transfer"
        else:
            # For non-transfers, try auto-categorization first with amount and account type info
            # Skip Transfer/Income/Investment categories since we handle those separately
            category = auto_categorize_expense(
                txn.get("description", ""),
                user_id,
                db,
                skip_special_categories=True,
                transaction_amount=txn_amount,
                account_type=current_account_type
            )
            if not category:
                category = get_default_category_for_transaction(txn, is_transfer, paired_account_type)

        if txn_id and txn_id in existing_by_txn_id:
            existing_exp = existing_by_txn_id[txn_id]
            update_data = {
                "date": txn.get("date"),
                "description": txn.get("description", ""),
                "amount": abs(txn.get("total", 0)),
                "category": category,  # Use recalculated category, not old one
                "transaction_id": txn_id,
                "paired_transaction_id": paired_txn_id,
                "paired_account_id": paired_account_id,
                "is_transfer_primary": True
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
                db.update("expenses", {"id": matching_exp["id"]}, {
                    "transaction_id": txn_id,
                    "paired_transaction_id": paired_txn_id,
                    "paired_account_id": paired_account_id,
                    "is_transfer_primary": True,
                    "category": category  # Update category as well
                })
                expenses_updated += 1
            continue

        # Track transfers for reporting
        if is_transfer:
            transfers_processed += 1

        expense_doc = {
            "date": txn.get("date"),
            "description": txn.get("description", ""),
            "amount": abs(txn.get("total", 0)),
            "category": category,
            "account_id": txn.get("account_id"),
            "transaction_id": txn_id,
            "paired_transaction_id": paired_txn_id,
            "paired_account_id": paired_account_id,
            "is_transfer_primary": True,
            "notes": f"Imported from transaction (type: {txn_type})"
        }

        db.insert("expenses", expense_doc)
        expenses_created += 1

    notify("completed")
    return {
        "message": (
            f"Converted {expenses_created} new transactions to cashflow, "
            f"updated {expenses_updated} existing items, "
            f"processed {transfers_processed} transfers "
            f"({transfer_expenses_removed} old transfer records cleaned up)"
        ),
        "expenses_created": expenses_created,
        "expenses_updated": expenses_updated,
        "transfers_processed": transfers_processed,
        "transfer_expenses_removed": transfer_expenses_removed,
        "transactions_processed": len(transactions),
        "user_id": user_id,
        "account_id": account_id,
    }


@router.post("/convert-transactions")
async def convert_transactions_to_expenses(
    account_id: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    db = get_db_service(session)

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


@router.post("/reclassify-uncategorized")
async def reclassify_uncategorized_expenses(
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    """
    Reclassify all Uncategorized expenses using the intelligent categorization algorithm.
    This uses learning from user's manual categorizations to improve accuracy over time.
    """
    db = get_db_service(session)

    # Get all uncategorized expenses for the user's accounts
    user_accounts = db.find("accounts", {"user_id": current_user.id})
    account_ids = [acc["id"] for acc in user_accounts if _is_expense_account(acc)]

    uncategorized_expenses = []
    for account_id in account_ids:
        expenses = db.find("expenses", {
            "account_id": account_id,
            "category": "Uncategorized"
        })
        uncategorized_expenses.extend(expenses)

    reclassified_count = 0
    failed_count = 0

    for expense in uncategorized_expenses:
        description = expense.get("description", "")
        expense_id = expense.get("id")
        expense_amount = expense.get("amount", 0)
        account_id = expense.get("account_id")

        # Get account type for better categorization
        account = db.find_one("accounts", {"id": account_id})
        account_type = account.get("account_type", "").lower() if account else None

        # Try to categorize using the intelligent algorithm
        new_category = auto_categorize_expense(
            description,
            current_user.id,
            db,
            skip_special_categories=True,
            transaction_amount=expense_amount,
            account_type=account_type
        )

        if new_category and new_category != "Uncategorized":
            try:
                db.update("expenses", {"id": expense_id}, {"category": new_category})
                reclassified_count += 1
            except Exception as e:
                failed_count += 1

    return {
        "message": f"Reclassified {reclassified_count} expenses, {failed_count} failed",
        "reclassified": reclassified_count,
        "failed": failed_count,
        "total_uncategorized": len(uncategorized_expenses)
    }
