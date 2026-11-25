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

- 覆盖经 `fetchWithUrlGuard()` 的搜索、详情、豆瓣、点播清单 / 密钥、封面缓存与弹幕等回源。直播订阅、EPG 与直播预检默认进池；订阅和 EPG 失败后可按 `HTTPS_PROXY` 等环境变量回退。直播播放清单、密钥与分片绕过池，沿用环境代理 / 直连分支。Bangumi 日历使用独立的环境代理 / 直连逻辑；Bangumi 封面优先使用环境代理，无匹配环境代理时默认进池。
- 点播分片默认直连，代理节点通常有流量限制。站长可在后台「站点设置 → 数据与图片代理 → 视频分片走代理池」开启，该开关仅在服务端已配置代理池时显示；开启后分片流量同样经代理节点中转再由服务器转发给用户。
- 点播按用户稳定选出口：会话用户名经 `AUTH_SECRET` 的 HMAC 派生为不透明 sticky 值，顶层清单使用该值选路，改写后的子清单、密钥及进池分片通过播放签名携带并延续该值；有效签名子请求直接验签，无需逐片查询用户。资源计额独立保留会话按用户、播放签名按客户端 IP 的规则。旧播放签名缺少 sticky 时沿用 IP 选路，重新加载顶层清单后取得新上下文。其他回源沿用原 identity 选路，无标识请求（如定时任务）轮询。
- 启用代理池时，raw 清单的缓存、预热、后台刷新与在途合并都按 sticky 分区（旧签名缺 sticky 时按计额身份），不跨用户共享：清单里的子地址可能绑定取清单的出口，且签名写在路径等位置时无法识别，只按签名判断会让并发请求或缓存命中拿到另一出口取得的地址。同一用户的预热、正式播放、重试与跨实例读取仍共用结果；按当前用户规模，跨用户命中的收益可以忽略，用户多、热门集集中观看时再评估按源开放共享。未启用代理池时 raw 清单继续共享。请求地址、重定向终点或正文含可识别签名参数的清单另外不进缓存，控制的是签名寿命。分区只保证本站不跨上下文复用：sticky 是选路偏好，节点故障顺延或回落直连会改变实际出口；分片默认不进池，CDN 把分片绑定出口 IP 时需开启 `UpstreamProxyPoolSegments`。改写结果缓存按 sticky 值分区，浏览器分片缓存保留稳定 sticky、剔除签名与到期等易变参数，同用户重签可复用，不同上下文隔离，容量上限保持不变。
- 每次按顺序选择最多两个可用池内出口（含显式配置的 `direct`），直连可用且尚未入选时补到末尾。直连退避期间选用其他可用出口，全部出口不可用时保留直连兜底。响应交付前的网络失败或目标域名冷却可顺延到下一出口；HTTP 403 等普通状态码保持原出口结果，429 或带 `Retry-After` 的 503 冷却按「节点 + 目标域名」隔离，直连按域名记录。已取消的请求保持原错误；带请求体的请求可在发送前冷却时顺延，网络失败仅在建连失败且请求体为字符串或 `URLSearchParams` 时顺延，收到 429 或带 `Retry-After` 的 503 后直接抛出冷却错误、保持单次发送；无请求体请求仍可顺延。已交付响应的正文沿用原连接。
- 连续三次网络失败退避 30 秒，退避结束后恢复尝试；再次失败时退避翻倍，最长五分钟，成功清零。代理节点健康按节点全局记录，直连健康按目标 hostname 隔离，直连记录最多保留最近失败的 1024 个主机；健康状态按进程独立维护。
- `UPSTREAM_PROXY_CONNECT_TIMEOUT_MS`（默认 5000ms）用于池内 direct 的 `Agent.connect.timeout` 和代理节点的 `proxyTls.timeout`（连接代理端）；隧道内目标站 TLS 沿用 undici 默认超时，完整隧道建连仍受各阶段与请求总预算约束。正文读取沿用原有预算。有效开发代理开启时，direct 使用原生 fetch 与全局 dispatcher；未配置有效代理池或请求显式绕过池时，同样使用原生 fetch 与原有连接超时。
- 每个节点须对应不同出口 IP。使用 mihomo 等本机代理服务时，建议每个出口单独端口，端口背后使用 `fallback` / `url-test` 组淘汰坏 IP，各端口候选 IP 保持互不重叠；仅暴露一个 `load-balance` 端口无法保证用户出口稳定。
- 生产环境照常执行本地 DNS 私网校验；有效开发代理开启时由代理解析域名，direct 沿用开发代理的全局 dispatcher。节点使用自有或可信服务，本机监听绑定 `127.0.0.1` 并保持公网隔离。Docker 内访问宿主代理使用 host 网络、可达的 `host.docker.internal`，或同一 Compose 网络的服务名。

