"""判题与失败降级。"""
from novel_learning import db
from novel_learning.quiz import grade, submit_answers


def _questions(n=5):
    return [{"question": f"q{i}", "options": ["a", "b", "c", "d"],
             "answer": 0, "source_paragraph": i + 1} for i in range(n)]


def test_grade_pass_three_correct():
    r = grade(_questions(), [0, 0, 0, 1, 1])
    assert r["passed"] is True and r["correct"] == 3


def test_grade_fail_two_correct():
    r = grade(_questions(), [0, 0, 1, 1, 1])
    assert r["passed"] is False and r["correct"] == 2


def test_submit_pass_unlocks(book_factory, chapter_factory):
    bid = book_factory()
    ch = chapter_factory(bid, 1, _questions())
    r = submit_answers(bid, ch, [0, 0, 0, 1, 1])
    assert r["passed"] is True
    assert db.get_progress(bid)["current_chapter"] == 1
    assert db.get_chapter(bid, 1)["status"] == "unlocked"


def test_submit_fail_degrade(book_factory, chapter_factory):
    bid = book_factory()
    ch = chapter_factory(bid, 1, _questions())
    r1 = submit_answers(bid, ch, [1, 1, 1, 1, 1])
    assert r1["passed"] is False and r1["consecutive_fails"] == 1
    assert r1["action"] == "retry_new_questions"
    r2 = submit_answers(bid, ch, [1, 1, 1, 1, 1])
    assert r2["consecutive_fails"] == 2 and r2["action"] == "retry_lower_difficulty"
    r3 = submit_answers(bid, ch, [1, 1, 1, 1, 1])
    assert r3["consecutive_fails"] == 3 and r3["action"] == "retry_easiest"


def test_fail_resets_after_pass(book_factory, chapter_factory):
    bid = book_factory()
    ch = chapter_factory(bid, 1, _questions())
    submit_answers(bid, ch, [1, 1, 1, 1, 1])  # 失败一次
    submit_answers(bid, ch, [0, 0, 0, 1, 1])  # 通过
    assert db.get_progress(bid)["consecutive_fails"] == 0
