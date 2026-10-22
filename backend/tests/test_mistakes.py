"""真实 SQLite + API：收录、换题留存、迁移幂等、账号隔离。"""
import subprocess
import sys
import os
from novel_learning import config, db
from novel_learning.quiz import answer_one, submit_answers
from conftest import login


def questions():
    return [{"type": "memory", "question": f"知识题 {i}", "options": ["正确", "错误", "其他", "无关"],
             "answer": 0, "source_paragraph": 2, "explanation": "知识讲解"} for i in range(5)]


def test_auto_collect_once_and_keep_after_replacement(client, book_factory, chapter_factory):
    bid = book_factory()
    chapter_factory(bid, questions=questions(), content="第1段\n故事开头\n第2段\n复利让利息继续计息。")
    url = f"/api/books/{bid}/chapters/1/answer"
    assert client.post(url, json={"index": 0, "choice": 1}).status_code == 200
    client.post(url, json={"index": 0, "choice": 0})
    client.post(url, json={"index": 1, "choice": 0})
    items = client.get("/api/mistakes").json()["mistakes"]
    assert len(items) == 1 and items[0]["choice"] == 1
    assert items[0]["source_excerpt"] == "复利让利息继续计息。"
    assert items[0]["explanation"] == "知识讲解"
    db.replace_questions(bid, 1, [{**q, "question": "新" + q["question"]} for q in questions()])
    assert db.get_quiz_attempt(bid, 1) is None
    assert client.get("/api/mistakes").json()["mistakes"] == items
    item_id = items[0]["id"]
    assert client.patch(f"/api/mistakes/{item_id}", json={"mastered": True}).status_code == 200
    db.init_db()
    assert client.get(f"/api/mistakes/{item_id}").json()["mistake"]["mastered"] is True
    program = "from novel_learning import db; db.init_db(); print(len(db.list_mistakes('" + db.get_book(bid)["user_id"] + "')))"
    result = subprocess.check_output([sys.executable, "-c", program], env={**os.environ, "NOVEL_LEARNING_DATA": str(config.DATA_DIR)}, text=True)
    assert result.strip() == "1"


def test_passed_quiz_also_records_wrong_answers(book_factory, chapter_factory):
    bid = book_factory()
    chapter = chapter_factory(bid, questions=questions())
    for i, choice in enumerate([0, 0, 0, 1, 1]):
        result = answer_one(bid, chapter, i, choice)
    assert result["result"]["passed"] is True
    assert len(db.list_mistakes(db.get_book(bid)["user_id"])) == 2


def test_backfill_is_idempotent_and_only_includes_answered_errors(book_factory, chapter_factory):
    bid = book_factory()
    chapter_factory(bid, questions=questions())
    db.save_quiz_attempt(bid, 1, [1, 0, None, None, None], False)
    db.init_db()
    owner = db.get_book(bid)["user_id"]
    items = db.list_mistakes(owner)
    assert len(items) == 1
    db.set_mistake_mastered(owner, items[0]["id"], True)
    db.init_db()
    assert len(db.list_mistakes(owner)) == 1
    assert db.list_mistakes(owner)[0]["mastered"] is True


def test_account_isolation_and_validation(client, book_factory, chapter_factory):
    bid = book_factory()
    chapter = chapter_factory(bid, questions=questions())
    submit_answers(bid, chapter, [1, 1, 0, 0, 0])
    item = client.get("/api/mistakes").json()["mistakes"][0]
    assert client.patch(f"/api/mistakes/{item['id']}", json={"mastered": "yes"}).status_code == 422
    login(client, "13900000000")
    assert client.get("/api/mistakes").json() == {"mistakes": []}
    assert client.get(f"/api/mistakes/{item['id']}").status_code == 404
    assert client.patch(f"/api/mistakes/{item['id']}", json={"mastered": True}).status_code == 404
    client.post("/api/auth/logout")
    assert client.get("/api/mistakes").status_code == 401
    assert client.patch(f"/api/mistakes/{item['id']}", json={"mastered": True}).status_code == 401


def test_invalid_legacy_answers_skipped(book_factory, chapter_factory):
    bid = book_factory()
    chapter_factory(bid, questions=questions())
    db.save_quiz_attempt(bid, 1, [99, "1", None, -1, True], False)
    db.init_db()
    assert db.list_mistakes(db.get_book(bid)["user_id"]) == []
