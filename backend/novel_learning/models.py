"""核心数据结构。"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Any

# 结局风格（暗定，不向用户透露）
ENDING_STYLES = {
    "happy": "圆满结局（主角逆袭成功，Happy Ending）",
    "twist": "反转结局（最后来个大转折）",
    "open": "开放结局（留白，让读者自己想象）",
    "tragedy": "悲剧结局（BE，遗憾收场）",
}

GENRES = ["爽文", "言情", "都市", "玄幻", "悬疑"]


@dataclass
class Question:
    """一道测验题。"""
    type: str                  # memory | understanding | transfer | locate
    question: str
    options: list[str]         # 4 个选项
    answer: int                # 正确选项下标
    source_paragraph: int      # 答案对应的段落（答错时用于提示「回看第 X 段」）
    difficulty: str = "medium"  # easy | medium | hard
    status: str = "active"      # active | challenged（争议作废）

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> "Question":
        return cls(**{k: data.get(k) for k in
                      ("type", "question", "options", "answer",
                       "source_paragraph", "difficulty", "status")})


@dataclass
class Chapter:
    """一章：正文 + 知识点 + 题目。"""
    id: int | None = None
    book_id: int = 0
    chapter_no: int = 0
    title: str = ""
    content: str = ""
    knowledge_points: list[dict] = field(default_factory=list)
    questions: list[dict] = field(default_factory=list)
    status: str = "locked"     # locked | unlocked
    is_ending: bool = False
    ending_style: str | None = None
    created_at: str = ""


@dataclass
class StoryBible:
    """故事档案：跨章节连贯性的唯一依据。"""
    book_id: int = 0
    characters: list[dict] = field(default_factory=list)       # [{name, identity, personality, status, relationships}]
    mainline: str = ""                                          # 主线设定
    chapter_summaries: list[str] = field(default_factory=list)  # 每章一句话
    foreshadowing: list[dict] = field(default_factory=list)     # [{desc, status: open|resolved}]
    learned_knowledge: list[str] = field(default_factory=list)  # 已学知识点
    outline: dict = field(default_factory=dict)                 # 全书大纲（三幕结构）

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> "StoryBible":
        return cls(**{k: data.get(k, v) for k, v in
                      (("book_id", 0), ("characters", []), ("mainline", ""),
                       ("chapter_summaries", []), ("foreshadowing", []),
                       ("learned_knowledge", []), ("outline", {}))})

    def add_summary(self, summary: str) -> None:
        self.chapter_summaries.append(summary)
