from __future__ import annotations

import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[3]
os.environ["DATABASE_URL"] = f"sqlite:///{(ROOT / 'test_weatherbench.db').as_posix()}"
os.environ["DEMO_MODE"] = "true"
os.environ["ADMIN_TOKEN"] = "test-admin-token"

from app.main import app  # noqa: E402


@pytest.fixture
def client() -> TestClient:
    with TestClient(app) as test_client:
        yield test_client

