# 上线：IceTV 接入 egress-pool 上游代理池

## 目标

生产 IceTV 的服务端回源分散到 egress-pool 的 4 个出口，降低单 IP 被源站 429 的风险。视频分片保持直连（后台开关默认关闭）。功能说明见 [部署 · 上游代理池](../docs/deployment.md#上游代理池)。

## 边界

- SSH 登录信息向站长索取（本机 Claude 记忆 `icetv-prod-server` 中有记录）。
- 推送、打 tag 需站长单独授权（见 [发布](../docs/release.md)）。
- 改 `/opt/egress-pool` 用 git 管理；不输出 `credentials/`、`.env`、`runtime/config.json`、订阅地址等凭据内容。
- 改 IceTV 的 compose 前先备份，沿用目录里已有的 `docker-compose.yml.bak.<日期>-<时间>` 命名。

## 现状

- egress-pool 本地提交 `a601590`（多入口 + 出口 IP 去重 + urltest）已在服务器 `main` 上，未推送到远端。`config/local.yaml` 已配置 `icetv` profile：HTTP 入口 8081–8084，每组 2 个节点。
- 网关容器 `egress-pool-gateway` 尚未创建；Docker 网络 `egress_shared` 已存在，暂无容器接入。
- 服务器上没有任何定时刷新（无 crontab、无 systemd timer）。README 提到的 `/root/.hermes/...` 入口实际不存在。
- IceTV compose 位于 `/opt/1panel/docker/compose/icetv/docker-compose.yml`：服务 `icetv-core`，镜像 `ghcr.io/naseaoi/icetv:dev`，只接入 `icetv_default` 网络，没有代理相关环境变量。

## 步骤

1. **发布 IceTV 镜像**：在已同步的 `dev` 上推送提交，打 `vX.Y.Z-dev.N` tag，触发 `Build & Push Docker image`，产出 `dev` 镜像。等 workflow 成功后再继续。
2. **启动网关**：
   - 在 `/opt/egress-pool` 先执行 `./scripts/egress-pool refresh --config config/local.yaml --dry-run`，确认 `icetv` 4 组都分配到节点、没有 `blocked_no_available`。
   - 再执行 `./scripts/refresh.sh`（内含 `--apply --start-gateway` 和防并发锁）。
3. **验证网关出口**：对 8081–8084 各执行一次
   `docker run --rm --network egress_shared curlimages/curl -s -m 15 -x http://egress-gateway:<端口> https://api.ipify.org`。
   预期得到 4 个互不相同的 IP，且都不是服务器自身 IP。
4. **安装每日刷新**：新建 `/etc/cron.d/egress-pool`，例如
   `17 4 * * * root /opt/egress-pool/scripts/daily-refresh.sh`
   该脚本成功时不输出，失败时输出脱敏摘要并返回非零。服务器时区为 PST。
5. **接入 IceTV**：编辑 IceTV 的 compose：
   - `icetv-core.networks` 增加 `egress_shared`，并在顶层 `networks` 声明 `egress_shared: { external: true }`。保留原有 `default`（`icetv_default`）。
   - `environment` 增加：
     `UPSTREAM_PROXY_POOL: "http://egress-gateway:8081,http://egress-gateway:8082,http://egress-gateway:8083,http://egress-gateway:8084,direct"`
   - 在该目录执行 `docker compose pull && docker compose up -d`。
6. **验证 IceTV**：
   - 容器恢复 healthy；日志中没有 `UPSTREAM_PROXY_POOL 条目无效`。
   - 后台「站点设置 → 数据与图片代理」出现「视频分片走代理池」开关，说明代理池已生效。开关保持关闭。
   - 搜索并播放任意点播源一集，确认正常起播。
   - `docker logs --since 10m icetv-core` 中没有 `Upstream proxy node down`。

## 回滚

删除 `UPSTREAM_PROXY_POOL`（可同时去掉 `egress_shared` 网络）后 `docker compose up -d`，IceTV 即回到服务器直连。网关可保持运行，不影响 IceTV。

## 上线后观察

- 每隔几天统计一次：
  `docker logs --since 24h icetv-core 2>&1 | grep -cE "Upstream host cooldown|Upstream proxy node down"`
- 冷却或节点下线频繁时扩容：
  - 在 `config/local.yaml` 的 `icetv.entries.http_ports` 追加端口（如 8085、8086）。
  - 同步 `docker-compose.yml` 的 `expose`，执行刷新。
  - 再把新地址追加进 `UPSTREAM_PROXY_POOL`。
  - 可用的不同出口 IP 约 50 个，足够扩容。
- 每日刷新失败时，cron 会输出脱敏摘要。IP 不足会阻止整份刷新写入，原有入口保持不变。

## 验收

- 4 个入口出口 IP 互不相同，且都不是服务器 IP。
- 每日刷新已安装。
- IceTV 搜索和点播正常，后台出现分片开关且为关闭状态。
- 完成后删除本文件。
