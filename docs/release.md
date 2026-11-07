# 发布规则

提交、推送、打 tag 和发布需分别获得授权；“只提交”不包含任何远端操作。

## 分支与版本

| 类型           | 目标提交                     | 版本文件                                              | 产物                                                   |
| -------------- | ---------------------------- | ----------------------------------------------------- | ------------------------------------------------------ |
| 日常开发       | `dev`                        | 不为测试 tag 修改正式版本                             | 无自动正式发布                                         |
| `vX.Y.Z-dev.N` | `dev` 上已推送的提交         | 不改版本条目、`package.json`、`public/changelog.json` | 版本镜像与 `dev` 镜像；不更新 `latest`、不创建 Release |
| `vX.Y.Z`       | `dev → main` PR 合并后的提交 | 三份版本文件一致                                      | 版本镜像、`latest` 和 GitHub Release                   |

- `main` 只经 PR 更新，正式 tag 不指向尚未合并的 `dev` 提交。
- 业务改动与发布元数据分开提交；发布提交仅包含上述三份版本文件。
- `CHANGELOG.md` 是正式版本说明的源文件，`pnpm gen:changelog` 同步其余两份。生成文件不手工维护。
- 已发布 tag 不重写；需修正已发布内容时使用新版本。

## 发布说明

只写用户或部署者能感知的功能、交互、性能、稳定性及安全影响。内部重构、测试、CI、文档维护和格式化不逐项搬入版本说明；仅内部改动通常不单独发用户版本。

- 用户可感知的改动在 `dev` 上与代码同次提交，写入 `CHANGELOG.md` 顶部的 `## [Unreleased]`，不存在时新建。dev tag 不单独写说明。
- 章节只用 `Added` / `Changed` / `Fixed` / `Admin`，其他标题会被校验拒绝。`Admin` 收录只有站长与管理员能感知的改动（后台页面、站长提醒、部署者须知），站内版本面板只对这两种身份展示，普通用户看到的是其余三节；GitHub Release 保留全部章节。同时影响前台与后台的改动写进前三节。
- `[Unreleased]` 只能有一个且位于所有版本之前；解析、`gen:changelog`、发版脚本与在线更新检查均跳过它，所以写入后不影响版本号与 `public/changelog.json`。
- 含不可逆数据迁移的改动，在条目中写明「回退须恢复升级前备份」。
- `[Unreleased]` 是随时改写的草稿。写入前先查同一功能是否已有条目，有就改写那条，不追加新条。
- 本周期新增、尚未发布的功能，后续调整与修复并入它原来的条目；`Fixed` 只写上一个正式版已存在的问题。
- 一条一句话，写用户能感知的结果，不写按钮位置、颜色、字号等实现细节；同一页面的界面打磨合成一条“××页细节优化”。数据迁移、环境变量等部署者须知始终单列。
- 发版时把 `## [Unreleased]` 改为 `## [X.Y.Z] - YYYY-MM-DD`，按功能区归并后再同步 `package.json` 版本。每版以 15 条以内为目标，超出时先合并界面打磨类条目，不删功能与修复。

## 本地版本显示

`pnpm dev` / `pnpm dev:webpack` 使用当前提交可达的最高本地 `vX.Y.Z-dev.N` 标签，启动时不联网。显式 `NEXT_PUBLIC_APP_VERSION` 优先；无可用 dev 标签时回退至更新日志及 `package.json`。同步标签后须重启开发服务。

生产构建只使用显式注入版本或正式版本，不自动采用本地 dev 标签。

## 发布前提

- 工作区干净，分支已同步；未解决的分叉不能发布。
- 日常验证按 [AGENTS.md](../AGENTS.md#验证)；发布前须通过全量检查和 `pnpm build`。构建生成的忽略文件不提交。
- 正式版的 PR 检查通过且已合并，tag 解析后的提交与本次 `origin/main` 发布提交一致。
- PR 使用 merge commit，合并后将 `dev` 快进同步至 `main`。同步前确认没有新的 dev 提交，不强推覆盖。

## 命令入口

以下 `X.Y.Z`、`N`、PR 编号和运行编号均需替换，不是可直接发布的版本号。

本地与远端状态：

```powershell
git fetch origin main dev --tags
git status --short --branch
git rev-list --left-right --count origin/main...HEAD
git rev-list --left-right --count origin/dev...HEAD
gh auth status
```

在 `dev` 上，第一组计数左侧为 `0` 表示已包含 main；第二组为 `0 0` 表示与远端 dev 完全同步。

开发镜像（当前分支必须是已同步的 `dev`）：

```powershell
git tag -a vX.Y.Z-dev.N -m "vX.Y.Z-dev.N"
git push origin vX.Y.Z-dev.N
```

正式版本文件与 PR（先按[发布说明](#发布说明)把 `[Unreleased]` 改为版本标题）：

```powershell
pnpm gen:changelog
git diff -- CHANGELOG.md package.json public/changelog.json
gh pr create --base main --head dev --title "chore(release): vX.Y.Z" --body "Release vX.Y.Z"
gh pr checks <PR编号> --watch --interval 10
gh pr merge <PR编号> --merge
```

创建 PR 前，版本文件须已独立提交并推送至 `dev`。PR 合并后，同步 dev 并把正式 tag 明确指向 main：

```powershell
git fetch origin main dev --tags
git push origin origin/main:dev
git tag -a vX.Y.Z origin/main -m "vX.Y.Z"
git push origin vX.Y.Z
```

## 完成条件

- 远端 tag 指向预期提交；不要把 annotated tag 对象的哈希当成提交哈希。
- `Build & Push Docker image` 的整个运行成功，**包括最后的 `merge` job**，仅架构构建成功不算镜像发布完成。
- 正式版的 `Sync GitHub Release` 成功，Release 为非 draft、非 prerelease；dev tag 不要求 Release。
- 状态检查按本次 tag / 提交筛选，不能把另一轮成功运行当作本次结果。

```powershell
gh run list --workflow "Build & Push Docker image" --limit 5
gh run list --workflow "Sync GitHub Release" --limit 5
gh run watch <运行编号> --exit-status
gh release view vX.Y.Z --json tagName,url,isDraft,isPrerelease
git status --short --branch
```

自动 Release 失败时，`pnpm release:prepare` 生成 `notes_file`；已有 Release 用 `gh release edit ... --notes-file <notes_file>`，不存在时用 `gh release create ... --verify-tag --notes-file <notes_file>`。手动兜底仍须满足同一 tag 和版本约束。
