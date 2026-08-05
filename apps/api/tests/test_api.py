from fastapi.testclient import TestClient


def test_demo_flow(client: TestClient) -> None:
    locations = client.get("/api/v1/locations")
    assert locations.status_code == 200
    location_id = locations.json()[0]["id"]

    nowcast = client.get(f"/api/v1/nowcast?location_id={location_id}")
    assert nowcast.status_code == 200
    assert nowcast.json()["is_demo"] is True
    assert len(nowcast.json()["points"]) == 13

    recommendation = client.post(
        "/api/v1/departure/recommend",
        json={"location_id": location_id, "exposure_minutes": 30, "max_wait_minutes": 60},
    )
    assert recommendation.status_code == 200
    assert "recommended" in recommendation.json()

    accuracy = client.get(f"/api/v1/accuracy/summary?location_id={location_id}")
    assert accuracy.json()["winner"] is None
    assert "표본 부족" in accuracy.json()["verdict"]


def test_admin_requires_token_and_excludes_restricted_data(client: TestClient) -> None:
    assert client.post("/api/v1/admin/export").status_code == 401
    response = client.post(
        "/api/v1/admin/export", headers={"X-Admin-Token": "test-admin-token"}
    )
    assert response.status_code == 200
    payload = response.json()
    assert "met_norway" in payload["providers_included"]
    assert "accuweather" not in payload["providers_included"]
    assert "windy_testing" not in payload["providers_included"]


def test_forecast_comparison_keeps_windy_models_separate(client: TestClient) -> None:
    response = client.get("/api/v1/forecast/compare?hours=3")
    assert response.status_code == 200
    series = response.json()["series"]
    windy_variants = {
        item["provider_variant"] for item in series if item["provider_id"] == "windy"
    }
    assert windy_variants == {"gfs", "icon"}
    assert all(item["watermark"] for item in series if item["provider_id"] == "windy")


def test_current_position_is_used_without_persistence(client: TestClient) -> None:
    before = client.get("/api/v1/locations").json()
    response = client.get(
        "/api/v1/weather/current?latitude=37.50123&longitude=127.03961"
    )
    assert response.status_code == 200
    temporary_location_id = response.json()["location_id"]

    recommendation = client.post(
        "/api/v1/departure/recommend",
        json={
            "latitude": 37.50123,
            "longitude": 127.03961,
            "exposure_minutes": 20,
            "max_wait_minutes": 30,
        },
    )
    assert recommendation.status_code == 200
    assert temporary_location_id not in {
        location["id"] for location in client.get("/api/v1/locations").json()
    }
    assert client.get("/api/v1/locations").json() == before
