"""交互式 CLI：一问一答，零命令行知识。"""
from __future__ import annotations

import logging

from . import config, db, generator, security
from .models import ENDING_STYLES, GENRES
from .story_bible import load_or_create
from .quiz import submit_answers

LOG = logging.getLogger("novel_learning.cli")
LINE = "—" * 52


def ask(prompt: str) -> str:
    try:
        return input(prompt).strip()
    except (EOFError, KeyboardInterrupt):
        print("\n已退出。")
        raise SystemExit(0)


def ask_int(prompt: str, lo: int, hi: int) -> int:
    while True:
        val = ask(prompt)
        try:
            n = int(val)
            if lo <= n <= hi:
                return n
        except ValueError:
            pass
        print(f"请输入 {lo}–{hi} 之间的数字。")


def pick(options: list[str], prompt: str = "请选择：") -> int:
    for i, opt in enumerate(options, 1):
        print(f"  {i}. {opt}")
    return ask_int(prompt, 1, len(options))


# ---------------------------------------------------------------------------
# 章节展示与答题
# ---------------------------------------------------------------------------


def print_chapter(chapter: dict) -> None:
    print(f"\n{'=' * 52}")
    print(f"第 {chapter['chapter_no']} 章《{chapter['title']}》"
          + ("（大结局）" if chapter.get("is_ending") else ""))
    print("=" * 52)
    print(chapter["content"])
    print("=" * 52)


def _answer_letter(index: int) -> str:
    return chr(ord("A") + index)


def quiz_loop(book_id: int, chapter: dict) -> bool:
    """答题循环：答对解锁；失败给提示、换题、降难度。返回是否通过。"""
    questions = chapter["questions"]
    while True:
        print(f"\n{LINE}")
        print(f"本章测验（答对 {config.PASS_THRESHOLD}/{config.QUESTIONS_PER_CHAPTER} 解锁下一章）")
        print(LINE)
        answers: list[int] = []
        for i, q in enumerate(questions, 1):
            print(f"\n{i}. {q['question']}")
            for j, opt in enumerate(q["options"]):
                print(f"   {_answer_letter(j)}. {opt}")
            while True:
                ans = ask("你的答案（A-D）：").strip().upper()
                if ans in ("A", "B", "C", "D"):
                    answers.append(ord(ans) - ord("A"))
                    break
                print("请输入 A-D。")

        result = submit_answers(book_id, chapter, answers)
        print(f"\n{result['message']}")
        if result["passed"]:
            return True

        # 失败：展示错题定位
        print("\n错题提示（回看原文）：")
        for h in result.get("hints", []):
            print(f"  {h}")

        # 按连续失败次数换题 / 降难度
        fails = result.get("consecutive_fails", 1)
        if fails == 1:
            hint = "适中难度，与原文一致"
        elif fails == 2:
            hint = "偏简单，答案尽量能在原文直接找到"
        else:
            hint = "最易：纯定位题，答案直接在原文里，一眼能看到"

        choice = pick(["重读原文", "换一套题重答", "放弃本章（返回）"], "下一步：")
        if choice == 1:
            print_chapter(chapter)
            continue
        if choice == 2:
            print(f"\n正在换题（{hint}）…")
            try:
                generator.regenerate_questions(chapter, hint)
                questions = chapter["questions"]
                print("已换新题，重新作答。")
            except Exception as exc:  # noqa: BLE001
                print(f"换题失败：{exc}，请稍后重试。")
            continue
        return False


# ---------------------------------------------------------------------------
# 结局
# ---------------------------------------------------------------------------


def do_finalize(book_id: int, bible) -> None:
    print("\n正在生成大结局（回收全部伏笔）…")
    try:
        chapter = generator.generate_ending(book_id, bible)
        print_chapter(chapter)
        print("\n✅ 全书已完结。结局已收入「结局画廊」。")
    except Exception as exc:  # noqa: BLE001
        print(f"结局生成失败：{exc}")


def show_gallery(book_id: int, bible) -> None:
    unlocked = db.get_unlocked_endings(book_id)
    print(f"\n{LINE}\n结局画廊\n{LINE}")
    for style, desc in ENDING_STYLES.items():
        mark = "✅" if style in unlocked else "🔒"
        print(f"  {mark} {desc}")

    locked = [s for s in ENDING_STYLES if s not in unlocked]
    if locked:
        print("\n可「重走一个结局」解锁新的（复用前面所有章节，只重写大结局章）。")
        if ask("要重走一个结局吗？[y/N]：").strip().lower() in ("y", "yes", "是"):
            labels = [ENDING_STYLES[s] for s in locked]
            idx = pick(labels, "选择要解锁的结局：") - 1
            style = locked[idx]
            print(f"\n正在生成「{ENDING_STYLES[style]}」…")
            try:
                chapter = generator.generate_ending(book_id, bible, ending_style=style)
                print_chapter(chapter)
                print(f"\n✅ 已解锁新结局：{ENDING_STYLES[style]}")
            except Exception as exc:  # noqa: BLE001
                print(f"生成失败：{exc}")


