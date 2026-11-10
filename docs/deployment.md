# 部署指南

完整变量与默认值见 [.env.example](../.env.example)。示例中的密码、密钥和 token 均须替换；`AUTH_SECRET` 使用至少 32 字符的随机值。

## Docker + SQLite

适合单机。保存为 `compose.yml`，数据库必须挂载到持久数据卷。

```yml
services:
  icetv:
    image: ghcr.io/naseaoi/icetv:latest
    container_name: icetv
    restart: unless-stopped
    ports:
      - '3000:3000'
    environment:
      ICETV_USERNAME: admin
      ICETV_PASSWORD: replace_with_admin_password
      AUTH_SECRET: replace_with_random_auth_secret
      CRON_SECRET: replace_with_random_cron_secret
      LOCAL_DB_PATH: /data/icetv-data.sqlite
    volumes:
      - icetv-data:/data
    logging:
      driver: json-file
      options:
        max-size: 10m
        max-file: '3'

volumes:
  icetv-data:
```

```bash
docker compose up -d
```

示例中的 `logging` 限制容器日志总量；去掉后 Docker 默认 `json-file` 驱动不轮转，日志随运行时间持续占盘。

访问 `http://localhost:3000`，用配置的站长账号登录。项目不内置播放源，需在后台配置。

## Docker + MySQL

多实例必须共用同一个 MySQL 数据库；各容器独立的 SQLite 文件不能共享缓存和资源额度。

```yml
services:
  mysql:
    image: mysql:8.4
    container_name: icetv-mysql
    restart: unless-stopped
    environment:
      MYSQL_DATABASE: icetv
      MYSQL_USER: icetv
      MYSQL_PASSWORD: replace_with_mysql_password
      MYSQL_ROOT_PASSWORD: replace_with_mysql_root_password
    volumes:
      - icetv-mysql:/var/lib/mysql
    healthcheck:
      test:
        [
          'CMD-SHELL',
          'mysqladmin ping -h 127.0.0.1 -u root -p"$${MYSQL_ROOT_PASSWORD}" --silent',
        ]
      interval: 10s
      timeout: 5s
      retries: 10
      start_period: 30s

  icetv:
    image: ghcr.io/naseaoi/icetv:latest
    container_name: icetv
    restart: unless-stopped
    depends_on:
      mysql:
        condition: service_healthy
    ports:
      - '3000:3000'
    environment:
      ICETV_USERNAME: admin
      ICETV_PASSWORD: replace_with_admin_password
      AUTH_SECRET: replace_with_random_auth_secret
      CRON_SECRET: replace_with_random_cron_secret
      NEXT_PUBLIC_STORAGE_TYPE: mysql
      DATABASE_URL: mysql://icetv:replace_with_mysql_password@mysql:3306/icetv
    logging:
      driver: json-file
      options:
        max-size: 10m
        max-file: '3'

volumes:
  icetv-mysql:
```

- 数据库账号须有建表、迁移和读写权限。用户名、密码中的特殊字符需在 `DATABASE_URL` 中 URL 编码。
- 同一 Compose 网络使用服务名 `mysql`；连接 Windows/macOS Docker Desktop 宿主机可用 `host.docker.internal`。
- 使用已有 MySQL 时不需要示例中的 `mysql` 服务及对应 `depends_on`，但仍需配置实际连接地址。
- MySQL 8.4 不支持 `default-authentication-plugin` 启动参数。

## 接入弹幕服务

