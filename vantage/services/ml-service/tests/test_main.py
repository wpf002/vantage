"""Smoke tests for the ML service."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app, API_KEY


client = TestClient(app)


def test_health() -> None:
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert "modelVersion" in body


def test_adjust_requires_api_key() -> None:
    r = client.post(
        "/v1/adjust",
        json={"companyId": "x", "preMlValuation": 1.0, "features": {}},
    )
    assert r.status_code == 401


def test_adjust_returns_shape() -> None:
    r = client.post(
        "/v1/adjust",
        headers={"x-api-key": API_KEY},
        json={
            "companyId": "anthropic",
            "preMlValuation": 32_000_000_000.0,
            "features": {"revenue_growth_ltm": 1.4, "gross_margin_ltm": 0.6},
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert "delta" in body
    assert body["direction"] in {"up", "down", "neutral"}
    assert isinstance(body["shap"], dict)
    assert body["modelVersion"]
