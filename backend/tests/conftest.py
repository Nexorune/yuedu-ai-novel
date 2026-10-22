"""测试公共配置：把数据重定向到临时目录，避免污染真实数据库。"""
import os
import tempfile

# 必须在导入 novel_learning 之前设置，config 在导入时读取该变量
os.environ.setdefault("NOVEL_LEARNING_DATA", tempfile.mkdtemp(prefix="novel_test_"))

import pytest  # noqa: E402

from novel_learning import config, db  # noqa: E402


@pytest.fixture(autouse=True)
def clean_db():
    db.init_db()
    yield
    with db.get_conn() as conn:
        for t in ("mistakes", "quiz_attempts", "usage", "tasks", "progress", "endings", "story_bibles", "chapters", "books",
                  "sessions", "users"):
            conn.execute(f"DELETE FROM {t}")


TEST_PHONE = "13800000000"


def test_owner() -> str:
    """测试书默认属于 TEST_PHONE 这个账号（与 client 登录的是同一个人）。"""
    return str(db.get_or_create_user(TEST_PHONE)[0]["id"])


@pytest.fixture
def book_factory():
    def _make(**kw):
        return db.create_book(kw.get("genre", "爽文"), kw.get("topic", "AI"),
                              kw.get("planned_chapters", 10),
                              kw.get("min_words", 1500), kw.get("max_words", 2500),
                              mode=kw.get("mode", "full"),
                              user_id=kw.get("user_id") or test_owner())
    return _make


@pytest.fixture
def chapter_factory():
    def _make(book_id, chapter_no=1, questions=None, content=None):
        content = content or ("（AI 生成内容）\n" + "第1段内容。" * 300)
        chapter = {"book_id": book_id, "chapter_no": chapter_no,
                   "title": f"第{chapter_no}章", "content": content,
                   "knowledge_points": [], "questions": questions or [],
                   "status": "locked", "is_ending": False, "ending_style": None}
        chapter["id"] = db.save_chapter(chapter)
        return chapter
    return _make


def login(c, phone: str = TEST_PHONE):
    return c.post("/api/auth/login", json={"phone": phone, "code": config.DEMO_LOGIN_CODE,
                                           "agreed": True})


@pytest.fixture
def anon_client():
    from fastapi.testclient import TestClient
    from novel_learning.web import app
    with TestClient(app) as c:
        yield c


@pytest.fixture
def client(anon_client):
    assert login(anon_client).status_code == 200
    yield anon_client
