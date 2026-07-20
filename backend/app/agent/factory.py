from pathlib import Path

from pydantic_ai import Agent

from ..config import Settings
from ..provider import build_model
from .capabilities import CUSTOM_CAPABILITY_TYPES
from .deps import AgentDeps

SPEC_ROOT = Path(__file__).with_name("specs")
CHAT_SPEC_PATH = SPEC_ROOT / "chat.yaml"


def build_chat_agent(settings: Settings) -> Agent[AgentDeps, str]:
    return Agent.from_file(
        CHAT_SPEC_PATH,
        model=build_model(settings),
        deps_type=AgentDeps,
        custom_capability_types=CUSTOM_CAPABILITY_TYPES,
        tool_timeout=settings.model_timeout_seconds,
    )
