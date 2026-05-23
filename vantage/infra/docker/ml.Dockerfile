# syntax=docker/dockerfile:1.7
# Build context: repository root. Set RAILWAY_DOCKERFILE_PATH=infra/docker/ml.Dockerfile.

FROM python:3.12-slim AS runtime

# xgboost needs libgomp1; shap/numpy/pandas all use it transitively.
RUN apt-get update \
 && apt-get install -y --no-install-recommends libgomp1 \
 && rm -rf /var/lib/apt/lists/*

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

COPY services/ml-service/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY services/ml-service/app ./app

# Railway injects PORT; bind 0.0.0.0 so the proxy can reach it.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8001}"]
