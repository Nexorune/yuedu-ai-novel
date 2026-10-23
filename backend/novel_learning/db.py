"""SQLite 存储。单进程，零外部依赖。"""
from __future__ import annotations

import json
import hashlib
import re
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path

from . import config

SCHEMA = """
CREATE TABLE IF NOT EXISTS books (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL DEFAULT 'local',
    genre TEXT NOT NULL,
    topic TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    archived INTEGER NOT NULL DEFAULT 0,
    mode TEXT NOT NULL DEFAULT 'full',          -- full | quick
    planned_chapters INTEGER NOT NULL,
    min_words INTEGER NOT NULL,
    max_words INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'reading',      -- reading | completed
    hidden_ending TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS chapters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id INTEGER NOT NULL,
    chapter_no INTEGER NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    knowledge_points TEXT NOT NULL DEFAULT '[]',
    questions TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'locked',       -- locked | unlocked
    is_ending INTEGER NOT NULL DEFAULT 0,
    ending_style TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(book_id, chapter_no)
);
CREATE TABLE IF NOT EXISTS story_bibles (
    book_id INTEGER PRIMARY KEY,
    characters TEXT NOT NULL DEFAULT '[]',
    mainline TEXT NOT NULL DEFAULT '',
    chapter_summaries TEXT NOT NULL DEFAULT '[]',
    foreshadowing TEXT NOT NULL DEFAULT '[]',
    learned_knowledge TEXT NOT NULL DEFAULT '[]',
    outline TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS endings (
    book_id INTEGER NOT NULL,
    ending_style TEXT NOT NULL,
    chapter_id INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (book_id, ending_style)
);
CREATE TABLE IF NOT EXISTS progress (
    book_id INTEGER PRIMARY KEY,
    user_id TEXT NOT NULL DEFAULT 'local',
    current_chapter INTEGER NOT NULL DEFAULT 0,   -- 已解锁到的章节号
    consecutive_fails INTEGER NOT NULL DEFAULT 0,
    daily_count INTEGER NOT NULL DEFAULT 0,
    daily_date TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id INTEGER NOT NULL,
    kind TEXT NOT NULL,                            -- outline | chapter | ending | regen_questions
    chapter_no INTEGER,
    style TEXT,
    status TEXT NOT NULL DEFAULT 'pending',        -- pending | running | done | error
    progress TEXT NOT NULL DEFAULT '',             -- 当前步骤描述（给前端展示）
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    month TEXT NOT NULL,                           -- YYYY-MM
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_usage_month ON usage(month);
CREATE TABLE IF NOT EXISTS quiz_attempts (
    book_id INTEGER NOT NULL,
    chapter_no INTEGER NOT NULL,
    answers TEXT NOT NULL DEFAULT '[]',            -- 每题第一次作答的选项下标，未答为 null
    finished INTEGER NOT NULL DEFAULT 0,           -- 5 题答完即结束；没通过要换一套题才能再闯
    updated_at TEXT NOT NULL,
    PRIMARY KEY (book_id, chapter_no)
);
CREATE TABLE IF NOT EXISTS mistakes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id INTEGER NOT NULL,
    chapter_no INTEGER NOT NULL,
    question_key TEXT NOT NULL,
    snapshot TEXT NOT NULL,
    mastered INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    UNIQUE(book_id, chapter_no, question_key)
);
CREATE INDEX IF NOT EXISTS idx_mistakes_book ON mistakes(book_id);
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT NOT NULL UNIQUE,
    nickname TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,                   -- 只存登录凭证的哈希，原文只在浏览器 Cookie 里
    user_id INTEGER NOT NULL,
    expires_at INTEGER NOT NULL                    -- Unix 秒
);
CREATE INDEX IF NOT EXISTS idx_books_user ON books(user_id);
"""


