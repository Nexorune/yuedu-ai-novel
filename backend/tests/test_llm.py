"""模型调用：不可恢复的拒绝（如密钥错误）不重试。"""
import httpx
import pytest

import anthropic
from novel_learning import llm


def _client_raising(exc, calls):
    class Messages:
        def create(self, **_kwargs):
            calls.append(1)
            raise exc
    return type("FakeClient", (), {"messages": Messages()})()


def test_rejected_request_is_not_retried(monkeypatch):
    calls = []
    response = httpx.Response(401, request=httpx.Request("POST", "https://example.invalid"))
    monkeypatch.setattr(llm, "_get_client", lambda: _client_raising(
        anthropic.AuthenticationError("bad key", response=response, body=None), calls))
    monkeypatch.setattr(llm.time, "sleep", lambda _s: None)
    with pytest.raises(RuntimeError, match="HTTP 401"):
        llm.call("system", "user", max_tokens=10)
    assert calls == [1]


def test_server_errors_are_still_retried(monkeypatch):
    calls = []
    response = httpx.Response(503, request=httpx.Request("POST", "https://example.invalid"))
    monkeypatch.setattr(llm, "_get_client", lambda: _client_raising(
        anthropic.InternalServerError("busy", response=response, body=None), calls))
    monkeypatch.setattr(llm.time, "sleep", lambda _s: None)
    with pytest.raises(RuntimeError, match="已重试"):
        llm.call("system", "user", max_tokens=10)
    assert len(calls) == llm.config.MAX_RETRIES
