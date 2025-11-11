"""
LLM-Enhanced Transaction Categorization Service

This module implements the LLM-enhanced categorization approach described in
Categorization Rules.md, providing:
- Local LLM integration via Ollama
- Merchant pattern learning
- Confidence scoring
- User feedback integration
"""

import os
import re
import json
import logging
from typing import Optional, Dict, Any, Tuple
from datetime import datetime
import requests

logger = logging.getLogger(__name__)


class LLMCategorizationService:
    """Service for LLM-enhanced transaction categorization."""

    def __init__(self):
        self.ollama_url = os.getenv("OLLAMA_URL", "http://ollama:11434")
        self.model = os.getenv("OLLAMA_MODEL", "mistral")
        self.enabled = self._check_ollama_availability()

    def _check_ollama_availability(self) -> bool:
        """Check if Ollama service is available."""
        try:
            response = requests.get(f"{self.ollama_url}/api/tags", timeout=2)
            return response.status_code == 200
        except Exception as e:
            logger.warning(f"Ollama not available: {e}. LLM categorization disabled.")
            return False

    def normalize_merchant_name(self, description: str) -> str:
        """
        Extract and normalize merchant name from transaction description.

        Examples:
        - "UBER EATS *MCDONALDS" -> "uber eats"
        - "STARBUCKS #1234 TORONTO" -> "starbucks"
        - "SQ *COFFEE SHOP" -> "coffee shop"
        - "PAYPAL *NETFLIX" -> "netflix"
        """
        # Remove common prefixes
        description = re.sub(r'^(SQ \*|PP\*|PAYPAL \*|UBER |UBER EATS )', '', description, flags=re.IGNORECASE)

        # Remove location codes, store numbers, transaction IDs
        description = re.sub(r'#\d+', '', description)
        description = re.sub(r'\d{3,}', '', description)  # Remove long numbers

        # Remove special characters except spaces
        description = re.sub(r'[^\w\s]', ' ', description)

        # Extract first meaningful words (usually merchant name)
        words = description.lower().split()
        noise_words = {'from', 'to', 'at', 'the', 'a', 'an', 'in', 'on', 'for', 'with', 'and', 'or'}
        meaningful_words = [w for w in words if w not in noise_words and len(w) > 2]

        # Return first 1-3 meaningful words as merchant name
        merchant = ' '.join(meaningful_words[:3])
        return merchant.strip()

    def get_merchant_memory(self, merchant_name: str, user_id: str, db) -> Optional[Dict[str, Any]]:
        """Retrieve stored categorization for a merchant from user's memory."""
        memory = db.find_one("merchant_memory", {
            "user_id": user_id,
            "merchant_name": merchant_name
        })
        return memory

    def update_merchant_memory(
        self,
        merchant_name: str,
        category: str,
        user_id: str,
        db,
        confidence: float = 1.0
    ):
        """Update or create merchant memory based on user feedback."""
        existing = self.get_merchant_memory(merchant_name, user_id, db)

        if existing:
            # Increment occurrence count if same category, otherwise reset
            if existing["category"] == category:
                new_count = existing["occurrence_count"] + 1
                new_confidence = min(1.0, existing["confidence"] + 0.1)  # Increase confidence
            else:
                new_count = 1
                new_confidence = 0.8  # Lower confidence for changed category

            db.update("merchant_memory", existing["id"], {
                "category": category,
                "confidence": new_confidence,
                "occurrence_count": new_count,
                "last_updated": datetime.utcnow()
            })
        else:
            # Create new memory
            import uuid
            db.insert("merchant_memory", {
                "id": str(uuid.uuid4()),
                "user_id": user_id,
                "merchant_name": merchant_name,
                "category": category,
                "confidence": confidence,
                "occurrence_count": 1,
                "created_at": datetime.utcnow(),
                "last_updated": datetime.utcnow()
            })

    def categorize_with_llm(
        self,
        description: str,
        amount: float,
        account_type: Optional[str],
        available_categories: list,
        user_history: Optional[Dict[str, int]] = None
    ) -> Tuple[Optional[str], float]:
        """
        Use LLM to categorize transaction based on semantic understanding.

        Returns:
            Tuple of (category, confidence)
        """
        if not self.enabled:
            return None, 0.0

        # Build context for LLM
        direction = "incoming money" if amount > 0 else "outgoing money"
        account_context = f"from a {account_type} account" if account_type else ""

        # Build category options
        category_list = ", ".join(available_categories)

        # Build user pattern context
        pattern_context = ""
        if user_history:
            top_categories = sorted(user_history.items(), key=lambda x: x[1], reverse=True)[:5]
            pattern_context = f"\nUser's most common categories: {', '.join([f'{cat} ({count}x)' for cat, count in top_categories])}"

        prompt = f"""You are a financial transaction categorization expert. Analyze this transaction and determine the most appropriate category.

Transaction Details:
- Description: "{description}"
- Amount: ${abs(amount):.2f} ({direction})
- Account: {account_context}
{pattern_context}

Available Categories: {category_list}

Instructions:
1. Understand the merchant/transaction type from the description
2. Consider the amount and account type
3. Choose the SINGLE most appropriate category from the available list
4. Provide a confidence score (0.0 to 1.0)

Respond in this EXACT JSON format:
{{
  "category": "category name",
  "confidence": 0.95,
  "reasoning": "brief explanation"
}}

Response:"""

        try:
            response = requests.post(
                f"{self.ollama_url}/api/generate",
                json={
                    "model": self.model,
                    "prompt": prompt,
                    "stream": False,
                    "options": {
                        "temperature": 0.1,  # Low temperature for consistent results
                        "top_p": 0.9,
                        "num_predict": 100  # Limit response tokens for faster inference
                    }
                },
                timeout=30  # Increased timeout for CPU inference
            )

            if response.status_code == 200:
                result = response.json()
                llm_output = result.get("response", "")

                # Parse JSON response
                try:
                    # Extract JSON from response (may have extra text)
                    json_match = re.search(r'\{[^}]+\}', llm_output)
                    if json_match:
                        parsed = json.loads(json_match.group())
                        category = parsed.get("category")
                        confidence = float(parsed.get("confidence", 0.0))

                        # Validate category is in available list
                        if category in available_categories:
                            logger.info(f"LLM categorized '{description}' as '{category}' (confidence: {confidence})")
                            return category, confidence
                        else:
                            logger.warning(f"LLM suggested invalid category: {category}")
                            return None, 0.0
                except json.JSONDecodeError as e:
                    logger.error(f"Failed to parse LLM JSON response: {e}")
                    return None, 0.0
            else:
                logger.error(f"Ollama API error: {response.status_code}")
                return None, 0.0

        except requests.exceptions.Timeout:
            logger.warning("LLM request timed out")
            return None, 0.0
        except Exception as e:
            logger.error(f"LLM categorization error: {e}")
            return None, 0.0

    def get_user_category_history(self, user_id: str, db) -> Dict[str, int]:
        """Get user's categorization history (category -> count)."""
        # Get all user's accounts first
        accounts = db.find("accounts", {"user_id": user_id})

        category_counts = {}

        # Get expenses for each account
        for account in accounts:
            account_id = account.get("id")
            if account_id:
                expenses = db.find("expenses", {"account_id": account_id})

                for expense in expenses:
                    category = expense.get("category")
                    if category:
                        category_counts[category] = category_counts.get(category, 0) + 1

        return category_counts

    def enhanced_categorize(
        self,
        description: str,
        user_id: str,
        db,
        transaction_amount: Optional[float] = None,
        account_type: Optional[str] = None,
        keyword_result: Optional[Tuple[Optional[str], int]] = None,
        available_categories: list = None
    ) -> Tuple[Optional[str], float, str]:
        """
        Enhanced categorization using multi-step approach:
        1. Check merchant memory (user's past categorizations)
        2. Use keyword matching (fast, rule-based)
        3. Fall back to LLM for semantic understanding

        Returns:
            Tuple of (category, confidence, source)
            source can be: 'merchant_memory', 'keyword', 'llm', 'unknown'
        """
        # Step 1: Check merchant memory
        merchant = self.normalize_merchant_name(description)
        if merchant:
            memory = self.get_merchant_memory(merchant, user_id, db)
            if memory and memory.get("occurrence_count", 0) >= 2:  # At least 2 occurrences
                confidence = memory.get("confidence", 1.0)
                if confidence >= 0.7:  # High confidence threshold
                    logger.info(f"Using merchant memory for '{merchant}': {memory['category']}")
                    return memory["category"], confidence, "merchant_memory"

        # Step 2: Use keyword matching result if available with high confidence
        if keyword_result and keyword_result[0] and keyword_result[1] >= 15:  # High keyword score
            # Convert keyword score to confidence (normalize to 0.0-1.0)
            confidence = min(0.95, keyword_result[1] / 20.0)  # Max confidence 0.95
            logger.info(f"Using keyword match: {keyword_result[0]} (score: {keyword_result[1]})")
            return keyword_result[0], confidence, "keyword"

        # Step 3: Try LLM categorization only if no keyword match or very low score
        # Skip LLM if we have any reasonable keyword match to avoid slow processing
        if keyword_result and keyword_result[0] and keyword_result[1] >= 5:
            # Use keyword match instead of waiting for LLM
            confidence = max(0.4, min(0.75, keyword_result[1] / 20.0))
            logger.info(f"Using keyword match (skip LLM): {keyword_result[0]} (score: {keyword_result[1]})")
            return keyword_result[0], confidence, "keyword"

        # Step 4: Try LLM only for completely unknown transactions
        if self.enabled and available_categories:
            user_history = self.get_user_category_history(user_id, db)
            llm_category, llm_confidence = self.categorize_with_llm(
                description,
                transaction_amount or 0,
                account_type,
                available_categories,
                user_history
            )

            if llm_category and llm_confidence >= 0.5:  # LLM confidence threshold
                return llm_category, llm_confidence, "llm"

        # Step 5: Fall back to keyword result even with very low score
        if keyword_result and keyword_result[0]:
            confidence = max(0.3, min(0.6, keyword_result[1] / 20.0))  # Low to medium confidence
            return keyword_result[0], confidence, "keyword_low"

        # No confident categorization found
        return None, 0.0, "unknown"


# Singleton instance
_llm_service = None

def get_llm_service() -> LLMCategorizationService:
    """Get or create the LLM categorization service instance."""
    global _llm_service
    if _llm_service is None:
        _llm_service = LLMCategorizationService()
    return _llm_service
