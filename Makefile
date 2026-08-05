.PHONY: dev api web worker test lint migrate policy

dev:
	docker compose up --build

api:
	PYTHONPATH=apps/api uvicorn app.main:app --reload --port 8000

web:
	pnpm --dir apps/web dev

worker:
	PYTHONPATH=apps/api python -m app.scheduler.worker

test:
	pytest -q
	pnpm --dir apps/web test

lint:
	ruff check apps/api scripts
	mypy apps/api/app
	pnpm --dir apps/web exec tsc --noEmit

migrate:
	alembic -c apps/api/alembic.ini upgrade head

policy:
	python scripts/validate_provider_policy.py

