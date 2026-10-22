"""故事档案的创建与随章更新。"""
from __future__ import annotations

import logging

from . import db
from .models import StoryBible

LOG = logging.getLogger("novel_learning.story_bible")


def load_or_create(book_id: int) -> StoryBible:
    raw = db.get_bible(book_id)
    if raw:
        bible = StoryBible(
            book_id=book_id,
            characters=__import__("json").loads(raw["characters"]),
            mainline=raw["mainline"],
            chapter_summaries=__import__("json").loads(raw["chapter_summaries"]),
            foreshadowing=__import__("json").loads(raw["foreshadowing"]),
            learned_knowledge=__import__("json").loads(raw["learned_knowledge"]),
            outline=__import__("json").loads(raw["outline"]),
        )
        return bible
    return StoryBible(book_id=book_id)


def init_from_outline(book_id: int, outline_data: dict) -> StoryBible:
    """用大纲生成结果初始化故事档案。"""
    bible = StoryBible(
        book_id=book_id,
        characters=outline_data.get("characters", []),
        mainline=outline_data.get("mainline", ""),
        foreshadowing=outline_data.get("foreshadowing", []),
        outline=outline_data.get("outline", {}),
    )
    save(bible)
    return bible


def save(bible: StoryBible) -> None:
    db.save_bible(bible.book_id, bible.to_dict())


def after_chapter(bible: StoryBible, chapter: dict) -> StoryBible:
    """生成一章后更新档案：摘要、知识点、伏笔状态。"""
    import json
    title = chapter.get("title", "")
    summary = chapter.get("summary", f"第{chapter.get('chapter_no')}章《{title}》")
    bible.chapter_summaries.append(summary)

    # 记录已学知识点（避免后续重复出题）
    for kp in chapter.get("knowledge_points", []):
        if kp.get("point") and kp["point"] not in bible.learned_knowledge:
            bible.learned_knowledge.append(kp["point"])

    save(bible)
    return bible
