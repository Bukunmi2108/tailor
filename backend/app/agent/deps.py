from dataclasses import dataclass

from ..models import JDAnalysis, ResumeData


@dataclass
class AgentDeps:
    resume: ResumeData
    analysis: JDAnalysis | None = None
