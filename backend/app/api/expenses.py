from fastapi import APIRouter, Depends, HTTPException, status
from typing import List
from datetime import datetime
from collections import defaultdict
from app.models.schemas import Expense, ExpenseCreate, Category, CategoryCreate, User
from app.api.auth import get_current_user
from app.database.json_db import get_db

router = APIRouter(prefix="/expenses", tags=["expenses"])

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
