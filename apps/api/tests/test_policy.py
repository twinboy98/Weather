from pathlib import Path

import pytest
from app.core.errors import PolicyViolation
from app.core.policy import PolicyAction, PolicyGate
from app.providers.windy.adapter import assert_windy_operation

ROOT = Path(__file__).resolve().parents[3]


@pytest.fixture
def gate() -> PolicyGate:
    return PolicyGate.from_yaml(ROOT / "config" / "provider_policy.yaml")


def test_policy_document_has_all_required_providers(gate: PolicyGate) -> None:
    provider_ids = {policy.provider_id for policy in gate.all()}
    assert {
        "kma_forecast",
        "kma_observation",
        "kma_nowcast",
        "met_norway",
        "windy_testing",
        "windy_professional",
        "accuweather",
        "rainviewer",
    } <= provider_ids


@pytest.mark.parametrize(
    "action",
    [
        PolicyAction.LIVE_FETCH,
        PolicyAction.DISPLAY,
        PolicyAction.RAW_PERSISTENCE,
        PolicyAction.NORMALIZED_PERSISTENCE,
        PolicyAction.GITHUB_EXPORT,
        PolicyAction.BENCHMARK,
    ],
)
def test_accuweather_is_fail_closed(gate: PolicyGate, action: PolicyAction) -> None:
    with pytest.raises(PolicyViolation):
        gate.require("accuweather", action)


def test_restricted_providers_never_enter_export(gate: PolicyGate) -> None:
    allowed = gate.exportable_provider_ids()
    assert "met_norway" in allowed
    assert "accuweather" not in allowed
    assert "windy_testing" not in allowed
    assert "rainviewer" not in allowed


def test_windy_testing_cannot_be_benchmarked(gate: PolicyGate) -> None:
    with pytest.raises(PolicyViolation) as exc_info:
        assert_windy_operation(gate, "testing", PolicyAction.BENCHMARK)
    assert exc_info.value.details["watermark"] == "테스트용 변형 데이터"

