import pyotp
import qrcode
import io
import base64
import secrets
from passlib.context import CryptContext
from typing import List, Tuple

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

class TwoFactorService:
    """Service for handling 2FA operations"""

    @staticmethod
    def generate_secret() -> str:
        """Generate a random secret for TOTP"""
        return pyotp.random_base32()

    @staticmethod
    def generate_qr_code(email: str, secret: str, issuer: str = "Portfolio Investments") -> str:
        """Generate QR code as base64 data URL"""
        totp = pyotp.TOTP(secret)
        provisioning_uri = totp.provisioning_uri(name=email, issuer_name=issuer)

        # Generate QR code
        qr = qrcode.QRCode(version=1, box_size=10, border=5)
        qr.add_data(provisioning_uri)
        qr.make(fit=True)

        img = qr.make_image(fill_color="black", back_color="white")

        # Convert to base64
        buffer = io.BytesIO()
        img.save(buffer, format='PNG')
        img_str = base64.b64encode(buffer.getvalue()).decode()

        return f"data:image/png;base64,{img_str}"

    @staticmethod
    def verify_totp(secret: str, code: str, window: int = 1) -> bool:
        """
        Verify a TOTP code
        window: number of time steps to check (1 = 30 seconds before/after)
        """
        if not code or not code.isdigit() or len(code) != 6:
            return False

        totp = pyotp.TOTP(secret)
        return totp.verify(code, valid_window=window)

    @staticmethod
    def generate_backup_codes(count: int = 10) -> List[str]:
        """Generate backup codes (8 characters each)"""
        codes = []
        for _ in range(count):
            # Generate 8-character alphanumeric codes
            code = ''.join(secrets.choice('ABCDEFGHJKLMNPQRSTUVWXYZ23456789') for _ in range(8))
            codes.append(code)
        return codes

    @staticmethod
    def hash_backup_codes(codes: List[str]) -> List[str]:
        """Hash backup codes for storage"""
        return [pwd_context.hash(code) for code in codes]

    @staticmethod
    def verify_backup_code(code: str, hashed_codes: List[str]) -> Tuple[bool, int]:
        """
        Verify a backup code against hashed codes
        Returns (is_valid, matched_index) - index is -1 if not found
        """
        code = code.strip().upper().replace('-', '').replace(' ', '')

        for idx, hashed_code in enumerate(hashed_codes):
            if pwd_context.verify(code, hashed_code):
                return True, idx

        return False, -1
