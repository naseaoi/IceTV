# 发布流程

## 原则

- 日常改动只进入 `dev` 分支。
- `main` 只通过 `dev -> main` PR 更新。
- 正式 tag 只打在已经合并到 `main` 的发布提交上，格式为 `vX.Y.Z`。
- dev 测试 tag 可打在 `dev` 分支提交上，格式为 `vX.Y.Z-dev.N`。
- 正式 tag 会构建 Docker 镜像和 GitHub Release；dev 测试 tag 只构建 Docker 镜像。
- `CHANGELOG.md`、`public/changelog.json` 和 GitHub Release 面向普通用户，不写内部发布流程、CI、测试、重构、文档维护等实现细节。

## 版本关系

- `main` 上的最新正式版决定当前稳定版本，例如 `v0.4.2`。
- `dev` 上继续开发下一个正式版本，例如 `0.4.3`。
- `dev` 阶段的测试发布只在 `dev` 分支打 tag，例如 `v0.4.3-dev.1`、`v0.4.3-dev.2`。
- 同一轮 `dev` 测试期间，`CHANGELOG.md`、`package.json`、`public/changelog.json` 保持下一正式版号，例如 `0.4.3`，只递增 `-dev.N`。
- `v0.4.3-dev.N` 只触发 dev 镜像构建，不创建 GitHub Release，不更新正式版 `latest`。
- `dev` 验证完成后，发起 `dev -> main` PR；合并到 `main` 的同一版本提交再打正式 tag `v0.4.3`。

示例：

- 当前 `main` 为 `v0.4.2`
- 当前 `dev` 版本为 `0.4.3`
- 测试阶段依次推送 `v0.4.3-dev.1`、`v0.4.3-dev.2`
- 验证完成后，`dev -> main` 合并，最后在 `main` 上打 `v0.4.3`

## Dev 镜像测试

`dev` 分支不会因普通 push 构建镜像。需要线上测试时，在目标提交上推送预发布 tag：

```powershell
git switch dev
git pull --ff-only origin dev
git tag -a v0.4.2-dev.1 -m "v0.4.2-dev.1"
git push origin v0.4.2-dev.1
```

推送后会生成：

- `ghcr.io/naseaoi/icetv:dev`
- `ghcr.io/naseaoi/icetv:0.4.2-dev.1`

dev tag 不更新 `latest`，也不创建 GitHub Release。

## 发布说明规则

提交记录只作为整理素材，不逐条搬进版本说明。

写入版本说明的内容：

- 用户能感知的功能、交互、性能、稳定性变化。
- 播放、搜索、直播、管理端等业务行为变化。
- 部署用户能感知的容器、配置、版本信息问题。
- 安全修复中用户或部署者需要知道的影响。

不要写入版本说明的内容：

- 发布流程、GitHub Actions、Docker 构建流水线本身的调整。
- 测试、lint、格式化、类型修复、内部重构。
- 仅维护者需要知道的文档、脚本、依赖和仓库配置变化。
- 用户不可见的代码清理和日志调整。

如果一个版本只有内部流程改动，通常不单独发布用户版本；等下一次用户可见改动一起发布。

## 1. 前置检查

```powershell
git switch dev
git fetch origin main dev --tags
git status --short --branch
git rev-list --left-right --count origin/main...HEAD
git rev-list --left-right --count origin/dev...HEAD
git tag --sort=-v:refname | Select-Object -First 10
gh auth status
```

`origin/main...HEAD` 第一列应为 `0`，第二列是本次准备发布的 `dev` 提交数。

`origin/dev...HEAD` 应为 `0 0`。如果不是，先同步 `dev`，不要带着分叉历史发布。

## 2. 完成业务提交

发布前先把业务改动单独提交并推送到 `dev`：

```powershell
git status --short
git add <业务文件>
git commit -m "<type(scope): summary>"
git push origin dev
```

发布提交只放版本文件：

- `CHANGELOG.md`
- `package.json`
- `public/changelog.json`

## 3. 更新版本

在 `CHANGELOG.md` 顶部新增版本条目：

```md
## [0.4.x] - YYYY-MM-DD

### Added

- 用户可见新增项

### Changed

- 用户可见调整项

### Fixed

- 用户可见修复项
```

没有内容的分类可以省略。

同步版本和前端 changelog：

```powershell
pnpm gen:changelog
git diff -- CHANGELOG.md package.json public/changelog.json
```

确认 `package.json` 和 `public/changelog.json` 已更新到新版本。

## 4. 验证

```powershell
pnpm jest <相关测试文件> --runInBand
pnpm typecheck
pnpm build
git diff --check
git status --short --branch
```

`pnpm build` 生成的忽略文件不加入提交。

## 5. 发布提交

```powershell
git add CHANGELOG.md package.json public/changelog.json
git commit -m "chore(release): v0.4.x"
git push origin dev
```

## 6. 合并 PR

```powershell
gh pr create --base main --head dev --title "chore(release): v0.4.x" --body "Release v0.4.x"
gh pr checks <PR编号> --watch --interval 10
gh pr merge <PR编号> --merge
```

发布 PR 推荐使用 merge commit。这样 PR 合并后，`dev` 可以直接快进到 `main`：

```powershell
git fetch origin main dev
git push origin origin/main:dev
git fetch origin dev
git switch dev
git pull --ff-only origin dev
```

## 7. 打 tag

PR 合并并同步 `dev` 后，在 `main` 上创建 tag：

```powershell
git fetch origin main --tags
git switch main
git pull --ff-only origin main
git log --oneline -1
git tag --list v0.4.x
git tag -a v0.4.x -m "v0.4.x"
git push origin v0.4.x
```

推送 `v*` tag 后会自动触发：

- `Build & Push Docker image`
- `Sync GitHub Release`

## 8. 最终核对

```powershell
git ls-remote --heads origin main
git ls-remote --tags origin v0.4.x
gh run list --workflow "Build & Push Docker image" --limit 3
gh run list --workflow "Sync GitHub Release" --limit 3
gh release view v0.4.x --json tagName,url,isDraft,isPrerelease,name
git status --short --branch
```

确认 PR 已合并、tag 已推送、镜像构建成功、Release 非 draft、本地工作区干净。

## 手动兜底

正常发布不需要手动创建 Release。自动流程失败时再执行：

```powershell
pnpm release:prepare
gh release view v0.4.x --json tagName,url,isDraft,isPrerelease,name,body
gh release edit v0.4.x --title "v0.4.x" --notes-file "<notes_file>"
```

如果 Release 不存在：

```powershell
gh release create v0.4.x --verify-tag --title "v0.4.x" --notes-file "<notes_file>"
```
