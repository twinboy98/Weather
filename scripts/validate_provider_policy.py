from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps" / "api"))

from app.core.errors import PolicyViolation  # noqa: E402
from app.core.policy import PolicyAction, PolicyGate  # noqa: E402


def main() -> int:
    gate = PolicyGate.from_yaml(ROOT / "config" / "provider_policy.yaml")
    forbidden = {"accuweather", "windy_testing"}
    if forbidden.intersection(gate.exportable_provider_ids()):
        raise RuntimeError("restricted provider unexpectedly allowed in GitHub export")
    for provider_id in forbidden:
        for action in (PolicyAction.BENCHMARK, PolicyAction.GITHUB_EXPORT):
            try:
                gate.require(provider_id, action)
            except PolicyViolation:
                pass
            else:
                raise RuntimeError(f"{provider_id} unexpectedly allowed for {action.value}")
    print(f"provider policy {gate.version}: valid ({len(gate.all())} entries)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

