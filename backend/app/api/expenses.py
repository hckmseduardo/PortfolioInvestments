from fastapi import APIRouter, Depends, HTTPException, status
from typing import List, Optional
from datetime import datetime
from collections import defaultdict
import re
from app.models.schemas import Expense, ExpenseCreate, Category, CategoryCreate, User
from app.api.auth import get_current_user
from app.database.json_db import get_db

router = APIRouter(prefix="/expenses", tags=["expenses"])

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
        
        query = {"account_id": account_id}
        if category:
            query["category"] = category
        
        expenses = db.find("expenses", query)
    else:
        user_accounts = db.find("accounts", {"user_id": current_user.id})
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
        expenses = db.find("expenses", {"account_id": account_id})
    else:
        user_accounts = db.find("accounts", {"user_id": current_user.id})
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
        {"name": "Groceries", "type": "expense", "color": "#4CAF50", "budget_limit": None},
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
        expenses = db.find("expenses", {"account_id": account_id})
    else:
        user_accounts = db.find("accounts", {"user_id": current_user.id})
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

@router.post("/convert-transactions")
async def convert_transactions_to_expenses(
    account_id: str = None,
    current_user: User = Depends(get_current_user)
):
    """
    Convert checking account withdrawal and fee transactions to expenses.
    Optionally specify account_id to convert for a specific account only.
    """
    db = get_db()

    # Get all checking accounts for the user
    if account_id:
        accounts = [db.find_one("accounts", {"id": account_id, "user_id": current_user.id, "account_type": "checking"})]
        if not accounts[0]:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Checking account not found"
            )
    else:
        accounts = db.find("accounts", {"user_id": current_user.id, "account_type": "checking"})

    if not accounts:
        return {"message": "No checking accounts found", "expenses_created": 0}

    account_ids = [acc["id"] for acc in accounts]

    # Get all withdrawal and fee transactions from checking accounts
    transactions = []
    for acc_id in account_ids:
        txns = db.find("transactions", {"account_id": acc_id})
        transactions.extend([t for t in txns if t.get("type") in ["withdrawal", "fee"]])

    # Get existing expenses to avoid duplicates
    existing_expenses = []
    for acc_id in account_ids:
        existing_expenses.extend(db.find("expenses", {"account_id": acc_id}))

    # Create a set of (account_id, date, amount, description) tuples to check for duplicates
    existing_expense_keys = set()
    for exp in existing_expenses:
        key = (
            exp.get("account_id"),
            exp.get("date"),
            exp.get("amount"),
            exp.get("description")
        )
        existing_expense_keys.add(key)

    # Convert transactions to expenses
    expenses_created = 0
    for txn in transactions:
        # Check if this transaction is already an expense
        txn_key = (
            txn.get("account_id"),
            txn.get("date"),
            abs(txn.get("total", 0)),
            txn.get("description")
        )

        if txn_key not in existing_expense_keys:
            # Auto-categorize the expense
            category = auto_categorize_expense(txn.get("description", ""), current_user.id)

            expense_doc = {
                "date": txn.get("date"),
                "description": txn.get("description", ""),
                "amount": abs(txn.get("total", 0)),
                "category": category or "Uncategorized",
                "account_id": txn.get("account_id"),
                "notes": f"Imported from transaction (type: {txn.get('type')})"
            }

            db.insert("expenses", expense_doc)
            expenses_created += 1

    return {
        "message": f"Converted {expenses_created} transactions to expenses",
        "expenses_created": expenses_created,
        "transactions_processed": len(transactions)
    }
