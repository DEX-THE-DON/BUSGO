"""
M-Pesa Daraja STK Push integration.

Real API flow:
  1. OAuth access token (consumer key/secret via Basic auth).
  2. Build the STK password = base64(timestamp + shortcode + passkey).
  3. POST /mpesa/stkpush/v1/processrequest with the customer's phone.
  4. Store the returned CheckoutRequestID; Safaricom calls the callback URL
     with the final result, which the app verifies and applies idempotently.

Set these in your environment (see .env.example):
  MPESA_ENV            sandbox | production        (default: sandbox)
  MPESA_CONSUMER_KEY   from your Safaricom app
  MPESA_CONSUMER_SECRET from your Safaricom app
  MPESA_PASSKEY        Daraja passkey for STK push
  MPESA_SHORTCODE      Paybill/Store number (default 174379 sandbox)
  MPESA_CALLBACK_URL   public HTTPS URL -> POST /api/pay/daraja/callback

The app degrades gracefully: `configured()` is False until the real keys are
set, and the simulated M-Pesa flow remains available for local dev.
"""
import base64
import os
from datetime import datetime
from typing import Optional

import httpx

MPESA_ENV = os.getenv("MPESA_ENV", "sandbox")
BASE_URL = (
    "https://sandbox.safaricom.co.ke"
    if MPESA_ENV == "sandbox"
    else "https://api.safaricom.co.ke"
)
CONSUMER_KEY = os.getenv("MPESA_CONSUMER_KEY", "")
CONSUMER_SECRET = os.getenv("MPESA_CONSUMER_SECRET", "")
PASSKEY = os.getenv("MPESA_PASSKEY", "")
SHORTCODE = os.getenv("MPESA_SHORTCODE", "174379")
CALLBACK_URL = os.getenv(
    "MPESA_CALLBACK_URL",
    "https://your-domain.example.com/api/pay/daraja/callback",
)


def configured() -> bool:
    return bool(CONSUMER_KEY and CONSUMER_SECRET and PASSKEY)


def normalize_phone(phone: str) -> str:
    """Accept 0712345678 / 254712345678 / +254712345678 -> 254712345678."""
    digits = "".join(ch for ch in phone if ch.isdigit())
    if digits.startswith("0"):
        return "254" + digits[1:]
    if digits.startswith("254"):
        return digits
    raise ValueError("Phone number must be a Kenyan number like 2547XXXXXXXX.")


async def get_access_token() -> str:
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            f"{BASE_URL}/oauth/v1/generate?grant_type=client_credentials",
            auth=(CONSUMER_KEY, CONSUMER_SECRET),
        )
        resp.raise_for_status()
        data = resp.json()
        token = data.get("access_token")
        if not token:
            raise RuntimeError(f"Daraja access token request failed: {data}")
        return token


def _stk_password() -> tuple[str, str]:
    timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
    raw = f"{SHORTCODE}{PASSKEY}{timestamp}"
    return base64.b64encode(raw.encode()).decode(), timestamp


async def stk_push(
    phone: str,
    amount: float,
    account_reference: str,
    transaction_desc: str = "BUSGO Seat Booking",
) -> dict:
    """Send an STK push and return the raw Daraja response."""
    token = await get_access_token()
    password, timestamp = _stk_password()
    normalized = normalize_phone(phone)
    payload = {
        "BusinessShortCode": SHORTCODE,
        "Password": password,
        "Timestamp": timestamp,
        "TransactionType": "CustomerPayBillOnline",
        "Amount": int(round(amount)),
        "PartyA": normalized,
        "PartyB": SHORTCODE,
        "PhoneNumber": normalized,
        "CallBackURL": CALLBACK_URL,
        "AccountReference": (account_reference or "BUSGO")[:12],
        "TransactionDesc": transaction_desc[:13],
    }
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.post(
            f"{BASE_URL}/mpesa/stkpush/v1/processrequest",
            headers={"Authorization": f"Bearer {token}"},
            json=payload,
        )
        resp.raise_for_status()
        return resp.json()


def parse_callback(body: dict) -> Optional[dict]:
    """Extract the meaningful fields from a Daraja STK callback body.

    Returns None if the body is not a valid STK callback.
    """
    try:
        stk = body["Body"]["stkCallback"]
        checkout_id = stk.get("CheckoutRequestID")
        result_code = stk.get("ResultCode")
        result_desc = stk.get("ResultDesc", "")
        metadata = {}
        for item in (stk.get("CallbackMetadata") or {}).get("Item", []):
            metadata[item["Name"]] = item.get("Value")
        return {
            "checkout_request_id": checkout_id,
            "result_code": result_code,
            "result_desc": result_desc,
            "metadata": metadata,
        }
    except (KeyError, TypeError, AttributeError):
        return None
