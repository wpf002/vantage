#!/usr/bin/env bash
# ============================================================================
# Vantage Bootstrap
# Run once after `git clone` (or after a fresh tar extract).
# Sets up dependencies, infra, and seed data.
# ============================================================================
set -euo pipefail

cyan() { printf "\033[1;36m%s\033[0m\n" "$*"; }
green() { printf "\033[1;32m%s\033[0m\n" "$*"; }
red() { printf "\033[1;31m%s\033[0m\n" "$*"; }
yellow() { printf "\033[1;33m%s\033[0m\n" "$*"; }

cyan "==> Vantage bootstrap"

# --- 1. Preflight ---------------------------------------------------------
cyan "==> [1/7] Preflight checks"

command -v node >/dev/null 2>&1 || { red "node not found. Install Node 22 (nvm install 22)."; exit 1; }
command -v pnpm >/dev/null 2>&1 || { red "pnpm not found. Install: npm i -g pnpm@9"; exit 1; }
command -v docker >/dev/null 2>&1 || { red "docker not found. Install Docker Desktop or engine."; exit 1; }
command -v python3 >/dev/null 2>&1 || { red "python3 not found. Install Python 3.12."; exit 1; }

NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$NODE_MAJOR" -lt 22 ]; then
  red "Node 22+ required. Found $(node -v)."; exit 1
fi

green "    node $(node -v), pnpm $(pnpm -v), docker $(docker -v | awk '{print $3}'), $(python3 --version)"

# --- 2. .env --------------------------------------------------------------
cyan "==> [2/7] Environment file"
if [ ! -f .env ]; then
  cp .env.example .env
  green "    created .env from .env.example — fill in your secrets"
else
  yellow "    .env already exists, leaving it alone"
fi

# --- 3. Install JS deps ----------------------------------------------------
cyan "==> [3/7] Installing JS dependencies (pnpm install)"
pnpm install

# --- 4. Spin up infra ------------------------------------------------------
cyan "==> [4/7] Starting Postgres + Redis (docker compose up -d)"
docker compose up -d
green "    waiting for Postgres to be healthy..."
for i in {1..30}; do
  if docker compose exec -T postgres pg_isready -U vantage >/dev/null 2>&1; then
    green "    Postgres ready"
    break
  fi
  sleep 1
done

# --- 5. DB migrations + seed ----------------------------------------------
cyan "==> [5/7] Database migrations + seed"
pnpm db:generate || yellow "    no migrations yet to generate"
pnpm db:migrate || yellow "    migrations skipped (drizzle config may need a generate first)"
pnpm db:seed || yellow "    seed skipped"

# --- 6. Python ML service venv --------------------------------------------
cyan "==> [6/7] Python ML service venv"
cd services/ml-service
if [ ! -d .venv ]; then
  python3 -m venv .venv
fi
# shellcheck disable=SC1091
source .venv/bin/activate
pip install --quiet --upgrade pip
pip install --quiet -r requirements.txt
deactivate
cd ../..
green "    ml-service venv ready (services/ml-service/.venv)"

# --- 7. Done --------------------------------------------------------------
cyan "==> [7/7] Done"
green "
  Vantage is ready.

  Next steps:
    pnpm dev                  # turbo runs api + ui + watchers
    pnpm ml:dev               # python ML service on :8001
    pnpm db:studio            # drizzle studio
    pnpm docker:logs          # tail postgres + redis logs

  UI:  http://localhost:3000
  API: http://localhost:4000
  ML:  http://localhost:8001
"
