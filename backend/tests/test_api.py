from fastapi.testclient import TestClient

from app.main import app


def test_public_health_and_protected_base():
    with TestClient(app) as client:
        assert client.get("/healthz").json() == {"status": "ok"}
        assert client.get("/api/base/current").status_code == 401


def test_public_config_contains_no_secrets():
    with TestClient(app) as client:
        payload = client.get("/api/config/public").json()
        assert payload["persistence"] == "browser-indexeddb"
        assert "token" not in str(payload).lower()
