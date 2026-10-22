"""配置：模型无关，全部由 .env 驱动。

换服务商只需改 .env 三行（ANTHROPIC_API_KEY / MODEL_ID / ANTHROPIC_BASE_URL）。
"""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

# 向上查找 .env（本包可能被放在项目根目录下运行）
ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env", override=True)

DATA_DIR = Path(os.getenv("NOVEL_LEARNING_DATA", str(ROOT / "data")))
DB_PATH = DATA_DIR / "novel_learning.db"

# 模型配置
MODEL_ID = os.getenv("MODEL_ID", "deepseek-chat")
# 出题单独用一个小快模型：结构化短输出，推理型模型会先烧上万 token，慢十倍
QUESTIONS_MODEL_ID = os.getenv("QUESTIONS_MODEL_ID", "") or MODEL_ID
API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
BASE_URL = os.getenv("ANTHROPIC_BASE_URL", "")

# 生成护栏
MAX_TOKENS_CHAPTER = int(os.getenv("CHAPTER_MAX_TOKENS", "8192"))
MAX_TOKENS_OUTLINE = int(os.getenv("OUTLINE_MAX_TOKENS", "2048"))
MAX_TOKENS_REVIEW = int(os.getenv("REVIEW_MAX_TOKENS", "1024"))
# 出题要带原句 evidence 与讲解，且部分模型会先推理再输出 JSON，预算给足
MAX_TOKENS_QUESTIONS = int(os.getenv("QUESTIONS_MAX_TOKENS", "8192"))
TIMEOUT_SECONDS = float(os.getenv("TIMEOUT_SECONDS", "120"))
MAX_RETRIES = int(os.getenv("MAX_RETRIES", "3"))
REWRITE_LIMIT = int(os.getenv("REWRITE_LIMIT", "2"))  # 审核/校验不通过的重写上限

# 篇幅与题目
MIN_WORDS = 1500
MAX_WORDS = 2500
QUESTIONS_PER_CHAPTER = 5
PASS_THRESHOLD = 3          # 5 题对 3 解锁
DAILY_GEN_LIMIT = 20        # 每用户每日生成上限
CHAPTER_WORDS_DEFAULT = "1500-2500"

# 费用熔断（D4：月度成本上限，到顶自动停）
MONTHLY_COST_LIMIT = float(os.getenv("MONTHLY_COST_LIMIT", "50"))     # 元/月
PRICE_INPUT_PER_1M = float(os.getenv("PRICE_INPUT_PER_1M", "4"))      # 元/百万 input tokens（aihubmix 估值）
PRICE_OUTPUT_PER_1M = float(os.getenv("PRICE_OUTPUT_PER_1M", "12"))   # 元/百万 output tokens

# 登录（演示版：不发真实短信，验证码统一用演示码；正式上线前换成真实短信 + 防刷）
DEMO_LOGIN_CODE = os.getenv("DEMO_LOGIN_CODE", "246810")
SESSION_DAYS = int(os.getenv("SESSION_DAYS", "30"))
DEMO_LOGIN_AUTOFILL = os.getenv("DEMO_LOGIN_AUTOFILL", "false").lower() == "true"
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "false").lower() == "true"   # 部署到 https 后改为 true
