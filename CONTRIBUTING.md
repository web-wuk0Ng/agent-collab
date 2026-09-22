# 协作指南（CONTRIBUTING）

> 团队 3-5 人，全员必读。有任何不理解的流程，随时在群里问。

## 分支模型

| 分支 | 用途 | 保护规则 |
|------|------|----------|
| `main` | 始终可运行、可发布 | 🚫 禁止直接 push，只能通过 PR 合并，至少 1 人 approve |
| `feat/*` | 新功能 | 个人自由操作 |
| `fix/*` | 修 bug | 个人自由操作 |
| `docs/*` | 文档 | 个人自由操作 |

命名示例：`feat/tool-registry`、`fix/chat-timeout`、`docs/setup-guide`

## 标准开发流程

```bash
# 0. 同步最新代码
git checkout main && git pull origin main

# 1. 从 main 拉出自己的分支
git checkout -b feat/你的功能名

# 2. 开发、小步提交
git add <文件>
git commit -m "feat: 简述做了什么"

# 3. 推送到远程
git push -u origin feat/你的功能名

# 4. 在 GitHub 上发起 Pull Request（模板已配好）
#    - 填写改动说明
#    - 至少请 1 名队友 review

# 5. review 通过 -> Squash merge 合入 main -> 删除 feature 分支
```

## 提交信息规范（Conventional Commits）

格式：`<类型>: <简述>`（简述用中文，一句话说清）

- `feat:` 新功能
- `fix:` 修 bug
- `docs:` 只改文档
- `refactor:` 重构（不改行为）
- `test:` 补测试
- `chore:` 构建、依赖、配置等杂项

✅ `feat: 增加天气查询工具`
❌ `update`、`修改了一些东西`、`final final v2`

## Code Review 规则

- 所有进 `main` 的改动必须走 PR
- 每个至少 1 人 approve；`src/agent_project/core/` 的改动建议 2 人
- review 时对事不对人；被 review 者对意见有疑问就直接讨论，别憋着
- PR 保持小而聚焦：一个 PR 只做一件事，改动尽量 < 400 行

## 冲突预防

- 开工前先 `git pull`
- 一人一分支一功能，别多人改同一个分支
- 改公共文件（requirements.txt、pyproject.toml）前在群里说一声
- 遇到冲突：`git pull origin main` 后手动解决，必要时求助队友

## 本地检查（提 PR 前必跑）

```bash
ruff check src tests      # lint
ruff format --check src tests  # 格式
pytest                    # 测试
```

CI 会在 PR 上跑同样的检查，不过就别浪费队友时间了 🙂
