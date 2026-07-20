from datetime import UTC, datetime, timedelta

import jwt
import pytest
from pydantic_ai.exceptions import UnexpectedModelBehavior
from pydantic_ai.models.fallback import FallbackModel

from app.agent.capabilities import ResumeTools, TailoringTools
from app.agent.factory import build_chat_agent
from app.agent.model_trace import TracedModel
from app.auth import InvalidToken, verify_token
from app.config import Settings
from app.provider import _should_fallback, build_model


def test_model_chain_uses_pydantic_ai_fallback():
    settings = Settings(modelscope_api_token="test-token", fallback_model_enabled=True)
    model = build_model(settings)
    assert isinstance(model, FallbackModel)
    assert all(isinstance(sub, TracedModel) for sub in model.models)


def test_chat_agent_spec_loads_both_capabilities():
    settings = Settings(modelscope_api_token="test-token")
    agent = build_chat_agent(settings)
    assert agent.name == "tailor-chat"
    capabilities = [
        toolset.capability
        for combined in agent.toolsets
        for toolset in getattr(combined, "toolsets", [])
        if hasattr(toolset, "capability")
    ]
    assert any(isinstance(c, ResumeTools) for c in capabilities)
    assert any(isinstance(c, TailoringTools) for c in capabilities)


def test_fallback_triggers_on_malformed_provider_response():
    assert _should_fallback(UnexpectedModelBehavior("Invalid response from provider"))


def test_verify_token_round_trip():
    settings = Settings(auth_signing_secret="test-secret")
    now = datetime.now(UTC)
    token = jwt.encode(
        {"sub": "tailor-owner", "iat": now, "exp": now + timedelta(hours=1), "aud": "tailor-api"},
        settings.auth_signing_secret,
        algorithm="HS256",
    )
    assert verify_token(token, settings) == "tailor-owner"
    with pytest.raises(InvalidToken):
        verify_token("not-a-real-token", settings)
