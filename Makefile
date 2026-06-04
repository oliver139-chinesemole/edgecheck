.PHONY: install dev test seed model clean

# ── Installation ──────────────────────────────────────────────────────────
install:
	@echo "==> Installing Python dependencies..."
	cd backend && pip install -r requirements.txt
	@echo "==> Installing Node dependencies..."
	cd frontend && npm install
	@echo "==> Generating seed data..."
	python3 data/generate_seed.py
	@echo "==> Training default model (Tab C ready)..."
	cd backend && python3 scripts/train_default_model.py
	@echo ""
	@echo "✓ Installation complete. Run 'make dev' to start."

# ── Development server ────────────────────────────────────────────────────
dev:
	@echo "==> Starting EdgeCheck (backend :8000, frontend :5173)"
	@trap 'kill 0' INT TERM; \
	(cd backend && uvicorn main:app --reload --port 8000 2>&1 | sed 's/^/[backend] /') & \
	(cd frontend && npm run dev 2>&1 | sed 's/^/[frontend] /') & \
	wait

# ── Tests ─────────────────────────────────────────────────────────────────
test:
	@echo "==> Running backend + methodology tests..."
	cd backend && python3 -m pytest ../tests/ -v --tb=short

# ── Helpers ───────────────────────────────────────────────────────────────
seed:
	python3 data/generate_seed.py

model:
	cd backend && python3 scripts/train_default_model.py

clean:
	@find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null; true
	@find . -name "*.pyc" -delete 2>/dev/null; true
	@rm -f backend/edgecheck.db
	@echo "Clean complete."
