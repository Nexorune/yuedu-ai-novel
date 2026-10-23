"""全部提示词。输出统一要求 JSON，便于稳健解析。"""
from __future__ import annotations

from .models import ENDING_STYLES, StoryBible

SYSTEM_BASE = (
    "你是「网文阅读 × 学习关卡」的章节生成引擎。"
    "你写的每一章都是用于知识学习的 AI 生成内容，表达应适合不同年龄的学习者，必须标注「AI 生成内容」。"
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
    {{"role": "core", "point": "核心知识点一句话", "quote": "正文里把这个知识点说出口的那句原话（逐字复制，12–40 字）"}},
    {{"role": "aux", "point": "辅助知识点一句话", "quote": "正文里的原话（逐字复制，12–40 字）"}},
    {{"role": "aux", "point": "辅助知识点一句话", "quote": "正文里的原话（逐字复制，12–40 字）"}}
  ],
  "title": "本章标题",
  "content": "正文，必须标注开头「（AI 生成内容）」，按「第1段\\n第2段\\n…」分好段，总字数严格控制在 {min_words}–{max_words} 个中文字符"
}}

硬性要求：
1. 知识点必须是 1 个 core + 2 个 aux，共 3 个；正文要真正解释核心知识的含义与用法，给出一个可迁移到现实的例子；不能只把知识词汇当作世界观装饰。辅助知识点也要给出准确的定义或辨析。先核查概念事实（例如长方体是立体图形，不是平面图形）。
2. 每个知识点必须在正文里「说出口」：由人物对话、内心独白或叙述明确讲出这个概念的含义或用法，让读者读到那一句就懂。三个知识点要分散在不同段落，不要挤在一起。
3. 禁止整段教科书式罗列，也不要让角色突然背定义：要用具体处境把这句话自然带出来（算账、争论、指点、后悔都行）。
4. quote 必须是正文里原样存在的一句话，一字不改、不改标点、不拼接两段。系统会拿它到正文里逐字搜索，搜不到就判废重写。不要输出 paragraph，段落位置由系统按 quote 自动定位。
5. 正文字数必须落在 {min_words}–{max_words} 个中文字符之间：宁短勿长，写完先自查一遍字数，超过 {max_words} 字就删减，不足 {min_words} 字就扩写。
6. 人物姓名、身份、关系必须与人物卡完全一致；剧情必须承接前情摘要。
7. 正文里不得出现暴力、色情、违法、危险模仿内容。"""
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
                                     questions: list[dict], character_names: list[str] | None = None,
                                     content: str = "") -> tuple[str, str]:
    """审题：这批题是否真的和本章正文对得上、答案有没有和原文矛盾。"""
    import json
    system = SYSTEM_BASE
    points = [kp.get("point", "") for kp in knowledge_points]
    user = f"""你是阅读理解题的审题员。学习主题：{topic}。本章知识点：{json.dumps(points, ensure_ascii=False)}。

【本章正文】
\"\"\"
{content.strip() or "（正文缺失）"}
\"\"\"

【待审题目】
{json.dumps(questions, ensure_ascii=False)}

逐题检查这四件事：
1. evidence 是否真的出自上面正文，且意思与该题考的东西一致；
2. 题目给出的正确答案是否和正文内容矛盾（正文没写过的数字、结论一律算矛盾）；
3. 题干是否把答案写出来了（读题干就能猜对的算不合格）；
4. 是否 4 个选项、且只有一个正确。

注意：本产品的题目就是要考「这一章你读懂没有」，题目里出现人物、情节、原文细节是正常的、要求的，不要因此判不合格。只有当题目问「这在第几段」这种纯位置题时才算不合格。

判定规则：全部合格时 relevant 为 true、issues 为空数组；存在不合格题时 relevant 为 false，issues 只列不合格题的题号和原因，不要写合格题，也不要写推理过程。
只输出 JSON：{{"relevant": true, "issues": []}} 或 {{"relevant": false, "issues": ["第N题：原因"]}}。"""
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
                                difficulty_hint: str, content: str = "") -> tuple[str, str]:
    """出题：必须贴着本章正文出，每题交一句逐字复制的原文依据。"""
    system = SYSTEM_BASE
    kps = "\n".join(
        f"  - [{kp.get('role')}] 第{kp.get('paragraph') or '?'}段 知识点：{kp.get('point')}"
        + (f"｜正文原句：「{kp.get('quote')}」" if kp.get("quote") else "")
        for kp in knowledge_points)
    body = content.strip() or "（正文缺失）"
    user = f"""你在给一章小说出阅读测验题。学习主题：{topic}。

