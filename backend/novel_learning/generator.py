"""章节生成管线：大纲 → 生成 → 审核 → 篇幅校验 → 连贯性校验 → 重写 → 存档。"""
from __future__ import annotations

import logging
import random
import re

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
                               questions: list[dict], character_names: list[str] | None = None,
                               content: str = "") -> tuple[bool, str]:
    if not validate_learning_questions(topic, questions, character_names):
        return False, "题目里出现了「第几段」这类纯位置题，请改问内容本身"
    system, user = prompts.learning_questions_review_prompt(
        topic, knowledge_points, questions, character_names, content)
    try:
        result = llm.call_json(system, user, max_tokens=config.MAX_TOKENS_REVIEW, temperature=0.0,
                               model=config.QUESTIONS_MODEL_ID)
    except (RuntimeError, ValueError) as exc:
        # 审题本身失败不该毁掉整章：接地校验才是硬门槛，这里退化成放行并记日志
        LOG.warning("审题调用失败，跳过语义复审：%s", exc)
        return True, ""
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
        # 标注缺失属于格式小问题，补上即可；不值得为它整章重写（重写一次几十秒）
        if content and "AI 生成内容" not in content:
            content = "（AI 生成内容）\n" + content
            data["content"] = content
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
        # 3) 独立出题（正文与题目分开生成，题目必须落到正文原句上）
        _emit(on_progress, "正文完成，正在独立出题…")
        try:
            data["questions"] = _generate_learning_questions(
                book["topic"], data["knowledge_points"],
                [character.get("name", "") for character in bible.characters],
                "适中；必须贴着本章正文出，读完这一章就能答",
                content)
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
    grounded = sum(1 for q in chapter["questions"] if q.get("grounded"))
    total_q = len(chapter["questions"]) or 1
    _emit(on_progress, f"章节已保存（题目接地 {grounded}/{total_q}）")
    LOG.info("第 %s 章《%s》生成成功（%d 字，%d 题，接地率 %d/%d）",
             chapter_no, chapter["title"],
             len(chapter["content"].replace("\n", "")), len(chapter["questions"]),
             grounded, total_q)
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
    qs = _generate_learning_questions(topic, chapter["knowledge_points"], character_names,
                                      difficulty_hint, chapter.get("content", ""))
    db.replace_questions(chapter["book_id"], chapter["chapter_no"], qs)
    chapter["questions"] = qs
    return qs


