from __future__ import annotations

import os
from enum import StrEnum
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, ConfigDict, Field, HttpUrl, field_validator

from app.core.errors import PolicyViolation


class PolicyAction(StrEnum):
    LIVE_FETCH = "live_fetch"
    DISPLAY = "display"
    RAW_PERSISTENCE = "raw_persistence"
    NORMALIZED_PERSISTENCE = "normalized_persistence"
    GITHUB_EXPORT = "github_export"
    BENCHMARK = "benchmark"


ACTION_FIELDS: dict[PolicyAction, str] = {
    PolicyAction.LIVE_FETCH: "allow_live_fetch",
    PolicyAction.DISPLAY: "allow_display",
    PolicyAction.RAW_PERSISTENCE: "allow_raw_persistence",
    PolicyAction.NORMALIZED_PERSISTENCE: "allow_normalized_persistence",
    PolicyAction.GITHUB_EXPORT: "allow_github_export",
    PolicyAction.BENCHMARK: "allow_benchmark",
}


class ProviderPolicy(BaseModel):
    model_config = ConfigDict(frozen=True)

    provider_id: str
    allow_live_fetch: bool
    allow_display: bool
    allow_raw_persistence: bool
    allow_normalized_persistence: bool
    allow_github_export: bool
    allow_benchmark: bool
    max_retention_days: int = Field(ge=0)
    attribution_required: bool
    attribution_text: str
    license_confirmation_env: str
    policy_checked_at: str
    policy_source_url: HttpUrl
    notes: str

    @field_validator("attribution_text")
    @classmethod
    def attribution_must_exist_if_required(cls, value: str, info: Any) -> str:
        if info.data.get("attribution_required") and not value.strip():
            raise ValueError("attribution_text is required")
        return value


class ProviderPolicyDocument(BaseModel):
    version: str
    providers: list[ProviderPolicy]


class PolicyGate:
    """Fail-closed enforcement before fetch, display, persistence, scoring, or export."""

    def __init__(self, document: ProviderPolicyDocument) -> None:
        self.version = document.version
        self._policies = {policy.provider_id: policy for policy in document.providers}
        if len(self._policies) != len(document.providers):
            raise ValueError("provider_policy.yaml contains duplicate provider_id values")

    @classmethod
    def from_yaml(cls, path: str | Path) -> PolicyGate:
        with Path(path).open(encoding="utf-8") as stream:
            payload = yaml.safe_load(stream)
        return cls(ProviderPolicyDocument.model_validate(payload))

    def get(self, provider_id: str) -> ProviderPolicy:
        try:
            return self._policies[provider_id]
        except KeyError as exc:
            raise PolicyViolation(
                f"등록되지 않은 공급자 정책입니다: {provider_id}",
                details={"provider_id": provider_id, "reason": "missing_policy"},
            ) from exc

    def all(self) -> list[ProviderPolicy]:
        return list(self._policies.values())

    def require(self, provider_id: str, action: PolicyAction) -> ProviderPolicy:
        policy = self.get(provider_id)
        allow_field = ACTION_FIELDS[action]
        if not getattr(policy, allow_field):
            raise PolicyViolation(
                f"{provider_id} 정책에서 {action.value} 작업이 허용되지 않습니다.",
                details={
                    "provider_id": provider_id,
                    "action": action.value,
                    "policy_version": self.version,
                    "policy_source_url": str(policy.policy_source_url),
                },
            )

        confirmation_env = policy.license_confirmation_env
        if confirmation_env and os.getenv(confirmation_env, "").lower() != "true":
            raise PolicyViolation(
                f"{provider_id} 라이선스 확인 환경변수가 활성화되지 않았습니다.",
                details={
                    "provider_id": provider_id,
                    "action": action.value,
                    "required_env": confirmation_env,
                },
            )
        return policy

    def exportable_provider_ids(self) -> set[str]:
        result: set[str] = set()
        for provider_id in self._policies:
            try:
                self.require(provider_id, PolicyAction.GITHUB_EXPORT)
            except PolicyViolation:
                continue
            result.add(provider_id)
        return result

