from __future__ import annotations

from dataclasses import dataclass

from app.core.errors import PolicyViolation
from app.core.policy import PolicyAction, PolicyGate


@dataclass(frozen=True)
class WindyVariant:
    provider_id: str
    provider_variant: str
    model_name: str


SUPPORTED_KOREA_VARIANTS = {
    "gfs": WindyVariant("windy", "gfs", "GFS"),
    "icon": WindyVariant("windy", "icon", "ICON-Global"),
}


def assert_windy_operation(gate: PolicyGate, api_mode: str, action: PolicyAction) -> None:
    policy_id = "windy_testing" if api_mode.lower() == "testing" else "windy_professional"
    try:
        gate.require(policy_id, action)
    except PolicyViolation as exc:
        if api_mode.lower() == "testing" and action in {
            PolicyAction.BENCHMARK,
            PolicyAction.GITHUB_EXPORT,
            PolicyAction.NORMALIZED_PERSISTENCE,
            PolicyAction.RAW_PERSISTENCE,
        }:
            exc.details["watermark"] = "테스트용 변형 데이터"
        raise