【本章正文】
\"\"\"
{body}
\"\"\"

【本章讲到的知识点】
{kps}

难度要求：{difficulty_hint}

请出 {config_questions()} 道题，输出 JSON：
{{"questions": [
  {{"type": "understanding", "question": "题干", "options": ["选项甲","选项乙","选项丙","选项丁"], "answer": 0, "evidence": "从上面正文里逐字复制的一句原话（12–50 字）", "difficulty": "easy", "explanation": "一句话讲清正确选项为什么对（不超过 60 字）"}}
]}}

规则（违反任意一条都算不合格，会被退回重出）：
1. 正确选项必须是本章正文**明确写出**的信息（原文直述，或同义改写）。原文只写了表情、动作、气氛时，不许据此考人物心理、动机、意图——「他脸色白了一瞬」推不出「他意识到对方掌握了更深层的方法」。
2. evidence 必须能**单独推出**正确选项：把其他段落遮住，只读这一句也能确定选它。要靠暗示、言外之意、作者倾向才能答对的，换一道题。
3. 每题必须给 evidence：从正文里逐字复制的一句原话（12–50 字），一字不改、不改标点、不拼接两段。系统会拿它去正文里逐字搜索，搜不到整题判废。
4. 推荐题型：文中的事实与数字、原文明写的因果、人物的原话、概念在情节里的具体表现、按文中数字算结果。不要问「这在第几段」「文中哪一段」这类纯位置题；原文没写原因的行为，不许问「他为什么这样做」。
5. 每题 4 个选项，只有一个正确；错误选项要像真的，不能一眼看出错；题干不能泄露答案。
6. answer 必须是 0、1、2、3 中的整数，不能写字母或文字。
7. explanation 用一句话（不超过 60 字）讲清正确选项为什么对，用户答完才展示。
8. {config_questions()} 道题的 evidence 来自正文不同段落，不要都堆在同一段；整体覆盖本章 3 个知识点，核心知识点至少 3 道。"""
    return system, user


def answerable_review_prompt(items: list[dict]) -> tuple[str, str]:
    """可答性审查：给依据所在段落和本章知识点，判断能否唯一确定正确选项。

    接地只能证明「这句话在正文里」，证明不了「这句话能推出这个答案」。
    知识点要一起给，否则「这段行为体现什么概念」这类正常题会被误判。
    """
    import json
    system = SYSTEM_BASE
    user = f"""你是阅读测验的可答性审查员。下面每题给出「依据原句」「所在段落全文」「本章知识点」、题目选项和正确答案序号。
读者读过本章，所以「所在段落全文」和「本章知识点」都是他可以用的材料，但**没有**其他段落和课外背景。
请据此逐题判断读者能否唯一确定正确选项。

判合格（answerable=true）的情形：所在段落里有一句话直接写明了正确选项的内容（措辞不必完全相同），或给出数字/事实，读者据此能直接选出该选项；或者正确选项正是本章知识点在段中情节上的直接对应（如段中写「第七小时只抄公式」，而本章知识点讲了「边际效用递减」，问它体现什么概念）。
后一种情况必须判 true——不要因为段落里没出现该术语就判否。
核对答案序号时以选项文字为准：只要序号指向的那个选项与原文一致，就说明序号没标错，不要仅凭措辞差异判定「序号有误」。

判不合格（answerable=false）的情形：
- 正确答案要靠推测人物心理、动机、言外之意、作者意图，而原文没有明说；
- 正确选项里有原文没出现的断言（例：原文只写「他脸色白了」，选项写「他意识到对方掌握了更深层的方法」）；
- 仅凭这一段和本章知识点排除不了其他选项，或需要额外背景知识才能判断；
- 错误选项与这一段描述同样说得通，无法区分。

不要因为「题目看起来合理」「这个道理是对的」就放行；只判断这一段原文和本章知识点能不能撑住这个答案。
只输出 JSON：{{"results": [{{"index": 1, "answerable": true, "reason": ""}}]}}
不合格时 reason 用不超过 40 字说明缺什么，例如「原文只写表情，未说他意识到什么」。

题目与原文：
{json.dumps(items, ensure_ascii=False, indent=1)}"""
    return system, user


def config_questions() -> int:
    from . import config
    return config.QUESTIONS_PER_CHAPTER