def _connect() -> sqlite3.Connection:
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(config.DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


@contextmanager
def get_conn():
    conn = _connect()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    with get_conn() as conn:
        conn.executescript(SCHEMA)
        # 兼容旧库：补充 tasks.progress 列
        try:
            conn.execute("ALTER TABLE tasks ADD COLUMN progress TEXT NOT NULL DEFAULT ''")
        except sqlite3.OperationalError:
            pass  # 列已存在
        try:
            conn.execute("ALTER TABLE books ADD COLUMN title TEXT NOT NULL DEFAULT ''")
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("ALTER TABLE books ADD COLUMN archived INTEGER NOT NULL DEFAULT 0")
        except sqlite3.OperationalError:
            pass
        # 给用户看的失败原因；原始异常仍留在 error 列，只用于排查
        try:
            conn.execute("ALTER TABLE tasks ADD COLUMN public_error TEXT NOT NULL DEFAULT ''")
        except sqlite3.OperationalError:
            pass

        rows = conn.execute("SELECT q.*, c.questions, c.knowledge_points, c.content, c.title"
                            " FROM quiz_attempts q JOIN chapters c ON c.book_id=q.book_id"
                            " AND c.chapter_no=q.chapter_no").fetchall()
        for row in rows:
            chapter = _parse_chapter(dict(row))
            try:
                answers = json.loads(row["answers"])
            except (ValueError, TypeError):
                continue
            if isinstance(answers, list):
                _archive_mistakes(conn, chapter, answers, row["updated_at"])


# ---------------------------------------------------------------------------
# users & sessions
# ---------------------------------------------------------------------------

UNCLAIMED_OWNER = "local"   # 接入账号前创建的书都记在这个名下


def get_or_create_user(phone: str) -> tuple[dict, bool]:
    """按手机号找用户，没有就注册。返回 (用户, 是否新注册)。

    第一个注册的账号会接手接入账号前的全部书籍（演示数据），之后的新账号从空白开始。
    """
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM users WHERE phone=?", (phone,)).fetchone()
        if row:
            return dict(row), False
        first = conn.execute("SELECT COUNT(*) AS n FROM users").fetchone()["n"] == 0
        cur = conn.execute(
            "INSERT INTO users(phone, nickname, created_at) VALUES(?,?,?)",
            (phone, "悦读用户" + phone[-4:], time.strftime("%Y-%m-%d %H:%M:%S")))
        user_id = int(cur.lastrowid)
        if first:
            conn.execute("UPDATE books SET user_id=? WHERE user_id=?",
                         (str(user_id), UNCLAIMED_OWNER))
        row = conn.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
        return dict(row), True


def get_user(user_id: int) -> dict | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
        return dict(row) if row else None


def create_session(token_hash: str, user_id: int, expires_at: int) -> None:
    with get_conn() as conn:
        conn.execute("DELETE FROM sessions WHERE expires_at < ?", (int(time.time()),))
        conn.execute("INSERT INTO sessions(token_hash, user_id, expires_at) VALUES(?,?,?)",
                     (token_hash, user_id, expires_at))


def get_session_user(token_hash: str) -> dict | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id"
            " WHERE s.token_hash=? AND s.expires_at >= ?",
            (token_hash, int(time.time()))).fetchone()
        return dict(row) if row else None


def delete_session(token_hash: str) -> None:
    with get_conn() as conn:
        conn.execute("DELETE FROM sessions WHERE token_hash=?", (token_hash,))


def user_stats(user_id: int) -> dict:
    """个人中心的学习统计：读过几本、通关几章、学会几个知识点。"""
    owner = str(user_id)
    with get_conn() as conn:
        books = conn.execute("SELECT COUNT(*) AS n FROM books WHERE user_id=? AND archived=0",
                             (owner,)).fetchone()["n"]
        passed = conn.execute(
            "SELECT COALESCE(SUM(p.current_chapter), 0) AS n FROM progress p"
            " JOIN books b ON b.id = p.book_id WHERE b.user_id=? AND b.archived=0",
            (owner,)).fetchone()["n"]
        rows = conn.execute(
            "SELECT c.knowledge_points FROM chapters c JOIN books b ON b.id = c.book_id"
            " WHERE b.user_id=? AND b.archived=0 AND c.status='unlocked'", (owner,)).fetchall()
    points = sum(len(json.loads(r["knowledge_points"] or "[]")) for r in rows)
    return {"books": books, "chapters_passed": passed, "knowledge_points": points}


# ---------------------------------------------------------------------------
# books
# ---------------------------------------------------------------------------


