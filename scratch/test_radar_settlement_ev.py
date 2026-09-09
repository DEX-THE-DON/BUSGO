#!/usr/bin/env python3
"""
Test Suite: National Radar, SACCO Treasury B2C Cashout & EV Fleet Telemetry
Verifies Phase 1, Phase 2, and Phase 3 of the approved expansion roadmap.
"""

import urllib.request
import urllib.error
import json
import sys

BASE_URL = "http://127.0.0.1:8000"

def log(msg, level="INFO"):
    colors = {
        "INFO": "\033[94m[INFO]\033[0m",
        "SUCCESS": "\033[92m[SUCCESS]\033[0m",
        "ERROR": "\033[91m[ERROR]\033[0m"
    }
    print(f"{colors.get(level, '')} {msg}")

def make_req(endpoint, method="GET", data=None, headers=None):
    url = f"{BASE_URL}{endpoint}"
    h = headers.copy() if headers else {}
    body = None
    if data is not None:
        body = json.dumps(data).encode("utf-8")
        h.setdefault("Content-Type", "application/json")
    
    req = urllib.request.Request(url, data=body, headers=h, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            content_type = resp.headers.get("Content-Type", "")
            raw = resp.read().decode("utf-8")
            if "application/json" in content_type:
                return resp.status, json.loads(raw)
            return resp.status, raw
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8")
        try:
            return e.code, json.loads(raw)
        except:
            return e.code, raw

def main():
    log("=== Starting Verification for Radar, Settlements & EV Fleet ===", "INFO")

    # Step 0: Authenticate Admin
    status, auth = make_req("/api/auth/login", method="POST", data={"email": "admin@busgo.test", "password": "admin123"})
    assert status == 200, f"Admin login failed: {auth}"
    admin_token = auth["access_token"]
    admin_headers = {"Authorization": f"Bearer {admin_token}"}
    log("✓ Admin authenticated successfully", "SUCCESS")

    # -------------------------------------------------------------------------
    # TEST 1: National Fleet Highway Radar (/api/radar/fleet)
    # -------------------------------------------------------------------------
    log("\n--- Testing Phase 1: National Fleet Highway Radar ---", "INFO")
    status, radar_data = make_req("/api/radar/fleet")
    assert status == 200, f"Radar fleet endpoint failed: {radar_data}"
    fleet = radar_data.get("fleet", [])
    assert len(fleet) >= 1, "Expected at least 1 transit vehicle on radar"
    v = fleet[0]
    assert "current_lat" in v and "current_lng" in v, "Missing lat/lng in radar vehicle"
    assert "sacco_name" in v and "plate_number" in v, "Missing SACCO or plate details"
    log(f"✓ Radar active: {len(fleet)} vehicles tracking with live GPS on Kenyan corridors", "SUCCESS")
    log(f"  First Vehicle: {v['plate_number']} ({v['sacco_name']}) at ({v['current_lat']:.4f}, {v['current_lng']:.4f}) - Speed: {v.get('current_speed')} km/h", "INFO")

    # -------------------------------------------------------------------------
    # TEST 2: SACCO Treasury & Daraja B2C Instant Cashout
    # -------------------------------------------------------------------------
    log("\n--- Testing Phase 2: SACCO Treasury & Daraja B2C Instant Cashout ---", "INFO")
    status, summary = make_req("/api/settlements/summary", headers=admin_headers)
    assert status == 200, f"Settlement summary failed: {summary}"
    assert "gross_revenue" in summary and "available_balance" in summary, "Invalid settlement summary shape"
    assert summary["platform_fee_pct"] == 3.0, "Platform fee must be 3.0%"
    log(f"✓ SACCO Treasury: Gross KES {summary['gross_revenue']:,.2f} | 3% Fee: KES {summary['platform_fee_total']:,.2f} | Available Net: KES {summary['available_net']:,.2f}", "SUCCESS")

    # Perform B2C withdrawal
    withdraw_payload = {
        "sacco_id": summary["sacco_id"],
        "amount": 1000.0,
        "recipient_phone": "+254716314831",
        "recipient_name": "Super Metro Finance Officer",
        "notes": "Automated End-to-End Payout Test"
    }
    status, withdraw_res = make_req("/api/settlements/withdraw", method="POST", data=withdraw_payload, headers=admin_headers)
    assert status == 200 and withdraw_res.get("ok") is True, f"B2C withdrawal failed: {withdraw_res}"
    assert withdraw_res["platform_fee"] == 30.0, "3% fee should be KES 30 on KES 1,000"
    assert withdraw_res["net_payout"] == 970.0, "Net payout should be KES 970 on KES 1,000"
    assert withdraw_res.get("b2c_transaction_id"), "Missing B2C transaction reference"
    log(f"✓ Daraja B2C Cashout executed: KES {withdraw_res['net_payout']:,.2f} disbursed (Ref: {withdraw_res['b2c_transaction_id']})", "SUCCESS")

    # -------------------------------------------------------------------------
    # TEST 3: EV Fleet Telemetry & Highway Charging Depots
    # -------------------------------------------------------------------------
    log("\n--- Testing Phase 3: EV Fleet Battery & Highway Charging Depots ---", "INFO")
    status, ev_data = make_req("/api/ev/fleet")
    assert status == 200, f"EV fleet query failed: {ev_data}"
    ev_fleet = ev_data.get("ev_fleet", [])
    assert len(ev_fleet) >= 1, "Expected at least 1 electric bus in EV fleet"
    ev_bus = ev_fleet[0]
    assert "battery_soc_pct" in ev_bus and "charging_status" in ev_bus, "Missing EV telemetry fields"
    log(f"✓ EV Fleet: {len(ev_fleet)} electric buses live. Lifetime CO2 Saved: {ev_data.get('total_co2_saved_kg')} kg", "SUCCESS")
    log(f"  Bus {ev_bus['plate_number']}: Battery {ev_bus['battery_soc_pct']}% SoC, Range {ev_bus['estimated_range_km']} km, Status: {ev_bus['charging_status']}", "INFO")

    # Ingest Telemetry Update
    status, telem_res = make_req("/api/ev/telemetry", method="POST", data={
        "vehicle_id": ev_bus["vehicle_id"],
        "battery_soc_pct": 76.5,
        "charging_status": "charging_dc_fast",
        "battery_temp_c": 32.0,
        "power_consumption_kwh_per_km": 0.0,
    })
    assert status == 200 and telem_res.get("ok") is True, f"Telemetry ingest failed: {telem_res}"
    assert telem_res["battery_soc_pct"] == 76.5
    log(f"✓ Telemetry Ingestion: Battery updated to 76.5% (Status: charging_dc_fast)", "SUCCESS")

    # Query Charging Stations
    status, stations_data = make_req("/api/ev/charging-stations")
    assert status == 200, f"Charging stations failed: {stations_data}"
    stations = stations_data.get("stations", [])
    assert len(stations) >= 5, f"Expected 5 charging stations, got {len(stations)}"
    st_names = [s["name"] for s in stations]
    log(f"✓ {len(stations)} Highway EV Fast Depots active: {', '.join(st_names[:3])}...", "SUCCESS")

    log("\n🎉 ALL NEW RADAR, SETTLEMENT & EV MODULES FULLY OPERATIONAL! 🎉", "SUCCESS")

if __name__ == "__main__":
    main()

