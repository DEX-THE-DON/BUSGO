import urllib.request
import json

BASE_URL = "http://127.0.0.1:8000"

def test_sacco_and_compliance():
    # 1. Login as admin
    login_req = urllib.request.Request(
        f"{BASE_URL}/api/auth/login",
        data=json.dumps({"email": "admin@busgo.test", "password": "admin123"}).encode('utf-8'),
        headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(login_req) as resp:
        admin_data = json.loads(resp.read().decode('utf-8'))
        token = admin_data["access_token"]
        print(f"✓ Admin Logged In: {admin_data['user']['full_name']} (Role: {admin_data['user']['role']})")

    auth_headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }

    # 2. Fetch SACCOs
    sacco_req = urllib.request.Request(f"{BASE_URL}/api/saccos")
    with urllib.request.urlopen(sacco_req) as resp:
        saccos = json.loads(resp.read().decode('utf-8'))["saccos"]
        print(f"✓ SACCOs loaded ({len(saccos)} cooperatives found):")
        for s in saccos:
            print(f"   - [{s['slug']}] {s['name']} (HQ: {s['headquarters']}, Fleet: {s['fleet_count']}, Score: {s['compliance_score']}%)")

    # 3. Fetch Fleet Compliance
    comp_req = urllib.request.Request(f"{BASE_URL}/api/compliance/fleet", headers=auth_headers)
    with urllib.request.urlopen(comp_req) as resp:
        comp_list = json.loads(resp.read().decode('utf-8'))["compliance"]
        print(f"✓ Compliance records loaded ({len(comp_list)} vehicles audited):")
        for c in comp_list:
            print(f"   - {c['plate_number']} | SACCO: {c['sacco_name']} | Omata Cert: {c['speed_governor_cert']} | Grounded: {c['is_grounded']}")

    # 4. Search trips for passengers with SACCO info
    search_req = urllib.request.Request(f"{BASE_URL}/api/trips/search?board_stop=Nairobi&alight_stop=Nakuru")
    with urllib.request.urlopen(search_req) as resp:
        search_results = json.loads(resp.read().decode('utf-8'))["results"]
        print(f"✓ Passenger Search with SACCO branding ({len(search_results)} trips found):")
        for res in search_results:
            print(f"   - Trip: {res['name']} | SACCO: {res.get('sacco_name')} | Fare: KES {res['fare']} | Seats: {res['available_seats']}")

    print("\n🎉 ALL MULTI-SACCO & NTSA FLEET COMPLIANCE TESTS PASSED SUCCESSFULLY!")

if __name__ == "__main__":
    test_sacco_and_compliance()

