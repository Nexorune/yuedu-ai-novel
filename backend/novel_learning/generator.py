"""章节生成管线：大纲 → 生成 → 审核 → 篇幅校验 → 连贯性校验 → 重写 → 存档。"""
from __future__ import annotations

import logging
import random

from . import config, db, llm, prompts, security
from .models import ENDING_STYLES, StoryBible
from .quiz import validate_learning_questions

LOG = logging.getLogger("novel_learning.generator")


class GenerationError(RuntimeError):
    pass


def _emit(cb, msg: str) -> None:
    """向外部报告进度（可选回调）。"""
    if cb:
        cb(msg)


# ---------------------------------------------------------------------------
# 全书初始化
# ---------------------------------------------------------------------------


def start_book(book_id: int, on_progress=None) -> StoryBible:
    """生成全书大纲 + 暗定结局 + 初始化故事档案。"""
    book = db.get_book(book_id)
    if not book:
        raise GenerationError(f"书不存在：{book_id}")

    security.check_monthly_cost()

    # 结局随机暗定（不向用户透露，存进 books.hidden_ending）
    hidden = random.choice(list(ENDING_STYLES.keys()))

    _emit(on_progress, "正在生成全书大纲（三幕结构）…")
    system, user = prompts.outline_prompt(
        book["genre"], book["topic"], book["planned_chapters"],
        book["min_words"], book["max_words"])
    data = llm.call_json(system, user, max_tokens=config.MAX_TOKENS_OUTLINE, temperature=0.9)
    title = str(data.get("title", "")).strip().strip("《》")
    if not title or title == book["topic"]:
        title = f"{book['topic']}之旅"
    db.set_book_title(book_id, title[:40])
    _emit(on_progress, "故事档案建立中…")

    bible = StoryBible(
        book_id=book_id,
        characters=data.get("characters", []),
        mainline=data.get("mainline", ""),
        foreshadowing=data.get("foreshadowing", []),
        outline=data.get("outline", {}),
    )
    from .story_bible import save
    save(bible)

    with db.get_conn() as conn:
        conn.execute("UPDATE books SET hidden_ending=? WHERE id=?", (hidden, book_id))
    _emit(on_progress, "大纲与档案已完成")
    LOG.info("书 %s 已初始化：结局已暗定（不透露），大纲=%s", book_id, bible.outline)
    return bible


# ---------------------------------------------------------------------------
# 单章生成
# ---------------------------------------------------------------------------


def _review_moderation(content: str) -> tuple[bool, str]:
    """模型自审 + 关键词兜底。返回 (safe, reason)。"""
    ok, reason = security.keyword_moderate(content)
    if not ok:
        return False, reason
    system, user = prompts.moderation_prompt(content)
    result = llm.call_json(system, user, max_tokens=config.MAX_TOKENS_REVIEW, temperature=0.0)
    return bool(result.get("safe", True)), result.get("reason", "")


def _review_continuity(content: str, bible: StoryBible) -> tuple[bool, str]:
    system, user = prompts.continuity_prompt(content, bible)
    result = llm.call_json(system, user, max_tokens=config.MAX_TOKENS_REVIEW, temperature=0.0)
    return bool(result.get("consistent", True)), result.get("issue", "")


def _review_learning_questions(topic: str, knowledge_points: list[dict],
                               questions: list[dict], character_names: list[str] | None = None) -> tuple[bool, str]:
    if not validate_learning_questions(topic, questions, character_names):
        return False, "题目在考小说剧情或虚构设定，请改考学习知识"
    system, user = prompts.learning_questions_review_prompt(topic, knowledge_points, questions, character_names)
    result = llm.call_json(system, user, max_tokens=config.MAX_TOKENS_REVIEW, temperature=0.0)
    if not isinstance(result.get("relevant"), bool):
        return False, "审题结果不合法"
    issues = result.get("issues", [])
    return result["relevant"], "；".join(str(x) for x in issues) if isinstance(issues, list) else "审题未通过"


