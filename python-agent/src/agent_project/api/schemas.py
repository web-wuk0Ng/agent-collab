"""接口层数据模型（入参统一接受 Node 端的 camelCase 字段）。"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class ApiModel(BaseModel):
    """统一基类：接受驼峰与下划线两种写法，忽略多余字段。"""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        extra="ignore",
        str_strip_whitespace=True,
    )


class QuestionIn(ApiModel):
    """一道面试题（题库原文或 JD 定制题）。"""

    id: str = ""
    type: str = "tech"
    stage: str = ""
    text: str = ""
    keywords: list[str] = []
    points: list[str] = []


class RoundIn(ApiModel):
    """一轮问答记录。"""

    question: QuestionIn = QuestionIn()
    answer: str = ""
    metrics: dict | None = None
    follow_ups: list[dict] = []


class GreetingIn(ApiModel):
    position: str
    question: QuestionIn
    rounds: int = 6


class FollowUpIn(ApiModel):
    position: str
    question: QuestionIn
    answer: str = ""
    metrics: dict | None = None


class NextIn(ApiModel):
    position: str
    question: QuestionIn
    answer: str = ""
    metrics: dict | None = None
    follow_count: int = 0
    next_question: QuestionIn | None = None


class ReportIn(ApiModel):
    position: str
    rounds: list[RoundIn] = []
    video_metrics: dict | None = None


class JdIn(ApiModel):
    position: str
    jd: str


class KnowledgeSearchIn(ApiModel):
    position: str
    query: str
    k: int = 4


class ChatIn(ApiModel):
    message: str
    position: str = ""
