SHELL := /bin/bash
.DEFAULT_GOAL := help

.PHONY: help setup backend-install frontend-install dev backend-dev frontend-dev stop test lint build auth-hash clean-build

help:
	@echo "Tailor development commands"
	@echo "  make setup         Install backend and frontend dependencies"
	@echo "  make dev           Run FastAPI and Vite together"
	@echo "  make stop          Kill running backend (7860) and frontend (5173) dev processes"
	@echo "  make test          Run backend tests and frontend production build"
	@echo "  make lint          Check Python formatting and lint"
	@echo "  make build         Build the frontend"
	@echo "  make auth-hash     Generate an Argon2id passphrase hash"

setup: backend-install frontend-install

backend-install:
	cd backend && uv sync --extra dev

frontend-install:
	npm install --prefix frontend

dev:
	@trap 'kill 0' INT TERM EXIT; \
	$(MAKE) backend-dev & \
	$(MAKE) frontend-dev & \
	wait

backend-dev:
	cd backend && uv run uvicorn app.main:app --host 127.0.0.1 --port 7860 --reload

frontend-dev:
	npm run dev --prefix frontend -- --host 127.0.0.1

stop:
	@for port in 7860 5173; do \
		pids=$$(lsof -ti tcp:$$port -sTCP:LISTEN); \
		if [ -n "$$pids" ]; then \
			kill $$pids 2>/dev/null || true; \
			sleep 1; \
			remaining=$$(lsof -ti tcp:$$port -sTCP:LISTEN); \
			if [ -n "$$remaining" ]; then kill -9 $$remaining 2>/dev/null || true; fi; \
		fi; \
	done
	@echo "Stopped Tailor backend (7860) and frontend (5173) dev processes"

test:
	cd backend && uv run pytest tests -q
	npm run build --prefix frontend

lint:
	cd backend && uv run ruff check .
	cd backend && uv run ruff format --check .

build:
	npm run build --prefix frontend

auth-hash:
	cd backend && uv run python scripts/hash_passphrase.py

clean-build:
	rm -rf frontend/dist
