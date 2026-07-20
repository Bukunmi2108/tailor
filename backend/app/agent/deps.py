from dataclasses import dataclass

from ..events import EventSender
from ..models import JDAnalysis, ResumeData


@dataclass
class AgentDeps:
    resume: ResumeData
    events: EventSender
    analysis: JDAnalysis | None = None
