"""
Model interface + Phase-1 stub.

The StubModel returns near-zero deltas — meaning the ML layer doesn't
move the valuation until a real model is trained and dropped in.

Phase 2+: train XGBoost on labeled outcomes, save with joblib,
swap the `_model` singleton in `main.py` for an `XgbModel`.
"""

from __future__ import annotations

from typing import Protocol

import numpy as np


class MlModel(Protocol):
    def predict(self, X: np.ndarray) -> np.ndarray: ...
    def shap_values(self, X: np.ndarray) -> np.ndarray: ...


class StubModel:
    """Returns ~0% delta. SHAP is uniformly zero. For Phase 1 only."""

    def predict(self, X: np.ndarray) -> np.ndarray:
        # Deterministic tiny perturbation so the bridge can be tested
        # without altering valuations meaningfully.
        return np.zeros(X.shape[0], dtype=np.float64)

    def shap_values(self, X: np.ndarray) -> np.ndarray:
        return np.zeros_like(X, dtype=np.float64)


# ─── Phase 2+ real model (commented) ────────────────────────────────────
#
# import joblib
# import shap
# import xgboost as xgb
#
# class XgbModel:
#     def __init__(self, model_path: str):
#         self.model: xgb.XGBRegressor = joblib.load(model_path)
#         self.explainer = shap.TreeExplainer(self.model)
#
#     def predict(self, X: np.ndarray) -> np.ndarray:
#         return self.model.predict(X)
#
#     def shap_values(self, X: np.ndarray) -> np.ndarray:
#         return self.explainer.shap_values(X)
