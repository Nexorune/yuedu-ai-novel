"""章节知识清单：可读范围、账号隔离及既有持久化数据。"""
from novel_learning import db


def add_points(chapter):
    chapter["knowledge_points"] = [
        {"role": "core", "point": "复利：利息也计息", "paragraph": 1},
        {"role": "aux", "point": "时间价值：长期积累", "paragraph": 2},
    ]
    db.save_chapter(chapter)


def test_current_chapter_points_visible_before_quiz(client, book_factory, chapter_factory):
    bid = book_factory()
    chapter = chapter_factory(bid, questions=[{"question": "选择", "options": ["甲", "乙"], "answer": 0, "explanation": "秘密解析"}])
    add_points(chapter)
    response = client.get(f"/api/books/{bid}/chapters/1")
    assert response.status_code == 200
    data = response.json()["chapter"]
    assert len(data["knowledge_points"]) == 2
    assert data["status"] == "locked"
    assert '"answer"' not in response.text and "秘密解析" not in response.text
    assert db.get_quiz_attempt(bid, 1) is None
    assert db.get_progress(bid)["current_chapter"] == 0


def test_directory_contains_only_readable_chapters_and_persists(client, book_factory, chapter_factory):
    bid = book_factory()
    for no in range(1, 4):
        add_points(chapter_factory(bid, no))
    endpoint = f"/api/books/{bid}/knowledge"
    assert [c["chapter_no"] for c in client.get(endpoint).json()["chapters"]] == [1]
    db.set_progress(bid, current_chapter=1)
    rows = client.get(endpoint).json()["chapters"]
    assert [c["chapter_no"] for c in rows] == [1, 2]
    assert all(set(c) == {"chapter_no", "title", "is_ending", "knowledge_points"} for c in rows)
    assert all(set(kp) == {"role", "point"} for c in rows for kp in c["knowledge_points"])
    db.init_db()
    assert client.get(endpoint).json()["chapters"] == rows
    # 已收集结局可读，但普通未来章仍不可见。
    ending = chapter_factory(bid, 5)
    ending["is_ending"] = True
    add_points(ending)
    db.set_book_status(bid, "completed")
    assert [c["chapter_no"] for c in client.get(endpoint).json()["chapters"]] == [1, 2, 5]


def test_directory_auth_owner_and_empty(client, anon_client, book_factory, chapter_factory):
    bid = book_factory()
    assert client.get(f"/api/books/{bid}/knowledge").json() == {"chapters": []}
    chapter_factory(bid)
    assert client.get(f"/api/books/{bid}/knowledge").json()["chapters"][0]["knowledge_points"] == []
    other = book_factory(user_id="other-user")
    assert client.get(f"/api/books/{other}/knowledge").status_code == 404
    client.cookies.clear()
    assert anon_client.get(f"/api/books/{bid}/knowledge").status_code == 401
