# 发布流程

## 前置检查

```powershell
git fetch origin main --tags
git status --short --branch
git remote -v
git tag --sort=-v:refname | Select-Object -First 10
git rev-list --left-right --count origin/main...HEAD
gh auth status
```

`git rev-list` 第一列为 `0` 后继续。第二列可以是本次要发布的本地提交数。

未提交业务改动先单独提交。发布提交只放版本文件、changelog 产物和必要发布文档。

## 发布说明来源

```powershell
$previousTag = git describe --tags --abbrev=0
git log --oneline "$previousTag..HEAD"
git log --no-merges --pretty=format:"- %s (%h)" "$previousTag..HEAD"
```

用上一个 tag 到当前 `HEAD` 的提交整理本次 `CHANGELOG` 条目。

## 更新版本

在 `CHANGELOG` 顶部新增版本条目：

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

## 提交

```powershell
git add CHANGELOG package.json public/changelog.json <本次改动文件>
git commit -m "chore(release): v0.3.x"
git status --short --branch
```

## Tag 与推送

```powershell
git tag --list v0.3.x
git tag -a v0.3.x -m "v0.3.x"
git push origin main
git push origin v0.3.x
```

`main` 推送不构建镜像。`v*` tag 推送触发镜像构建。

## Release

生成发布说明：

```powershell
pnpm release:prepare
```

如果 Release 不存在：

```powershell
gh release create v0.3.x --title "v0.3.x" --notes-file "<notes_file>"
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
gh release view v0.3.x --json tagName,url,isDraft,isPrerelease,name,body
git status --short --branch
```

确认 `main` 已推送、tag 已推送、Release 非 draft、工作区干净。
