# Vantage ML Service

Python FastAPI service that exposes the XGBoost adjustment layer to the TS monorepo via `core-private/ml-bridge`.

## Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/health` | none | Liveness + model version |
| POST | `/v1/adjust` | `x-api-key` header | Predict adjustment delta + SHAP values |

## Phase 1 stub

The shipped `StubModel` returns near-zero deltas with zero SHAP values. This lets the TS bridge be exercised end-to-end without changing valuations.

## Phase 2+ real model

1. Train an `xgb.XGBRegressor` on labeled outcomes (valuation residuals vs alt-data feature vectors)
2. `joblib.dump(model, 'model.joblib')`
3. In `app/main.py`, swap the singleton:
   ```python
   from .models import XgbModel
   _model: MlModel = XgbModel('/path/to/model.joblib')
   ```

## Feature contract

`app/features.py::canonical_feature_order()` defines the column layout. Train and serve must agree on it. Missing features default to 0.

## Dev

```bash
cd services/ml-service
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8001
pytest
```

Or from the monorepo root: `pnpm ml:dev`.