def create_book(genre: str, topic: str, planned_chapters: int,
                min_words: int, max_words: int, mode: str = "full",
                hidden_ending: str = "", user_id: str = "local") -> int:
    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO books(user_id, genre, topic, mode, planned_chapters,"
            " min_words, max_words, status, hidden_ending, created_at)"
            " VALUES(?,?,?,?,?,?,?, 'reading', ?, ?)",
            (user_id, genre, topic, mode, planned_chapters, min_words, max_words,
             hidden_ending, time.strftime("%Y-%m-%d %H:%M:%S")))
        return int(cur.lastrowid)


def get_book(book_id: int) -> dict | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM books WHERE id=?", (book_id,)).fetchone()
        return dict(row) if row else None


def set_book_title(book_id: int, title: str) -> None:
    with get_conn() as conn:
        conn.execute("UPDATE books SET title=? WHERE id=?", (title.strip(), book_id))


def set_book_archived(book_id: int, archived: bool) -> None:
    with get_conn() as conn:
        conn.execute("UPDATE books SET archived=? WHERE id=?", (int(archived), book_id))


def set_book_status(book_id: int, status: str) -> None:
    with get_conn() as conn:
        conn.execute("UPDATE books SET status=? WHERE id=?", (status, book_id))


# ---------------------------------------------------------------------------
# chapters
# ---------------------------------------------------------------------------


def save_chapter(chapter: dict) -> int:
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO chapters(book_id, chapter_no, title, content, knowledge_points,"
            " questions, status, is_ending, ending_style, created_at)"
            " VALUES(?,?,?,?,?,?,?,?,?,?)"
            " ON CONFLICT(book_id, chapter_no) DO UPDATE SET"
            " title=excluded.title, content=excluded.content,"
            " knowledge_points=excluded.knowledge_points, questions=excluded.questions,"
            " status=excluded.status, is_ending=excluded.is_ending,"
            " ending_style=excluded.ending_style",
            (chapter["book_id"], chapter["chapter_no"], chapter["title"],
             chapter["content"], json.dumps(chapter["knowledge_points"], ensure_ascii=False),
             json.dumps(chapter["questions"], ensure_ascii=False), chapter["status"],
             1 if chapter.get("is_ending") else 0, chapter.get("ending_style"),
             time.strftime("%Y-%m-%d %H:%M:%S")))
        row = conn.execute("SELECT id FROM chapters WHERE book_id=? AND chapter_no=?",
                           (chapter["book_id"], chapter["chapter_no"])).fetchone()
        # 正文或题目换了，旧的作答记录作废
        conn.execute("DELETE FROM quiz_attempts WHERE book_id=? AND chapter_no=?",
                     (chapter["book_id"], chapter["chapter_no"]))
        return int(row["id"])


def _parse_chapter(row: dict) -> dict:
    """把 JSON 字段还原为 list。"""
    row = dict(row)
    for field in ("knowledge_points", "questions"):
        try:
            row[field] = json.loads(row.get(field) or "[]")
        except (json.JSONDecodeError, TypeError):
            row[field] = []
    return row


def get_chapter(book_id: int, chapter_no: int) -> dict | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM chapters WHERE book_id=? AND chapter_no=?",
            (book_id, chapter_no)).fetchone()
        return _parse_chapter(row) if row else None


def unlock_chapter(book_id: int, chapter_no: int) -> None:
    with get_conn() as conn:
        conn.execute(
            "UPDATE chapters SET status='unlocked' WHERE book_id=? AND chapter_no=?",
            (book_id, chapter_no))


def list_chapters(book_id: int) -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM chapters WHERE book_id=? ORDER BY chapter_no",
            (book_id,)).fetchall()
        return [_parse_chapter(r) for r in rows]


def get_latest_chapter_no(book_id: int) -> int:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT COALESCE(MAX(chapter_no), 0) AS m FROM chapters WHERE book_id=?",
            (book_id,)).fetchone()
        return int(row["m"])


def replace_questions(book_id: int, chapter_no: int, questions: list[dict]) -> None:
    """换题：只替换题目，并作废这一章的作答记录。"""
    with get_conn() as conn:
        conn.execute("UPDATE chapters SET questions=? WHERE book_id=? AND chapter_no=?",
                     (json.dumps(questions, ensure_ascii=False), book_id, chapter_no))
        conn.execute("DELETE FROM quiz_attempts WHERE book_id=? AND chapter_no=?",
                     (book_id, chapter_no))