def _generate_learning_questions(topic: str, knowledge_points: list[dict],
                                 character_names: list[str], difficulty_hint: str,
                                 content: str = "") -> list[dict]:
    """出题 + 接地校验：每题必须交一句能在正文里逐字搜到的原话。

    重试原则：只有结构完整（5 题、4 选项、answer 合法）的结果才留着备用。
    后面某次重试崩了，也不能把前面已经拿到的好结果一起扔掉。
    """
    system, user = prompts.questions_regenerate_prompt(topic, knowledge_points, difficulty_hint, content)
    qs: list[dict] = []
    problems: list[str] = []
    best: list[dict] | None = None
    best_problems: list[str] = []
    best_score = (-1, -1)
    for _attempt in range(config.REWRITE_LIMIT + 1):
        try:
            data = llm.call_json(system, user, max_tokens=config.MAX_TOKENS_QUESTIONS,
                                 temperature=0.3, model=config.QUESTIONS_MODEL_ID)
        except (RuntimeError, ValueError) as exc:
            LOG.warning("出题调用或解析失败（第 %d 次）：%s", _attempt + 1, exc)
            problems = ["模型输出未能解析为题目 JSON"]
            user += "\n上一版不是有效 JSON。请只输出完整合法的 JSON，不要省略字段，也不要写任何解释。"
            continue
        qs = data.get("questions", [])
        _normalize_answer_indices(qs)
        problems = _validate_questions(qs)
        if problems:
            LOG.warning("出题结构不合格（第 %d 次）：%s", _attempt + 1, problems)
            user += f"\n上一版测验结构不合格（{problems}）。请逐条修正后重出。"
            continue
        problems = _check_grounding(content, qs)
        if not problems:
            problems = _check_answerable(content, qs, knowledge_points)
        if not problems:
            relevant, issue = _review_learning_questions(
                topic, knowledge_points, qs, character_names, content)
            if not relevant:
                problems.append(issue or "测验与本章正文对不上")
        grounded = sum(1 for q in qs if q.get("grounded"))
        answerable = sum(1 for q in qs if q.get("answerable") is True)
        if (grounded, answerable) > best_score:
            best, best_problems, best_score = qs, list(problems), (grounded, answerable)
        if not problems:
            break
        LOG.warning("出题不合格（第 %d 次）：%s", _attempt + 1, problems)
        user += f"\n上一版测验不合格（{problems}）。请逐条修正后重出。"
    if problems:
        if best is None:
            raise GenerationError(f"出题失败：{problems}")
        # 结构没问题、只是这次没达标：保住已有结果如实交付，不卡住用户
        LOG.warning("重出未达标，按已有结果交付（接地 %d/%d，可答 %d/%d）：%s",
                    best_score[0], len(best), best_score[1], len(best), best_problems)
        qs = best
    else:
        LOG.info("出题达标：接地 %d/%d，可答 %d/%d", best_score[0], len(qs), best_score[1], len(qs))
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
    """校验题目结构（接地与否由 _check_grounding 单独负责）。"""
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
        if not isinstance(q.get("evidence"), str) or not q["evidence"].strip():
            problems.append(f"题「{label}」缺 evidence（必须从正文逐字复制的原句）")
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
        # 讲解与出处是加分项：格式不对就清理，不因此判整套题不合格
        explanation = question.get("explanation")
        if isinstance(explanation, str) and explanation.strip():
            question["explanation"] = explanation.strip()[:120]
        else:
            question.pop("explanation", None)
        evidence = question.get("evidence")
        if isinstance(evidence, str) and evidence.strip():
            question["evidence"] = evidence.strip().strip("「」\"'“”")
        else:
            question.pop("evidence", None)


# 接地校验：原句必须能在正文里逐字找到，且落在一段之内（防止模型拼接两句）
_STRIP_CHARS = re.compile(r"[\s\u3000，。、；：！？…—－·“”‘’（）《》〈〉「」『』,.;:!?\"'()\[\]<>/\\|*#]+")
_WATERMARK = re.compile(r"^[（(]\s*AI\s*生成内容\s*[）)]$")
_PARA_PREFIX = re.compile(r"^第\s*\d+\s*段\s*[:：]?\s*")
MIN_EVIDENCE_CHARS = 10


def _norm_text(text: str) -> str:
    return _STRIP_CHARS.sub("", text or "")


def _paragraphs(content: str) -> list[str]:
    """切成读者眼里的段落：跳过「（AI 生成内容）」水印行，剥掉「第N段：」前缀。"""
    result: list[str] = []
    for raw in content.split("\n"):
        line = raw.strip()
        if not line or _WATERMARK.match(line):
            continue
        line = _PARA_PREFIX.sub("", line).strip()
        if line:
            result.append(line)
    return result


def _locate_quote(content: str, quote: str) -> int | None:
    """把一句原话定位到正文第几段；找不到返回 None。

    忽略空白与标点差异；允许跨越相邻两段（对话常被拆成多行），
    此时返回这句话开始的那一段。
    """
    target = _norm_text(quote)
    if len(target) < MIN_EVIDENCE_CHARS:
        return None
    paragraphs = _paragraphs(content)
    if not paragraphs:
        return None
    flat = ""
    starts: list[int] = []
    for paragraph in paragraphs:
        starts.append(len(flat))
        flat += _norm_text(paragraph)
    position = flat.find(target)
    if position < 0:
        return None
    index = 0
    for i, start in enumerate(starts):
        if start <= position:
            index = i
        else:
            break
    return index + 1


