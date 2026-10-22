# 第 2 阶段技术开发文档｜后端 MVP（网页版最小切片）

## 一、阶段目标
把「悦读」做成能在浏览器里用的最小可用版本：新建小说 → 逐章生成 → 读正文 → 答 5 题对 3 解锁下一章 → 随时完结 + 结局画廊。核心链路端到端跑通，含 mock 测试与真实模型冒烟。

## 二、技术适配摘要
- 产品形态：生成式内容产品，网页版优先（纵向切片）。
- 开发路径：最小后端（FastAPI）+ 最小网页界面（单 HTML + 原生 JS），正式 Next.js 前端留到阶段 3。
- 结论：沿用现有 `novel_learning` 核心模块（生成器/档案/判题/安全/存储），新增 FastAPI API 层 + 最小网页界面，不做整体重构。

## 三、技术栈与模型
- Python 3.12.x（本机 3.12.14）、FastAPI、uvicorn、SQLite、pytest、httpx（TestClient）
- 模型：DeepSeek（Anthropic 兼容网关，`deepseek-chat`），由 `backend/.env` 配置

## 四、环境与配置
- 虚拟环境：`backend/.venv`（python3.12 创建）
- 依赖：`backend/requirements.txt`
- 密钥：`backend/.env`（`.gitignore` 已忽略；真实 Key 待产品经理填入，未填时用 mock 测试推进）

## 五、项目结构
```
backend/
├── .env.example / .env
├── requirements.txt
├── novel_learning/          # 现有核心模块（复用）
│   ├── db.py                # + 新增 tasks 任务表
│   ├── generator.py / quiz.py / security.py / story_bible.py / prompts.py / llm.py / models.py / config.py
│   └── web.py               # 新增：FastAPI 应用 + 后台任务运行器
├── static/
│   └── index.html           # 新增：最小网页验收界面
└── tests/                   # 新增：mock 自动化测试
```

## 六、数据、资产与状态
- SQLite `backend/data/novel_learning.db`（进度/章节/档案/结局/任务全部落库，重启可恢复）
- 任务状态：`pending → running → done | error`（长任务持久化，浏览器轮询）

## 七、API 设计（前缀 `/api`，统一错误 `{"error":{"code","message"}}`）
- `POST /api/books` 新建书 + 启动大纲任务 → `{book_id, task_id}`
- `GET /api/books` 书列表；`GET /api/books/{id}` 详情
- `POST /api/books/{id}/chapters/next` 启动「生成下一章」任务 → `{task_id}`
- `GET /api/books/{id}/chapters/{no}` 取章节（越权拒绝）
- `POST /api/books/{id}/chapters/{no}/submit` 提交答案（判题/解锁/失败降级）
- `POST /api/books/{id}/chapters/{no}/regenerate` 启动换题任务
- `POST /api/books/{id}/finalize` 启动大结局任务；`POST /api/books/{id}/endings/{style}` 重走结局
- `GET /api/books/{id}/endings` 结局画廊；`GET /api/tasks/{task_id}` 轮询任务状态

**2026-10-01 接口加固（对外数据与后端把关）**
- 对外只返回界面需要的字段：章节题目只含 `question / options / source_paragraph`（正确答案只在后端判分用）；书籍详情不含 `hidden_ending`、`user_id` 等内部字段；进度只含 `current_chapter / consecutive_fails`。
- 任务失败时 `error` 只给用户可读的说明（费用熔断、每日上限会原样告知原因）；原始异常只写日志和数据库 `tasks.error`，新增列 `tasks.public_error`。
- 花钱的操作由后端校验：重走结局需全书已完结、未收集过该结局、且没有进行中的结局任务；完结需至少读完一章；换题需本章答题未通过，难度只接受三档固定文案；同一本书同类任务进行中时复用原任务，避免重复扣费。
- 新建书：主题限 60 字并做关键词检查，`mode` 只接受 `full / quick`；提交答案需题数一致、选项在范围内。
- 结局画廊返回每个已收集结局的 `chapter_no`；已完结的书可阅读所有已收集的结局章节。
- 模型调用遇到密钥错误等不可恢复的拒绝（4xx，除 408/409/429）不再重试。

