"""
Encryption Service

Handles encryption and decryption of sensitive data like Plaid access tokens.
Uses Fernet symmetric encryption (AES-128-CBC with HMAC authentication).
"""
import logging
from typing import Optional
from cryptography.fernet import Fernet
from app.config import settings

logger = logging.getLogger(__name__)


class EncryptionService:
    """Service for encrypting and decrypting sensitive data"""

    def __init__(self):
        """
        Initialize the encryption service with a key derived from SECRET_KEY.
        The SECRET_KEY is already validated to be 32+ characters and secure.
        """
        # Fernet requires a URL-safe base64-encoded 32-byte key
        # We'll use the SECRET_KEY and pad/truncate to 32 bytes, then base64 encode
        from cryptography.hazmat.primitives import hashes
        from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
        from cryptography.hazmat.backends import default_backend
        import base64

        # Derive a proper Fernet key from the SECRET_KEY
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,
            salt=b'plaid_token_encryption_salt',  # Fixed salt for key derivation
            iterations=100000,
            backend=default_backend()
        )
        key_bytes = kdf.derive(settings.SECRET_KEY.encode())
        self.key = base64.urlsafe_b64encode(key_bytes)
        self.cipher = Fernet(self.key)

    def encrypt(self, plaintext: str) -> str:
        """
        Encrypt a plaintext string and return base64-encoded ciphertext.

        Args:
            plaintext: The string to encrypt

        Returns:
            Base64-encoded encrypted string
        """
        if not plaintext:
            return ""

        try:
            encrypted_bytes = self.cipher.encrypt(plaintext.encode())
            return encrypted_bytes.decode()
        except Exception as e:
            logger.error(f"Encryption error: {e}")
            raise

    def decrypt(self, ciphertext: str) -> str:
        """
        Decrypt a base64-encoded ciphertext and return plaintext.

        Args:
            ciphertext: Base64-encoded encrypted string

        Returns:
            Decrypted plaintext string
        """
        if not ciphertext:
            return ""

        try:
            decrypted_bytes = self.cipher.decrypt(ciphertext.encode())
            return decrypted_bytes.decode()
        except Exception as e:
            logger.error(f"Decryption error: {e}")
            raise

    def encrypt_if_present(self, value: Optional[str]) -> Optional[str]:
        """
        Encrypt a value only if it's not None or empty.

        Args:
            value: Optional string to encrypt

        Returns:
            Encrypted string or None
        """
        if value:
            return self.encrypt(value)
        return None

    def decrypt_if_present(self, value: Optional[str]) -> Optional[str]:
        """
        Decrypt a value only if it's not None or empty.

        Args:
            value: Optional encrypted string to decrypt

        Returns:
            Decrypted string or None
        """
        if value:
            return self.decrypt(value)
        return None


# Global encryption service instance
encryption_service = EncryptionService()
