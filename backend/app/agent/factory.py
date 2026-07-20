from pathlib import Path
from typing import TypeVar

from pydantic import BaseModel
from pydantic_ai import Agent
from pydantic_ai.output import PromptedOutput

from ..config import Settings
from ..provider import build_model
from .capabilities import CUSTOM_CAPABILITY_TYPES
from .deps import AgentDeps

OutputT = TypeVar("OutputT", bound=BaseModel)
SPEC_ROOT = Path(__file__).with_name("specs")


def build_agent(spec_name: str, output_type: type[OutputT], settings: Settings) -> Agent[AgentDeps, OutputT]:
    return Agent.from_file(
        SPEC_ROOT / f"{spec_name}.yaml",
        model=build_model(settings),
        output_type=PromptedOutput(output_type),
        deps_type=AgentDeps,
        custom_capability_types=CUSTOM_CAPABILITY_TYPES,
        tool_timeout=settings.model_timeout_seconds,
    )