**2026-10-01 逐题闯关与等待内容**
- `POST /api/books/{id}/chapters/{no}/answer` `{index, choice}` → 这一题的对错、正确选项、讲解 `explanation`、所考知识点 `knowledge`，以及已答数；5 题答完时带 `result`（通过时含本章 `knowledge_points`）。同一题只认第一次作答；一套题答完没过关返回 409 `QUIZ_FINISHED`，需换题后再闯。作答记录存表 `quiz_attempts`，换题或章节重写时作废。
- `GET /api/books/{id}/chapters/{no}`：未通关章节附 `quiz`（已答题的揭晓信息，未答为 null）；通关章节和结局章附 `knowledge_points`。题目多返回 `type`（记忆/理解/应用/辨析）。
- 同一套题已在逐题闯关中作答后，`/submit` 整套交卷返回 409，避免看完答案再交卷。
- `GET /api/books/{id}/recap`：等待生成时展示的故事简介、登场人物（姓名+身份）、上回说到（已读最后一章的结尾段）、已学知识点；只含已读部分。
- 出题：每题带一句讲解（提示词要求，缺失不判不合格）；出完由代码打乱选项顺序（模型习惯把答案放在 A/B）。

## 八、Prompt 设计
沿用现有 `prompts.py`（大纲/章节三段式/审核/连贯性/换题），不做改动。

## 九、验收界面（最小纵向切片）
`static/index.html`：18+ 确认 → 新建书 → 生成进度提示 → 读正文 → 答题（A–D）→ 解锁/失败提示 → 完结 + 结局画廊。仅够判断核心价值，不铺开正式视觉。

## 十、测试要求（第一层 mock）
- `tests/test_quiz.py`：判题（对 3 解锁）、失败降级（换题/降难度动作）
- `tests/test_security.py`：关键词兜底、每日上限、越权拒绝、18+ 门槛
- `tests/test_db.py`：书/章节/进度/任务落库与恢复
- `tests/test_api.py`：FastAPI 全链路（mock 掉模型调用）

## 十一、验收清单
1. `pytest` 全绿；2. 真实模型冒烟（待 Key）；3. 浏览器打开 localhost 新建书→读→答→解锁→完结 走通；4. 桌面/移动端宽度可看。

## 十二、风险与待确认项
- 生成时延 30s–2min，网页用「提交任务 + 轮询」异步，避免请求无限等待。
- 真实冒烟需要 DeepSeek Key（未提供前如实写「待验」）。

## 十三、交接给下一阶段
- 阶段 3 正式前端：在已验证 API 契约上做 Next.js；登录/支付/推送仍暂缓。

## 十四、数据模型（2026-10-01 从 PRD 移入）
PRD v1.1 只写需求，数据表结构移到本文档。下表按 `backend/novel_learning/db.py` 实际建表整理（SQLite，`data/novel_learning.db`）。

| 表 | 关键字段 |
|---|---|
| books（书） | id, user_id('local'), genre, topic, title, archived, mode(full/quick), planned_chapters, min_words, max_words, status(reading/completed), hidden_ending, created_at |
| chapters（章） | id, book_id, chapter_no, title, content, knowledge_points, questions, status(locked/unlocked), is_ending, ending_style, created_at |
| story_bibles（故事档案） | book_id, characters, mainline, chapter_summaries, foreshadowing, learned_knowledge, outline |
| endings（结局） | book_id, ending_style, chapter_id, created_at |
| progress（进度） | book_id, user_id, current_chapter, consecutive_fails, daily_count, daily_date |
| tasks（后台任务） | id, book_id, kind(outline/chapter/ending/regen_questions), chapter_no, style, status(pending/running/done/error), progress, error, public_error, created_at, updated_at |
| usage（模型用量，月度熔断用） | id, month(YYYY-MM), input_tokens, output_tokens, created_at |