# ---------------------------------------------------------------------------
# 阅读主循环
# ---------------------------------------------------------------------------


def reading_loop(book_id: int) -> None:
    book = db.get_book(book_id)
    bible = load_or_create(book_id)

    while True:
        p = db.get_progress(book_id)
        next_no = p["current_chapter"] + 1
        print(f"\n{LINE}")
        print(f"《{book['genre']} × {book['topic']}》 进度：已解锁第 {p['current_chapter']}/{book['planned_chapters']} 章"
              + ("　[已完结]" if book["status"] == "completed" else ""))
        print(LINE)

        opts: list[str] = []
        actions: list[str] = []
        if book["status"] != "completed" and next_no <= book["planned_chapters"]:
            opts.append(f"读第 {next_no} 章")
            actions.append("read")
        if book["status"] != "completed":
            opts.append("就此完结")
            actions.append("finalize")
        opts.append("结局画廊 / 重走一个结局")
        actions.append("gallery")
        opts.append("返回主菜单")
        actions.append("back")

        choice = pick(opts, "请选择：")
        action = actions[choice - 1]

        if action == "read":
            chapter = db.get_chapter(book_id, next_no)
            if chapter is None:
                print(f"\n正在生成第 {next_no} 章（异步，约 30s–2min）…")
                try:
                    chapter = generator.generate_chapter(book_id, next_no, bible)
                except Exception as exc:  # noqa: BLE001
                    print(f"生成失败：{exc}")
                    continue
            print_chapter(chapter)
            if not chapter.get("is_ending"):
                quiz_loop(book_id, chapter)
                p = db.get_progress(book_id)
                if p["current_chapter"] >= book["planned_chapters"]:
                    print("\n🎉 已读完计划章节！可以「就此完结」收尾。")
        elif action == "finalize":
            do_finalize(book_id, bible)
        elif action == "gallery":
            show_gallery(book_id, bible)
        else:
            return


# ---------------------------------------------------------------------------
# 新建书
# ---------------------------------------------------------------------------


def new_book() -> None:
    print(f"\n{LINE}\n新建一本小说\n{LINE}")
    g = pick(GENRES, "选小说类型：")
    genre = GENRES[g - 1]
    topic = ask("输入想学的主题（如 AI、英语、复利）：") or "AI"

    mode = pick(["整本连载（多章）", "快速短篇（一个知识点，1 章）"], "模式：")
    if mode == 1:
        chapters = ask_int("章节数（1–50）：", 1, 50)
    else:
        chapters = 1
        topic = ask(f"输入一个词或知识点（当前：{topic}）：") or topic

    min_w = ask_int("每章最少字数（建议 1500）：", 800, 5000)
    max_w = ask_int("每章最多字数（建议 2500）：", min_w, 10000)

    book_id = db.create_book(genre, topic, chapters, min_w, max_w,
                             mode="quick" if mode == 2 else "full")

    print("\n正在初始化全书大纲 + 故事档案（结局已随机暗定，不剧透）…")
    try:
        generator.start_book(book_id)
    except Exception as exc:  # noqa: BLE001
        print(f"初始化失败：{exc}")
        return
    print(f"✅ 书已创建（ID={book_id}）。")
    reading_loop(book_id)


def continue_reading() -> None:
    with db.get_conn() as conn:
        rows = conn.execute(
            "SELECT id, genre, topic, planned_chapters, status FROM books ORDER BY id DESC"
        ).fetchall()
    if not rows:
        print("还没有书，先去新建一本。")
        return
    print(f"\n{LINE}\n已有哪些书\n{LINE}")
    for r in rows:
        print(f"  {r['id']}. {r['genre']} × {r['topic']}（{r['planned_chapters']} 章，{r['status']}）")
    bid = ask_int("输入书 ID（0 返回）：", 0, 999999)
    if bid:
        reading_loop(bid)


# ---------------------------------------------------------------------------
# 主菜单
# ---------------------------------------------------------------------------


def main() -> None:
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s %(levelname)s %(name)s %(message)s")
    db.init_db()

    print(f"\n{'=' * 52}")
    print("网文阅读 × 学习关卡（第一版）")
    print(f"模型：{config.MODEL_ID}（换模型改 .env 即可）")
    print("=" * 52)

    while True:
        print(f"\n{LINE}")
        print("主菜单")
        print("  1. 新建一本小说")
        print("  2. 继续读（已有书）")
        print("  0. 退出")
        c = ask("请选择：")
        if c == "1":
            new_book()
        elif c == "2":
            continue_reading()
        elif c == "0":
            print("再见！")
            break
        else:
            print("请输入 0–2。")


if __name__ == "__main__":
    main()