def _check_grounding(content: str, questions: list[dict]) -> list[str]:
    """逐题核对 evidence 是否真在正文里，并把真实段号写回 source_paragraph。"""
    problems: list[str] = []
    if not content.strip():
        return ["正文为空，无法核对题目依据"]
    for number, question in enumerate(questions, 1):
        label = str(question.get("question") or "")[:14]
        paragraph = _locate_quote(content, question.get("evidence") or "")
        if paragraph is None:
            question["grounded"] = False
            question["source_paragraph"] = None
            problems.append(
                f"第{number}题「{label}」的 evidence 在正文里搜不到，必须一字不改地复制正文原句（12–50 字，不能拼接两段）")
        else:
            question["grounded"] = True
            question["source_paragraph"] = paragraph
    return problems


def _check_answerable(content: str, questions: list[dict],
                     knowledge_points: list[dict] | None = None) -> list[str]:
    """盲读校验：给依据所在段落 + 本章知识点，判断能否唯一确定正确选项。

    接地只证明「这句话在正文里」，证明不了「这句话能推出这个答案」。
    「他脸色白了一瞬」推不出「他意识到对方掌握了更深层的方法」，
    这类过度推断必须在这里拦下来，否则读原文也答不出。

    知识点定义要一起给：考「这段行为体现什么概念」时，概念定义在另一段，
    只给依据段会把正常的概念应用题误判成「推不出来」。
    """
    paragraphs = _paragraphs(content)
    lessons = [f"[{kp.get('role')}] {kp.get('point')}" for kp in (knowledge_points or [])
               if isinstance(kp, dict) and kp.get("point")]
    items = []
    for number, question in enumerate(questions, 1):
        paragraph_no = question.get("source_paragraph")
        premise = ""
        if isinstance(paragraph_no, int) and 1 <= paragraph_no <= len(paragraphs):
            premise = paragraphs[paragraph_no - 1]
        items.append({
            "index": number,
            "question": question.get("question", ""),
            "options": question.get("options", []),
            "answer": question.get("answer"),
            "evidence": question.get("evidence", ""),
            "premise": premise,
            "lessons": lessons,
        })
    system, user = prompts.answerable_review_prompt(items)
    try:
        result = llm.call_json(system, user, max_tokens=config.MAX_TOKENS_REVIEW,
                               temperature=0.0, model=config.QUESTIONS_MODEL_ID)
    except (RuntimeError, ValueError) as exc:
        # 校验本身失败不拦用户：按「未判定」放行，并留日志便于发现
        LOG.warning("可答性校验调用失败，本轮不拦：%s", exc)
        return []
    verdicts = result.get("results")
    if not isinstance(verdicts, list):
        LOG.warning("可答性校验返回格式不对：%s", str(result)[:120])
        return []
    judged: dict[int, dict] = {}
    for item in verdicts:
        if not isinstance(item, dict):
            continue
        try:
            judged[int(item.get("index"))] = item
        except (TypeError, ValueError):
            continue
    problems: list[str] = []
    for number, question in enumerate(questions, 1):
        verdict = judged.get(number)
        if verdict is None:
            question["answerable"] = None      # 没判定：不当作不合格，避免误杀
            continue
        ok = verdict.get("answerable") is True
        question["answerable"] = ok
        if not ok:
            reason = str(verdict.get("reason") or "仅凭原文这一段无法确定答案").strip()[:40]
            label = str(question.get("question") or "")[:12]
            problems.append(
                f"第{number}题「{label}」答案推不出来（{reason}）：请改成原文明确写出答案的题，"
                f"evidence 用直接写着答案的那句")
    return problems


def _assign_paragraphs(content: str, data: dict) -> None:
    """知识点段落位置：按 quote 在正文里反查真实段号，不再平均分配。"""
    for kp in data.get("knowledge_points") or []:
        if not isinstance(kp, dict):
            continue
        paragraph = _locate_quote(content, kp.get("quote") or "")
        kp["paragraph"] = paragraph or 1
