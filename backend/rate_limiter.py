"""
BUSGO High-Performance Token Bucket Rate Limiter & Abuse Protection.

Protects sensitive transit endpoints against brute force and DDoS:
  1. M-Pesa STK Push triggers (prevents SIM spam & Daraja API quota exhaustion)
  2. USSD Webhook hops (prevents Telco aggregator flooding)
  3. Authentication logins (prevents credential stuffing on conductor/admin accounts)
  4. Ticket search and reservation endpoints
"""

import time
from collections import defaultdict
from typing import Dict, List, Tuple, Optional
from fastapi import Request, HTTPException


class SlidingWindowRateLimiter:
    """
    Sliding window in-memory rate limiter with automatic stale key eviction.
    """

    def __init__(self):
        # Maps bucket_key -> list of timestamp floats
        self._buckets: Dict[str, List[float]] = defaultdict(list)
        self._last_cleanup = time.time()

    def is_allowed(
        self, key: str, max_requests: int, window_seconds: int = 60
    ) -> Tuple[bool, int, int]:
        """
        Check if request under `key` is allowed within `window_seconds`.
        Returns:
            (is_allowed: bool, current_count: int, retry_after_seconds: int)
        """
        now = time.time()
        window_start = now - window_seconds

        # Periodic cleanup of expired buckets every 5 minutes
        if now - self._last_cleanup > 300:
            self._cleanup(window_start)
            self._last_cleanup = now

        timestamps = self._buckets[key]
        # Filter timestamps within current window
        valid_timestamps = [t for t in timestamps if t > window_start]
        self._buckets[key] = valid_timestamps

        if len(valid_timestamps) >= max_requests:
            earliest_timestamp = valid_timestamps[0]
            retry_after = max(1, int(window_seconds - (now - earliest_timestamp)))
            return False, len(valid_timestamps), retry_after

        # Record new hit
        self._buckets[key].append(now)
        return True, len(self._buckets[key]), 0

    def _cleanup(self, window_start: float):
        keys_to_delete = []
        for key, timestamps in self._buckets.items():
            valid = [t for t in timestamps if t > window_start]
            if not valid:
                keys_to_delete.append(key)
            else:
                self._buckets[key] = valid
        for k in keys_to_delete:
            del self._buckets[k]

    def reset(self, key: Optional[str] = None):
        if key:
            self._buckets.pop(key, None)
        else:
            self._buckets.clear()


# Global limiter instance
limiter = SlidingWindowRateLimiter()


def get_client_ip(request: Request) -> str:
    """Extract real client IP considering forward headers from Caddy/Nginx."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    real_ip = request.headers.get("x-real-ip")
    if real_ip:
        return real_ip.strip()
    return request.client.host if request.client else "127.0.0.1"


def enforce_rate_limit(
    key: str,
    max_requests: int,
    window_seconds: int = 60,
    action_label: str = "request",
):
    """
    Synchronous / inline check that raises HTTP 429 if threshold exceeded.
    """
    allowed, count, retry_after = limiter.is_allowed(key, max_requests, window_seconds)
    if not allowed:
        raise HTTPException(
            status_code=429,
            detail={
                "error": "rate_limit_exceeded",
                "message": f"Too many {action_label} attempts. Please wait {retry_after}s before retrying.",
                "retry_after_seconds": retry_after,
            },
            headers={"Retry-After": str(retry_after)},
        )
