"""
Migration Script: Encrypt Existing Plaid Access Tokens

This script encrypts all existing plain-text Plaid access tokens in the database.
Run this once after implementing token encryption.
"""
import sys
from pathlib import Path

# Add the app directory to the Python path
sys.path.insert(0, str(Path(__file__).parent))

from app.database.postgres_db import get_db_context
from app.database.models import PlaidItem
from app.services.encryption import encryption_service
from app.config import settings


def migrate_encrypt_tokens():
    """Migrate all plain-text access tokens to encrypted format."""

    print("Starting Plaid access token encryption migration...")
    print(f"Environment: {settings.PLAID_ENVIRONMENT}")
    print()

    with get_db_context() as db:
        # Get all Plaid items
        plaid_items = db.query(PlaidItem).all()

        if not plaid_items:
            print("No Plaid items found in database.")
            return

        print(f"Found {len(plaid_items)} Plaid item(s) to process")
        print()

        encrypted_count = 0
        skipped_count = 0
        error_count = 0

        for item in plaid_items:
            item_id = item.id
            institution = item.institution_name
            token_length = len(item.access_token) if item.access_token else 0

            # Encrypted tokens are much longer (100+ chars due to base64 encoding)
            # Plain text Plaid tokens are typically 50-60 chars
            if token_length > 90:
                print(f"✓ SKIP: {institution} ({item_id[:8]}...) - Already encrypted (length: {token_length})")
                skipped_count += 1
                continue

            try:
                # Try to decrypt - if it succeeds, it's already encrypted
                try:
                    decrypted = encryption_service.decrypt(item.access_token)
                    if decrypted and len(decrypted) > 20:  # Valid Plaid token
                        print(f"✓ SKIP: {institution} ({item_id[:8]}...) - Already encrypted")
                        skipped_count += 1
                        continue
                except Exception:
                    # Decryption failed - token is plain text, proceed with encryption
                    pass

                # Encrypt the plain text token
                print(f"→ ENCRYPTING: {institution} ({item_id[:8]}...)")
                print(f"  Original length: {token_length} chars")

                encrypted_token = encryption_service.encrypt(item.access_token)

                print(f"  Encrypted length: {len(encrypted_token)} chars")

                # Update the database
                item.access_token = encrypted_token
                db.commit()

                print(f"✓ SUCCESS: {institution} encrypted successfully")
                encrypted_count += 1

            except Exception as e:
                print(f"✗ ERROR: {institution} ({item_id[:8]}...) - {str(e)}")
                error_count += 1
                db.rollback()

            print()

        print("=" * 60)
        print("Migration Summary:")
        print(f"  Total items: {len(plaid_items)}")
        print(f"  Encrypted: {encrypted_count}")
        print(f"  Skipped (already encrypted): {skipped_count}")
        print(f"  Errors: {error_count}")
        print("=" * 60)

        if error_count > 0:
            print("\n⚠️  WARNING: Some items failed to encrypt. Check errors above.")
            return 1
        elif encrypted_count > 0:
            print("\n✓ Migration completed successfully!")
            print("  All Plaid access tokens are now encrypted.")
            return 0
        else:
            print("\n✓ No migration needed - all tokens already encrypted.")
            return 0


if __name__ == "__main__":
    try:
        exit_code = migrate_encrypt_tokens()
        sys.exit(exit_code)
    except Exception as e:
        print(f"\n✗ FATAL ERROR: {str(e)}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
