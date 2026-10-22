"""用户反馈：题目必须能在正文里找到答案——原句逐字核对 + 真实段号回填。"""

from novel_learning import db, generator
from novel_learning.models import StoryBible
from novel_learning.quiz import validate_learning_questions

CONTENT = (
    "（AI 生成内容）\n"
    "复利是把利息也当本金的算法。" + "他一遍遍算着账。" * 70 + "\n"
    "单利只按最初本金算利息。" + "她在本子上画了两条线。" * 70 + "\n"
    "时间越长期数越多差距越大。" + "窗外的灯一盏盏灭了。" * 70
)

GOOD_QUOTE = "单利只按最初本金算利息。"
UNGROUNDED_QUOTE = "复利就是利滚利越滚越多"


def _question(evidence: str, stem: str = "这段文字说明了什么？") -> dict:
    return {"type": "understanding", "question": stem,
            "options": ["选项甲", "选项乙", "选项丙", "选项丁"],
            "answer": 0, "evidence": evidence, "explanation": "讲解"}


# ---------------------------------------------------------------------------
# 审核函数：只拦纯位置题，不再禁止人物与剧情
# ---------------------------------------------------------------------------


def test_rejects_pure_location_question():
    assert not validate_learning_questions("复利", [_question(GOOD_QUOTE, "这个说法在第几段？")])


def test_accepts_question_that_mentions_character():
    """题目出现人物是本产品的正常要求：考的就是这一章读懂了没有。"""
    assert validate_learning_questions("复利", [_question(GOOD_QUOTE, "老周为什么坚持每月存五百？")])


# ---------------------------------------------------------------------------
# 接地校验：原句要能在正文里逐字搜到，并回填真实段号
# ---------------------------------------------------------------------------


def test_grounding_fills_real_paragraph_number():
    questions = [_question(GOOD_QUOTE)]
    assert generator._check_grounding(CONTENT, questions) == []
    assert questions[0]["grounded"] is True
    # 第 1 段是复利，第 2 段才是单利这条原句
    assert questions[0]["source_paragraph"] == 2


def test_grounding_ignores_watermark_line_when_counting():
    """「（AI 生成内容）」不算一段，否则读者数出来的段号会差一位。"""
    questions = [_question("复利是把利息也当本金的算法。")]
    assert generator._check_grounding(CONTENT, questions) == []
    assert questions[0]["source_paragraph"] == 1


def test_grounding_rejects_rewritten_quote():
    questions = [_question(UNGROUNDED_QUOTE)]
    problems = generator._check_grounding(CONTENT, questions)
    assert problems and "搜不到" in problems[0]
    assert questions[0]["grounded"] is False
    assert questions[0]["source_paragraph"] is None


def test_grounding_rejects_quote_stitched_from_two_paragraphs():
    """把相隔两段的句子拼成一句，不算接地——否则「回看第几段」又会指错。"""
    questions = [_question("复利是把利息也当本金的算法单利只按最初本金算利息。")]
    assert generator._check_grounding(CONTENT, questions)


def test_grounding_accepts_dialogue_split_across_lines():
    """对话常被拆成多行，这种跨行原句必须认，并回到它开始的那一段。"""
    content = ("（AI 生成内容）\n「七十二。」\n「什么？」\n"
               "「七十二除以年化收益率，就是翻一倍要多少年。」\n" + "她愣住了。" * 60)
    questions = [_question("「七十二。」「什么？」「七十二除以年化收益率，就是翻一倍要多少年。」")]
    assert generator._check_grounding(content, questions) == []
    assert questions[0]["source_paragraph"] == 1


def test_grounding_tolerates_punctuation_spacing():
    questions = [_question("单利 只按最初本金算利息")]
    assert generator._check_grounding(CONTENT, questions) == []
    assert questions[0]["source_paragraph"] == 2


# ---------------------------------------------------------------------------
# 生成链路：不接地就退回重出
# ---------------------------------------------------------------------------


