"""安全守卫：18+ 门槛、关键词兜底、每日生成上限、越权拒绝。"""
from __future__ import annotations

import logging

from . import config, db

LOG = logging.getLogger("novel_learning.security")

# 关键词兜底（模型自审之外的廉价防线；命中即判不安全）
BLOCKED_KEYWORDS = [
    "自杀方法", "制毒", "制造炸弹", "如何杀人", "儿童色情",
    "真人儿童", "暴力恐怖袭击", "教唆犯罪",
]


def require_adult() -> bool:
    """18+ 门槛：MVP 用自声明确认（产品化后换实名/支付校验）。"""
    ans = input("本产品仅面向 18 岁以上成年人，请确认你已满 18 岁 [y/N]：").strip().lower()
    return ans in ("y", "yes", "是")


def keyword_moderate(text: str) -> tuple[bool, str]:
    """关键词兜底审核。返回 (safe, reason)。"""
    for kw in BLOCKED_KEYWORDS:
        if kw in text:
            return False, f"命中敏感词：{kw}"
    return True, ""


def check_daily_limit(user_id: str = "local", book_id: int | None = None) -> None:
    """每日生成上限（防滥用）；失败重试不计数（由调用方控制）。"""
    if book_id is None:
        return
    today = __import__("time").strftime("%Y-%m-%d")
    p = db.get_progress(book_id)
    count = p["daily_count"] if p["daily_date"] == today else 0
    if count >= config.DAILY_GEN_LIMIT:
        raise PermissionError(f"今日生成次数已达上限（{config.DAILY_GEN_LIMIT} 章/天），明天再来。")


def bump_daily_count(book_id: int) -> None:
    """成功生成一章后 +1（重试失败不调用此函数）。"""
    import time as _t
    today = _t.strftime("%Y-%m-%d")
    p = db.get_progress(book_id)
    count = (p["daily_count"] if p["daily_date"] == today else 0) + 1
    db.set_progress(book_id, daily_count=count, daily_date=today)


def check_monthly_cost() -> None:
    """月度费用熔断：估算本月已消耗成本，到顶自动停（D4）。"""
    import time as _t
    month = _t.strftime("%Y-%m")
    u = db.get_month_usage(month)
    cost = (u["input_tokens"] * config.PRICE_INPUT_PER_1M
            + u["output_tokens"] * config.PRICE_OUTPUT_PER_1M) / 1_000_000
    if cost >= config.MONTHLY_COST_LIMIT:
        raise PermissionError(
            f"本月模型费用已达上限（约 {cost:.2f} 元 / {config.MONTHLY_COST_LIMIT:.0f} 元），已自动停用。"
            f"如需继续请下月再试，或联系调整上限。")


def guard_unlock(book_id: int, chapter_no: int) -> None:
    """越权拒绝：只有「已解锁到当前章」才能读下一章。"""
    p = db.get_progress(book_id)
    if chapter_no > p["current_chapter"] + 1:
        raise PermissionError(
            f"无权访问第 {chapter_no} 章：当前只解锁到第 {p['current_chapter']} 章。")
