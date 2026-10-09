"""
Test Suite for Infrastructure Enhancements:
1. Token Bucket Sliding Window Rate Limiter
2. Alembic Migration Structure & Down Revision Chain
3. GitHub Actions CI/CD Configuration
"""

import sys
import os
import yaml
from pathlib import Path
from fastapi import HTTPException

PROJECT_ROOT = Path(__file__).resolve().parent.parent

from backend.rate_limiter import SlidingWindowRateLimiter, enforce_rate_limit


def run_tests():
    print("=" * 65)
    print("--- [TEST: Infrastructure & DevOps Quality Gate] ---")
    print("=" * 65)

    # 1. Rate Limiter Functional Test
    print("\n--- 1. Testing Sliding Window Rate Limiter ---")
    limiter = SlidingWindowRateLimiter()
    test_key = "test_daraja_stk:254716314831"

    # Allow up to 3 requests per 10 seconds
    for i in range(3):
        allowed, count, retry_after = limiter.is_allowed(test_key, max_requests=3, window_seconds=10)
        assert allowed is True, f"Request {i+1} should be allowed"
        assert count == i + 1

    # 4th request must be throttled
    allowed, count, retry_after = limiter.is_allowed(test_key, max_requests=3, window_seconds=10)
    assert allowed is False, "4th request should be blocked"
    assert retry_after > 0, "Retry-After should be positive"
    print(f"✓ Throttling verified: 4th request blocked with Retry-After: {retry_after}s")

    # Enforce helper test (expecting HTTPException 429 on 4th call)
    enforce_key = "enforce_test:123"
    for _ in range(3):
        enforce_rate_limit(enforce_key, max_requests=3, window_seconds=10, action_label="payment")

    try:
        enforce_rate_limit(enforce_key, max_requests=3, window_seconds=10, action_label="payment")
        assert False, "Should have raised HTTPException 429"
    except HTTPException as e:
        assert e.status_code == 429
        assert "Retry-After" in e.headers
        print("✓ enforce_rate_limit successfully raised HTTP 429 with Retry-After header!")

    # 2. Alembic Migration Chain Test
    print("\n--- 2. Testing Alembic Migration Chain ---")
    migration_file = PROJECT_ROOT / "backend" / "alembic" / "versions" / "f6a7b8c9d0e1_add_production_vouchers_telemetry_ussd_settlements.py"
    assert migration_file.exists(), "Migration file must exist"

    content = migration_file.read_text()
    assert "revision: str = 'f6a7b8c9d0e1'" in content
    assert "down_revision: Union[str, Sequence[str], None] = 'e5f6a7b8c9d0'" in content
    assert "travel_vouchers" in content
    assert "ussd_sessions" in content
    assert "gps_telemetry_logs" in content
    assert "sacco_settlements" in content
    assert "tracker_imei" in content
    print("✓ Alembic migration f6a7b8c9d0e1 verified with full production schema additions!")

    # 3. GitHub Actions CI/CD Workflow Test
    print("\n--- 3. Testing .github/workflows/ci.yml Syntax ---")
    ci_file = PROJECT_ROOT / ".github" / "workflows" / "ci.yml"
    assert ci_file.exists(), "ci.yml must exist"

    with open(ci_file, "r") as f:
        ci_data = yaml.safe_load(f)

    assert "backend-ci" in ci_data["jobs"]
    assert "frontend-ci" in ci_data["jobs"]
    assert "docker-ci" in ci_data["jobs"]
    ci_triggers = ci_data.get(True) or ci_data.get("on")
    assert "push" in ci_triggers
    assert "pull_request" in ci_triggers
    print("✓ GitHub Actions workflow verified with Python, TypeScript, and Docker quality gates!")

    print("\n" + "=" * 65)
    print("ALL INFRASTRUCTURE & DEVOPS TESTS PASSED SUCCESSFULLY!")
    print("=" * 65)


if __name__ == "__main__":
    run_tests()
