# Matrix — dev orchestration.
#
# Usage:
#   make install   # install backend (editable) + frontend deps
#   make dev       # run uvicorn + vite together (Ctrl-C kills both)
#   make api       # backend only
#   make web       # frontend only
#   make smoke     # curl the health + DB endpoints
#
# Requires: Python 3.11+, Node 18+, npm. Backend uses a local venv at backend/.venv.

PY        := python3
VENV_DIR  := backend/.venv
VENV_BIN  := $(VENV_DIR)/bin
UVICORN   := $(VENV_BIN)/uvicorn
PIP       := $(VENV_BIN)/pip

.PHONY: help install api web dev smoke clean

help:
	@echo "make install   # backend venv + pip install -e .  +  npm install"
	@echo "make dev       # run backend + frontend together"
	@echo "make api       # backend only (uvicorn --reload on :8000)"
	@echo "make web       # frontend only (vite on :5173)"
	@echo "make smoke     # curl /api/health and /api/health/db"

$(VENV_DIR):
	$(PY) -m venv $(VENV_DIR)

install: $(VENV_DIR)
	$(PIP) install -U pip
	cd backend && ../$(VENV_BIN)/pip install -e .
	cd frontend && npm install

api: $(VENV_DIR)
	cd backend && ../$(VENV_BIN)/uvicorn app.main:app --reload --port 8000

web:
	cd frontend && npm run dev

dev:
	@trap 'kill 0' INT TERM; \
	  ($(MAKE) api 2>&1 | sed -e 's/^/[api] /') & \
	  ($(MAKE) web 2>&1 | sed -e 's/^/[web] /') & \
	  wait

smoke:
	@echo "GET /api/health:"
	@curl -fsS http://localhost:8000/api/health || echo "  ✗ backend not running"
	@echo
	@echo "GET /api/health/db:"
	@curl -fsS http://localhost:8000/api/health/db || echo "  ✗ DB not reachable"
	@echo

clean:
	rm -rf $(VENV_DIR) frontend/node_modules
