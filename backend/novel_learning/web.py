"""FastAPI 应用：把核心模块暴露为网页可调用的 API。

长任务（大纲/章节/结局/换题）统一走「创建任务 → 后台线程执行 → 轮询状态」，
任务状态持久化在 SQLite，进程重启后可恢复。统一错误结构 {"error":{"code","message"}}。
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import re
import secrets
import threading
import time
from contextlib import asynccontextmanager
from typing import Literal

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import config, db, generator, security
from .models import ENDING_STYLES, GENRES
from .quiz import QuizFinished, answer_one, quiz_state, submit_answers
from .story_bible import load_or_create

LOG = logging.getLogger("novel_learning.web")
STATIC_DIR = config.ROOT / "static"
SPAWN_LOCK = threading.Lock()
ANSWER_LOCK = threading.Lock()   # 逐题作答是「读-改-写」，串行化避免连点覆盖
_BOOK_LOCKS: dict[int, threading.Lock] = {}
_BOOK_LOCKS_GUARD = threading.Lock()
TOPIC_MAX_LENGTH = 60

# 换题难度只接受这三档（与前端、旧版页面发送的文案一致），不把客户端任意文本写进提示词
DIFFICULTY_HINTS = (
    "适中难度，与原文一致",
    "偏简单，答案尽量能在原文直接找到",
    "最易：纯定位题，答案直接在原文里，一眼能看到",
)

# 任务失败时给用户看的说明；原始异常只写日志和数据库 error 列
TASK_FAILURE_MESSAGES = {
    "outline": "故事大纲没有生成成功，请稍后重试。",
    "chapter": "这一章没有写成功，请稍后重试。",
    "regen_questions": "新题目没有生成成功，请稍后再换一次。",
    "ending": "大结局没有写成功，请稍后重试。",
}


# ---------------------------------------------------------------------------
# 请求模型
# ---------------------------------------------------------------------------

class BookCreate(BaseModel):
    genre: str
    topic: str = "AI"
    planned_chapters: int = Field(ge=1, le=50)
    min_words: int = Field(ge=800, le=5000)
    max_words: int = Field(ge=800, le=10000)
    mode: Literal["full", "quick"] = "full"


class CodeRequest(BaseModel):
    phone: str
    demo_autofill: bool = False


class LoginRequest(BaseModel):
    phone: str
    code: str
    agreed: bool = False


class AnswerSubmit(BaseModel):
    answers: list[int]


class AnswerOne(BaseModel):
    index: int
    choice: int


class MistakeUpdate(BaseModel):
    mastered: bool = Field(strict=True)


class RegenRequest(BaseModel):
    difficulty_hint: str = "适中难度，与原文一致"


# ---------------------------------------------------------------------------
# 统一错误结构
# ---------------------------------------------------------------------------

def err(code: str, message: str, status: int = 400) -> JSONResponse:
    return JSONResponse(status_code=status,
                        content={"error": {"code": code, "message": message}})


def _not_found(msg: str) -> None:
    raise HTTPException(status_code=404, detail=msg)


# ---------------------------------------------------------------------------
# 对外数据：只返回界面需要的字段（不含正确答案、暗定结局等）
# ---------------------------------------------------------------------------

BOOK_PUBLIC_FIELDS = ("id", "genre", "topic", "title", "planned_chapters", "mode",
                      "status", "min_words", "max_words", "created_at")
QUESTION_PUBLIC_FIELDS = ("type", "question", "options", "source_paragraph")


def public_book(book: dict) -> dict:
    return {key: book.get(key) for key in BOOK_PUBLIC_FIELDS}


def public_progress(progress: dict) -> dict:
    return {"current_chapter": progress["current_chapter"],
            "consecutive_fails": progress["consecutive_fails"]}


def public_knowledge(chapter: dict) -> list[dict]:
    return [{"role": kp.get("role", ""), "point": kp.get("point", "")}
            for kp in chapter.get("knowledge_points") or [] if isinstance(kp, dict) and kp.get("point")]


def public_chapter(chapter: dict) -> dict:
    questions = [{key: q.get(key) for key in QUESTION_PUBLIC_FIELDS}
                 for q in chapter.get("questions") or [] if isinstance(q, dict)]
    data = {"chapter_no": chapter["chapter_no"], "title": chapter["title"],
            "content": chapter["content"], "questions": questions,
            "status": chapter["status"], "is_ending": bool(chapter.get("is_ending"))}
    # 知识清单是阅读材料，当前可读章节在闯关前后都展示；题目答案仍按作答揭晓。
    data["knowledge_points"] = public_knowledge(chapter)
    return data


def _last_paragraph(content: str, limit: int = 150) -> str:
    """「上回说到」：取上一章最后一段，去掉段落标记。"""
    lines = [line.strip() for line in content.split("\n")
             if line.strip() and not re.fullmatch(r"第\s*\d+\s*段\s*[:：]?|（AI 生成内容）", line.strip())]
    if not lines:
        return ""
    text = lines[-1]
    return text if len(text) <= limit else "…" + text[-limit:]


def public_task_error(task: dict) -> str | None:
    if task["status"] != "error":
        return None
    return task.get("public_error") or TASK_FAILURE_MESSAGES.get(task["kind"], "生成没有完成，请稍后重试。")


def _book_lock(book_id: int) -> threading.Lock:
    with _BOOK_LOCKS_GUARD:
        return _BOOK_LOCKS.setdefault(book_id, threading.Lock())


# ---------------------------------------------------------------------------
# 后台任务
# ---------------------------------------------------------------------------

def _execute_task(task_id: int) -> None:
    existing_task = db.get_task(task_id)
    if not existing_task or existing_task["status"] == "done":
        return
    if existing_task["kind"] == "chapter" and db.get_chapter(existing_task["book_id"], existing_task["chapter_no"]):
        db.set_task_status(task_id, "done")
        return
    db.set_task_status(task_id, "running")

    def _progress(msg: str) -> None:
        db.set_task_progress(task_id, msg)

    try:
        t = db.get_task(task_id)
        if not t:
            return
        book_id, kind = t["book_id"], t["kind"]
        if kind == "outline":
            generator.start_book(book_id, on_progress=_progress)
        elif kind == "chapter":
            generator.generate_chapter(book_id, t["chapter_no"],
                                       load_or_create(book_id), on_progress=_progress)
        elif kind == "ending":
            generator.generate_ending(book_id, load_or_create(book_id),
                                      t.get("style"), on_progress=_progress)
        elif kind == "regen_questions":
            chapter = db.get_chapter(book_id, t["chapter_no"])
            _progress("正在重新出题…")
            generator.regenerate_questions(chapter, t.get("style") or "适中难度，与原文一致")
        else:
            raise RuntimeError(f"未知任务类型：{kind}")
        db.set_task_status(task_id, "done")
    except PermissionError as exc:
        # 费用熔断、每日上限：文案本来就是写给用户看的，原样告知
        LOG.warning("任务 %s 被拦截：%s", task_id, exc)
        db.set_task_status(task_id, "error", str(exc), public_error=str(exc))
    except Exception as exc:  # noqa: BLE001
        LOG.exception("任务 %s 失败", task_id)
        db.set_task_status(task_id, "error", str(exc))


def _run_task(task_id: int) -> None:
    task = db.get_task(task_id)
    if task:
        with _book_lock(task["book_id"]):
            _execute_task(task_id)


def _spawn(kind: str, book_id: int, chapter_no: int | None = None,
           style: str | None = None) -> int:
    with SPAWN_LOCK:
        # 同一本书同类任务进行中时复用原任务：重复点击、两个窗口同时操作都不会重复扣费
        if kind in ("outline", "ending"):
            existing = db.get_active_task(book_id, kind)
        elif chapter_no is not None:
            existing = db.get_active_task(book_id, kind, chapter_no)
        else:
            existing = None
        if existing:
            return existing["id"]
        task_id = db.create_task(book_id, kind, chapter_no, style)
        threading.Thread(target=_run_task, args=(task_id,), daemon=True).start()
        return task_id


# ---------------------------------------------------------------------------
# 应用
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(_app: FastAPI):
    db.init_db()
    for unfinished in db.list_unfinished_tasks():
        threading.Thread(target=_run_task, args=(unfinished["id"],), daemon=True).start()
    yield


app = FastAPI(title="悦读 · 网文阅读 × 学习关卡", lifespan=lifespan)


# ---------------------------------------------------------------------------
# 登录与数据隔离
# ---------------------------------------------------------------------------

SESSION_COOKIE = "yuedu_session"
PHONE_PATTERN = re.compile(r"^1\d{10}$")
BOOK_PATH = re.compile(r"^/api/books/(\d+)(?:/|$)")
TASK_PATH = re.compile(r"^/api/tasks/(\d+)$")


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _owns(user: dict, book_id: int) -> bool:
    book = db.get_book(book_id)
    return bool(book) and book["user_id"] == str(user["id"])


@app.middleware("http")
async def require_login(request: Request, call_next):
    """除登录接口外，所有 /api 接口都要先登录；书和任务只能由书的主人访问。

    别人的书一律按「不存在」处理，不暴露这本书是否存在。
    """
    path = request.url.path
    if not path.startswith("/api/") or path.startswith("/api/auth/"):
        return await call_next(request)
    token = request.cookies.get(SESSION_COOKIE, "")
    user = db.get_session_user(_hash_token(token)) if token else None
    if not user:
        return err("UNAUTHORIZED", "请先登录", 401)
    book_match = BOOK_PATH.match(path)
    if book_match and not _owns(user, int(book_match.group(1))):
        return err("HTTP_404", f"书 {book_match.group(1)} 不存在", 404)
    task_match = TASK_PATH.match(path)
    if task_match:
        task = db.get_task(int(task_match.group(1)))
        if not task or not _owns(user, task["book_id"]):
            return err("HTTP_404", f"任务 {task_match.group(1)} 不存在", 404)
    request.state.user = user
    return await call_next(request)


def public_user(user: dict) -> dict:
    phone = user["phone"]
    return {"id": user["id"], "nickname": user["nickname"],
            "phone_masked": phone[:3] + "****" + phone[-4:], "created_at": user["created_at"]}



@app.get("/api/mistakes")
def list_mistakes(request: Request):
    return {"mistakes": db.list_mistakes(str(request.state.user["id"]))}


@app.get("/api/mistakes/{mistake_id}")
def get_mistake(mistake_id: int, request: Request):
    item = db.get_mistake(str(request.state.user["id"]), mistake_id)
    if not item:
        return err("HTTP_404", "这道错题不存在", 404)
    return {"mistake": item}


@app.patch("/api/mistakes/{mistake_id}")
def update_mistake(mistake_id: int, payload: MistakeUpdate, request: Request):
    if not db.set_mistake_mastered(str(request.state.user["id"]), mistake_id, payload.mastered):
        return err("HTTP_404", "这道错题不存在", 404)
    return {"id": mistake_id, "mastered": payload.mastered}


@app.post("/api/auth/code")
def send_code(payload: CodeRequest):
    # 演示版不发真实短信，只校验手机号格式；上线前在这里接短信服务并加限频
    if not PHONE_PATTERN.match(payload.phone.strip()):
        return err("INVALID_PHONE", "请输入正确的 11 位手机号", 400)
    # 必须由本地环境显式开启；旧页面的自动请求在关闭开关后也不得变成短信发送。
    if payload.demo_autofill and not config.DEMO_LOGIN_AUTOFILL:
        return err("DEMO_DISABLED", "测试自动填写已关闭，请手动获取验证码", 403)
    if config.DEMO_LOGIN_AUTOFILL:
        return JSONResponse({"sent": True, "cooldown": 0, "demo_code": config.DEMO_LOGIN_CODE},
                            headers={"Cache-Control": "no-store"})
    return {"sent": True, "cooldown": 60}


@app.post("/api/auth/login")
def login(payload: LoginRequest):
    phone = payload.phone.strip()
    if not PHONE_PATTERN.match(phone):
        return err("INVALID_PHONE", "请输入正确的 11 位手机号", 400)
    if not hmac.compare_digest(payload.code.strip(), config.DEMO_LOGIN_CODE):
        return err("INVALID_CODE", "验证码不正确", 400)
    if not payload.agreed:
        return err("AGREEMENT_REQUIRED", "请先阅读并同意《用户协议》和《隐私政策》", 400)
    user, created = db.get_or_create_user(phone)
    token = secrets.token_urlsafe(32)
    max_age = config.SESSION_DAYS * 86400
    db.create_session(_hash_token(token), user["id"], int(time.time()) + max_age)
    response = JSONResponse({"user": public_user(user), "created": created})
    response.set_cookie(SESSION_COOKIE, token, max_age=max_age, httponly=True,
                        samesite="lax", secure=config.COOKIE_SECURE, path="/")
    return response


@app.post("/api/auth/logout")
def logout(request: Request):
    token = request.cookies.get(SESSION_COOKIE, "")
    if token:
        db.delete_session(_hash_token(token))
    response = JSONResponse({"ok": True})
    response.delete_cookie(SESSION_COOKIE, path="/")
    return response


@app.get("/api/auth/me")
def me(request: Request):
    """未登录时返回 user=null（不算错误），方便页面决定显示「登录」还是头像。"""
    token = request.cookies.get(SESSION_COOKIE, "")
    user = db.get_session_user(_hash_token(token)) if token else None
    payload = {"user": public_user(user) if user else None,
               "demo_autofill": config.DEMO_LOGIN_AUTOFILL}
    # 本机演示：告诉登录页「上次用的是哪个号」，一键进入才不会进到空账号
    if config.DEMO_LOGIN_AUTOFILL and not user:
        payload["demo_phone"] = db.latest_login_phone()
    return payload


@app.get("/api/me/stats")
def my_stats(request: Request):
    return {"stats": db.user_stats(request.state.user["id"])}


@app.exception_handler(PermissionError)
async def _perm_err(_req, exc):
    return err("FORBIDDEN", str(exc), 403)


@app.exception_handler(generator.GenerationError)
async def _gen_err(_req, exc):
    return err("GENERATION_FAILED", str(exc), 500)


@app.exception_handler(HTTPException)
async def _http_err(_req, exc):
    detail = exc.detail if isinstance(exc.detail, str) else "请求错误"
    return err(f"HTTP_{exc.status_code}", detail, exc.status_code)


@app.exception_handler(RequestValidationError)
async def _valid_err(_req, exc):
    return err("INVALID_INPUT", "请求参数不合法（请检查字段类型与范围）", 422)


@app.exception_handler(Exception)
async def _unhandled(_req, exc):
    LOG.exception("未处理异常")
    return err("INTERNAL", "服务内部错误，请稍后重试", 500)


# ---------------------------------------------------------------------------
# 书
# ---------------------------------------------------------------------------

@app.post("/api/books")
def create_book(payload: BookCreate, request: Request):
    if payload.genre not in GENRES:
        return err("INVALID_GENRE", f"小说类型必须是：{' / '.join(GENRES)}", 400)
    if payload.max_words < payload.min_words:
        return err("INVALID_WORDS", "每章最多字数不能小于最少字数", 400)
    topic = payload.topic.strip() or "AI"
    if len(topic) > TOPIC_MAX_LENGTH:
        return err("TOPIC_TOO_LONG", f"学习主题请控制在 {TOPIC_MAX_LENGTH} 字以内", 400)
    if not security.keyword_moderate(topic)[0]:
        return err("TOPIC_BLOCKED", "这个主题不适合生成，请换一个", 400)
    chapters = 1 if payload.mode == "quick" else payload.planned_chapters
    book_id = db.create_book(payload.genre, topic, chapters,
                             payload.min_words, payload.max_words, mode=payload.mode,
                             user_id=str(request.state.user["id"]))
    task_id = _spawn("outline", book_id)
    return {"book_id": book_id, "task_id": task_id}


@app.get("/api/books")
def list_books(request: Request):
    with db.get_conn() as conn:
        rows = conn.execute(
            "SELECT b.id, b.genre, b.topic, b.title, b.planned_chapters, b.mode, b.status,"
            " b.created_at, COALESCE(p.current_chapter, 0) AS current_chapter"
            " FROM books b LEFT JOIN progress p ON p.book_id = b.id"
            " WHERE b.archived=0 AND b.user_id=? ORDER BY b.id DESC",
            (str(request.state.user["id"]),)).fetchall()
    return {"books": [dict(r) for r in rows]}


@app.get("/api/books/{book_id}")
def book_detail(book_id: int):
    book = db.get_book(book_id)
    if not book:
        _not_found(f"书 {book_id} 不存在")
    p = db.get_progress(book_id)
    return {"book": public_book(book), "progress": public_progress(p),
            "endings": db.get_unlocked_endings(book_id),
            "outline_ready": db.get_bible(book_id) is not None}


@app.post("/api/books/{book_id}/outline/retry")
def retry_outline(book_id: int):
    book = db.get_book(book_id)
    if not book:
        _not_found(f"书 {book_id} 不存在")
    if db.get_bible(book_id):
        return err("OUTLINE_READY", "这本书的大纲已经生成", 400)
    return {"task_id": _spawn("outline", book_id)}


# ---------------------------------------------------------------------------
# 章节
# ---------------------------------------------------------------------------

@app.post("/api/books/{book_id}/chapters/next")
def start_next_chapter(book_id: int):
    book = db.get_book(book_id)
    if not book:
        _not_found(f"书 {book_id} 不存在")
    if book["status"] == "completed":
        return err("BOOK_COMPLETED", "全书已完结", 400)
    if not db.get_bible(book_id):
        return err("OUTLINE_NOT_READY", "故事大纲还没有生成，请先重试生成大纲", 409)
    p = db.get_progress(book_id)
    next_no = p["current_chapter"] + 1
    if next_no > book["planned_chapters"]:
        return err("ALL_READ", "已读完计划章节，可以「就此完结」", 400)
    existing = db.get_chapter(book_id, next_no)
    if existing:
        return {"task_id": None, "chapter_no": next_no, "chapter": public_chapter(existing)}
    task_id = _spawn("chapter", book_id, chapter_no=next_no)
    return {"task_id": task_id, "chapter_no": next_no}


@app.post("/api/books/{book_id}/chapters/{chapter_no}/prefetch-next")
def prefetch_next_chapter(book_id: int, chapter_no: int):
    book = db.get_book(book_id)
    if not book:
        _not_found(f"书 {book_id} 不存在")
    if book["status"] == "completed" or chapter_no >= book["planned_chapters"]:
        return err("NO_NEXT_CHAPTER", "没有需要提前生成的下一章", 400)
    p = db.get_progress(book_id)
    if chapter_no != p["current_chapter"] + 1 or not db.get_chapter(book_id, chapter_no):
        return err("INVALID_PROGRESS", "请先阅读当前章节", 403)
    next_no = chapter_no + 1
    if db.get_chapter(book_id, next_no):
        return {"task_id": None, "chapter_no": next_no, "ready": True}
    previous_task = db.get_latest_chapter_task(book_id, next_no)
    if previous_task and previous_task["status"] == "error":
        # 自动预生成失败后刷新页面不重复扣模型用量；解锁后用户可手动重试。
        return {"task_id": None, "chapter_no": next_no, "ready": False}
    task_id = _spawn("chapter", book_id, chapter_no=next_no)
    return {"task_id": task_id, "chapter_no": next_no, "ready": False}


def _is_readable_ending(book_id: int, chapter: dict) -> bool:
    """已完结的书，收集到的每个结局都可以读（重走的结局章节号会排在后面）。"""
    book = db.get_book(book_id)
    return bool(chapter.get("is_ending")) and book is not None and book["status"] == "completed"


@app.get("/api/books/{book_id}/knowledge")
def book_knowledge(book_id: int):
    """按章节汇总当前可读知识；不暴露预生成、尚未解锁章节的内容。"""
    book = db.get_book(book_id)
    if not book:
        _not_found(f"书 {book_id} 不存在")
    readable_through = db.get_progress(book_id)["current_chapter"] + 1
    chapters = [
        {"chapter_no": chapter["chapter_no"], "title": chapter["title"],
         "is_ending": bool(chapter.get("is_ending")), "knowledge_points": public_knowledge(chapter)}
        for chapter in db.list_chapters(book_id)
        if chapter["chapter_no"] <= readable_through
        or (chapter.get("is_ending") and book["status"] == "completed")
    ]
    return {"chapters": chapters}


@app.get("/api/books/{book_id}/chapters/{chapter_no}")
def get_chapter(book_id: int, chapter_no: int):
    chapter = db.get_chapter(book_id, chapter_no)
    if not chapter:
        _not_found(f"第 {chapter_no} 章不存在（可能尚未生成）")
    if not _is_readable_ending(book_id, chapter):
        security.guard_unlock(book_id, chapter_no)
    data = public_chapter(chapter)
    if chapter["status"] != "unlocked" and not chapter.get("is_ending"):
        data["quiz"] = quiz_state(book_id, chapter)
    return {"chapter": data}


@app.post("/api/books/{book_id}/chapters/{chapter_no}/answer")
def answer_question(book_id: int, chapter_no: int, payload: AnswerOne):
    """逐题闯关：答一题立刻返回对错与讲解；5 题答完自动判定是否解锁。"""
    chapter = db.get_chapter(book_id, chapter_no)
    if not chapter:
        _not_found(f"第 {chapter_no} 章不存在")
    security.guard_unlock(book_id, chapter_no)
    if chapter["status"] == "unlocked":
        return err("ALREADY_PASSED", "这一章已经通关了", 400)
    if chapter.get("is_ending"):
        return err("NO_QUIZ", "大结局没有闯关题", 400)
    questions = chapter["questions"]
    if not 0 <= payload.index < len(questions) or not 0 <= payload.choice < len(questions[payload.index].get("options") or []):
        return err("INVALID_ANSWER", "请选择一个有效选项", 400)
    with ANSWER_LOCK:
        try:
            response = answer_one(book_id, chapter, payload.index, payload.choice)
        except QuizFinished as exc:
            return err("QUIZ_FINISHED", str(exc), 409)
    if response["result"] and response["result"]["passed"]:
        response["result"]["knowledge_points"] = public_knowledge(chapter)
    return response


@app.post("/api/books/{book_id}/chapters/{chapter_no}/submit")
def submit_chapter(book_id: int, chapter_no: int, payload: AnswerSubmit):
    chapter = db.get_chapter(book_id, chapter_no)
    if not chapter:
        _not_found(f"第 {chapter_no} 章不存在")
    security.guard_unlock(book_id, chapter_no)
    if db.get_quiz_attempt(book_id, chapter_no):
        # 逐题闯关会揭晓答案；同一套题不能再整套提交，避免看完答案再交卷
        return err("QUIZ_IN_PROGRESS", "这一套题已经在闯关中作答，请继续闯关或换一套题", 409)
    questions = chapter["questions"]
    if len(payload.answers) != len(questions) or any(
            not 0 <= answer < len(question.get("options") or [])
            for answer, question in zip(payload.answers, questions)):
        return err("INVALID_ANSWERS", "请答完所有题目再提交", 400)
    return submit_answers(book_id, chapter, payload.answers)


@app.post("/api/books/{book_id}/chapters/{chapter_no}/regenerate")
def regenerate_chapter(book_id: int, chapter_no: int, payload: RegenRequest):
    chapter = db.get_chapter(book_id, chapter_no)
    if not chapter:
        _not_found(f"第 {chapter_no} 章不存在")
    security.guard_unlock(book_id, chapter_no)
    if chapter["status"] == "unlocked" or db.get_progress(book_id)["consecutive_fails"] < 1:
        return err("REGEN_NOT_NEEDED", "答题没通过时才需要换题", 400)
    hint = payload.difficulty_hint if payload.difficulty_hint in DIFFICULTY_HINTS else DIFFICULTY_HINTS[0]
    task_id = _spawn("regen_questions", book_id, chapter_no=chapter_no, style=hint)
    return {"task_id": task_id}


@app.get("/api/books/{book_id}/recap")
def book_recap(book_id: int):
    """等待生成时给用户看的内容：故事简介、登场人物、上回说到、已学知识（只含已读部分，不剧透）。"""
    if not db.get_book(book_id):
        _not_found(f"书 {book_id} 不存在")
    bible = db.get_bible(book_id)
    current = db.get_progress(book_id)["current_chapter"]
    previous = None
    knowledge = []
    for no in range(1, current + 1):
        chapter = db.get_chapter(book_id, no)
        if not chapter:
            continue
        knowledge += [{"chapter_no": no, **kp} for kp in public_knowledge(chapter)]
        if no == current:
            previous = {"chapter_no": no, "title": chapter["title"], "excerpt": _last_paragraph(chapter["content"])}
    characters = []
    if bible:
        try:
            characters = [{"name": str(c.get("name", "")), "identity": str(c.get("identity", ""))}
                          for c in json.loads(bible["characters"] or "[]") if isinstance(c, dict) and c.get("name")][:4]
        except (json.JSONDecodeError, TypeError):
            characters = []
    return {"mainline": bible["mainline"] if bible else "", "characters": characters,
            "previous": previous, "knowledge": knowledge}


# ---------------------------------------------------------------------------
# 结局
# ---------------------------------------------------------------------------

@app.post("/api/books/{book_id}/finalize")
def finalize_book(book_id: int):
    book = db.get_book(book_id)
    if not book:
        _not_found(f"书 {book_id} 不存在")
    if book["status"] == "completed":
        return err("BOOK_COMPLETED", "全书已完结", 400)
    if db.get_progress(book_id)["current_chapter"] < 1:
        return err("NOTHING_READ", "先读完至少一章，再选择完结", 400)
    task_id = _spawn("ending", book_id)
    return {"task_id": task_id}


@app.post("/api/books/{book_id}/endings/{style}")
def rewalk_ending(book_id: int, style: str):
    if style not in ENDING_STYLES:
        return err("INVALID_STYLE", f"结局风格必须是：{' / '.join(ENDING_STYLES)}", 400)
    book = db.get_book(book_id)
    if not book:
        _not_found(f"书 {book_id} 不存在")
    if book["status"] != "completed":
        return err("BOOK_NOT_COMPLETED", "读完并完结本书后，才能重走其他结局", 400)
    if style in db.get_unlocked_endings(book_id):
        return err("ENDING_UNLOCKED", "这个结局已经收集过了", 400)
    if db.get_active_task(book_id, "ending"):
        return err("ENDING_IN_PROGRESS", "已有一个结局正在生成，请等它完成", 409)
    task_id = _spawn("ending", book_id, style=style)
    return {"task_id": task_id}


@app.get("/api/books/{book_id}/endings")
def list_endings(book_id: int):
    if not db.get_book(book_id):
        _not_found(f"书 {book_id} 不存在")
    chapters = db.get_ending_chapters(book_id)
    return {"endings": [
        {"style": s, "desc": ENDING_STYLES[s], "unlocked": s in chapters,
         "chapter_no": chapters.get(s)}
        for s in ENDING_STYLES]}


# ---------------------------------------------------------------------------
# 任务轮询
# ---------------------------------------------------------------------------

@app.get("/api/tasks/{task_id}")
def task_status(task_id: int):
    t = db.get_task(task_id)
    if not t:
        _not_found(f"任务 {task_id} 不存在")
    return {"task_id": t["id"], "status": t["status"], "kind": t["kind"],
            "chapter_no": t["chapter_no"], "progress": t.get("progress", ""),
            "error": public_task_error(t)}


# ---------------------------------------------------------------------------
# 静态页面
# ---------------------------------------------------------------------------

STATIC_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/")
def index():
    return FileResponse(str(STATIC_DIR / "index.html"))
