from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

REPOSITORY_ROOT = Path(__file__).resolve().parents[4]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=REPOSITORY_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "WeatherBench Korea"
    app_version: str = "0.1.0"
    demo_mode: bool = True
    database_url: str = f"sqlite:///{(REPOSITORY_ROOT / 'weatherbench.db').as_posix()}"
    admin_token: str = "change-me-for-local-admin"
    cors_origins: list[str] = Field(
        default_factory=lambda: ["http://localhost:3000", "http://127.0.0.1:3000"]
    )

    met_norway_user_agent: str = (
        "WeatherBenchKorea/0.1 https://github.com/example/weatherbench-korea"
    )
    kma_service_key: str | None = None
    kma_apihub_key: str | None = None
    windy_api_key: str | None = None
    windy_api_mode: str = "testing"
    windy_professional_license_confirmed: bool = False
    accuweather_api_key: str | None = None
    accuweather_separate_license_confirmed: bool = False
    accuweather_policy_file: Path | None = None

    provider_policy_path: Path = REPOSITORY_ROOT / "config" / "provider_policy.yaml"
    nowcast_config_path: Path = REPOSITORY_ROOT / "config" / "nowcast.yaml"
    scoring_config_path: Path = REPOSITORY_ROOT / "config" / "scoring.yaml"


@lru_cache
def get_settings() -> Settings:
    return Settings()

