from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import UUID

from sqlalchemy.exc import SQLAlchemyError

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps" / "api"))

from app.core.errors import WeatherBenchError  # noqa: E402
from app.core.policy import PolicyAction, PolicyGate  # noqa: E402
from app.core.settings import get_settings  # noqa: E402
from app.providers.met_norway.ingestion import (  # noqa: E402
    MetNorwayForecastIngestionService,
)
from app.storage.database import (  # noqa: E402
    LocationRepository,
    create_session_factory,
    seed_demo_locations,
    upgrade_database,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="정책 검증된 MET Norway compact 응답을 append-only DB에 저장합니다."
    )
    parser.add_argument(
        "--fixture",
        type=Path,
        help="네트워크 호출 없이 수집할 MET Norway compact JSON 파일",
    )
    parser.add_argument(
        "--location-id",
        type=UUID,
        help="응답을 연결할 기존 위치 ID. 생략하면 첫 저장 위치를 사용합니다.",
    )
    parser.add_argument(
        "--database-url",
        help="기본 DATABASE_URL 대신 사용할 SQLAlchemy 데이터베이스 URL",
    )
    parser.add_argument(
        "--fetched-at",
        type=_parse_datetime_argument,
        help="명시적 수신 시각(ISO 8601, timezone 필수). 기본값은 현재 UTC입니다.",
    )
    parser.add_argument(
        "--deprecated",
        action="store_true",
        help="fixture를 HTTP 203 응답으로 표시합니다.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    settings = get_settings()
    if args.fixture is None:
        if settings.demo_mode:
            print(
                "DEMO_MODE: no forecast ingestion performed; pass --fixture to validate "
                "the offline persistence path"
            )
            return 0
        print(
            "Live ingestion is not enabled by this command yet; provide --fixture for the "
            "validated offline ingestion path.",
            file=sys.stderr,
        )
        return 2

    try:
        policy_gate = PolicyGate.from_yaml(settings.provider_policy_path)
        policy_gate.require("met_norway", PolicyAction.NORMALIZED_PERSISTENCE)
        payload = _load_fixture(args.fixture)
        database_url = args.database_url or settings.database_url
        upgrade_database(database_url)
        session_factory = create_session_factory(database_url)
        with session_factory() as session:
            if settings.demo_mode:
                seed_demo_locations(session)
            location_repository = LocationRepository(session)
            if args.location_id is None:
                locations = location_repository.list()
                if not locations:
                    raise ValueError(
                        "저장된 위치가 없습니다. 먼저 위치를 생성하거나 --location-id를 지정하세요."
                    )
                location = locations[0]
            else:
                selected_location = location_repository.get(str(args.location_id))
                if selected_location is None:
                    raise ValueError(f"위치를 찾을 수 없습니다: {args.location_id}")
                location = selected_location

            service = MetNorwayForecastIngestionService(policy_gate, session)
            result = service.ingest_payload(
                payload,
                location=location,
                fetched_at_utc=args.fetched_at or datetime.now(UTC),
                deprecated=args.deprecated,
            )
        print(json.dumps(asdict(result), ensure_ascii=False, sort_keys=True))
        return 0
    except (OSError, ValueError, json.JSONDecodeError, WeatherBenchError, SQLAlchemyError) as exc:
        print(f"forecast ingestion failed: {exc}", file=sys.stderr)
        return 2


def _load_fixture(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as stream:
        payload = json.load(stream)
    if not isinstance(payload, dict):
        raise ValueError("MET Norway fixture root must be a JSON object")
    return payload


def _parse_datetime_argument(value: str) -> datetime:
    normalized = value.strip()
    if normalized.endswith("Z"):
        normalized = f"{normalized[:-1]}+00:00"
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("--fetched-at must be valid ISO 8601") from exc
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise argparse.ArgumentTypeError("--fetched-at must include a timezone")
    return parsed.astimezone(UTC)


if __name__ == "__main__":
    raise SystemExit(main())
