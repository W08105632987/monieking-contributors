"""
One-time helper: generates a real VAPID key pair for push notifications.

Run once per environment you deploy to (dev, staging, production should
each have their own — don't reuse the same pair across environments):

    python backend/scripts/generate_vapid_keys.py

Paste the two printed values into that environment's .env as
VAPID_PRIVATE_KEY_PEM and VAPID_PUBLIC_KEY_B64. Keep the private key as
secret as any other credential in this app — never commit it, never log
it, never expose it to the frontend (only the public key is exposed, via
GET /push/vapid-public-key).
"""
import base64
from py_vapid import Vapid02
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat


def main():
    v = Vapid02()
    v.generate_keys()

    private_pem = v.private_pem().decode()
    public_raw = v.public_key.public_bytes(
        encoding=Encoding.X962,
        format=PublicFormat.UncompressedPoint,
    )
    public_b64 = base64.urlsafe_b64encode(public_raw).decode().rstrip("=")

    print("\n— VAPID_PRIVATE_KEY_PEM (keep secret, server-side only) —\n")
    print(private_pem)
    print("— VAPID_PUBLIC_KEY_B64 (safe to expose to the frontend) —\n")
    print(public_b64)
    print()


if __name__ == "__main__":
    main()