def test_generation_rewrites_until_questions_are_grounded(book_factory, monkeypatch):
    bid = book_factory(topic="复利")
    calls = {"chapters": 0, "questions": 0}

    base = {"title": "第一章", "content": CONTENT,
            "knowledge_points": [
                {"role": "core", "point": "复利", "quote": "复利是把利息也当本金的算法。"},
                {"role": "aux", "point": "单利", "quote": "单利只按最初本金算利息。"},
                {"role": "aux", "point": "期数", "quote": "时间越长期数越多差距越大。"},
            ]}

    def fake_model(_system, user, **_kwargs):
        if "可答性审查员" in user:
            return {"results": [{"index": i, "answerable": True, "reason": ""} for i in range(1, 6)]}
        if "阅读测验题" in user:
            calls["questions"] += 1
            quote = UNGROUNDED_QUOTE if calls["questions"] == 1 else GOOD_QUOTE
            return {"questions": [_question(quote) for _ in range(5)]}
        calls["chapters"] += 1
        return base

    monkeypatch.setattr(generator.llm, "call_json", fake_model)
    monkeypatch.setattr(generator, "_review_moderation", lambda _content: (True, ""))
    monkeypatch.setattr(generator, "_review_learning_questions",
                        lambda *_args, **_kwargs: (True, ""))

    chapter = generator.generate_chapter(bid, 1, StoryBible(book_id=bid))

    assert calls["chapters"] == 1
    assert calls["questions"] == 2, "第一次原句搜不到，必须退回重出一次"
    assert all(q["grounded"] for q in chapter["questions"])
    assert all(q["source_paragraph"] == 2 for q in chapter["questions"])
    assert all(q["evidence"] == GOOD_QUOTE for q in chapter["questions"])
    assert db.get_chapter(bid, 1)["questions"] == chapter["questions"]


# ---------------------------------------------------------------------------
# 可答性校验：光「这句话在正文里」不够，还得「这句能推出这个答案」
# ---------------------------------------------------------------------------


def test_answerable_rejects_over_inference(monkeypatch):
    """原文只写「脸色白了」，选项说「他意识到更深层的方法」——这类必须判不合格。"""
    questions = [_question(GOOD_QUOTE) for _ in range(5)]
    generator._check_grounding(CONTENT, questions)
    captured: dict = {}

    def fake_json(_system, user, **_kwargs):
        captured["user"] = user
        return {"results": [{"index": i, "answerable": i != 2, "reason": "" if i != 2 else "原文只写动作，未写他在想什么"}
                            for i in range(1, 6)]}

    monkeypatch.setattr(generator.llm, "call_json", fake_json)
    problems = generator._check_answerable(CONTENT, questions)
    assert len(problems) == 1 and "第2题" in problems[0]
    assert questions[1]["answerable"] is False
    assert questions[0]["answerable"] is True
    # 校验只给依据所在的那一段，不把全文丢给模型（否则又会用后文给自己圆场）
    assert "单利只按最初本金算利息。" in captured["user"]


def test_answerable_does_not_block_when_checker_fails(monkeypatch):
    """校验本身挂了不能把用户卡住：按未判定放行。"""
    questions = [_question(GOOD_QUOTE) for _ in range(5)]
    generator._check_grounding(CONTENT, questions)

    def broken(*_args, **_kwargs):
        raise ValueError("JSON 不完整")

    monkeypatch.setattr(generator.llm, "call_json", broken)
    assert generator._check_answerable(CONTENT, questions) == []
    assert all(q.get("answerable") is None for q in questions)


def test_generation_rewrites_when_answer_is_not_derivable(book_factory, chapter_factory, monkeypatch):
    """答案推不出来时重出；重出仍不过就如实降级交付，标 answerable=False。"""
    bid = book_factory(topic="数学")
    chapter = chapter_factory(bid)
    chapter["knowledge_points"] = [{"role": "core", "point": "四则运算", "paragraph": 1}]
    asked = 0

    def fake_model(_system, user, **_kwargs):
        nonlocal asked
        if "可答性审查员" in user:
            return {"results": [{"index": i, "answerable": False, "reason": "原文没说原因"}
                                for i in range(1, 6)]}
        asked += 1
        return {"questions": [{"type": "memory", "question": "老周为什么走四十分钟？",
                              "options": ["因为省钱", "因为锻炼", "因为堵车", "因为喜欢"],
                              "answer": 0, "evidence": "第1段内容。第1段内容。"} for _ in range(5)]}

    monkeypatch.setattr(generator.llm, "call_json", fake_model)
    monkeypatch.setattr(generator, "_review_learning_questions", lambda *_args, **_kwargs: (True, ""))
    questions = generator.regenerate_questions(chapter, "适中")
    assert asked == 3, "可答性不过要重出到次数用尽"
    assert len(questions) == 5
    assert all(q["answerable"] is False for q in questions)


