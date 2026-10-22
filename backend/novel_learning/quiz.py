"""判题与失败降级：答对 ≥3 解锁；失败给提示、换题、降难度，绝不卡死。"""
from __future__ import annotations

import logging

from . import config, db

LOG = logging.getLogger("novel_learning.quiz")


def validate_learning_questions(topic: str, questions: list[dict],
                                character_names: list[str] | None = None) -> bool:
    """只拦纯位置题（问「第几段」）；题目是否接地由 evidence 逐字校验负责。

    题目里出现人物、情节是本产品的正常要求——要考的就是「这一章读懂了没有」。
    """
    if not topic.strip() or not questions:
        return False
    location_cues = ("第几段", "哪一段", "哪个段落", "第几自然段", "文中第")
    for question in questions:
        stem = str(question.get("question", ""))
        if any(cue in stem for cue in location_cues):
            return False
    return True


def grade(questions: list[dict], answers: list[int]) -> dict:
    """判卷。answers 是每题的选项下标。返回详细结果。"""
    results = []
    correct = 0
    for i, (q, ans) in enumerate(zip(questions, answers)):
        right = ans == q.get("answer")
        if right:
            correct += 1
        results.append({
            "index": i,
            "question": q.get("question", ""),
            "correct": right,
            "answer": q.get("answer"),
            "source_paragraph": q.get("source_paragraph"),
            "evidence": q.get("evidence"),
        })
    passed = correct >= config.PASS_THRESHOLD
    return {"correct": correct, "total": len(questions),
            "passed": passed, "results": results}


def submit_answers(book_id: int, chapter: dict, answers: list[int]) -> dict:
    """提交答案并处理解锁 / 失败降级。返回给 UI 的反馈。"""
    questions = chapter["questions"]
    result = grade(questions, answers)
    p = db.get_progress(book_id)

    if result["passed"]:
        # 解锁本章（并推进进度指针）
        db.unlock_chapter(book_id, chapter["chapter_no"])
        if chapter["chapter_no"] > p["current_chapter"]:
            db.set_progress(book_id, current_chapter=chapter["chapter_no"], consecutive_fails=0)
        else:
            db.set_progress(book_id, consecutive_fails=0)
        return {"passed": True, "correct": result["correct"],
                "total": result["total"], "message": f"答对 {result['correct']}/{result['total']}，本章解锁！"}

    # 失败：累计连续失败次数
    fails = p["consecutive_fails"] + 1
    db.set_progress(book_id, consecutive_fails=fails)

    # 错题定位提示：段号来自原句在正文里的真实位置，不再是估算值
    hints = []
    for r in result["results"]:
        if r["correct"]:
            continue
        if r.get("source_paragraph"):
            hints.append(f"· 「{r['question'][:30]}…」→ 回看第 {r['source_paragraph']} 段")
        else:
            hints.append(f"· 「{r['question'][:30]}…」→ 看这道题的讲解")

    feedback = {
        "passed": False,
        "correct": result["correct"],
        "total": result["total"],
        "consecutive_fails": fails,
        "hints": hints,
    }

    # 文案只描述用户接下来能做什么；换题要用户点「换一套题」才会真正发生
    if fails == 1:
        feedback["message"] = "还差一点！可以回看原文再答一次，或者换一套新题。"
        feedback["action"] = "retry_new_questions"
    elif fails == 2:
        feedback["message"] = "题目可能偏难，可以换一套更简单的题。"
        feedback["action"] = "retry_lower_difficulty"
    else:
        feedback["message"] = "可以换一套最简单的题，答案都能在原文里直接找到。"
        feedback["action"] = "retry_easiest"
    return feedback


# ---------------------------------------------------------------------------
# 逐题闯关：每题答完立刻告诉对错与讲解；5 题答完按「第一次作答」判定是否解锁
# ---------------------------------------------------------------------------


class QuizFinished(RuntimeError):
    """这一套题已经答完（没通过），需要换一套新题才能再闯。"""


def knowledge_for_question(questions: list[dict], knowledge_points: list[dict], index: int) -> dict | None:
    """按出题规则找到这道题考的知识点：核心知识点出 memory/understanding/transfer，辅助知识点各出一道 locate。"""
    if not knowledge_points or not 0 <= index < len(questions):
        return None
    if questions[index].get("type") == "locate":
        order = sum(1 for previous in questions[:index] if previous.get("type") == "locate")
        aux = [kp for kp in knowledge_points if kp.get("role") == "aux"]
        return aux[order] if order < len(aux) else None
    core = [kp for kp in knowledge_points if kp.get("role") == "core"]
    return core[0] if core else None


def reveal(chapter: dict, index: int, choice: int) -> dict:
    """某题作答后才给出的信息：对错、正确选项、讲解、相关知识点。"""
    questions = chapter["questions"]
    question = questions[index]
    knowledge = knowledge_for_question(questions, chapter.get("knowledge_points") or [], index)
    return {
        "index": index,
        "choice": choice,
        "correct": choice == question.get("answer"),
        "answer": question.get("answer"),
        "explanation": question.get("explanation") or "",
        "knowledge": knowledge.get("point", "") if knowledge else "",
        "source_paragraph": question.get("source_paragraph"),
        "evidence": question.get("evidence") or "",
    }


def quiz_state(book_id: int, chapter: dict) -> dict:
    """当前这一套题的作答进度（只揭示已经答过的题）。"""
    total = len(chapter["questions"])
    attempt = db.get_quiz_attempt(book_id, chapter["chapter_no"])
    if not attempt or len(attempt["answers"]) != total:
        return {"answered": [None] * total, "finished": False}
    return {
        "answered": [None if choice is None else reveal(chapter, i, choice)
                     for i, choice in enumerate(attempt["answers"])],
        "finished": attempt["finished"],
    }


def answer_one(book_id: int, chapter: dict, index: int, choice: int) -> dict:
    """记录一道题的作答。同一题只认第一次作答，重复提交返回原结果。"""
    total = len(chapter["questions"])
    attempt = db.get_quiz_attempt(book_id, chapter["chapter_no"])
    if not attempt or len(attempt["answers"]) != total:
        attempt = {"answers": [None] * total, "finished": False}
    if attempt["finished"]:
        raise QuizFinished("这一套题已经答完了，换一套新题再闯关吧")
    answers = attempt["answers"]
    if answers[index] is None:
        answers[index] = choice
    feedback = reveal(chapter, index, answers[index])
    answered = sum(1 for value in answers if value is not None)
    result = None
    if answered == total:
        result = submit_answers(book_id, chapter, answers)
        attempt["finished"] = True
        if not result["passed"]:
            # 逐题闯关时正确答案已经揭晓，没过关只能换一套新题，文案按这个规则说
            result["message"] = {
                "retry_new_questions": "差一点就过关了！先回看原文，再换一套新题闯关。",
                "retry_lower_difficulty": "题目可能偏难，换一套更简单的题再试试。",
            }.get(result.get("action"), "换一套最简单的题吧，答案都能在原文里直接找到。")
    db.save_quiz_attempt(book_id, chapter["chapter_no"], answers, attempt["finished"])
    return {**feedback, "answered": answered, "total": total, "result": result}