## LinuxDo 登录

在后台「注册与登录」配置 LinuxDo Connect 的 Client ID 与 Client Secret，再开启 LinuxDo 登录并选择最低信任等级。凭证保存在数据库配置中，仅服务端使用；后台响应中的 Client Secret 恒为空字符串，保存时留空表示保留已有密钥。登录按钮随首屏运行时配置下发。

生产环境建议填写固定回调地址，并在 LinuxDo Connect 应用中登记同一完整地址：使用本站的 HTTP/HTTPS 绝对 URL，路径恰为 `/api/auth/linuxdo/callback`，无用户名、密码与 hash。留空则按请求推导；只有 `TRUSTED_PROXY_COUNT` 为正数时才使用代理的 `x-forwarded-proto` / `x-forwarded-host`，代理须覆盖客户端传入的转发头。多个实例共用 `AUTH_SECRET`，用于验证十分钟有效的 HttpOnly OAuth 状态与待注册 cookie。

开放注册是总开关，账号密码与 LinuxDo 注册通道分别控制普通注册和未绑定身份的自动建号；两个通道至少保留一个选中，总开关关闭时均停止新注册。邀请码与默认用户组对两种注册方式统一生效。已绑定用户登录与已有账号绑定独立于注册通道开关；关闭 LinuxDo 注册时，用户先用已有账号登录后绑定。自动建号账号保留 LinuxDo 绑定以确保可继续登录。

## 定时维护与源站探测

`/api/cron` 接受 `task=config|live|metadata|source-health|all`，省略参数时执行 `all`。`metadata` 包含源站探测，`all` 每轮也只探测一次；独立 `source-health` 仅执行探测。任务互斥，已有任务运行时返回 202，本轮跳过；`start.js` 与开发调度器收到 202 后每 2 分钟补跑，至多 15 次，避免周期相近的任务撞上后整轮丢失。进程内用内存标记，跨进程靠文件锁：Docker 默认 `/data/icetv-cron.lock`（`CRON_LOCK_PATH` 可改），非 Docker 未设置时不加文件锁，不共享数据卷的多个容器也互不感知。200 表示后台任务已启动，完成情况以服务端日志与健康报告为准。

