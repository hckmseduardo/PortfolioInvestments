# Transaction Classification Rules

This document defines how the system identifies and categorizes transactions from account statements.

## Account Types

| Account Type | Description |
|--------------|-------------|
| **Checking Account** | Main operational account for everyday transactions, payments, and income deposits. |
| **Savings Account** | Account dedicated to saving and earning interest. |
| **Investment Account** | Account used for buying and selling assets (ETFs, stocks, crypto, etc.). |
| **Credit Card** | Account representing purchases and repayments. |

## Transaction Types

| Type | Description | Examples |
|------|-------------|----------|
| **Expense** | Money spent on goods, services, or bills. | Grocery, Netflix, Hydro, Rent |
| **Income** | Money received as salary, refund, or investment return. | Payroll, Bonus, Tax Refund |
| **Investment** | Money allocated to or withdrawn from investments. | ETF Purchase, Dividend, Crypto Deposit |
| **Transfer** | Movement between user's own accounts. | Checking → Savings, Checking → Credit Card |

## Classification Logic

### 1. Transaction Direction

| Condition | Interpretation |
|-----------|----------------|
| Amount > 0 | Possible Income or Transfer In |
| Amount < 0 | Possible Expense, Investment, or Transfer Out |

### 2. Keyword and Pattern Recognition

| Category | Typical Keywords or Expressions |
|----------|--------------------------------|
| **Income** | "payroll", "deposit", "salary", "bonus", "refund", "dividend", "interest", "transfer from" |
| **Expense** | "walmart", "costco", "amazon", "netflix", "hydro", "insurance", "restaurant", "payment", "bill", "mortgage" |
| **Investment** | "etf", "stock", "crypto", "investment", "wealthsimple", "questrade", "tfsa", "rrsp", "buy", "sell" |
| **Transfer** | "transfer to", "internal transfer", "interac", "to savings", "to chequing", "to credit card", "self transfer" |
| **Credit Card Payment** | "credit card payment", "card balance", "payment to credit" |

**Notes:**
- Keywords are checked case-insensitively.
- Priority is given to more specific matches (for example, "credit card payment" is classified before "expense").

### 3. Account Relationship Rules

| Relationship | Classification |
|--------------|----------------|
| Debit from Checking → Credit to Credit Card | Payment of credit card balance |
| Debit from Checking → Credit to Savings | Transfer to savings |
| Debit from Checking → Credit to Investment | Investment deposit |
| Credit to Checking ← Debit from Investment | Investment withdrawal or return |
| Same amount on the same date across two accounts | Internal transfer |

### 4. Decision Tree

```
                        ┌──────────────────────┐
                        │ Transaction Detected │
                        └────────────┬─────────┘
                                     │
                                     ▼
                   ┌────────────────────────────────┐
                   │ Check Amount Sign (Positive?)  │
                   └────────────┬───────────────────┘
                                │
        ┌───────────────────────┴────────────────────────┐
        ▼                                                ▼
    amount > 0                                      amount < 0
        │                                                │
        ▼                                                ▼
┌───────────────┐                              ┌────────────────────┐
│ Income or     │                              │ Expense, Transfer, │
│ Transfer In   │                              │ or Investment      │
└───────┬───────┘                              └─────────┬──────────┘
        │                                                │
        ▼                                                ▼
┌────────────────────┐                         ┌───────────────────────────┐
│ Keyword & Account  │                         │ Keyword & Account         │
│ Analysis           │                         │ Analysis                  │
└──────────┬─────────┘                         └────────────┬──────────────┘
           │                                                │
           ▼                                                ▼
 Income, Transfer In                           Expense / Investment / Transfer Out
```

## Example Output

| Date | Account | Description | Amount | Type | Category | Source | Destination |
|------|---------|-------------|--------|------|----------|--------|-------------|
| 2025-03-01 | Checking | Payroll Deposit | +5000.00 | Income | Salary | Employer | Checking |
| 2025-03-02 | Credit Card | Amazon Purchase | −120.00 | Expense | Shopping | Credit Card | — |
| 2025-03-05 | Checking | Transfer to Savings | −800.00 | Transfer | Savings | Checking | Savings |
| 2025-03-10 | Investment | ETF Purchase | −250.00 | Investment | ETF | Checking | Investment |

## Purpose

This classification system enables:

- **Automated categorization** of transactions from multiple financial institutions
- **Consolidated financial analytics**, including:
  - Expense and income breakdowns
  - Monthly cash-flow reports
  - Savings and investment tracking
  - Net worth progression