# ---------------------------------------------------------------------------
# quiz attempts（逐题闯关的作答记录，刷新或重启后可接着答）
# ---------------------------------------------------------------------------


def get_quiz_attempt(book_id: int, chapter_no: int) -> dict | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM quiz_attempts WHERE book_id=? AND chapter_no=?",
                           (book_id, chapter_no)).fetchone()
    if not row:
        return None
    try:
        answers = json.loads(row["answers"] or "[]")
    except (json.JSONDecodeError, TypeError):
        answers = []
    return {"answers": answers if isinstance(answers, list) else [], "finished": bool(row["finished"])}


def save_quiz_attempt(book_id: int, chapter_no: int, answers: list, finished: bool,
                      chapter: dict | None = None) -> None:
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO quiz_attempts(book_id, chapter_no, answers, finished, updated_at) VALUES(?,?,?,?,?)"
            " ON CONFLICT(book_id, chapter_no) DO UPDATE SET answers=excluded.answers,"
            " finished=excluded.finished, updated_at=excluded.updated_at",
            (book_id, chapter_no, json.dumps(answers), int(finished), time.strftime("%Y-%m-%d %H:%M:%S")))

        if chapter:
            _archive_mistakes(conn, {**chapter, "book_id": book_id}, answers)


_MARKER = re.compile(r"^\s*第\s*(\d+)\s*段\s*[:：]?\s*$")


def source_paragraphs(content: str) -> list[dict]:
    """与前端 parseChapter 完全一致的切段：有「第N段」标记按标记，没有则按行。

    模型几乎不写「第N段」标记；若这时整章并成一段，错题本会把整章存成
    「原文摘录」，前端也定位不到具体段落。所以无标记时一行一段，编号从 1 起，
    与出题时 generator._paragraphs 的编号严格对应。
    """
    content = re.sub(r"^\s*（AI 生成内容）\s*", "", content)
    lines = [line.strip() for line in content.split("\n") if line.strip()]
    if not any(_MARKER.match(line) for line in lines):
        return [{"no": index + 1, "text": line} for index, line in enumerate(lines)]
    parts: list[dict] = []
    current = None
    for raw in content.split("\n"):
        match = _MARKER.match(raw)
        if match:
            current = {"no": int(match.group(1)), "lines": []}
            parts.append(current)
        elif raw.strip():
            if current is None:
                current = {"no": None, "lines": []}
                parts.append(current)
            current["lines"].append(raw.strip())
    return [{"no": part["no"], "text": "\n".join(part["lines"])}
            for part in parts if part["lines"]]


