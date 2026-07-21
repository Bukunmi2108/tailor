from fastapi.testclient import TestClient

from app.main import app


def test_public_health_and_protected_base():
    with TestClient(app) as client:
        assert client.get("/healthz").json() == {"status": "ok"}
        assert client.get("/api/base/current").status_code == 401


def test_public_config_contains_no_secrets():
    with TestClient(app) as client:
        payload = client.get("/api/config/public").json()
        assert payload["persistence"] == "browser-memory"
        assert "token" not in str(payload).lower()


def test_cors_exposes_every_download_header():
    # The frontend runs cross-origin, so every X-* download header the browser must
    # read has to appear in the middleware's Access-Control-Expose-Headers. The
    # /export/both headers were previously missing, hiding the page counts cross-origin.
    with TestClient(app) as client:
        response = client.get("/api/config/public", headers={"Origin": "http://localhost:5173"})
        exposed = response.headers.get("access-control-expose-headers", "")
        for header in (
            "Content-Disposition",
            "X-Page-Count",
            "X-Content-Hash",
            "X-Resume-Page-Count",
            "X-Cover-Page-Count",
            "X-Resume-Hash",
            "X-Cover-Hash",
        ):
            assert header in exposed, f"{header} is not exposed cross-origin"
