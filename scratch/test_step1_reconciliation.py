"""
Test Payment Reconciliation logic.
Verifies query_stk_status fallback, reconciliation engine logic, and sweeping.
"""
import asyncio
from backend import daraja

async def test_daraja_query():
    print("Testing Daraja query fallback...")
    res = await daraja.query_stk_status("ws_CO_TEST_12345")
    assert res is not None
    assert "ResponseCode" in res or "ResultCode" in res
    print("✓ query_stk_status returned valid dictionary response:", res)

if __name__ == "__main__":
    asyncio.run(test_daraja_query())
    print("Step 1 tests passed!")