def _archive_mistakes(conn, chapter: dict, answers: list, created_at: str | None = None) -> None:
    """持久化错题快照；未作答/正确题不收录，重试和迁移幂等。"""
    from .quiz import knowledge_for_question
    questions = chapter.get("questions") or []
    parts = source_paragraphs(chapter.get("content") or "")
    for i, (question, choice) in enumerate(zip(questions, answers)):
        options = question.get("options") or []
        answer = question.get("answer")
        if (type(choice) is not int or type(answer) is not int or choice == answer
                or not 0 <= choice < len(options) or not 0 <= answer < len(options)):
            continue
        knowledge = knowledge_for_question(questions, chapter.get("knowledge_points") or [], i)
        source_no = question.get("source_paragraph")
        source = next((part["text"] for part in parts if part["no"] == source_no), "") if source_no else ""
        # 无分段标记的历史正文只能定位到全文，不伪造段落位置。
        if not source and len(parts) == 1 and parts[0]["no"] is None:
            source = parts[0]["text"]
        snapshot = {"question": question.get("question", ""), "options": options,
                    "answer": answer, "choice": choice, "type": question.get("type", ""),
                    "explanation": question.get("explanation") or "",
                    "knowledge": knowledge.get("point", "") if knowledge else "",
                    "source_paragraph": source_no, "source_excerpt": source,
                    "chapter_title": chapter.get("title") or ""}
        identity = {k: snapshot[k] for k in ("question", "options", "answer", "source_excerpt")}
        key = hashlib.sha256(json.dumps(identity, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
        conn.execute("INSERT OR IGNORE INTO mistakes(book_id,chapter_no,question_key,snapshot,created_at)"
                     " VALUES(?,?,?,?,?)", (chapter["book_id"], chapter["chapter_no"], key,
                     json.dumps(snapshot, ensure_ascii=False), created_at or time.strftime("%Y-%m-%d %H:%M:%S")))


def archive_mistakes(book_id: int, chapter: dict, answers: list) -> None:
    with get_conn() as conn:
        _archive_mistakes(conn, {**chapter, "book_id": book_id}, answers)


def list_mistakes(user_id: str) -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute("SELECT m.*, b.title AS book_title, b.topic FROM mistakes m"
                            " JOIN books b ON b.id=m.book_id WHERE b.user_id=?"
                            " ORDER BY m.created_at DESC, m.id DESC", (str(user_id),)).fetchall()
    return [{**json.loads(row["snapshot"]), "id": row["id"], "book_id": row["book_id"],
             "book_title": row["book_title"], "topic": row["topic"], "chapter_no": row["chapter_no"],
             "created_at": row["created_at"], "mastered": bool(row["mastered"])} for row in rows]


def get_mistake(user_id: str, mistake_id: int) -> dict | None:
    with get_conn() as conn:
        row = conn.execute("SELECT m.*, b.title AS book_title, b.topic FROM mistakes m"
                           " JOIN books b ON b.id=m.book_id WHERE b.user_id=? AND m.id=?",
                           (str(user_id), mistake_id)).fetchone()
    if not row:
        return None
    return {**json.loads(row["snapshot"]), "id": row["id"], "book_id": row["book_id"],
            "book_title": row["book_title"], "topic": row["topic"], "chapter_no": row["chapter_no"],
            "created_at": row["created_at"], "mastered": bool(row["mastered"])}


def set_mistake_mastered(user_id: str, mistake_id: int, mastered: bool) -> bool:
    with get_conn() as conn:
        result = conn.execute("UPDATE mistakes SET mastered=? WHERE id=? AND book_id IN"
                              " (SELECT id FROM books WHERE user_id=?)",
                              (int(mastered), mistake_id, str(user_id)))
        return result.rowcount > 0


# ---------------------------------------------------------------------------
# story bible
# ---------------------------------------------------------------------------


def save_bible(book_id: int, bible: dict) -> None:
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO story_bibles(book_id, characters, mainline, chapter_summaries,"
            " foreshadowing, learned_knowledge, outline) VALUES(?,?,?,?,?,?,?)"
            " ON CONFLICT(book_id) DO UPDATE SET"
            " characters=excluded.characters, mainline=excluded.mainline,"
            " chapter_summaries=excluded.chapter_summaries,"
            " foreshadowing=excluded.foreshadowing,"
            " learned_knowledge=excluded.learned_knowledge, outline=excluded.outline",
            (book_id, json.dumps(bible["characters"], ensure_ascii=False), bible["mainline"],
             json.dumps(bible["chapter_summaries"], ensure_ascii=False),
             json.dumps(bible["foreshadowing"], ensure_ascii=False),
             json.dumps(bible["learned_knowledge"], ensure_ascii=False),
             json.dumps(bible["outline"], ensure_ascii=False)))


def get_bible(book_id: int) -> dict | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM story_bibles WHERE book_id=?", (book_id,)).fetchone()
        return dict(row) if row else None


# ---------------------------------------------------------------------------
# endings
# ---------------------------------------------------------------------------


def add_ending(book_id: int, ending_style: str, chapter_id: int) -> None:
    with get_conn() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO endings(book_id, ending_style, chapter_id, created_at)"
            " VALUES(?,?,?,?)",
            (book_id, ending_style, chapter_id, time.strftime("%Y-%m-%d %H:%M:%S")))


def get_unlocked_endings(book_id: int) -> list[str]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT ending_style FROM endings WHERE book_id=?", (book_id,)).fetchall()
        return [r["ending_style"] for r in rows]


def get_ending_chapters(book_id: int) -> dict[str, int]:
    """已解锁结局 → 对应的章节号（结局画廊用来打开阅读）。"""
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT e.ending_style, c.chapter_no FROM endings e"
            " JOIN chapters c ON c.id = e.chapter_id WHERE e.book_id=?",
            (book_id,)).fetchall()
        return {r["ending_style"]: int(r["chapter_no"]) for r in rows}


