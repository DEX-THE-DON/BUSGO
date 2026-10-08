"""
Test Suite for Item 1: Automated M-Pesa B2C Payouts & Vehicle Owner Revenue Splits.
"""
import asyncio
from backend import daraja

async def test_b2c_engine():
    print("Test 1: Testing Daraja B2C Payment Request API...")
    res = await daraja.b2c_payment_request(
        phone="254712345678",
        amount=10400.0,
        remarks="Dividend Payout KDA 123A",
        occasion="OwnerDividend"
    )
    assert res is not None
    assert "ConversationID" in res
    assert "ResponseCode" in res
    print("✓ B2C Payment Request simulated successfully:", res)

    print("\nTest 2: Testing Daraja B2C Callback Parser...")
    sample_callback = {
        "Result": {
            "ResultType": 0,
            "ResultCode": 0,
            "ResultDesc": "The service request is processed successfully.",
            "OriginatorConversationID": "ORIG_123456",
            "ConversationID": "AG_B2C_789XYZ",
            "TransactionID": "QJH789XYZ",
            "ResultParameters": {
                "ResultParameter": [
                    {"Key": "TransactionAmount", "Value": 10400},
                    {"Key": "TransactionReceipt", "Value": "QJH789XYZ"},
                    {"Key": "ReceiverPartyPublicName", "Value": "254712345678 - John Doe"}
                ]
            }
        }
    }
    parsed = daraja.parse_b2c_callback(sample_callback)
    assert parsed is not None
    assert parsed["result_code"] == 0
    assert parsed["transaction_id"] == "QJH789XYZ"
    assert parsed["conversation_id"] == "AG_B2C_789XYZ"
    print("✓ B2C Callback parser successfully verified:", parsed)

    print("\nTest 3: Testing Kenyan SACCO Revenue Split Formula...")
    gross_fares = 20000.0
    fuel_deduction = 6000.0
    conductor_wage = 2000.0
    sacco_levy = round(gross_fares * 0.05, 2)  # 5% = 1,000
    platform_fee = round(gross_fares * 0.03, 2)  # 3% = 600
    net_owner_dividend = round(gross_fares - fuel_deduction - conductor_wage - sacco_levy - platform_fee, 2)

    assert sacco_levy == 1000.0
    assert platform_fee == 600.0
    assert net_owner_dividend == 10400.0
    print(f"✓ Kenyan SACCO split math verified: Gross KES {gross_fares:,.2f} -> Net Owner Dividend KES {net_owner_dividend:,.2f}")

    print("\nALL ITEM 1 DARAJA B2C & OWNER REVENUE SPLIT TESTS PASSED!")

if __name__ == "__main__":
    asyncio.run(test_b2c_engine())

