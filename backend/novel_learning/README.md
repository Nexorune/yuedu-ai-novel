# 悦读 · 网文阅读 × 学习关卡（网页版）

把「追网文的爽感」和「学习打卡」结合：选类型 + 输入学习主题，系统按章生成个性化小说与配套测验，答对解锁下一章。

## 快速开始（网页版）

```sh
# 1. 首次：创建虚拟环境并安装依赖（在 backend/ 目录下）
cd backend
python3.12 -m venv .venv
./.venv/bin/pip install -r requirements.txt

# 2. 配置密钥：编辑 backend/.env，把 ANTHROPIC_API_KEY 换成真实 DeepSeek Key
#    （模型无关，换服务商只改 MODEL_ID / ANTHROPIC_BASE_URL / ANTHROPIC_API_KEY 三行）

# 3. 启动（端口 8787；如被占用可改 --port）
./.venv/bin/python -m uvicorn novel_learning.web:app --host 127.0.0.1 --port 8787
```

浏览器打开：**http://127.0.0.1:8787**

## 功能

- 选类型（爽文/言情/都市/玄幻/悬疑）+ 输主题 + 设章节数/篇幅
- 快速模式：只输入一个词/知识点，立刻生成短篇 + 测验
- 大纲生成时给全书取名；书架同时展示书名和学习主题
- 第一章由用户发起；读到本章答题区时，下一章自动后台生成，答对 5 题中的 3 题后才可阅读
- 测验先做结构校验，再拦截明显剧情题，并用模型复审学习相关性
- 失败降级：错题定位提示 → 换题 → 降难度 → 送分题，绝不卡死
- 全书大纲先行 + 故事档案（人物卡/摘要/伏笔），保证章节连贯
- 连贯性校验 + 内容审核（模型自审 + 关键词兜底）+ 18+ 门槛
- 结局随机暗定（不剧透）+ 随时完结 + 结局画廊（重走多结局）

## 架构

```
浏览器(static/index.html) → FastAPI(web.py) → 核心模块(generator/quiz/security/db/llm/prompts)
                                              └── SQLite(data/novel_learning.db)
```

长任务（大纲/章节/结局/换题）走「创建任务 → 后台线程 → 轮询状态」，任务状态持久化在 SQLite，进程重启后会续跑未完成任务。打开答题区会触发一次下一章提前生成，因此可能产生模型费用。

## 测试

```sh
cd backend
./.venv/bin/python -m pytest tests/ -v
```

## 目录

| 文件 | 职责 |
|---|---|
| web.py | FastAPI 应用 + 后台任务运行器（新增） |
| static/index.html | 最小网页验收界面（新增） |
| cli.py | 交互式 CLI（保留为开发期备用入口） |
| generator.py | 生成管线：大纲→生成→审核→校验→重写→存档 |
| prompts.py | 全部提示词（大纲/章节/审核/连贯性/结局/换题） |
| story_bible.py | 故事档案 |
| quiz.py | 判题 + 失败降级 |
| security.py | 18+ / 关键词 / 每日上限 / 越权 |
| db.py | SQLite 存储（含 tasks 任务表） |
| llm.py | 模型无关调用 + JSON 解析 + 重试 |
| config.py | .env 配置 |

## 换模型

只改 `.env`（Anthropic 兼容网关均可）：DeepSeek / 智谱 GLM / Kimi / MiniMax / Anthropic 官方。