# ---------------------------------------------------------------------------
# progress
# ---------------------------------------------------------------------------


def get_progress(book_id: int) -> dict:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM progress WHERE book_id=?", (book_id,)).fetchone()
        if row:
            return dict(row)
        return {"book_id": book_id, "user_id": "local", "current_chapter": 0,
                "consecutive_fails": 0, "daily_count": 0, "daily_date": ""}


def set_progress(book_id: int, **fields) -> None:
    p = get_progress(book_id)
    p.update(fields)
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO progress(book_id, user_id, current_chapter, consecutive_fails,"
            " daily_count, daily_date) VALUES(?,?,?,?,?,?)"
            " ON CONFLICT(book_id) DO UPDATE SET"
            " current_chapter=excluded.current_chapter,"
            " consecutive_fails=excluded.consecutive_fails,"
            " daily_count=excluded.daily_count, daily_date=excluded.daily_date",
            (book_id, p["user_id"], p["current_chapter"], p["consecutive_fails"],
             p["daily_count"], p["daily_date"]))


# ---------------------------------------------------------------------------
# tasks（长任务：后台生成，浏览器轮询，重启可恢复）
# ---------------------------------------------------------------------------


def create_task(book_id: int, kind: str, chapter_no: int | None = None,
                style: str | None = None) -> int:
    now = time.strftime("%Y-%m-%d %H:%M:%S")
    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO tasks(book_id, kind, chapter_no, style, status, progress, error,"
            " created_at, updated_at) VALUES(?,?,?,?, 'pending', '', '', ?, ?)",
            (book_id, kind, chapter_no, style, now, now))
        return int(cur.lastrowid)


def get_task(task_id: int) -> dict | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
        return dict(row) if row else None


def get_active_task(book_id: int, kind: str, chapter_no: int | None = None) -> dict | None:
    """同一本书（可限定章节）进行中的同类任务；用于防止重复点击重复扣费。"""
    sql = ("SELECT * FROM tasks WHERE book_id=? AND kind=? AND status IN ('pending', 'running')")
    params: list = [book_id, kind]
    if chapter_no is not None:
        sql += " AND chapter_no=?"
        params.append(chapter_no)
    with get_conn() as conn:
        row = conn.execute(sql + " ORDER BY id DESC LIMIT 1", params).fetchone()
        return dict(row) if row else None


def get_latest_chapter_task(book_id: int, chapter_no: int) -> dict | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM tasks WHERE book_id=? AND chapter_no=? AND kind='chapter'"
            " ORDER BY id DESC LIMIT 1", (book_id, chapter_no)).fetchone()
        return dict(row) if row else None


def list_unfinished_tasks() -> list[dict]:
    with get_conn() as conn:
        return [dict(row) for row in conn.execute(
            "SELECT * FROM tasks WHERE status IN ('pending', 'running') ORDER BY id")]


def set_task_status(task_id: int, status: str, error: str | None = None,
                    public_error: str | None = None) -> None:
    with get_conn() as conn:
        conn.execute(
            "UPDATE tasks SET status=?, error=?, public_error=?, updated_at=? WHERE id=?",
            (status, error or "", public_error or "", time.strftime("%Y-%m-%d %H:%M:%S"), task_id))


def set_task_progress(task_id: int, progress: str) -> None:
    with get_conn() as conn:
        conn.execute(
            "UPDATE tasks SET progress=?, updated_at=? WHERE id=?",
            (progress, time.strftime("%Y-%m-%d %H:%M:%S"), task_id))


# ---------------------------------------------------------------------------
# usage（月度费用熔断用）
# ---------------------------------------------------------------------------


def record_usage(input_tokens: int, output_tokens: int) -> None:
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO usage(month, input_tokens, output_tokens, created_at)"
            " VALUES(?,?,?,?)",
            (time.strftime("%Y-%m"), int(input_tokens or 0), int(output_tokens or 0),
             time.strftime("%Y-%m-%d %H:%M:%S")))


def get_month_usage(month: str) -> dict:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT COALESCE(SUM(input_tokens),0) AS i, COALESCE(SUM(output_tokens),0) AS o"
            " FROM usage WHERE month=?", (month,)).fetchone()
        return {"input_tokens": int(row["i"]), "output_tokens": int(row["o"])}
