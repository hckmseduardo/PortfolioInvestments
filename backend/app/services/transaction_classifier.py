"""
Transaction Classification Service

Classifies transactions based on the definitions in Definitions.MD:

Type (based on value):
- Money In: positive values
- Money Out: negative values
"""
import logging

logger = logging.getLogger(__name__)


class TransactionClassifier:
    """Classifies transactions into type based on amount."""

    @staticmethod
    def classify_transaction(amount: float) -> str:
        """
        Classify a transaction into type based on amount.

        Args:
            amount: Transaction amount (positive for money in, negative for money out)

        Returns:
            Transaction type: "Money In" or "Money Out"
        """
        return "Money In" if amount > 0 else "Money Out"


# Singleton instance
transaction_classifier = TransactionClassifier()