- Docker 由 `start.js` 在服务就绪后调用接口：就绪成功先设置一次性标记并停止轮询，在途健康响应只消费正文，定时任务只注册一组。默认直播 60 秒、配置 75 秒、元数据 90 秒后首次运行，随后分别每 1、6、6 小时运行；源站探测、过期邀请码清理与线路统计（`source_route_stats`）的 37 天保留清理随元数据任务执行。周期和启动延迟变量见 [.env.example](../.env.example)。
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
- 首页推荐、Bangumi 日历、详情、搜索（含 giri / xgcartoon）、不带签名参数的逐集解析地址、调整后的封面和可缓存 VOD 清单复用共享结果；签名清单（地址、重定向终点或正文含签名参数）、直播清单及分片内容不进入 VOD 结果缓存。已完结的媒体清单最长复用 30 分钟（与详情缓存上限相同），其余可缓存清单 2 分钟；分片令牌写在路径里且有效期短于 30 分钟的源站，缓存清单里的分片地址可能已过期。
- 缓存键包含源配置或去广告策略版本，封面还包含尺寸和质量。鉴权先于缓存读取，命中缓存不等于公开访问。
- 豆瓣数据、通用图片代理、直播 logo 与点播分片响应使用 `private`，浏览器按各自 TTL 复用，CDN 与反向代理遵守该响应头。公开 Bangumi 封面、日历、版本信息与站点图标保持公共缓存；`public/` 下的默认图标文件名固定，生产 CDN 会给它们下发长达一个月的浏览器缓存，引用地址统一经 `src/lib/site-icon.ts` 与 `scripts/generate-manifest.js` 追加 `?v=<应用版本>`，新增引用直接写裸路径会让换图后客户端沿用旧图；server-config 按会话区分并带 `Vary: Cookie`。Service Worker 的显式 Cache Storage 规则独立于 HTTP 公共缓存指令，只覆盖点播分片、图片代理与 Bangumi 封面；Serwist 按顺序取第一条匹配规则，默认规则末尾的 `/.*/` NetworkOnly 会接走全部同源请求，自定义规则须经 `composeRuntimeCaching()`（`src/lib/sw-cache-rules.ts`）排在默认规则之前。跨域图片是不透明响应，Chrome 按每条约 7MB 计入配额，由 `shouldBypassCrossOriginImageCache()` 先于默认跨域规则改为只走网络，不写入 Cache Storage。
- 「豆瓣接口浏览器缓存时间」（`SiteInterfaceCacheTime`）只控制 `/api/douban` 系列接口响应的 `private max-age`；服务端豆瓣缓存使用独立的固定策略。
- 直播频道与 EPG 按当前源 URL、有效 UA 和 EPG 地址隔离，命中前读取源配置。进程内缓存新鲜期 30 分钟，最长保留 2 小时，最多 64 条 / 32 MiB 估算序列化体积。频道列表在播放列表解析后交付，冷读节目单等待同一次刷新。EPG 刷新失败时保留同地址未过期的节目单，有效期仍从上次成功加载起算；到期且刷新失败时返回空节目单。
- `shared_cache` 是可丢弃数据。单条上限 2 MiB，清理目标为 4096 条 / 128 MiB，活跃租约暂时豁免，清理间隔内允许暂时超出。共享缓存与资源表的清理各由每实例每分钟最多一轮、同类任务不重叠的后台维护触发，在下一轮事件循环执行。缓存删除与旧行字节数回填每批至多处理 250 条、批次间让出事件循环；每轮共用 40 批 / 250ms 调度预算，先清过期，再按条数裁剪及分批回填，元数据字节数完整时执行字节裁剪，达到任一预算后余量留到下一轮。时间预算在批次边界检查，单条同步 SQL 或数据库等待仍可能超过预算；容量判断只读有界元数据，字节列与旧行兼容见[数据与存储](data-storage.md#共享缓存)。Vercel 冻结后台执行时只延后空间回收，容量目标属于软上限。缓存消费侧按 `staleUntil` 排除过期值，资源准入事务清理过期租约，续租和额度消费分别校验租约到期时间与窗口结束时间，正确性不依赖维护及时完成。
- 共享缓存遇数据库故障时保留可用旧缓存；无缓存时返回 503，不绕过资源保护集中回源。搜索聚合例外：单源失败只表现为该源无结果，整体仍返回 200。
- `force-dynamic` 不等于所有显式 fetch 都不缓存。首页上游 fetch 使用 `no-store`，推荐复用由 IceTV 共享缓存负责；开发模式/HMR 的请求次数不能代表生产表现。
- 首页服务端渲染对共享缓存整页共用 800ms 预算（`HOME_UPSTREAM_WAIT_MS`）：豆瓣热门电影 / 剧集 / 综艺、Hero 简介与 Bangumi 日历未在预算内拿到时本次留空交给客户端加载，回源在后台继续并写入缓存。热门电影或剧集任一超时时 Hero 整体留空，由客户端拿到完整列表后挑选（此时无简介）。Bangumi 日历全站一份，由服务端回源预热，按 6 小时新鲜、24 小时最长保留刷新；客户端（含游客）先请求 `/api/bangumi/calendar`，失败或无内容时浏览器直连 `api.bgm.tv` 兜底，无用户或站点级数据源选项。
- 豆瓣数据与图片默认「自动」：数据依次 本站服务端 → CMLiussss 腾讯云 → Zwei，优先复用本站全站共享缓存；图片依次 CMLiussss 腾讯云 → 阿里云 → 本站服务端。游客不含服务端（选了服务端的游客也按自动处理），浏览器直连豆瓣数据受跨域限制，不在自动链里。回退成功的通道在同一标签页记 5 分钟（`src/lib/douban-route-memory.ts`），首位成功不续期，到期恢复各自默认顺序。浏览器端数据候选超时为本站 15 秒（需覆盖服务端 10 秒回源预算与鉴权、额度检查）、第三方 10 秒，均计时到响应头，正文读取在计时范围外。Top250 页面缺少列表容器或榜单范围内解析不出影片时按上游失败处理、不写缓存，客户端可回退。首页服务端渲染把豆瓣图片写成第一个镜像地址，客户端按镜像路径还原到 `img1.doubanio.com` 生成后续候选；后台保存过的具体通道不会自动改成「自动」。
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
- 分片回源请求 `Accept-Encoding: identity`。Fetch 自动解码时按解码后字节限流，并丢弃原编码和长度头；直播环境代理流保留原始字节及对应响应头。清单和密钥的环境代理分支要求未压缩正文，收到压缩正文时改走支持解码的 Fetch 回源。
- 用户超额返回 429，共享资源繁忙或数据库故障返回 503，附带 `Retry-After`；已开始发送的流只能中断，不能改 HTTP 状态。
- 搜索上游闸门（`src/lib/search-aggregate.ts`）和封面转码（`src/lib/cover-image-resize.ts`）的排队有条数上限和等待期限：搜索排队满或超时只让该源记为失败，不进入源失败冷却；封面转码返回 503。
- 上游返回 429，或返回带 `Retry-After` 的 503 时，该出口对目标主机进入冷却（`src/lib/upstream-cooldown.server.ts`，时长按 `Retry-After` 取 5～300 秒，缺失时 30 秒）。代理池按「节点 + 目标域名」隔离冷却，直连按域名记录；可用出口选择见[上游代理池](#上游代理池)。当前回源路径受冷却阻断时返回带剩余秒数的 503，弹幕接口仍返回 429。冷却经数据库在实例间共享，查询结果在本地缓存 3 秒；冷却存储故障时只在本实例内生效。
- 请求数与流量额度按 60 秒固定窗口计数：各实例按块向数据库预约后在内存中扣减（预取块为 64 个请求或 8 MiB，流量以 256 KiB 为单位；单次缺口更大时按实际缺口预约），未用完的额度不退还。多实例时每个实例对每项额度最多提前占用一块未用额度，接近上限时可能略早拒绝。实例间时钟同步（如 NTP）时不会超发；时钟落后的实例在窗口翻转时，每项额度最多多放一块。流量额度是保护性上限，不是平滑限速或实际网卡流量统计；单分片仍有 256 MiB 上限。
- 缓存命中只消耗入口额度，浏览器直连不消耗本站回源额度。资源额度按各自的时间窗口和租约管理。
- 流量额度只限每分钟速率，不限累计用量。累计用量由[月流量监控](#月流量监控)按宿主机网卡统计保护；直播页另在后台超过 10 分钟或前台 3 小时无输入时停止拉流（阈值见 `src/features/live/lib/liveInactivityPolicy.ts`），只约束正常打开的直播页。
- 这些上限不承诺所有并发用户均可播放。带宽整形、分片复用及容量验收由实际网关、源站码率和部署资源决定。

### 换源检测

- 检测请求同时受额外检测额度和普通回源预算约束；普通播放不占检测额度。每个浏览器页同时检测 2 个源，离开换源标签后不再启动下一批。
- 额度不足显示「检测暂缓」，不记为源站失效、不无限自动重试；按退避提示手动重试。检测外层只管理额外额度和取消，共享主机冷却由实际回源响应触发。
- 成功结果复用 10 分钟。清单延迟取实际 GET 首包，不额外发 HEAD。

## 月流量监控

VPS 按月计流量、超额断网时，用宿主机的 vnstat 统计网卡进出流量，IceTV 读取统计文件做后台展示、告警和自动保护。后台「流量」页仅在读到统计文件或已设额度时显示（`isTrafficTabVisible()`，由后台布局在服务端判断，接入后刷新后台页面即出现）；设了额度时统计不可用会告警并跳到该页，所以有额度就保留该页并显示读取失败。不配置时其余功能不受影响。

宿主机：

```bash
apt install -y vnstat            # 安装后 vnstatd 自动开始记录，安装前的用量不会补录
cat > /usr/local/bin/icetv-traffic-export <<'SH'
#!/bin/sh
set -e
out=/var/lib/docker/volumes/icetv_icetv-data/_data/host-traffic.json   # 数据卷在宿主机上的路径
vnstat -i eth0 --json d 40 > "$out.tmp"
chmod 644 "$out.tmp"
mv "$out.tmp" "$out"
SH
chmod 755 /usr/local/bin/icetv-traffic-export
echo '*/5 * * * * root /usr/local/bin/icetv-traffic-export' > /etc/cron.d/icetv-traffic
```

- 容器内默认读取 `/data/host-traffic.json`（非 Docker 为 `data/host-traffic.json`），`HOST_TRAFFIC_FILE` 可改路径。文件为 `vnstat --json d` 原样输出，多个网卡按日合计；进出流量合计计入用量。周期按 UTC 日期切分，vnstat 按宿主机时区划日，宿主机不是 UTC 时周期边界那一天的流量可能归入相邻周期。
- 站长在后台「维护 → 流量」设置月额度（GB，十进制）与每月重置日（1～28），额度为空时只展示不告警、不暂停。设置存于配置的 `TrafficConfig`。
- 站长告警：用量达 80%、按当前速率预计超额、已暂停中转、统计超过 30 分钟未更新、设了额度却读不到文件。
- 用量达额度 95% 时自动暂停服务器中转：`/api/proxy/segment` 与服务器模式的 `/api/proxy/m3u8` 返回带 `x-icetv-relay-paused: 1` 的 503，`/api/proxy-modes` 把「自动」源报为直连。浏览器直连播放不受影响，下个周期自动恢复；站长可在流量页手动恢复本周期中转。统计文件缺失或读取出错时不暂停；超过 30 分钟未更新的文件仍按最后一次数据判断，避免导出中断后自动放开中转。
- 状态在进程内缓存 30 秒，暂停与恢复另受配置缓存影响，最长约 1 分钟生效。

## 网页内升级（可选）

dev 通道部署只检测并升级到 dev 镜像（GHCR 上最高的 `X.Y.Z-dev.N` 标签），正式版不提示。

单实例 Docker Compose 部署可接入 updater，由站长在版本面板先下载镜像，再确认重启。下载期间原容器继续服务；重启前 IceTV 在线备份 SQLite，备份失败会阻止重启。新容器启动或健康检查失败时自动回退旧镜像，并再次验证旧容器健康状态。

在宿主机 `/opt/icetv` 保存原 `compose.yml` 与以下 `compose.updater.yml`；实际目录不同时，同时替换挂载两侧路径。在该目录的 `.env` 中设置至少 32 字符的高熵随机 `UPDATER_TOKEN`，两服务共用同一值，生成方式见 [.env.example](../.env.example)。

```yml
services:
  icetv:
    environment:
      UPDATER_URL: http://icetv-updater:9330
      UPDATER_TOKEN: ${UPDATER_TOKEN:?请在 .env 中设置升级密钥}

  icetv-updater:
    image: ghcr.io/naseaoi/icetv-updater:latest
    restart: unless-stopped
    environment:
      UPDATER_TOKEN: ${UPDATER_TOKEN:?请在 .env 中设置升级密钥}
      UPDATER_TARGET_CONTAINER: icetv
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - /opt/icetv:/opt/icetv:ro
    logging:
      driver: json-file
      options:
        max-size: 10m
        max-file: '3'
```

```bash
cd /opt/icetv
docker compose -f compose.yml -f compose.updater.yml up -d
```

- updater 仅通过 Compose 内网访问，**不要发布其端口**。只有 updater 挂载 Docker socket；IceTV 应用容器保持无 socket。socket 访问等同于宿主机 root 权限，即便只读挂载 socket 也能调用写 API；只使用可信镜像，保护 token、Compose 文件及内网访问权限。
- updater 读取目标容器的 Compose 标签还原项目、服务、工作目录、按顺序排列的 `-f` 与 `--env-file`。工作目录、全部 Compose 文件、环境文件及引用的配置文件须在 updater 内按宿主机相同绝对路径可读；目录外的文件另加同路径只读挂载。启动与手动维护时沿用同一组 `-f` 参数。
- Compose 插值变量须保存在 `.env` 或显式 `--env-file` 文件中。首次启动时仅由宿主 shell 提供的变量无法还原；updater 自身环境中同名变量也会参与插值，应保持一致。私有镜像仓库需另为 updater 配置 Docker 登录凭证。
- 支持 `latest`、`dev` 等浮动标签与单实例镜像部署。固定版本号、digest、无 Compose 标签、挂载缺失或 updater 不可达时，版本面板保留手动更新入口。服务须使用 `image`，升级期间保持 Compose 配置与目标镜像标签稳定，并暂停外部自动更新器及镜像清理任务。
- updater 同时只执行一个任务，状态保存在内存；任务期间保持 updater 运行。重建使用已拉取的本地镜像（`--pull never`），避免 `pull_policy: always` 再次拉取并覆盖回退镜像；原有数据卷与其他服务保持不变。
- 新旧容器都以 Docker 健康检查通过为就绪；未配置健康检查时以连续运行 20 秒为准。自动回退只恢复镜像，数据库仍使用原数据卷；**不可逆迁移回退须恢复升级前备份**。SQLite 在线备份位于数据库同目录的 `backups/`，保留最近两份；MySQL 升级前由部署者自行备份，操作见[升级与备份](#升级与备份)。
- updater 从镜像（而非容器）的 `NEXT_PUBLIC_APP_VERSION` 环境变量读取版本，版本面板据此显示已下载版本并判断是否需要刷新页面，所以 `Dockerfile` 运行阶段必须保留该 `ENV`。`start.js` 每次启动都会重新执行 `scripts/generate-manifest.js`，运行时镜像只带 `scripts/` 而不带 `src/`，该脚本只能用这个 `ENV` 给图标地址加版本号，也不能引用 `src/` 下的模块，否则容器启动即退出，网页升级随之回滚。容器上覆盖的同名变量不参与判断。
- updater 自身由部署者手动升级：沿用同一组 Compose 文件执行 `docker compose ... pull icetv-updater` 与 `docker compose ... up -d --no-deps icetv-updater`。应用与 updater 选择一致的发布通道；updater 参数默认值见 [.env.example](../.env.example)。

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

弹幕合法空结果仅短暂缓存，异常搜索响应按上游错误处理且不缓存；临时错误不会覆盖已有非空评论。绑定 ID 失效可重新匹配。手动绑定的标题校验暂时失败时保留绑定，不必反复清除或重绑。
