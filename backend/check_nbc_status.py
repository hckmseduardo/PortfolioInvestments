#!/usr/bin/env python3
"""
Check National Bank of Canada institution status in Plaid
"""
import os
import sys
sys.path.insert(0, '/app')

from app.services.plaid_client import plaid_client
from plaid.model.institutions_get_by_id_request import InstitutionsGetByIdRequest
from plaid.model.country_code import CountryCode

def check_institution_status():
    if not plaid_client._is_enabled():
        print("ERROR: Plaid is not configured")
        return

    # National Bank of Canada institution ID in Plaid
    # Common IDs: ins_128026 (NBC), ins_43 (testing)
    nbc_ids = ["ins_128026", "ins_43", "ins_20"]

    print(f"Plaid Environment: {plaid_client.environment}")
    print(f"Checking National Bank of Canada status...\n")

    for institution_id in nbc_ids:
        try:
            request = InstitutionsGetByIdRequest(
                institution_id=institution_id,
                country_codes=[CountryCode("CA")]
            )
            response = plaid_client.client.institutions_get_by_id(request)
            institution = response['institution']

            print(f"✓ Found institution: {institution.get('name')}")
            print(f"  ID: {institution.get('institution_id')}")
            print(f"  Status: {institution.get('status')}")
            print(f"  Products: {institution.get('products', [])}")
            print(f"  Country codes: {institution.get('country_codes', [])}")
            print(f"  OAuth: {institution.get('oauth', False)}")
            print(f"  URL: {institution.get('url')}")

            # Check if transactions product is available
            if 'transactions' in institution.get('products', []):
                print(f"  ✓ Transactions product: AVAILABLE")
            else:
                print(f"  ✗ Transactions product: NOT AVAILABLE")

            return True

        except Exception as e:
            print(f"✗ Institution ID {institution_id}: {str(e)[:100]}")
            continue

    print("\n❌ National Bank of Canada not found in Plaid")
    print("\nPossible reasons:")
    print("1. Institution is not available in Production environment")
    print("2. Your Plaid application needs institution-specific approval")
    print("3. National Bank of Canada changed their Plaid integration")
    print("4. Try searching for the institution:")

    # Try searching
    try:
        from plaid.model.institutions_search_request import InstitutionsSearchRequest
        search_request = InstitutionsSearchRequest(
            query="National Bank",
            country_codes=[CountryCode("CA")],
            products=['transactions']
        )
        search_response = plaid_client.client.institutions_search(search_request)
        institutions = search_response.get('institutions', [])

        print(f"\n   Search results for 'National Bank' in Canada:")
        for inst in institutions[:5]:
            print(f"   - {inst.get('name')} ({inst.get('institution_id')})")

    except Exception as e:
        print(f"\n   Search failed: {e}")

if __name__ == "__main__":
    check_institution_status()
