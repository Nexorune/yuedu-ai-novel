"""用户反馈：测验应巩固学习主题，不能只考小说设定。"""

from novel_learning.quiz import validate_learning_questions
from novel_learning import generator, db
from novel_learning.models import StoryBible


def test_rejects_story_trivia_even_when_it_has_four_options():
    questions = [
        {
            "question": "根据正文描述，在算力王朝，只会加减乘除的人被称为什么？",
            "options": ["算民", "算奴", "算工", "算徒"],
            "answer": 0,
            "source_paragraph": 2,
        }
    ]
    assert not validate_learning_questions("算力", questions)


def test_accepts_questions_about_transferable_knowledge():
    questions = [
        {
            "question": "把同一项计算任务拆成并行子任务时，哪种情况最可能提高处理速度？",
            "options": ["子任务相互独立", "每步都等待前一步", "输入数据不断重复", "只增加显示屏数量"],
            "answer": 0,
            "source_paragraph": 2,
        }
    ]
    assert validate_learning_questions("算力", questions)


def test_rejects_character_question_even_if_answer_is_a_real_concept():
    questions = [{"question": "叶辰在采石场怎样优化开采方案？",
                  "options": ["使用基础几何知识", "让监工加分", "只靠运气", "等待别人"],
                  "answer": 0}]
    assert not validate_learning_questions("算力", questions, ["叶辰"])


def test_generation_rewrites_when_review_finds_plot_trivia(book_factory, monkeypatch):
    bid = book_factory(topic="算力")
    calls = {"chapters": 0, "questions": 0}
    good = {"question": "把独立计算任务分给多个处理器，主要利用了什么？",
            "options": ["并行计算", "串行等待", "重复输入", "关闭缓存"],
            "answer": 0, "source_paragraph": 1, "type": "memory"}
    bad = {**good, "question": "叶辰在采石场用什么提高算绩？"}
    base = {"title": "第一章", "content": "（AI 生成内容）\n" + "算力来自可并行处理的计算资源。" * 120,
            "knowledge_points": [{"role": "core", "point": "并行计算", "paragraph": 1},
                                 {"role": "aux", "point": "算力单位", "paragraph": 1},
                                 {"role": "aux", "point": "任务拆分", "paragraph": 1}]}

    def fake_model(_system, user, **_kwargs):
        if "请仅根据知识点清单" in user:
            calls["questions"] += 1
            return {"questions": [good] * 5}
        calls["chapters"] += 1
        return {**base, "questions": [bad, good, good, good, good]}

    monkeypatch.setattr(generator.llm, "call_json", fake_model)
    monkeypatch.setattr(generator, "_review_moderation", lambda _content: (True, ""))
    monkeypatch.setattr(generator, "_review_learning_questions",
                        lambda _topic, _points, questions, _names: ("叶辰" not in questions[0]["question"], "考了人物经历"))
    chapter = generator.generate_chapter(bid, 1, StoryBible(book_id=bid))
    assert calls == {"chapters": 1, "questions": 1}
    assert "叶辰" not in chapter["questions"][0]["question"]
    assert db.get_chapter(bid, 1)["questions"] == chapter["questions"]


def test_regenerate_recovers_from_invalid_json_and_letter_answer(book_factory, chapter_factory, monkeypatch):
    bid = book_factory(topic="数学")
    chapter = chapter_factory(bid)
    chapter["knowledge_points"] = [{"role": "core", "point": "四则运算", "paragraph": 1}]
    calls = 0

    def fake_model(_system, _user, **_kwargs):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise ValueError("模型输出不是 JSON")
        return {"questions": [{"type": "memory", "question": "2+2 等于几？",
                              "options": ["4", "3", "2", "1"], "answer": "A",
                              "source_paragraph": 1} for _ in range(5)]}

    monkeypatch.setattr(generator.llm, "call_json", fake_model)
    monkeypatch.setattr(generator, "_review_learning_questions", lambda *_args: (True, ""))
    questions = generator.regenerate_questions(chapter, "适中")
    assert calls == 2
    # 字母答案 "A" 被识别为选项「4」；选项随后会被打乱，所以按选项内容核对
    assert all(q["options"][q["answer"]] == "4" for q in questions)
    assert len(db.get_chapter(bid, 1)["questions"]) == 5
