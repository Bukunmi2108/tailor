from pydantic_ai.models.fallback import FallbackModel

from app.agent.factory import build_agent
from app.config import Settings
from app.models import JDAnalysis
from app.provider import build_model


def test_model_chain_uses_pydantic_ai_fallback():
    settings = Settings(modelscope_api_token="test-token", fallback_model_enabled=True)
    assert isinstance(build_model(settings), FallbackModel)


def test_yaml_agent_spec_loads_resume_capability():
    settings = Settings(modelscope_api_token="test-token")
    agent = build_agent("analyze", JDAnalysis, settings)
    assert agent.name == "tailor-analyze"
