"""存储层：书/章节/进度/任务的落库与恢复。"""
from novel_learning import db


def test_create_and_get_book(book_factory):
    bid = book_factory(genre="悬疑", topic="复利", planned_chapters=5)
    b = db.get_book(bid)
    assert b["genre"] == "悬疑" and b["topic"] == "复利"
    assert b["planned_chapters"] == 5 and b["status"] == "reading"


def test_save_and_get_chapter(book_factory, chapter_factory):
    bid = book_factory()
    ch = chapter_factory(bid, 2)
    got = db.get_chapter(bid, 2)
    assert got["chapter_no"] == 2 and got["status"] == "locked"
    assert got["questions"] == []


def test_unlock_chapter(book_factory, chapter_factory):
    bid = book_factory()
    chapter_factory(bid, 1)
    db.unlock_chapter(bid, 1)
    assert db.get_chapter(bid, 1)["status"] == "unlocked"


def test_progress_roundtrip(book_factory):
    bid = book_factory()
    db.set_progress(bid, current_chapter=3, consecutive_fails=1)
    p = db.get_progress(bid)
    assert p["current_chapter"] == 3 and p["consecutive_fails"] == 1


def test_task_lifecycle(book_factory):
    bid = book_factory()
    tid = db.create_task(bid, "chapter", chapter_no=1)
    assert db.get_task(tid)["status"] == "pending"
    db.set_task_status(tid, "running")
    db.set_task_status(tid, "done")
    assert db.get_task(tid)["status"] == "done"


def test_task_error_records_message(book_factory):
    bid = book_factory()
    tid = db.create_task(bid, "chapter", chapter_no=1)
    db.set_task_status(tid, "error", "模型调用失败")
    t = db.get_task(tid)
    assert t["status"] == "error" and t["error"] == "模型调用失败"
