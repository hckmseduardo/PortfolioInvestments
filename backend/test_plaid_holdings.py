#!/usr/bin/env python3
"""
Test script to call Plaid's /investments/holdings/get endpoint directly
and see what raw data is returned for Wealthsimple TFSA account.
"""
import sys
import os
import json
from datetime import datetime

# Add app to path
sys.path.insert(0, '/app')

from app.config import settings
from app.services.encryption import encryption_service
from app.database.postgres_db import get_db
from app.database.models import PlaidItem

# Import Plaid SDK
import plaid
from plaid.api import plaid_api
from plaid.model.investments_holdings_get_request import InvestmentsHoldingsGetRequest


def main():
    """Call Plaid API directly to get investment holdings"""

    # Initialize Plaid client
    print("=" * 80)
    print("Plaid Investment Holdings Test")
    print("=" * 80)
    print(f"\nEnvironment: {settings.PLAID_ENVIRONMENT}")
    print(f"Client ID: {settings.PLAID_CLIENT_ID[:10]}..." if settings.PLAID_CLIENT_ID else "NOT SET")

    # Map environment
    env_map = {
        "sandbox": plaid.Environment.Sandbox,
        "production": plaid.Environment.Production,
    }
    environment = env_map.get(settings.PLAID_ENVIRONMENT.lower(), plaid.Environment.Production)

    # Create Plaid client
    configuration = plaid.Configuration(
        host=environment,
        api_key={
            'clientId': settings.PLAID_CLIENT_ID,
            'secret': settings.PLAID_SECRET,
        }
    )
    api_client = plaid.ApiClient(configuration)
    client = plaid_api.PlaidApi(api_client)

    print("\n✓ Plaid client initialized")

    # Get Wealthsimple TFSA connection from database
    db = next(get_db())

    print("\n" + "=" * 80)
    print("Finding Wealthsimple connection with investments enabled...")
    print("=" * 80)

    plaid_item = db.query(PlaidItem).filter(
        PlaidItem.institution_name.ilike('%wealthsimple%'),
        PlaidItem.investments_enabled == True
    ).first()

    if not plaid_item:
        print("\n❌ No Wealthsimple connection with investments enabled found!")
        print("\nAvailable Plaid items:")
        all_items = db.query(PlaidItem).all()
        for item in all_items:
            print(f"  - {item.institution_name}: investments_enabled={item.investments_enabled}")
        return

    print(f"\n✓ Found: {plaid_item.institution_name}")
    print(f"  - Item ID: {plaid_item.id}")
    print(f"  - Supports Investments: {plaid_item.supports_investments}")
    print(f"  - Investments Enabled: {plaid_item.investments_enabled}")
    print(f"  - Last Synced: {plaid_item.last_synced}")

    # Decrypt access token
    access_token = encryption_service.decrypt(plaid_item.access_token)
    print(f"  - Access Token: {access_token[:10]}..." if access_token else "FAILED TO DECRYPT")

    # Call Plaid API
    print("\n" + "=" * 80)
    print("Calling Plaid API: /investments/holdings/get")
    print("=" * 80)

    try:
        request = InvestmentsHoldingsGetRequest(
            access_token=access_token
        )

        print("\nRequest parameters:")
        print(f"  - access_token: {access_token[:10]}...")

        print("\nCalling Plaid API...")
        response = client.investments_holdings_get(request)

        # Convert to dict
        response_dict = response.to_dict()

        print("\n✓ API call successful!")
        print("\n" + "=" * 80)
        print("RESPONSE SUMMARY")
        print("=" * 80)

        holdings = response_dict.get('holdings', [])
        securities = response_dict.get('securities', [])
        accounts = response_dict.get('accounts', [])

        print(f"\nTotal Holdings: {len(holdings)}")
        print(f"Total Securities: {len(securities)}")
        print(f"Total Accounts: {len(accounts)}")

        # Show account balances
        print("\n" + "=" * 80)
        print("ACCOUNTS")
        print("=" * 80)
        for account in accounts:
            name = account.get('name', 'Unknown')
            mask = account.get('mask', 'N/A')
            acc_type = account.get('type', 'N/A')
            subtype = account.get('subtype', 'N/A')
            balance = account.get('balances', {}).get('current', 0)
            currency = account.get('balances', {}).get('iso_currency_code', 'N/A')

            print(f"\n{name} ({mask})")
            print(f"  Type: {acc_type} / {subtype}")
            print(f"  Balance: {currency} {balance:,.2f}")

        # Group holdings by account
        print("\n" + "=" * 80)
        print("HOLDINGS BY ACCOUNT")
        print("=" * 80)

        # Create security lookup
        security_map = {s['security_id']: s for s in securities}

        # Group by account
        holdings_by_account = {}
        for holding in holdings:
            acc_id = holding.get('account_id')
            if acc_id not in holdings_by_account:
                holdings_by_account[acc_id] = []
            holdings_by_account[acc_id].append(holding)

        # Display by account
        for account in accounts:
            acc_id = account.get('account_id')
            acc_holdings = holdings_by_account.get(acc_id, [])

            if not acc_holdings:
                continue

            print(f"\n{account.get('name')} ({account.get('mask')}) - {len(acc_holdings)} holdings:")
            print("-" * 80)

            for holding in acc_holdings:
                security_id = holding.get('security_id')
                security = security_map.get(security_id, {})

                ticker = security.get('ticker_symbol', 'NO_TICKER')
                name = security.get('name', 'Unknown')[:50]
                quantity = holding.get('quantity', 0) or 0
                inst_price = holding.get('institution_price', 0) or 0
                inst_value = holding.get('institution_value', 0) or 0
                close_price = security.get('close_price', 0) or 0
                cost_basis = holding.get('cost_basis', 0) or 0
                currency = holding.get('iso_currency_code', 'N/A')

                print(f"\n  {ticker:10s} | {name}")
                print(f"    Quantity: {quantity:10.4f}")
                print(f"    Institution Price: {currency} {inst_price:10.2f}")
                print(f"    Institution Value: {currency} {inst_value:10.2f}")
                print(f"    Close Price: {currency} {close_price:10.2f}")
                print(f"    Cost Basis: {currency} {cost_basis:10.2f}")

        # Save full response to file
        output_file = f"/app/logs/plaid_debug/manual_holdings_test_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.json"
        with open(output_file, 'w') as f:
            json.dump(response_dict, f, indent=2, default=str)

        print("\n" + "=" * 80)
        print(f"✓ Full response saved to: {output_file}")
        print("=" * 80)

    except plaid.ApiException as e:
        print(f"\n❌ Plaid API Error!")
        print(f"  Status Code: {e.status}")
        print(f"  Reason: {e.reason}")
        print(f"  Body: {e.body}")
    except Exception as e:
        print(f"\n❌ Unexpected error: {e}")
        import traceback
        traceback.print_exc()
    finally:
        db.close()


if __name__ == '__main__':
    main()