def _validate_chapter(data: dict, min_words: int, max_words: int) -> list[str]:
    """本地硬校验：篇幅、题量、题结构。返回问题列表（空 = 通过）。"""
    problems: list[str] = []
    content = data.get("content", "")
    if not isinstance(content, str):
        return ["正文必须是字符串"]
    n_words = len(content.replace("\n", "").replace(" ", ""))
    if n_words < min_words:
        problems.append(f"正文字数 {n_words} 少于最少 {min_words} 字，请扩写")
    elif n_words > max_words * 2:
        problems.append(f"正文字数 {n_words} 远超上限 {max_words} 字，请大幅删减")
    # 偏长（上限到 2 倍之间）不再触发重写，直接接受，避免拖慢生成、浪费重试成本
    if "（AI 生成内容）" not in content and "AI 生成内容" not in content:
        problems.append("正文缺少「AI 生成内容」标注")

    kps = data.get("knowledge_points", [])
    if not isinstance(kps, list) or any(not isinstance(kp, dict) for kp in kps):
        return problems + ["知识点必须是数组"]
    if len(kps) != 3:
        problems.append(f"知识点应为 3 个（1 core + 2 aux），实际 {len(kps)} 个")

    return problems


def generate_chapter(book_id: int, chapter_no: int, bible: StoryBible,
                     is_ending: bool = False, ending_style: str | None = None,
                     on_progress=None) -> dict:
    """生成一章，含审核/校验/重写循环。返回存档后的 chapter dict。"""
    book = db.get_book(book_id)
    if not book:
        raise GenerationError(f"书不存在：{book_id}")

    security.check_daily_limit(book_id=book_id)
    security.check_monthly_cost()

    style = ending_style or book["hidden_ending"]
    system, user = prompts.chapter_prompt(
        book["genre"], book["topic"], chapter_no, book["planned_chapters"],
        book["min_words"], book["max_words"], bible, style, is_ending=is_ending)

    last_data = None
    for attempt in range(config.REWRITE_LIMIT + 1):
        _emit(on_progress, f"正在写第 {chapter_no} 章正文（第 {attempt + 1} 次）…")
        try:
            data = llm.call_json(system, user, max_tokens=config.MAX_TOKENS_CHAPTER,
                                 temperature=0.6)
        except Exception as exc:  # noqa: BLE001
            LOG.warning("第 %s 章生成调用失败（第 %d 次）: %s", chapter_no, attempt + 1, exc)
            if "长度上限" in str(exc):
                raise GenerationError(str(exc)) from exc
            user += "\n\n上一版 JSON 格式不合法。请严格使用双引号包住所有字符串；正文换行写成 \\n；paragraph 和 answer 必须是整数；只输出一个完整 JSON 对象。"
            continue

        content = data.get("content") if isinstance(data.get("content"), str) else ""
        _assign_paragraphs(content, data)
        # 1) 内容审核
        _emit(on_progress, "内容安全审核中…")
        safe, reason = _review_moderation(content)
        if not safe:
            LOG.warning("第 %s 章审核不通过（第 %d 次）: %s", chapter_no, attempt + 1, reason)
            user += f"\n\n上一版审核不通过（{reason}），请重写，务必避开违规内容。"
            continue
        # 2) 本地篇幅/题量校验
        _emit(on_progress, "篇幅与题目结构校验中…")
        problems = _validate_chapter(data, book["min_words"], book["max_words"])
        if problems:
            LOG.warning("第 %s 章本地校验不通过（第 %d 次）: %s", chapter_no, attempt + 1, problems)
            user += f"\n\n上一版校验不通过（{problems}），请按硬性要求重写。"
            continue
        # 3) 独立出题（正文与题目分开生成，更可靠）
        _emit(on_progress, "正文完成，正在独立出题…")
        try:
            data["questions"] = _generate_learning_questions(
                book["topic"], data["knowledge_points"],
                [character.get("name", "") for character in bible.characters],
                "适中；只考知识点的概念、理解和现实应用")
        except GenerationError as exc:
            LOG.warning("第 %s 章独立出题失败（第 %d 次）: %s", chapter_no, attempt + 1, exc)
            continue
        _assign_paragraphs(content, data)
        # 4) 连贯性校验（第一章没有前情，跳过）
        if bible.chapter_summaries:
            _emit(on_progress, "与前文连贯性校验中…")
            consistent, issue = _review_continuity(content, bible)
            if not consistent:
                LOG.warning("第 %s 章连贯性不通过（第 %d 次）: %s", chapter_no, attempt + 1, issue)
                user += f"\n\n上一版与人物卡/前情矛盾（{issue}），请修正后重写。"
                continue
        last_data = data
        break

    if last_data is None:
        raise GenerationError(f"第 {chapter_no} 章生成失败：审核/校验 {config.REWRITE_LIMIT} 次重写后仍未通过")

    chapter = {
        "book_id": book_id,
        "chapter_no": chapter_no,
        "title": last_data.get("title", f"第{chapter_no}章"),
        "content": last_data.get("content", ""),
        "knowledge_points": last_data.get("knowledge_points", []),
        "questions": last_data.get("questions", []),
        "status": "locked",
        "is_ending": is_ending,
        "ending_style": ending_style if is_ending else None,
    }
    chapter_id = db.save_chapter(chapter)
    chapter["id"] = chapter_id

    # 更新档案（摘要、知识点）
    chapter["summary"] = last_data.get("summary") or f"第{chapter_no}章《{chapter.get('title')}》"
    from .story_bible import after_chapter
    after_chapter(bible, chapter)

    security.bump_daily_count(book_id)
    _emit(on_progress, "章节已保存")
    LOG.info("第 %s 章《%s》生成成功（%d 字，%d 题）",
             chapter_no, chapter["title"],
             len(chapter["content"].replace("\n", "")), len(chapter["questions"]))
    return chapter


