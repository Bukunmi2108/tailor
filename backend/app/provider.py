from __future__ import annotations

from dataclasses import dataclass
from typing import cast

from openai import AsyncOpenAI
from pydantic_ai.exceptions import ModelAPIError, ModelHTTPError
from pydantic_ai.models.fallback import FallbackModel
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.profiles.openai import OpenAIModelProfile
from pydantic_ai.providers.openai import OpenAIProvider

from .config import Settings

MODELSCOPE_PROFILE = cast(
    OpenAIModelProfile,
    {
        "supports_tools": True,
        "supports_thinking": True,
        "openai_chat_thinking_field": "reasoning_content",
        "openai_supports_strict_tool_definition": False,
    },
)
LLAMA_CPP_PROFILE = cast(
    OpenAIModelProfile,
    {
        "supports_tools": True,
        "supports_thinking": True,
        "openai_chat_thinking_field": "reasoning_content",
        "openai_chat_supports_max_completion_tokens": False,
        "openai_supports_strict_tool_definition": False,
    },
)


@dataclass(frozen=True)
class ModelEndpoint:
    model: str
    base_url: str
    api_key: str
    profile: OpenAIModelProfile


class AllModelsFailed(RuntimeError):
    pass


def endpoints(settings: Settings) -> list[ModelEndpoint]:
    configured: list[ModelEndpoint] = []
    if settings.modelscope_api_token:
        configured.extend(
            [
                ModelEndpoint(
                    settings.primary_model_name,
                    settings.modelscope_base_url,
                    settings.modelscope_api_token,
                    MODELSCOPE_PROFILE,
                ),
                ModelEndpoint(
                    settings.secondary_model_name,
                    settings.modelscope_base_url,
                    settings.modelscope_api_token,
                    MODELSCOPE_PROFILE,
                ),
            ]
        )
    if settings.fallback_model_enabled:
        configured.append(
            ModelEndpoint(
                settings.fallback_model_name,
                settings.fallback_model_base_url,
                settings.fallback_model_api_key,
                LLAMA_CPP_PROFILE,
            )
        )
    return configured


def _openai_model(endpoint: ModelEndpoint, settings: Settings) -> OpenAIChatModel:
    return OpenAIChatModel(
        endpoint.model,
        provider=OpenAIProvider(
            openai_client=AsyncOpenAI(
                api_key=endpoint.api_key,
                base_url=endpoint.base_url.rstrip("/") + "/",
                timeout=settings.model_timeout_seconds,
                max_retries=0,
            )
        ),
        profile=endpoint.profile,
    )


def _should_fallback(exc: Exception) -> bool:
    if isinstance(exc, ModelHTTPError):
        body = str(exc.body or "").lower()
        if any(marker in body for marker in ("quota", "rate limit", "too many", "insufficient_quota")):
            return True
        return exc.status_code in {408, 429, 500, 502, 503, 504}
    return isinstance(exc, ModelAPIError)


def build_model(settings: Settings) -> OpenAIChatModel | FallbackModel:
    models = [_openai_model(endpoint, settings) for endpoint in endpoints(settings)]
    if not models:
        raise AllModelsFailed("No model endpoint is configured")
    if len(models) == 1:
        return models[0]
    return FallbackModel(models[0], *models[1:], fallback_on=_should_fallback)
