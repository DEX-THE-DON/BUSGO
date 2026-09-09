"""
Paystack Payment Gateway Integration for BUSGO.
Handles transaction initialization, verification, and webhook signature validation.
Supports Kenyan Shillings (KES) across Cards, Mobile Money, and M-Pesa.
"""
import os
import hmac
import hashlib
import json
from typing import Optional, Dict, Any
import httpx

PAYSTACK_SECRET_KEY = os.getenv("PAYSTACK_SECRET_KEY", "")
PAYSTACK_PUBLIC_KEY = os.getenv("PAYSTACK_PUBLIC_KEY", "")
PAYSTACK_BASE_URL = "https://api.paystack.co"


def is_configured() -> bool:
    return bool(PAYSTACK_SECRET_KEY and PAYSTACK_SECRET_KEY.startswith("sk_"))


async def initialize_transaction(
    email: str,
    amount_kes: float,
    reference: str,
    callback_url: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    if not is_configured():
        return {
            "authorization_url": f"https://checkout.paystack.com/simulate-{reference}",
            "access_code": f"sim_{reference}",
            "reference": reference,
        }

    amount_in_cents = int(round(amount_kes * 100))
    payload: Dict[str, Any] = {
        "email": email,
        "amount": amount_in_cents,
        "currency": "KES",
        "reference": reference,
        "channels": ["card", "mobile_money", "mpesa", "bank"],
    }
    if callback_url:
        payload["callback_url"] = callback_url
    if metadata:
        payload["metadata"] = metadata

    headers = {
        "Authorization": f"Bearer {PAYSTACK_SECRET_KEY}",
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.post(
            f"{PAYSTACK_BASE_URL}/transaction/initialize",
            json=payload,
            headers=headers,
        )
        res_data = response.json()
        if not response.is_success or not res_data.get("status"):
            error_msg = res_data.get("message", "Paystack initialization failed.")
            raise ValueError(f"Paystack API Error: {error_msg}")
        return res_data["data"]


async def verify_transaction(reference: str) -> Dict[str, Any]:
    """
    Verifies a transaction using its reference.
    Returns the transaction data if verified.
    """
    if not is_configured():
        return {
            "status": "success",
            "reference": reference,
            "amount": 50000,
            "gateway_response": "Successful (Simulated)",
        }

    headers = {
        "Authorization": f"Bearer {PAYSTACK_SECRET_KEY}",
    }

    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.get(
            f"{PAYSTACK_BASE_URL}/transaction/verify/{reference}",
            headers=headers,
        )
        res_data = response.json()
        if not response.is_success or not res_data.get("status"):
            error_msg = res_data.get("message", "Paystack verification failed.")
            raise ValueError(f"Paystack Verify Error: {error_msg}")
        return res_data["data"]


def verify_webhook_signature(raw_body: bytes, signature_header: Optional[str]) -> bool:
    """
    Verifies that the incoming webhook originated from Paystack using HMAC SHA512.
    """
    if not signature_header:
        return False
    computed_signature = hmac.new(
        PAYSTACK_SECRET_KEY.encode("utf-8"),
        msg=raw_body,
        digestmod=hashlib.sha512,
    ).hexdigest()
    return hmac.compare_digest(computed_signature, signature_header)