# ---------------------------------------------------------------------------
# 合并后重试与降级
# ---------------------------------------------------------------------------


def test_retry_crash_keeps_previously_usable_questions(book_factory, chapter_factory,
                                                       monkeypatch):
    """第一次已拿到结构完整的题，第二次重试崩了（长度上限等），不能把好结果一起丢掉。"""
    bid = book_factory(topic="数学")
    chapter = chapter_factory(bid)
    chapter["knowledge_points"] = [{"role": "core", "point": "四则运算", "paragraph": 1}]
    calls = 0

    def fake_model(_system, user, **_kwargs):
        if "可答性审查员" in user:
            return {"results": [{"index": i, "answerable": True, "reason": ""} for i in range(1, 6)]}
        nonlocal calls
        calls += 1
        if calls == 1:
            return {"questions": [{"type": "memory", "question": "2+2 等于几？",
                                  "options": ["4", "3", "2", "1"], "answer": 0,
                                  "evidence": "第1段内容。第1段内容。"} for _ in range(5)]}
        raise ValueError("模型输出达到长度上限，JSON 不完整")

    monkeypatch.setattr(generator.llm, "call_json", fake_model)
    monkeypatch.setattr(generator, "_review_learning_questions",
                        lambda *_args, **_kwargs: (False, "第1题：与正文对不上"))
    questions = generator.regenerate_questions(chapter, "适中")
    assert calls == 3, "重试直到次数用尽"
    assert len(questions) == 5
    assert all(q["grounded"] for q in questions)


def test_generation_logs_and_accepts_when_grounding_never_passes(book_factory, monkeypatch):
    """重出两次仍不接地时不卡死用户：降级交付并标注 grounded=False。"""
    bid = book_factory(topic="复利")
    base = {"title": "第一章", "content": CONTENT,
            "knowledge_points": [
                {"role": "core", "point": "复利", "quote": "复利是把利息也当本金的算法。"},
                {"role": "aux", "point": "单利", "quote": "单利只按最初本金算利息。"},
                {"role": "aux", "point": "期数", "quote": "时间越长期数越多差距越大。"},
            ]}

    def fake_model(_system, user, **_kwargs):
        if "阅读测验题" in user:
            return {"questions": [_question(UNGROUNDED_QUOTE) for _ in range(5)]}
        return base

    monkeypatch.setattr(generator.llm, "call_json", fake_model)
    monkeypatch.setattr(generator, "_review_moderation", lambda _content: (True, ""))
    monkeypatch.setattr(generator, "_review_learning_questions",
                        lambda *_args, **_kwargs: (True, ""))

    chapter = generator.generate_chapter(bid, 1, StoryBible(book_id=bid))
    assert len(chapter["questions"]) == 5
    assert not any(q["grounded"] for q in chapter["questions"])


def test_regenerate_recovers_from_invalid_json_and_letter_answer(book_factory, chapter_factory,
                                                                  monkeypatch):
    bid = book_factory(topic="数学")
    chapter = chapter_factory(bid)
    chapter["knowledge_points"] = [{"role": "core", "point": "四则运算", "paragraph": 1}]
    calls = 0

    def fake_model(_system, user, **_kwargs):
        if "可答性审查员" in user:
            return {"results": [{"index": i, "answerable": True, "reason": ""} for i in range(1, 6)]}
        nonlocal calls
        calls += 1
        if calls == 1:
            raise ValueError("模型输出不是 JSON")
        return {"questions": [{"type": "memory", "question": "2+2 等于几？",
                              "options": ["4", "3", "2", "1"], "answer": "A",
                              "evidence": "第1段内容。第1段内容。",
                              "source_paragraph": 1} for _ in range(5)]}

    monkeypatch.setattr(generator.llm, "call_json", fake_model)
    monkeypatch.setattr(generator, "_review_learning_questions", lambda *_args, **_kwargs: (True, ""))
    questions = generator.regenerate_questions(chapter, "适中")
    assert calls == 2
    # 字母答案 "A" 被识别为选项「4」；选项随后会被打乱，所以按选项内容核对
    assert all(q["options"][q["answer"]] == "4" for q in questions)
    assert all(q["grounded"] for q in questions)
    assert len(db.get_chapter(bid, 1)["questions"]) == 5
