"""安全边界：关键词兜底、每日上限、越权、18+。"""
import time

import pytest

from novel_learning import db, security


def test_keyword_moderate_blocks():
    ok, _ = security.keyword_moderate("教你如何制毒的方法")
    assert ok is False


def test_keyword_moderate_pass():
    ok, _ = security.keyword_moderate("主角逆袭的普通爽文剧情")
    assert ok is True


def test_daily_limit(book_factory):
    bid = book_factory()
    today = time.strftime("%Y-%m-%d")
    db.set_progress(bid, daily_count=20, daily_date=today)
    with pytest.raises(PermissionError):
        security.check_daily_limit(book_id=bid)


def test_daily_limit_new_day_resets(book_factory):
    bid = book_factory()
    db.set_progress(bid, daily_count=20, daily_date="2020-01-01")  # 非今天
    security.check_daily_limit(book_id=bid)  # 不应抛错


def test_guard_unlock(book_factory):
    bid = book_factory()
    security.guard_unlock(bid, 1)  # 第 1 章允许
    with pytest.raises(PermissionError):
        security.guard_unlock(bid, 3)  # 第 3 章越权


def test_monthly_cost_blocks_when_over_limit(monkeypatch):
    from novel_learning import config
    monkeypatch.setattr(config, "MONTHLY_COST_LIMIT", 0.001)
    db.record_usage(1000, 1000)  # 估算成本约 0.016 元，超过 0.001 上限
    with pytest.raises(PermissionError):
        security.check_monthly_cost()


def test_monthly_cost_allows_under_limit(monkeypatch):
    from novel_learning import config
    monkeypatch.setattr(config, "MONTHLY_COST_LIMIT", 1000000.0)
    db.record_usage(10, 10)
    security.check_monthly_cost()  # 不应抛错


def test_require_adult_yes(monkeypatch):
    monkeypatch.setattr("builtins.input", lambda *a: "y")
    assert security.require_adult() is True


def test_require_adult_no(monkeypatch):
    monkeypatch.setattr("builtins.input", lambda *a: "n")
    assert security.require_adult() is False
