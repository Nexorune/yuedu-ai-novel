# 悦读 · 边追更，边学东西

通过小说学习知识：选择学习主题与故事类型，生成个性化故事，每章完成测验后解锁后续内容。

## 当前版本

- 首页介绍、独立创作页与学习记录。
- 手机号演示登录、个人中心、按账号隔离数据。
- 阅读目录、字号与纸白/护眼/夜间主题。
- 逐题闯关、错题讲解、进度恢复、知识卡片与结局画廊。
- 2026-10-21 书房视觉：奶油色内页、实体书封、木质书架及移动端适配。

前端为 Next.js / React / TypeScript，后端为 FastAPI，SQLite 保存书籍、任务和学习进度。模型经服务端配置调用。

## 本地启动

需要 Python 3.12 和 Node.js 22 或更高版本。分别在两个终端启动后端、前端。

### 后端

```sh
cd backend
python3.12 -m venv .venv
./.venv/bin/pip install -r requirements.txt
cp .env.example .env
```

编辑 `backend/.env`，填写自己的模型服务配置，并将演示登录码设为六位数字。配置文件被 Git 忽略；不要提交真实密钥。

```sh
./.venv/bin/python -m uvicorn novel_learning.web:app --host 127.0.0.1 --port 8787
```

### 前端

在另一个终端中，从项目根目录执行：

```sh
cd frontend
npm ci
npm run dev -- --hostname 127.0.0.1 --port 3012
```

打开 http://127.0.0.1:3012 。前端默认代理 API 到本机 8787 端口；如需修改，设置服务端环境变量 `BACKEND_URL`。完整前端说明见 [frontend/README.md](frontend/README.md)。

## 验证

```sh
cd backend
./.venv/bin/python -m pytest tests/
```

```sh
cd frontend
npm run lint
npm run typecheck
npm run test
npm run build
```

如本机 Turbopack 遇到临时端口权限问题，可用 `npm run build -- --webpack`。2026-10-21 已通过前端 14 项测试、Lint、类型检查和 Webpack 生产构建；本轮视觉验收未调用真实模型。

## 数据与演示边界

本仓库不包含 `.env`、用户数据库、运行日志、本地备份和验收原始截图。首次启动创建新的数据库，已有本机书籍与账号不会随代码上传。生成故事、换题和重走结局会产生模型用量；阅读连载到章末也可能提前生成下一章。

当前为本地演示版：验证码固定、不发送短信，正式公开上线前需要完成 PRD 中的上线前补齐项。GitHub 上传不等于网站部署。

## 项目资料

- [项目状态与决策](docs/项目状态.md)
- [PRD](docs/PRD/PRD-网文阅读×学习关卡.md)
- [最近视觉验收说明](docs/evidence/阶段3/书房视觉-20261021/验收说明.md)（原始截图仅在本机）
- [原始开发工具包说明](docs/工具包原始说明.md)
- [协作规则](AGENTS.md)

沿用仓库现有 [LICENSE](LICENSE)。