def generate_ending(book_id: int, bible: StoryBible,
                    ending_style: str | None = None, on_progress=None) -> dict:
    """生成大结局章。ending_style 为空则用暗定结局。"""
    book = db.get_book(book_id)
    style = ending_style or book["hidden_ending"]
    if book["status"] == "completed":
        chapter_no = db.get_latest_chapter_no(book_id) + 1
    else:
        # 用户可在任意已读章选择完结。若下一章已提前生成，用结局覆盖尚未解锁的草稿。
        current = db.get_progress(book_id)["current_chapter"]
        chapter_no = current + 1
        bible.chapter_summaries = bible.chapter_summaries[:current]
        bible.learned_knowledge = []
        for no in range(1, current + 1):
            previous = db.get_chapter(book_id, no)
            if previous:
                for point in previous["knowledge_points"]:
                    if point.get("point") and point["point"] not in bible.learned_knowledge:
                        bible.learned_knowledge.append(point["point"])
    chapter = generate_chapter(book_id, chapter_no, bible, is_ending=True,
                               ending_style=style, on_progress=on_progress)
    db.add_ending(book_id, style, chapter["id"])
    db.set_book_status(book_id, "completed")
    return chapter


def regenerate_questions(chapter: dict, difficulty_hint: str) -> list[dict]:
    """失败降级：正文不变，只重出 5 道题（可降难度）。返回新题列表。"""
    topic = db.get_book(chapter["book_id"])["topic"]
    from .story_bible import load_or_create
    character_names = [c.get("name", "") for c in load_or_create(chapter["book_id"]).characters]
    qs = _generate_learning_questions(topic, chapter["knowledge_points"], character_names, difficulty_hint)
    db.replace_questions(chapter["book_id"], chapter["chapter_no"], qs)
    chapter["questions"] = qs
    return qs


def _generate_learning_questions(topic: str, knowledge_points: list[dict],
                                 character_names: list[str], difficulty_hint: str) -> list[dict]:
    system, user = prompts.questions_regenerate_prompt(topic, knowledge_points, difficulty_hint)
    qs = []
    problems = []
    for _attempt in range(config.REWRITE_LIMIT + 1):
        try:
            data = llm.call_json(system, user, max_tokens=config.MAX_TOKENS_CHAPTER // 2,
                                 temperature=0.3)
        except (RuntimeError, ValueError) as exc:
            LOG.warning("换题调用或解析失败（第 %d 次）：%s", _attempt + 1, exc)
            problems = ["模型输出未能解析为题目 JSON"]
            user += "\n上一版不是有效 JSON。请只输出完整合法的 JSON，不要省略字段。"
            continue
        qs = data.get("questions", [])
        _normalize_answer_indices(qs)
        problems = _validate_questions(qs)
        if not problems:
            relevant, issue = _review_learning_questions(topic, knowledge_points, qs, character_names)
            if not relevant:
                problems.append(issue or "测验偏离学习主题")
        if not problems:
            break
        LOG.warning("换题生成不合法：%s", problems)
        user += f"\n上一版测验不合格（{problems}）。请重出与学习知识有关的题目。"
    if problems:
        raise GenerationError(f"换题失败：{problems}")
    shuffle_options(qs)
    return qs


