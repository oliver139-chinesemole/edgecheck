#!/usr/bin/env bash
# Render.com build script — runs from the repo root.
set -e

echo "==> Installing Python dependencies…"
pip install -r backend/requirements.txt

echo "==> Creating models directory…"
mkdir -p models

echo "==> Training default model…"
cd backend
python3 scripts/train_default_model.py
cd ..

echo "==> Build complete."
