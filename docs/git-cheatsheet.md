# Git 常用命令速查（新人版）

> 只列日常开发会用到的命令。完整规范见根目录 CONTRIBUTING.md。

## 第一次拿到项目

```bash
git clone <仓库地址>
cd <项目目录>
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt
pytest   # 跑通测试，确认环境 OK
```

## 每天开工

```bash
git checkout main
git pull origin main          # 同步最新代码
git checkout -b feat/xxx      # 拉自己的功能分支
```

## 开发中（小步提交）

```bash
git status                    # 看改了什么
git add 文件名                 # 别用 git add . 盲加
git commit -m "feat: 做了什么"
```

## 推送与合并

```bash
git push -u origin feat/xxx   # 首次推送
git push                      # 之后的推送
# 然后去 GitHub 页面点 "Compare & pull request"
```

## 别人的 main 更新了，我的分支要同步

```bash
git fetch origin
git rebase origin/main        # 或 merge，团队统一用 rebase
# 有冲突 -> 解决后 git add -> git rebase --continue
```

## 撤销操作（谨慎）

```bash
git restore 文件名             # 撤销未提交的修改
git commit --amend            # 修改最近一次提交信息（仅限未推送）
git revert <commit-id>        # 安全回滚某次已推送的提交
```

## 🚫 红线

- 不要直接 push 到 `main`（仓库已设保护）
- 不要 `git push --force` 到共享分支
- 不要提交 `.env`、密钥、大文件
- 不要在一个 PR 里塞多个不相关的改动
