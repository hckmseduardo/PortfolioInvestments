"""
Plaid Audit Logger Service

Logs all Plaid API interactions for compliance, debugging, and monitoring.
"""
import logging
import uuid
from datetime import datetime
from typing import Optional, Dict, Any
from contextlib import contextmanager
import time

from app.database.postgres_db import get_db_context
from app.database.models import PlaidAuditLog

logger = logging.getLogger(__name__)


class PlaidAuditLogger:
    """Service for logging Plaid API interactions."""

    @staticmethod
    def sanitize_request_params(params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Sanitize request parameters by removing sensitive data.

        Args:
            params: Request parameters

        Returns:
            Sanitized parameters with sensitive data removed
        """
        if not params:
            return {}

        sanitized = params.copy()

        # Remove sensitive fields
        sensitive_fields = [
            'access_token', 'secret', 'client_id', 'public_token',
            'password', 'credentials', 'authorization'
        ]

        for field in sensitive_fields:
            if field in sanitized:
                sanitized[field] = '***REDACTED***'

        return sanitized

    @staticmethod
    def create_response_summary(response: Any, endpoint: str) -> Dict[str, Any]:
        """
        Create a summary of the response data.

        Args:
            response: API response
            endpoint: Endpoint called

        Returns:
            Summary of response data
        """
        summary = {}

        if not response:
            return summary

        # Handle different response types based on endpoint
        if endpoint == '/transactions/sync':
            if isinstance(response, dict):
                summary['added'] = len(response.get('added', []))
                summary['modified'] = len(response.get('modified', []))
                summary['removed'] = len(response.get('removed', []))
                summary['has_more'] = response.get('has_more', False)
                summary['cursor'] = 'present' if response.get('next_cursor') else 'none'

        elif endpoint == '/transactions/get':
            if isinstance(response, dict):
                summary['transaction_count'] = len(response.get('transactions', []))
                summary['total_transactions'] = response.get('total_transactions', 0)

        elif endpoint == '/investments/transactions/get':
            if isinstance(response, dict):
                summary['transaction_count'] = len(response.get('investment_transactions', []))
                summary['total_transactions'] = response.get('total_investment_transactions', 0)

        elif endpoint == '/investments/holdings/get':
            if isinstance(response, dict):
                summary['holdings_count'] = len(response.get('holdings', []))
                summary['securities_count'] = len(response.get('securities', []))

        elif endpoint == '/accounts/get':
            if isinstance(response, dict):
                summary['accounts_count'] = len(response.get('accounts', []))

        elif endpoint == '/link/token/create':
            if isinstance(response, dict):
                summary['token_created'] = 'link_token' in response
                summary['expiration'] = response.get('expiration')

        elif endpoint == '/item/public_token/exchange':
            if isinstance(response, dict):
                summary['exchange_successful'] = 'access_token' in response
                summary['item_id'] = response.get('item_id', 'unknown')

        return summary

    @staticmethod
    @contextmanager
    def log_api_call(
        user_id: str,
        endpoint: str,
        method: str = 'POST',
        plaid_item_id: Optional[str] = None,
        sync_type: Optional[str] = None,
        request_params: Optional[Dict[str, Any]] = None
    ):
        """
        Context manager to log a Plaid API call.

        Usage:
            with PlaidAuditLogger.log_api_call(
                user_id='user123',
                endpoint='/transactions/sync',
                plaid_item_id='item123',
                sync_type='incremental',
                request_params={'cursor': 'abc123'}
            ) as log_context:
                # Make API call
                response = plaid_client.some_method()
                log_context['response'] = response
                log_context['status_code'] = 200

        Args:
            user_id: User ID
            endpoint: Plaid API endpoint
            method: HTTP method (default: POST)
            plaid_item_id: Optional Plaid item ID
            sync_type: Optional sync type (incremental, full_resync, initial)
            request_params: Optional request parameters

        Yields:
            Dictionary to store response and status code
        """
        start_time = time.time()
        log_id = str(uuid.uuid4())
        log_context = {
            'response': None,
            'status_code': None,
            'error_message': None
        }

        try:
            yield log_context

        except Exception as e:
            log_context['error_message'] = str(e)
            log_context['status_code'] = 500
            raise

        finally:
            # Calculate duration
            duration_ms = int((time.time() - start_time) * 1000)

            # Sanitize request params
            sanitized_params = PlaidAuditLogger.sanitize_request_params(request_params or {})

            # Create response summary
            response_summary = PlaidAuditLogger.create_response_summary(
                log_context.get('response'),
                endpoint
            )

            # Save audit log to database
            try:
                with get_db_context() as db:
                    audit_log = PlaidAuditLog(
                        id=log_id,
                        user_id=user_id,
                        plaid_item_id=plaid_item_id,
                        timestamp=datetime.utcnow(),
                        endpoint=endpoint,
                        sync_type=sync_type,
                        method=method,
                        status_code=log_context.get('status_code'),
                        duration_ms=duration_ms,
                        request_params=sanitized_params,
                        response_summary=response_summary,
                        error_message=log_context.get('error_message')
                    )
                    db.add(audit_log)
                    db.commit()

                    logger.info(
                        f"Plaid API audit log saved: {endpoint} for user {user_id} "
                        f"(duration: {duration_ms}ms, status: {log_context.get('status_code')})"
                    )

            except Exception as db_error:
                logger.error(f"Failed to save Plaid audit log: {db_error}", exc_info=True)


# Global instance
plaid_audit_logger = PlaidAuditLogger()