def shuffle_options(questions: list[dict], rng: random.Random | None = None) -> None:
    """打乱选项顺序并同步正确答案位置。

    模型习惯把正确答案放在固定位置（实测大多是 A 或 B），不打乱的话闭眼选同一个字母就能过关。
    """
    rng = rng or random.SystemRandom()
    for question in questions:
        options = question.get("options")
        answer = question.get("answer")
        if not isinstance(options, list) or type(answer) is not int or not 0 <= answer < len(options):
            continue
        order = list(range(len(options)))
        rng.shuffle(order)
        question["options"] = [options[i] for i in order]
        question["answer"] = order.index(answer)


def _validate_questions(qs: list[dict]) -> list[str]:
    """校验换题结果（与章节题同标准）。"""
    problems: list[str] = []
    if not isinstance(qs, list):
        return ["题目必须是数组"]
    if len(qs) != config.QUESTIONS_PER_CHAPTER:
        problems.append(f"题目应为 {config.QUESTIONS_PER_CHAPTER} 道，实际 {len(qs)} 道")
    for q in qs:
        if not isinstance(q, dict):
            problems.append("题目必须是对象")
            continue
        label = str(q.get("question") or "")[:20]
        opts = q.get("options", [])
        ans = q.get("answer")
        if not isinstance(q.get("question"), str) or not q["question"].strip():
            problems.append("题干不能为空")
        if not isinstance(opts, list) or len(opts) != 4 or any(not isinstance(o, str) for o in opts):
            problems.append(f"题「{label}」选项不是 4 个")
            continue
        if type(ans) is not int or ans < 0 or ans >= len(opts):
            problems.append(f"题「{label}」answer 越界")
        if type(q.get("source_paragraph")) is not int or q["source_paragraph"] < 1:
            problems.append(f"题「{label}」缺 source_paragraph")
    return problems


def _normalize_answer_indices(questions: list[dict]) -> None:
    """兼容模型偶尔输出的 A/B/C/D，落库仍统一用 0–3。"""
    if not isinstance(questions, list):
        return
    for question in questions:
        if not isinstance(question, dict):
            continue
        answer = question.get("answer")
        if isinstance(answer, str) and answer.strip().upper() in "ABCD" and len(answer.strip()) == 1:
            question["answer"] = "ABCD".index(answer.strip().upper())
        paragraph = question.get("source_paragraph")
        if isinstance(paragraph, str) and paragraph.isdecimal():
            question["source_paragraph"] = int(paragraph)
        # 讲解是加分项：缺失或格式不对就去掉，不因此判整套题不合格
        explanation = question.get("explanation")
        if isinstance(explanation, str) and explanation.strip():
            question["explanation"] = explanation.strip()[:120]
        else:
            question.pop("explanation", None)


def _assign_paragraphs(content: str, data: dict) -> None:
    """段落定位由代码确定性完成，不依赖模型数段号。

    正文通常含「第N段」标记；按标记数求总段数，再把知识点与题目
    均匀散布到各段，保证「回看第 X 段」提示指向大致正确的区域。
    """
    import re as _re
    markers = [int(x) for x in _re.findall(r"第\s*(\d+)\s*段", content)]
    total = max(markers) if markers else max(1, len([p for p in content.split("\n") if p.strip()]))
    kps = data.get("knowledge_points") or []
    for i, kp in enumerate(kps):
        if isinstance(kp, dict):
            kp["paragraph"] = max(1, min(total, total * (i + 1) // 4))
    qs = data.get("questions") or []
    n = max(1, len(qs))
    for i, q in enumerate(qs):
        if isinstance(q, dict):
            q["source_paragraph"] = max(1, min(total, total * (i + 1) // (n + 1)))
