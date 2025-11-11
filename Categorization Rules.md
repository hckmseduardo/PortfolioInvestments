# Transaction Classification Rules

This document defines how the system identifies and categorizes transactions from account statements using a hybrid approach of traditional keyword matching and LLM-enhanced semantic understanding.

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
- **LLM Enhancement** (Planned): Traditional keyword matching will be enhanced with open-source language models for semantic understanding of transaction descriptions.

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

## LLM-Enhanced Categorization (In Development)

The categorization system will be enhanced with open-source Large Language Models (LLMs) to provide intelligent, context-aware transaction categorization that learns from user behavior.

### 5. Semantic Understanding with LLMs

**Architecture:**
- **Local Processing**: All LLM inference happens locally using Ollama or llama.cpp
- **Privacy-First**: No transaction data is sent to external APIs
- **Model Options**: Mistral, Llama, Phi, or other quantized models optimized for efficiency
- **Hybrid Approach**: Combines traditional keyword matching with semantic understanding

**How It Works:**

1. **Traditional Keyword Matching** (Current)
   - Fast, rule-based categorization using the keyword lists above
   - Provides baseline categorization with high confidence

2. **LLM Semantic Analysis** (Planned Enhancement)
   - Understands transaction context beyond exact keyword matches
   - Example: "UBER EATS" → Dining (not Transportation)
   - Example: "APPLE.COM/BILL" → Shopping/Entertainment (context-dependent)
   - Handles variations in merchant names and descriptions

3. **User Pattern Learning**
   - Analyzes all previous manual categorizations made by the user
   - Builds a personalized understanding of spending patterns
   - Example: If user always categorizes "COSTCO" as Groceries (not Shopping), the system learns this preference

4. **Merchant-Specific Memory**
   - Once a user categorizes a merchant, all future transactions from that merchant inherit the category
   - Tracks merchant name variations (e.g., "STARBUCKS", "STARBUCKS #1234", "STARBUCKS TORONTO")

5. **Multi-Dimensional Context**
   - **Amount Analysis**: Large amounts from grocery stores might be categorized differently
   - **Account Type**: Same transaction description has different meaning on credit card vs checking
   - **Temporal Patterns**: Recurring transactions on specific dates (subscriptions, bills)
   - **Historical Frequency**: How often does this merchant appear in user's history?

6. **Confidence Scoring**
   - Each categorization receives a confidence score (0-100%)
   - Low confidence transactions are flagged for user review
   - High confidence transactions are automatically categorized
   - User feedback continuously improves confidence scoring

### 6. Continuous Learning Loop

```
┌─────────────────────────────────────────────────────────┐
│                  Transaction Import                      │
└───────────────────────┬─────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│  Step 1: Traditional Keyword Matching                   │
│  - Fast rule-based categorization                       │
│  - High confidence for exact matches                    │
└───────────────────────┬─────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│  Step 2: Check User History                             │
│  - Has user categorized this merchant before?           │
│  - What category did they use?                          │
└───────────────────────┬─────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│  Step 3: LLM Semantic Analysis (if needed)              │
│  - Analyze transaction description semantically         │
│  - Consider context: amount, account type, date         │
│  - Compare with similar transactions in history         │
└───────────────────────┬─────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│  Step 4: Confidence Evaluation                          │
│  - High confidence (>85%): Auto-categorize              │
│  - Medium confidence (50-85%): Suggest to user          │
│  - Low confidence (<50%): Mark as "Needs Review"        │
└───────────────────────┬─────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│  Step 5: User Review & Feedback                         │
│  - User accepts or changes categorization               │
│  - System learns from correction                        │
│  - Updates merchant-specific memory                     │
└───────────────────────┬─────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│  Step 6: Model Refinement                               │
│  - User's feedback improves future categorizations      │
│  - System builds personalized categorization model      │
└─────────────────────────────────────────────────────────┘
```

### 7. Example LLM Enhancements

| Transaction Description | Keyword Match | LLM Understanding | Final Category |
|------------------------|---------------|-------------------|----------------|
| "UBER EATS - MCDONALDS" | Transportation (Uber) | Food delivery service | **Dining** |
| "APPLE.COM/BILL" | None | Subscription service | **Entertainment** |
| "COSTCO #123 GASOLINE" | Groceries (Costco) | Gas station purchase | **Transportation** |
| "INTERAC E-TRF FROM JOHN DOE" | Transfer | Personal transfer (not bill split) | **Transfer** |
| "PAY PAL *NETFLIX" | None | Streaming subscription via PayPal | **Entertainment** |
| "SQ *COFFEE SHOP" | None | Square payment at cafe | **Dining** |

**Benefits:**
- ✅ Handles merchant name variations automatically
- ✅ Understands context beyond simple keywords
- ✅ Learns user-specific categorization preferences
- ✅ Reduces manual categorization workload over time
- ✅ Privacy-preserving with local processing
- ✅ Multi-language support for international transactions

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
  - Traditional keyword-based matching for fast, reliable categorization
  - LLM-enhanced semantic understanding for complex or ambiguous transactions (planned)
  - Continuous learning from user's manual categorizations
- **Consolidated financial analytics**, including:
  - Expense and income breakdowns
  - Monthly cash-flow reports
  - Savings and investment tracking
  - Net worth progression
- **Personalized categorization** that improves over time:
  - System learns user-specific merchant preferences
  - Adapts to individual spending patterns
  - Reduces manual categorization effort with each transaction reviewed
