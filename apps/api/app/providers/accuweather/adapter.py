from pathlib import Path

import yaml

from app.core.errors import PolicyViolation

BLOCKED_MESSAGE = (
    "API 키가 입력되어 있지만 현재 라이선스에서는 정확도 평가 및 장기 저장이 "
    "비활성화되어 있습니다."
)


def load_separate_license(confirmed: bool, policy_file: Path | None) -> dict[str, object]:
    if not confirmed or policy_file is None or not policy_file.is_file():
        raise PolicyViolation(
            BLOCKED_MESSAGE,
            details={"provider_id": "accuweather", "reason": "separate_license_required"},
        )
    with policy_file.open(encoding="utf-8") as stream:
        payload = yaml.safe_load(stream)
    required = {
        "allow_display",
        "allow_long_term_storage",
        "allow_benchmark",
        "allow_ranking",
        "allow_github_export",
        "max_retention_days",
        "attribution_text",
    }
    missing = required.difference(payload or {})
    if missing:
        raise PolicyViolation(
            BLOCKED_MESSAGE,
            details={"provider_id": "accuweather", "missing_fields": sorted(missing)},
        )
    return dict(payload)

