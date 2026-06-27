# 发布流程

## 前置检查

```powershell
git fetch origin main dev --tags
git status --short --branch
git branch --show-current
git remote -v
git tag --sort=-v:refname | Select-Object -First 10
git rev-list --left-right --count origin/main...HEAD
git rev-list --left-right --count origin/dev...HEAD
gh auth status
```

发布准备在 `dev` 分支完成。`origin/main...HEAD` 第一列为 `0` 后继续，第二列可以是本次要发布的本地提交数。

未提交业务改动先单独提交。发布提交只放版本文件、changelog 产物和必要发布文档。

## 发布说明来源

```powershell
$previousTag = git describe --tags --abbrev=0
git log --oneline "$previousTag..HEAD"
git log --no-merges --pretty=format:"- %s (%h)" "$previousTag..HEAD"
```

用上一个 tag 到当前 `HEAD` 的提交整理本次 `CHANGELOG.md` 条目。

## 更新版本

在 `CHANGELOG.md` 顶部新增版本条目：

```md
## [0.3.x] - YYYY-MM-DD

### Added

- 新增项

### Changed

- 调整项

### Fixed

- 修复项
```

同步版本与前端 changelog：

```powershell
pnpm gen:changelog
```

确认 `package.json` 和 `public/changelog.json` 已更新到新版本。

## 验证

```powershell
pnpm jest <相关测试文件> --runInBand
pnpm typecheck
pnpm build
git diff --check
git status --short --branch
```

`pnpm build` 会生成 gitignore 文件，不加入提交。

## 发布提交

```powershell
git add CHANGELOG.md package.json public/changelog.json <本次改动文件>
git commit -m "chore(release): v0.3.x"
git status --short --branch
```

## 推送 dev 与合并 PR

```powershell
git push origin dev
gh pr create --base main --head dev --title "chore(release): v0.3.x" --body "Release v0.3.x"
```

等待检查通过后按仓库策略合并 PR。不要从 `dev` 直接推送到 `main`。

## Tag

PR 合并后同步 `main`，确认 `HEAD` 是合并后的发布提交，再创建并推送 tag：

```powershell
git fetch origin main --tags
git switch main
git pull --ff-only origin main
git log --oneline -1
git tag --list v0.3.x
git tag -a v0.3.x -m "v0.3.x"
git push origin v0.3.x
```

`v*` tag 推送会同时触发镜像构建和 GitHub Release 同步。Release 工作流只读取已存在 tag，不创建 tag。

## Release

通常不需要手动执行。tag 推送后 `Sync GitHub Release` 会校验推送 tag 与 `CHANGELOG.md` 顶部版本一致，再自动创建或更新 GitHub Release。

手动兜底时先生成发布说明：

```powershell
pnpm release:prepare
```

如果 Release 不存在：

```powershell
gh release create v0.3.x --verify-tag --title "v0.3.x" --notes-file "<notes_file>"
```

如果 Release 已存在：

```powershell
gh release view v0.3.x --json tagName,url,isDraft,isPrerelease,name,body
```

正文不一致时更新：

```powershell
gh release edit v0.3.x --title "v0.3.x" --notes-file "<notes_file>"
```

## 最终核对

```powershell
git ls-remote --heads origin main
git ls-remote --tags origin v0.3.x
gh run list --workflow "Build & Push Docker image" --limit 5
gh run list --workflow "Sync GitHub Release" --limit 5
gh release view v0.3.x --json tagName,url,isDraft,isPrerelease,name,body
git status --short --branch
```

确认 PR 已合并到 `main`、tag 已推送、镜像构建通过、Release 非 draft、工作区干净。
