"""模型调用封装：模型无关 + 重试 + 超时 + JSON 稳健解析。"""
from __future__ import annotations

import json
import logging
import re
import time
from typing import Any

from anthropic import Anthropic, APIConnectionError, APIStatusError, APITimeoutError

from . import config, db

LOG = logging.getLogger("novel_learning.llm")

_client: Anthropic | None = None


def _get_client() -> Anthropic:
    global _client
    if _client is None:
        if not config.API_KEY or "xxx" in config.API_KEY:
            raise RuntimeError("缺少 API Key：请在 .env 里填入 ANTHROPIC_API_KEY")
        kwargs: dict[str, Any] = {"api_key": config.API_KEY, "timeout": config.TIMEOUT_SECONDS}
        if config.BASE_URL:
            kwargs["base_url"] = config.BASE_URL
        _client = Anthropic(**kwargs)
    return _client


def call(system: str, user: str, max_tokens: int, temperature: float = 0.8) -> str:
    """调模型，返回纯文本；瞬时错误自动退避重试。"""
    client = _get_client()
    last_error: Exception | None = None
    for attempt in range(config.MAX_RETRIES):
        try:
            resp = client.messages.create(
                model=config.MODEL_ID,
                system=system,
                max_tokens=max_tokens,
                temperature=temperature,
                messages=[{"role": "user", "content": user}],
            )
            stop_reason = getattr(resp, "stop_reason", None)
            usage = getattr(resp, "usage", None)
            output_tokens = getattr(usage, "output_tokens", None) or 0
            input_tokens = getattr(usage, "input_tokens", None) or 0
            db.record_usage(input_tokens, output_tokens)
            LOG.info("模型响应：结束原因=%s，输出 token=%s，上限=%s",
                     stop_reason, output_tokens, max_tokens)
            if stop_reason == "max_tokens":
                raise ValueError("模型输出达到长度上限，JSON 不完整；需要提高章节输出上限")
            return "".join(getattr(b, "text", "") for b in resp.content)
        except (APITimeoutError, APIConnectionError, APIStatusError) as exc:
            status = getattr(exc, "status_code", None)
            if isinstance(exc, APIStatusError) and status is not None and status < 500 and status not in (408, 409, 429):
                # 密钥错误、参数错误等重试也不会成功，直接失败，避免空等和重复请求
                LOG.warning("模型服务拒绝请求（%s），不再重试", status)
                raise RuntimeError(f"模型服务拒绝了请求（HTTP {status}）") from exc
            last_error = exc
            delay = 0.5 * (2 ** attempt)
            LOG.warning("模型调用失败 (第 %d/%d 次): %s；%.1fs 后重试",
                        attempt + 1, config.MAX_RETRIES, exc, delay)
            time.sleep(delay)
    raise RuntimeError(f"模型调用失败（已重试 {config.MAX_RETRIES} 次）: {last_error}")


def _extract_json(text: str) -> dict:
    """从模型输出里稳健地抠出第一个 JSON 对象（容忍 ```json 围栏与前后废话）。"""
    text = text.strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL)
    if fence:
        text = fence.group(1)
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("模型输出中没有找到 JSON")
    body = text[start:end + 1]
    try:
        return json.loads(body)
    except json.JSONDecodeError as exc:
        repaired = _repair_json_text(body)
        try:
            return json.loads(repaired)
        except json.JSONDecodeError:
            # 只记录错误附近的短片段，定位格式问题；不记录整章内容。
            LOG.warning("JSON 错误位置附近：%r", text[max(0, exc.pos - 35):exc.pos + 35])
            raise ValueError(f"JSON 解析失败: {exc}") from exc


def _repair_json_text(text: str) -> str:
    """宽容修复模型常见数值占位符错误，让 JSON 可解析；错误值由后续校验拦截并重写。"""
    # 模型偶尔混入看不见的零宽字符或其 HTML 写法（如 &zwj;），直接去掉
    text = re.sub(r"&(?:zwj|zwnj|nbsp);|[\u200b-\u200d\ufeff]", "", text)
    # "answer": —1 → "answer": 1（em-dash 后跟数字，视为误输入）
    text = re.sub(r'(\s*:\s*)[—–]\s*(\d)', r'\g<1>\g<2>', text)
    # 裸占位符当数值："key": x / - / ? / _ → 0
    text = re.sub(r'(\s*:\s*)(?:x|X|_|\?)(?=\s*[,}\]])', r'\g<1>0', text)
    text = re.sub(r'(\s*:\s*)-(?=\s*[,}\]])', r'\g<1>0', text)
    return text


def call_json(system: str, user: str, max_tokens: int, temperature: float = 0.8) -> dict:
    """调模型并解析为 JSON dict。"""
    text = call(system, user, max_tokens=max_tokens, temperature=temperature)
    return _extract_json(text)
