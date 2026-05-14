"""
Vantage ML Service.

Wraps an XGBoost regression model that predicts a multiplicative adjustment
to the pre-ML blended valuation, given a flat feature vector of alt-data
signals. Every prediction also returns SHAP values for explainability.

Endpoints:
    GET  /health      → liveness check
    POST /v1/adjust   → predict adjustment + SHAP

For Phase 2: the model is a deterministic stub (returns ~0% delta).
For Phase 2+: train against a labeled corpus and load via joblib.
"""

from __future__ import annotations

import os
from typing import Literal

import numpy as np
from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from .features import canonical_feature_order
from .models import StubModel, MlModel

load_dotenv()

API_KEY = os.environ.get("ML_SERVICE_API_KEY", "dev-only-change-in-prod")
MODEL_VERSION = "0.1.0-stub"

app = FastAPI(
    title="Vantage ML Service",
    version=MODEL_VERSION,
    description="XGBoost adjustment layer for private valuations.",
)

# Singleton model — loaded once at startup.
# Replace with joblib.load(...) once a real model is trained.
_model: MlModel = StubModel()


# ─── Schemas ─────────────────────────────────────────────────────────────


class AdjustRequest(BaseModel):
    companyId: str
    preMlValuation: float = Field(gt=0)
    features: dict[str, float]


class AdjustResponse(BaseModel):
    delta: float
    direction: Literal["up", "down", "neutral"]
    shap: dict[str, float]
    modelVersion: str


class HealthResponse(BaseModel):
    status: str
    modelVersion: str


# ─── Routes ──────────────────────────────────────────────────────────────


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(status="ok", modelVersion=MODEL_VERSION)


@app.post("/v1/adjust", response_model=AdjustResponse)
async def adjust(
    req: AdjustRequest,
    x_api_key: str | None = Header(default=None, convert_underscores=False),
) -> AdjustResponse:
    if x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="invalid api key")

    # Canonicalize feature vector to a fixed order known to the model
    feature_names = canonical_feature_order()
    x = np.array([[req.features.get(name, 0.0) for name in feature_names]])

    delta = float(_model.predict(x)[0])
    shap_values = _model.shap_values(x)[0]
    shap_dict = {name: float(v) for name, v in zip(feature_names, shap_values)}

    direction: Literal["up", "down", "neutral"]
    if delta > 0.02:
        direction = "up"
    elif delta < -0.02:
        direction = "down"
    else:
        direction = "neutral"

    return AdjustResponse(
        delta=delta,
        direction=direction,
        shap=shap_dict,
        modelVersion=MODEL_VERSION,
    )