SQLite、MySQL 共用以下叠加配置，保存为 `compose.danmaku.yml`。使用 [danmu_api](https://github.com/huangxd-/danmu_api)，IceTV 与服务端的 token 必须一致。

```yml
services:
  danmu-api:
    image: hxd66/danmu_api:latest
    restart: unless-stopped
    environment:
      DANMU_API_TOKEN: replace_with_random_token
    volumes:
      - danmu-data:/app/data

  icetv:
    depends_on:
      danmu-api:
        condition: service_started
    environment:
      DANMAKU_API_BASE_URL: http://danmu-api:9321/replace_with_random_token
      DANMAKU_API_ALLOW_PRIVATE: 'true'

volumes:
  danmu-data:
```

```bash
docker compose -f compose.yml -f compose.danmaku.yml up -d
```

- 服务只通过容器内网访问，无需把 9321 端口暴露到公网。
- `DANMAKU_API_BASE_URL` 包含 token 路径；内网地址须显式设置 `DANMAKU_API_ALLOW_PRIVATE=true`。
- 后台「站点配置 → 播放器弹幕」仍须开启；「测试连接」用于验证地址。
- 「运行参数 → 弹幕」管理单集条数上限和上游请求超时；超时用于搜索、绑定校验、评论拉取和连接测试，只约束到响应头到达。字号、透明度、速度在播放器调整，缓存与限流退避仍由系统管理。
- 启动、升级等操作须沿用相同的 Compose `-f` 文件组合。

## Vercel + MySQL

使用外部 MySQL，不使用 SQLite。除下节的账号和密钥外，配置：

```bash
NEXT_PUBLIC_STORAGE_TYPE=mysql
DATABASE_URL=mysql://user:password@host:3306/dbname
```

云数据库要求 TLS 时，用 `MYSQL_SSL_CA` 提供 CA PEM 文本。Vercel 不托管 `danmu_api` 常驻进程，弹幕服务需独立部署并配置可达的地址。

## 环境变量边界

| 配置                                | 易错点                                                                                     |
| ----------------------------------- | ------------------------------------------------------------------------------------------ |
| `ICETV_USERNAME` / `ICETV_PASSWORD` | 站长账号不来自普通用户表，密码须使用强随机值                                               |
| `AUTH_SECRET`                       | 会话签名密钥，不用站长密码代替；各实例保持一致                                             |
| `CRON_SECRET`                       | 定时接口凭证，Docker 启动时必填；不要依赖旧兼容变量名                                      |
| `LOCAL_DB_PATH`                     | Docker 默认在 `/data`；本地开发路径以 `.env.example` 为准                                  |
| `TRUSTED_PROXY_COUNT`               | 填实际代理层数，如 Nginx 为 1、Cloudflare + Nginx 为 2；默认 0 不能防伪造转发头            |
| `CACHE_PROFILE`                     | 默认 `small` 仅限制业务缓存，不限制 Node、SQLite、sharp 等进程总内存                       |
| `MYSQL_QUEUE_LIMIT`                 | 等待连接的队列上限，默认连接数的 50 倍；队列满时数据库操作直接失败，不在内存中堆积         |
| `UPSTREAM_PROXY_POOL`               | 各节点须使用不同出口 IP；Docker 中 `127.0.0.1` 指容器自身，配置见[上游代理池](#上游代理池) |

## 上游代理池

设置 `UPSTREAM_PROXY_POOL` 可分散服务端回源的出口 IP。节点用逗号或空白分隔，支持 `http://[user:pass@]host:port`、`https://[user:pass@]host:port`、`socks5://[user:pass@]host:port`；`direct` 表示服务器自身出口。未设置、为空或仅含 `direct` 时保持原有行为；无法解析的条目会被跳过并记录不含凭据的告警。连接超时参数与配置示例见 [.env.example](../.env.example)。

- 覆盖经 `fetchWithUrlGuard()` 的搜索、详情、豆瓣、点播清单 / 密钥、封面缓存与弹幕等回源；直播与 Bangumi 沿用 `HTTPS_PROXY` 等环境变量逻辑，直播不经代理池。
- 点播分片默认直连，代理节点通常有流量限制。站长可在后台「站点设置 → 数据与图片代理 → 视频分片走代理池」开启，该开关仅在服务端已配置代理池时显示；开启后分片流量同样经代理节点中转再由服务器转发给用户。
- 按用户固定出口：同一用户的清单、密钥与分片走同一节点，节点下线只影响原本分到它的用户；无用户的请求（如定时任务）轮询。清单缓存跨用户共享，CDN 签名绑定 IP 的源可能因此失败。
- 节点网络失败或对目标域名处于 429 冷却时改用下一个节点，最多尝试两个代理节点，再回退服务器直连；切换发生在响应交付前，已开始传输的正文保持原连接。429 冷却按「节点 + 目标域名」隔离，直连按域名记录。
- 节点连续三次网络失败下线 30 秒，再次失败冷却翻倍，最长五分钟；冷却结束后的首次失败即再次下线，任意成功清零。节点健康状态按进程独立维护。
- 每个节点须对应不同出口 IP。使用 mihomo 等本机代理服务时，建议每个出口单独端口，端口背后使用 `fallback` / `url-test` 组淘汰坏 IP，各端口候选 IP 保持互不重叠；仅暴露一个 `load-balance` 端口无法保证用户出口稳定。
- 本地 DNS 私网校验照常执行；节点使用自有或可信服务，本机监听绑定 `127.0.0.1` 并保持公网隔离。Docker 内访问宿主代理使用 host 网络、可达的 `host.docker.internal`，或同一 Compose 网络的服务名。

## LinuxDo 登录

同时配置 `LINUXDO_CLIENT_ID` 与 `LINUXDO_CLIENT_SECRET`，在后台注册设置中开启 LinuxDo 登录并选择最低信任等级。凭证仅服务端使用；登录按钮随首屏运行时配置下发。

生产环境建议设置固定 `LINUXDO_REDIRECT_URI`，并在 LinuxDo Connect 应用中登记同一完整回调地址。缺省路径是 `/api/auth/linuxdo/callback`；只有 `TRUSTED_PROXY_COUNT` 为正数时才使用代理的 `x-forwarded-proto` / `x-forwarded-host`，代理须覆盖客户端传入的转发头。多个实例共用 `AUTH_SECRET`，用于验证十分钟有效的 HttpOnly OAuth 状态与待注册 cookie。

未绑定用户遵循开放注册、邀请码与默认用户组设置；关闭注册时，用户先用已有账号登录后绑定。自动建号账号保留 LinuxDo 绑定以确保可继续登录。

## 定时维护与源站探测

`/api/cron` 接受 `task=config|live|metadata|source-health|all`，省略参数时执行 `all`。`metadata` 包含源站探测，`all` 每轮也只探测一次；独立 `source-health` 仅执行探测。任务互斥，已有任务运行时返回 202，本轮跳过。进程内用内存标记，跨进程靠文件锁：Docker 默认 `/data/icetv-cron.lock`（`CRON_LOCK_PATH` 可改），非 Docker 未设置时不加文件锁，不共享数据卷的多个容器也互不感知。200 表示后台任务已启动，完成情况以服务端日志与健康报告为准。

- Docker 由 `start.js` 在服务就绪后调用接口：默认直播 60 秒、配置 75 秒、元数据 90 秒后首次运行，随后分别每 1、6、6 小时运行；源站探测、过期邀请码清理与线路统计（`source_route_stats`）的 37 天保留清理随元数据任务执行。周期和启动延迟变量见 [.env.example](../.env.example)。
- 本地 `pnpm dev` 由进程内调度器直接启动任务：默认元数据 30 秒、直播 45 秒、配置 60 秒后首次运行，后续使用相同周期。`DEV_CRON_DISABLED=true` 关闭开发调度。
- `pnpm start` 仅启动 Next 服务，定时调用由外部调度器负责。仓库 `vercel.json` 配置每天 UTC 01:00 请求 `/api/cron`（`all`）；平台执行时限仍适用，接口返回成功不代表后台批次已经完成。

探测范围与样本口径见 [源站与搜索](sources-search.md#探测)。

手动执行（环境中先设置对应站点的 `CRON_SECRET`；远程部署替换地址）：

```bash
curl -fsS -H "Authorization: Bearer $CRON_SECRET" 'http://localhost:3000/api/cron?task=source-health'
```

## 缓存与资源边界

### 多实例与缓存

- 业务共享缓存和资源租约在数据库，不依赖 Next Data Cache 或容器文件系统。SQLite 仅支持本机进程访问同一文件，不跨主机挂载。
- 首页推荐、Bangumi 日历、详情、搜索、调整后的封面和可缓存 VOD 清单复用共享结果；签名清单、直播清单及分片内容不进入 VOD 结果缓存。已完结且内容不含签名参数的媒体清单最长复用 30 分钟（与详情缓存上限相同），其余可缓存清单 2 分钟；分片令牌写在路径里且有效期短于 30 分钟的源站，缓存清单里的分片地址可能已过期。
- 缓存键包含源配置或去广告策略版本，封面还包含尺寸和质量。鉴权先于缓存读取，命中缓存不等于公开访问。
- 豆瓣数据、通用图片代理、直播 logo 与点播分片响应使用 `private`，浏览器按各自 TTL 复用，CDN 与反向代理遵守该响应头。公开 Bangumi 封面、日历、版本信息与站点图标保持公共缓存；server-config 按会话区分并带 `Vary: Cookie`。Service Worker 的显式 Cache Storage 规则独立于 HTTP 公共缓存指令，只覆盖点播分片、图片代理与 Bangumi 封面；Serwist 按顺序取第一条匹配规则，默认规则末尾的 `/.*/` NetworkOnly 会接走全部同源请求，自定义规则须经 `composeRuntimeCaching()`（`src/lib/sw-cache-rules.ts`）排在默认规则之前。跨域图片是不透明响应，Chrome 按每条约 7MB 计入配额，由 `shouldBypassCrossOriginImageCache()` 先于默认跨域规则改为只走网络，不写入 Cache Storage。
- 直播频道与 EPG 按当前源 URL、有效 UA 和 EPG 地址隔离，命中前读取源配置。进程内缓存新鲜期 30 分钟，最长保留 2 小时，最多 64 条 / 32 MiB 估算序列化体积；旧值覆盖短暂回源故障，持续失败到期后重新加载并返回错误，不无限延长节目单有效期。
- `shared_cache` 是可丢弃数据。单条上限 2 MiB，清理目标为 4096 条 / 128 MiB，清理间隔内允许暂时超出。
- 共享缓存遇数据库故障时保留可用旧缓存；无缓存时返回 503，不绕过资源保护集中回源。搜索聚合例外：单源失败只表现为该源无结果，整体仍返回 200。
- `force-dynamic` 不等于所有显式 fetch 都不缓存。首页上游 fetch 使用 `no-store`，推荐复用由 IceTV 共享缓存负责；开发模式/HMR 的请求次数不能代表生产表现。
- 首页服务端渲染对共享缓存只等 800ms（`HOME_UPSTREAM_WAIT_MS`）：豆瓣简介与 Bangumi 日历未命中时本次留空交给客户端加载，回源在后台继续并写入缓存。Bangumi 日历全站一份，由服务端回源预热，按 6 小时新鲜、24 小时最长保留刷新；客户端（含游客）先请求 `/api/bangumi/calendar`，失败或无内容时浏览器直连 `api.bgm.tv` 兜底，无用户或站点级数据源选项。
- 豆瓣数据与图片默认「自动」：数据依次 Zwei → CMLiussss 腾讯云 → 本站服务端，图片依次 CMLiussss 腾讯云 → 阿里云 → 本站服务端；游客不含服务端（选了服务端的游客也按自动处理），浏览器直连豆瓣数据受跨域限制，不在自动链里。回退成功的通道在同一标签页记 5 分钟（`src/lib/douban-route-memory.ts`），到期恢复第三方优先。首页服务端渲染把豆瓣图片写成第一个镜像地址，客户端按镜像路径还原到 `img1.doubanio.com` 生成后续候选；后台保存过的具体通道不会自动改成「自动」。
- 源站封面按后台「源站封面加载」：代理经 `/api/image-proxy` 回源，按显示宽度缩成 webp 存入共享缓存；直连由浏览器取原图、不缩放，HTTPS 站点上的 http 封面会被浏览器升级或拦截；自动先代理、失败后直连。图片代理与豆瓣图片共用该路由，配额与失败日志分别记为 `douban-image` / `source-cover`（各为每用户或 IP 每分钟 480 次）。
- 图片代理按域名记录回源健康：同一域名连续 3 次超时、网络错误、403 或 5xx 后，本实例 5 分钟内对该域名直接返回 502、不回源，冷却后首次请求仍失败立即重新冷却；单图 404、本站资源限制与地址校验失败不计数。此状态在进程内、只作用于图片代理；上游 429 由回源层的共享冷却处理。

### 回源预算

默认值如下，变量名和调参入口见 [.env.example](../.env.example)：

| 类别             | 全局 / 主机并发 | 单用户并发 | 全局 / 主机每分钟请求数 | 最长请求时间 |
| ---------------- | --------------- | ---------- | ----------------------- | ------------ |
| 元数据           | 64 / 12         | —          | 1800 / 300              | 60 秒        |
| VOD + 直播分片   | 96 / 32         | 6          | 12000 / 6000            | 120 秒       |
| 换源检测额外额度 | 8 / 8           | 2          | 480 / 480               | 20 秒        |

- 直播另有总并发 32 的上限；分片全局 / 主机 / 单用户流量额度为 1536 / 768 / 192 MiB 每分钟。VOD 与直播共用媒体预算。
- 主机按目标 URL 的 hostname 合并，不按可修改的 source 参数或端口拆分。带有效播放签名的请求按客户端 IP 计数（即使同时登录），其余按账号计数；同出口用户可能共享额度。
- 连接租约持续到响应体读完、取消或出错，不在收到响应头时释放；每 10 秒续租，实例失联后 30 秒过期。
- 用户超额返回 429，共享资源繁忙或数据库故障返回 503，附带 `Retry-After`；已开始发送的流只能中断，不能改 HTTP 状态。
- 搜索上游闸门（`src/lib/search-aggregate.ts`）和封面转码（`src/lib/cover-image-resize.ts`）的排队有条数上限和等待期限：搜索排队满或超时只让该源记为失败，不进入源失败冷却；封面转码返回 503。
- 上游返回 429，或返回带 `Retry-After` 的 503 时，该出口对目标主机进入冷却（`src/lib/upstream-cooldown.server.ts`，时长按 `Retry-After` 取 5～300 秒，缺失时 30 秒）。代理池按「节点 + 目标域名」隔离冷却，直连按域名记录；可用出口选择见[上游代理池](#上游代理池)。当前回源路径受冷却阻断时返回带剩余秒数的 503，弹幕接口仍返回 429。冷却经数据库在实例间共享，查询结果在本地缓存 3 秒；冷却存储故障时只在本实例内生效。
- 请求数与流量额度按 60 秒固定窗口计数：各实例按块向数据库预约后在内存中扣减（预取块为 64 个请求或 8 MiB，流量以 256 KiB 为单位；单次缺口更大时按实际缺口预约），未用完的额度不退还。多实例时每个实例对每项额度最多提前占用一块未用额度，接近上限时可能略早拒绝。实例间时钟同步（如 NTP）时不会超发；时钟落后的实例在窗口翻转时，每项额度最多多放一块。流量额度是保护性上限，不是平滑限速或实际网卡流量统计；单分片仍有 256 MiB 上限。
- 缓存命中只消耗入口额度，浏览器直连不消耗本站回源额度。资源额度按各自的时间窗口和租约管理。
- 这些上限不承诺所有并发用户均可播放。带宽整形、分片复用及容量验收由实际网关、源站码率和部署资源决定。

### 换源检测

- 检测请求同时受额外检测额度和普通回源预算约束；普通播放不占检测额度。每个浏览器页同时检测 2 个源，离开换源标签后不再启动下一批。
- 额度不足显示「检测暂缓」，进入共享冷却，不记为源站失效、不无限自动重试；冷却后可手动重试。
- 成功结果复用 10 分钟。清单延迟取实际 GET 首包，不额外发 HEAD。

## 升级与备份

Docker 升级使用 `docker compose pull`、`docker compose up -d`，保留原数据卷；Vercel 重新部署时保留原数据库连接。带弹幕叠加文件的部署须带同一组 `-f` 参数。

SQLite 不直接复制正在写入的主文件。停止 IceTV 后备份整个数据目录，或使用数据库在线备份；备份路径使用新的空目录：

```bash
docker compose stop icetv
docker cp icetv:/data ./icetv-backup
docker compose start icetv
```

MySQL 使用逻辑备份，不直接复制运行中的数据卷：

```bash
docker compose exec -T mysql sh -c 'exec mysqldump --single-transaction --no-tablespaces -u root -p"$MYSQL_ROOT_PASSWORD" icetv' > backup.sql
```

## 故障边界

| 现象                 | 检查入口 / 含义                                                                    |
| -------------------- | ---------------------------------------------------------------------------------- |
| 弹幕连接失败         | 地址中的 token、内网放行变量、后台「测试连接」、`docker compose logs danmu-api`    |
| 弹幕暂时为空         | 在弹幕面板点「重载」查看结果；`200` 空数组不证明原视频无弹幕，需检查采集服务与 DNS |
| 弹幕 429             | 按 `Retry-After` 等待，缺失时默认 60 秒；不同用户可能共用服务端出口 IP 的上游额度  |
| MySQL 连接失败       | URL 编码、账号权限、容器健康状态、云数据库 TLS                                     |
| 反代后登录或限流异常 | 真实代理层数与 `TRUSTED_PROXY_COUNT` 是否一致                                      |

弹幕空结果仅短暂缓存，临时错误不会覆盖已有非空评论；绑定 ID 失效可重新匹配。手动绑定的标题校验暂时失败时保留绑定，不必反复清除或重绑。
