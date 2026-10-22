"""全部提示词。输出统一要求 JSON，便于稳健解析。"""
from __future__ import annotations

from .models import ENDING_STYLES, StoryBible

SYSTEM_BASE = (
    "你是「网文阅读 × 学习关卡」的章节生成引擎。"
    "你写的每一章都是面向 18 岁以上成年人的 AI 生成内容，必须标注「AI 生成内容」。"
    "你只输出 JSON，不要输出任何 JSON 之外的文字。"
)

# ---------------------------------------------------------------------------
# 全书大纲 + 故事档案初始化（含结局暗定）
# ---------------------------------------------------------------------------


def outline_prompt(genre: str, topic: str, total_chapters: int,
                   min_words: int, max_words: int) -> tuple[str, str]:
    system = SYSTEM_BASE
    first_end = max(1, total_chapters // 3)
    second_end = max(first_end, total_chapters * 2 // 3)
    act2 = f"[{first_end + 1}, {second_end}]" if second_end > first_end else "[]"
    act3 = f"[{second_end + 1}, {total_chapters}]" if total_chapters > second_end else "[]"
    user = f"""请为一部「{genre} × 学习{topic}」的小说生成全书大纲，并建立故事档案。

全书共 {total_chapters} 章，单章 {min_words}–{max_words} 字。

请输出如下 JSON（字段名严格一致）：
{{
  "title": "这部小说独有的书名，4–12 个汉字，不要只写学习主题或小说类型",
  "mainline": "一句话主线设定",
  "outline": {{
    "act1": {{"chapters": [1, {first_end}], "direction": "开局：主角陷入困境，埋下核心伏笔"}},
    "act2": {{"chapters": {act2}, "direction": "发展：层层升级，爽点与知识点交织"}},
    "act3": {{"chapters": {act3}, "direction": "高潮与结局：最大冲突，伏笔逐个回收"}}
  }},
  "characters": [
    {{"name": "主角名", "identity": "身份", "personality": "性格", "status": "初始处境", "relationships": "与谁什么关系"}}
  ],
  "foreshadowing": [
    {{"desc": "开局埋下的核心伏笔", "status": "open"}}
  ]
}}

要求：
- act1/act2/act3 的章节区间必须完整覆盖 1 到 {total_chapters} 章，不能有空档；一章短篇允许后两幕为空数组。
- characters 至少给出 1 个主角 + 1 个配角。
- foreshadowing 至少埋 2 条伏笔（后续章节会回收）。"""
    return system, user


# ---------------------------------------------------------------------------
# 章节生成（三段式：知识点 → 正文 → 题目）
# ---------------------------------------------------------------------------


def chapter_prompt(genre: str, topic: str, chapter_no: int, total_chapters: int,
                   min_words: int, max_words: int, bible: StoryBible,
                   hidden_ending: str, is_ending: bool = False) -> tuple[str, str]:
    system = SYSTEM_BASE

    # 故事档案快照：注入到每章 prompt，保证连贯
    summaries = "\n".join(f"  第{i + 1}章：{s}" for i, s in enumerate(bible.chapter_summaries))
    characters = "\n".join(
        f"  - {c.get('name')}（{c.get('identity')}，{c.get('personality')}；现状：{c.get('status')}；关系：{c.get('relationships')}）"
        for c in bible.characters)
    open_foreshadow = "\n".join(
        f"  - {f.get('desc')}" for f in bible.foreshadowing if f.get("status") == "open")
    learned = "、".join(bible.learned_knowledge) or "（暂无）"

    # 大纲位置提示：让模型知道自己在书的哪个位置、还剩几章
    act_hint = ""
    outline = bible.outline or {}
    for act_name, act in outline.items():
        chs = act.get("chapters", [])
        if chs and chs[0] <= chapter_no <= chs[-1]:
            act_hint = f"当前属于「{act_name}」幕（{act.get('direction', '')}）"
            break

    # 结局方向：暗定结局不透露，只给极隐晦的基调提示
    ending_hint = ""
    if hidden_ending:
        if is_ending:
            ending_hint = f"这是大结局章，必须按「{ENDING_STYLES[hidden_ending]}」收尾，"
            ending_hint += "回收下面所有未回收伏笔，给主角完整交代。"
        else:
            # 非结局章只给一句极隐晦的基调，不剧透具体结局
            tone = {"happy": "整体基调偏昂扬向上",
                    "twist": "剧情埋有反转的种子",
                    "open": "留有一些未说破的余地",
                    "tragedy": "基调偏深沉、带遗憾感"}[hidden_ending]
            ending_hint = f"（全书基调：{tone}，但不要在正文里点破结局）"

    user = f"""请写「{genre}」小说第 {chapter_no} 章，学习主题：{topic}。全书共 {total_chapters} 章，单章 {min_words}–{max_words} 字。

【前情摘要】
{summaries or "（这是第一章，无前情）"}

【人物卡（必须一致，不许改名/改设定）】
{characters}

【未回收伏笔（后续章节要回收，可在此章继续埋新的）】
{open_foreshadow or "（暂无）"}

【已学知识点（不要重复出题）】
{learned}

【进度】{act_hint or "（全书大纲待确认）"}；这是第 {chapter_no}/{total_chapters} 章。{ending_hint}

严格输出如下 JSON（本步只写正文与知识点，题目另一步生成）：
{{
  "knowledge_points": [
    {{"role": "core", "point": "核心知识点一句话", "paragraph": 1}},
    {{"role": "aux", "point": "辅助知识点一句话", "paragraph": 1}},
    {{"role": "aux", "point": "辅助知识点一句话", "paragraph": 1}}
  ],
  "title": "本章标题",
  "content": "正文，必须标注开头「（AI 生成内容）」，按「第1段\\n第2段\\n…」分好段，总字数严格控制在 {min_words}–{max_words} 个中文字符"
}}

硬性要求：
1. 知识点必须是 1 个 core + 2 个 aux，共 3 个；正文要真正解释核心知识的含义与用法，给出一个可迁移到现实的例子；不能只把知识词汇当作世界观装饰。辅助知识点也要给出准确的定义或辨析。先核查概念事实（例如长方体是立体图形，不是平面图形）。
2. paragraph 直接填数字 1 即可（段落定位由系统后处理完成），绝对禁止用 x、-、—、|、罗马数字、文字、代码或留空代替数字。
3. 正文字数必须落在 {min_words}–{max_words} 个中文字符之间：宁短勿长，写完先自查一遍字数，超过 {max_words} 字就删减，不足 {min_words} 字就扩写。
4. 人物姓名、身份、关系必须与人物卡完全一致；剧情必须承接前情摘要。
5. 正文里不得出现暴力、色情、违法、危险模仿内容。"""
    return system, user


# ---------------------------------------------------------------------------
# 内容审核
# ---------------------------------------------------------------------------


def moderation_prompt(content: str) -> tuple[str, str]:
    system = SYSTEM_BASE
    user = f"""请审核下面这段小说正文，判断是否包含暴力、色情、违法、危险模仿、或改编现实真实网文的内容。

正文：
\"\"\"
{content}
\"\"\"

输出 JSON：
{{"safe": true, "reason": ""}}。若不安全，把 safe 改为 false，并在 reason 写一句话说明违规类型。"""
    return system, user


# ---------------------------------------------------------------------------
# 连贯性校验
# ---------------------------------------------------------------------------


def continuity_prompt(content: str, bible: StoryBible) -> tuple[str, str]:
    system = SYSTEM_BASE
    characters = "\n".join(
        f"  - {c.get('name')}（{c.get('identity')}，关系：{c.get('relationships')}）"
        for c in bible.characters)
    user = f"""请校验下面新章节是否与已有故事档案连贯一致。

已有人物卡：
{characters}

新章节正文：
\"\"\"
{content}
\"\"\"

重点检查：人物姓名是否写错、身份/关系是否矛盾、前情是否冲突。
输出 JSON：{{"consistent": true, "issue": ""}}。若不连贯，把 consistent 改为 false，并在 issue 写一句话说明问题。"""
    return system, user


def learning_questions_review_prompt(topic: str, knowledge_points: list[dict],
                                     questions: list[dict], character_names: list[str] | None = None) -> tuple[str, str]:
    import json
    system = SYSTEM_BASE
    points = [kp.get("point", "") for kp in knowledge_points]
    user = f"""你是学习测验审题员。学习主题：{topic}。本章知识点：{json.dumps(points, ensure_ascii=False)}。小说角色：{json.dumps(character_names or [], ensure_ascii=False)}。
请逐题检查以下题目及正确答案：{json.dumps(questions, ensure_ascii=False)}
合格标准：题干直接考知识点的概念、原理、辨析或现实场景应用；把小说正文完全拿走后，题目仍能独立回答。
只要题干问小说角色在某场景做了什么、依靠什么、为什么这样做，或包含虚构世界的称号/指标，即使正确选项提到真实知识，也必须判不合格。
例：「叶辰在采石场主要依靠什么提高算绩？」→ 不合格（问角色剧情，算绩是虚构指标）；「把独立计算任务分给多个处理器，利用了什么？」→ 合格。
判定规则：所有题都合格时，relevant 为 true、issues 为空数组；存在不合格题时，relevant 为 false，issues 只列不合格的题号和原因。不要在 issues 中写合格题或推理过程。
只输出 JSON：{{"relevant": true, "issues": []}} 或 {{"relevant": false, "issues": ["第N题：原因"]}}。不要迁就表面上出现学习主题词的剧情题。"""
    return system, user


# ---------------------------------------------------------------------------
# 大结局章
# ---------------------------------------------------------------------------


def ending_prompt(genre: str, topic: str, chapter_no: int, min_words: int,
                  max_words: int, bible: StoryBible, ending_style: str) -> tuple[str, str]:
    # 复用章节 prompt，但明确标注为结局章
    system, user = chapter_prompt(
        genre, topic, chapter_no, chapter_no, min_words, max_words,
        bible, ending_style, is_ending=True)
    user += "\n\n再次强调：这是全书大结局，必须回收【未回收伏笔】里的全部伏笔，给所有主要角色一个交代。"
    return system, user


# ---------------------------------------------------------------------------
# 换题 / 降难度（失败降级：正文不变，只重出题）
# ---------------------------------------------------------------------------


def questions_regenerate_prompt(topic: str, knowledge_points: list[dict],
                                difficulty_hint: str) -> tuple[str, str]:
    system = SYSTEM_BASE
    kps = "\n".join(f"  - [{kp.get('role')}] 第{kp.get('paragraph')}段：{kp.get('point')}" for kp in knowledge_points)
    user = f"""请仅根据知识点清单，为学习主题「{topic}」出 {config_questions()} 道测验题。小说正文不提供给你，不能编造故事人物和剧情。

本章知识点：
{kps}

难度要求：{difficulty_hint}

请只围绕上述知识点出题，输出 JSON：
{{"questions": [
  {{"type": "memory", "question": "题干", "options": ["选项甲","选项乙","选项丙","选项丁"], "answer": 0, "source_paragraph": 1, "difficulty": "easy", "explanation": "一句话讲解为什么选这个"}}
]}}

规则：核心知识点 3 道（memory/understanding/transfer），2 个辅助知识点各 1 道 locate，共 5 道；每题 4 选项；answer 必须是 0、1、2、3 中的整数，不能写字母或文字；source_paragraph 直接填 1 即可（段落定位由系统后处理）。locate 题也要考该知识点本身，不问「文中哪一段」或情节位置。只考概念、简单计算、辨析或现实场景应用；禁止考人物姓名、剧情、虚构称号或谁做了什么。每题脱离小说也可回答。每题必须带 explanation：用一句话（不超过 60 字）讲清正确选项为什么对、点出知识点本身，不提剧情和人物，用户答完这道题后才会看到。"""
    return system, user


def config_questions() -> int:
    from . import config
    return config.QUESTIONS_PER_CHAPTER
