from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_ROOT = Path(__file__).resolve().parents[1]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BACKEND_ROOT / ".env", extra="ignore")

    app_env: str = "local"
    app_name: str = "Tailor"
    allowed_origins: str = "http://localhost:5173"
    tailor_password_hash: str = ""
    auth_signing_secret: str = ""
    auth_token_ttl_hours: int = Field(default=10, ge=1, le=72)
    modelscope_api_token: str = ""
    modelscope_base_url: str = "https://api-inference.modelscope.ai/v1"
    primary_model_name: str = "Qwen/Qwen3.5-397B-A17B"
    secondary_model_name: str = "Qwen/Qwen3.5-35B-A3B"
    fallback_model_enabled: bool = True
    fallback_model_base_url: str = "https://bukunmi2108-aristotle-model.hf.space/v1"
    fallback_model_name: str = "NVIDIA-Nemotron3-Nano-4B-Q4_K_M.gguf"
    fallback_model_api_key: str = "not-needed"
    model_timeout_seconds: float = 90
    model_temperature: float = 0.15
    canon_path: Path = BACKEND_ROOT / "canon" / "resume.yaml"
    template_root: Path = BACKEND_ROOT / "render" / "templates"

    @property
    def origins(self) -> list[str]:
        return [origin.strip() for origin in self.allowed_origins.split(",") if origin.strip()]

    @property
    def configured(self) -> bool:
        return bool(self.tailor_password_hash and self.auth_signing_secret)


@lru_cache
def get_settings() -> Settings:
    return Settings()
