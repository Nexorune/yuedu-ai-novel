"""第 14 本书曾因模型照抄无效 JSON 示例反复失败。"""

import json

from novel_learning import prompts
from novel_learning.models import StoryBible


def _example(prompt: str) -> dict:
    start = prompt.index("{", prompt.index("输出如下 JSON"))
    end = prompt.index("\n\n", start)
    return json.loads(prompt[start:end])


def test_outline_example_is_valid_json():
    _, prompt = prompts.outline_prompt("爽文", "RAG知识库", 10, 1500, 2500)
    assert _example(prompt)["title"]


def test_short_outline_example_is_valid_json():
    for count in (1, 2):
        _, prompt = prompts.outline_prompt("爽文", "RAG知识库", count, 1500, 2500)
        assert _example(prompt)["outline"]["act1"]["chapters"][0] == 1


def test_chapter_example_is_valid_json():
    _, prompt = prompts.chapter_prompt("爽文", "RAG知识库", 1, 10, 1500, 2500,
                                        StoryBible(), "")
    assert _example(prompt)["knowledge_points"]
