# 部署指南

IceTV 支持多种部署方式，可根据实际需求选择合适的方案。

## 目录

- [Docker + SQLite](#docker--sqlite)
- [Docker + MySQL](#docker--mysql)
- [Docker + SQLite + 弹幕服务](#docker--sqlite--弹幕服务)
- [Docker + MySQL + 弹幕服务](#docker--mysql--弹幕服务)
- [Vercel + MySQL](#vercel--mysql)
- [环境变量说明](#环境变量说明)
- [升级与备份](#升级与备份)

---

## Docker + SQLite

最简单的部署方式，适合个人使用和小规模部署。

```yml
services:
  icetv:
    image: ghcr.io/naseaoi/icetv:latest
    container_name: icetv
    restart: unless-stopped
    ports:
      - '3000:3000'
    environment:
      - ICETV_USERNAME=admin
      - ICETV_PASSWORD=admin_password
      - AUTH_SECRET=replace_with_random_auth_secret
      - CRON_SECRET=replace_with_random_secret
      - LOCAL_DB_PATH=/data/icetv-data.sqlite
    volumes:
      - icetv-data:/data

volumes:
  icetv-data:
```

**启动：**

```bash
docker compose up -d
```

访问 `http://localhost:3000`，使用配置的管理员账号登录。

---

## Docker + MySQL

适合需要多实例部署或对数据库有更高要求的场景。

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
      ICETV_PASSWORD: admin_password
      AUTH_SECRET: replace_with_random_auth_secret
      CRON_SECRET: replace_with_random_secret
      NEXT_PUBLIC_STORAGE_TYPE: mysql
      DATABASE_URL: mysql://icetv:replace_with_mysql_password@mysql:3306/icetv

volumes:
  icetv-mysql:
```

**注意事项：**

- IceTV 会自动创建数据表，数据库账号需要建表和读写权限
- 同一 Compose 网络内使用服务名 `mysql`
- 连接宿主机 MySQL 时，Windows/macOS Docker Desktop 可用 `host.docker.internal`
- 用户名或密码含特殊字符时需在 `DATABASE_URL` 中 URL 编码
- 使用已有 MySQL 服务时移除 `mysql` 服务，将 `DATABASE_URL` 指向实际地址

---

## Docker + SQLite + 弹幕服务

在 SQLite 部署基础上增加弹幕功能。

```yml
services:
  danmu-api:
    image: hxd66/danmu_api:latest
    container_name: danmu-api
    restart: unless-stopped
    ports:
      - '9321:9321'
    environment:
      - DANMU_API_TOKEN=replace_with_random_token
    volumes:
      - danmu-data:/app/data

  icetv:
    image: ghcr.io/naseaoi/icetv:latest
    container_name: icetv
    restart: unless-stopped
    depends_on:
      - danmu-api
    ports:
      - '3000:3000'
    environment:
      - ICETV_USERNAME=admin
      - ICETV_PASSWORD=admin_password
      - AUTH_SECRET=replace_with_random_auth_secret
      - CRON_SECRET=replace_with_random_secret
      - LOCAL_DB_PATH=/data/icetv-data.sqlite
      - DANMAKU_API_BASE_URL=http://danmu-api:9321/replace_with_random_token
    volumes:
      - icetv-data:/data

volumes:
  icetv-data:
  danmu-data:
```

**配置说明：**

1. **弹幕服务**：使用 [danmu_api](https://github.com/huangxd-/danmu_api)，需设置 `DANMU_API_TOKEN`
2. **弹幕地址**：`DANMAKU_API_BASE_URL` 格式为 `http://服务名:端口/token`
3. **容器网络**：IceTV 通过 Docker 内部网络访问弹幕服务，使用服务名 `danmu-api`
4. **内网地址**：若弹幕服务使用内网地址，需设置 `DANMAKU_API_ALLOW_PRIVATE=true`

**启用弹幕：**

部署后需在 **管理后台 → 站点配置 → 播放器弹幕** 开启开关，可使用"测试连接"按钮验证配置。

---

## Docker + MySQL + 弹幕服务

完整部署方案，同时使用 MySQL 和弹幕服务。

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

  danmu-api:
    image: hxd66/danmu_api:latest
    container_name: danmu-api
    restart: unless-stopped
    ports:
      - '9321:9321'
    environment:
      - DANMU_API_TOKEN=replace_with_random_token
    volumes:
      - danmu-data:/app/data

  icetv:
    image: ghcr.io/naseaoi/icetv:latest
    container_name: icetv
    restart: unless-stopped
    depends_on:
      mysql:
        condition: service_healthy
      danmu-api:
        condition: service_started
    ports:
      - '3000:3000'
    environment:
      ICETV_USERNAME: admin
      ICETV_PASSWORD: admin_password
      AUTH_SECRET: replace_with_random_auth_secret
      CRON_SECRET: replace_with_random_secret
      NEXT_PUBLIC_STORAGE_TYPE: mysql
      DATABASE_URL: mysql://icetv:replace_with_mysql_password@mysql:3306/icetv
      DANMAKU_API_BASE_URL: http://danmu-api:9321/replace_with_random_token

volumes:
  icetv-mysql:
  danmu-data:
```

---

## Vercel + MySQL

适合无服务器部署，需配合云数据库使用。

**环境变量配置（必填）：**

```bash
ICETV_USERNAME=admin
ICETV_PASSWORD=your_password
AUTH_SECRET=replace_with_random_auth_secret
CRON_SECRET=replace_with_random_cron_secret
NEXT_PUBLIC_STORAGE_TYPE=mysql
DATABASE_URL=mysql://user:password@host:3306/dbname
```

**TLS 连接：**

云数据库要求 TLS 时，通过 `MYSQL_SSL_CA` 提供 CA PEM 文本。

**限制：**

- Vercel 无法部署弹幕服务（需独立服务器运行 danmu_api）
- 若需弹幕功能，弹幕服务需单独部署并配置 `DANMAKU_API_BASE_URL`

---

## 环境变量说明

### 必填变量

| 变量             | 说明         | 示例                                |
| ---------------- | ------------ | ----------------------------------- |
| `ICETV_USERNAME` | 站长账号     | `admin`                             |
| `ICETV_PASSWORD` | 站长密码     | `your_secure_password`              |
| `AUTH_SECRET`    | 签名密钥     | 至少 32 字符随机字符串              |
| `CRON_SECRET`    | 定时任务密钥 | Docker 部署必填，至少 32 字符随机值 |

### 存储相关

| 变量                       | 说明        | 默认值                             |
| -------------------------- | ----------- | ---------------------------------- |
| `NEXT_PUBLIC_STORAGE_TYPE` | 存储类型    | 有 `DATABASE_URL` 时自动为 `mysql` |
| `LOCAL_DB_PATH`            | SQLite 路径 | `/data/icetv-data.sqlite`          |
| `DATABASE_URL`             | MySQL 连接  | 无                                 |

### 弹幕相关

| 变量                        | 说明         | 示例                              |
| --------------------------- | ------------ | --------------------------------- |
| `DANMAKU_API_BASE_URL`      | 弹幕服务地址 | `http://danmu-api:9321/yourtoken` |
| `DANMAKU_API_ALLOW_PRIVATE` | 允许内网地址 | `true`（内网部署时需设置）        |

### 其他可选

| 变量                  | 说明         | 默认值  |
| --------------------- | ------------ | ------- |
| `TRUSTED_PROXY_COUNT` | 反代层数     | `0`     |
| `CACHE_PROFILE`       | 内存缓存档位 | `small` |

完整变量列表见项目根目录 [.env.example](../.env.example)。

### 重要提示

> [!IMPORTANT]
> 反代后设置 `TRUSTED_PROXY_COUNT` 为代理层数，否则注册限流可被绕过。

`CACHE_PROFILE` 默认 `small`，服务端缓存预算约 100 MiB（不含 Node.js、SQLite、sharp 等其他进程开销），适合 1C1G 小鸡。4GB 以上内存且搜索命中率低时可改 `standard`，其缓存预算约 312 MiB。

---

## 升级与备份

### 多人在线资源预算

代理的用户/IP请求额度、服务端实际回源的速率与连接租约均放在数据库，多个实例必须连接同一个 MySQL 库。SQLite 仅支持本机进程共享同一文件；每个容器各用一个 SQLite 文件不能共享预算。缓存命中只消耗入口额度，不消耗回源额度。

| 环境变量                                                                         | 默认值       | 作用                               |
| -------------------------------------------------------------------------------- | ------------ | ---------------------------------- |
| `UPSTREAM_METADATA_CONCURRENCY`                                                  | 64           | 元数据回源总连接数                 |
| `UPSTREAM_METADATA_HOST_CONCURRENCY`                                             | 12           | 同一上游主机的元数据连接数         |
| `UPSTREAM_METADATA_RPM` / `UPSTREAM_METADATA_HOST_RPM`                           | 1800 / 300   | 元数据全局/主机每分钟请求额度      |
| `UPSTREAM_MEDIA_CONCURRENCY` / `UPSTREAM_MEDIA_HOST_CONCURRENCY`                 | 96 / 32      | VOD与直播合计的全局/主机分片连接数 |
| `UPSTREAM_MEDIA_USER_CONCURRENCY`                                                | 6            | 单用户分片连接数，VOD与直播共用    |
| `UPSTREAM_LIVE_CONCURRENCY`                                                      | 32           | 直播分片额外总连接数上限           |
| `UPSTREAM_MEDIA_RPM` / `UPSTREAM_MEDIA_HOST_RPM`                                 | 12000 / 6000 | 分片全局/主机每分钟请求额度        |
| `UPSTREAM_MEDIA_MIB_PER_MINUTE`                                                  | 1536         | 分片全局每分钟预留流量（MiB）      |
| `UPSTREAM_MEDIA_HOST_MIB_PER_MINUTE`                                             | 768          | 分片单主机每分钟预留流量（MiB）    |
| `UPSTREAM_MEDIA_USER_MIB_PER_MINUTE`                                             | 192          | 分片单用户每分钟预留流量（MiB）    |
| `UPSTREAM_METADATA_MAX_DURATION_SECONDS` / `UPSTREAM_MEDIA_MAX_DURATION_SECONDS` | 60 / 120     | 包含响应体消费在内的最长请求时间   |

主机维度按真实目标 URL 的 hostname 合并，不以用户可修改的 source 参数或端口拆分额度。分片 session 鉴权按用户名分组，仅有播放签名时按客户端 IP 分组；同一出口 IP 的签名播放共享额度。正确设置 `TRUSTED_PROXY_COUNT`，不能信任客户端伪造的转发头。

连接租约持有至响应体 EOF、取消或出错，每 10 秒续租；实例崩溃后 30 秒过期。上游拒绝、错误内容、用户中断均释放连接。额度不足时不绕过保护回源，用户额度返回 429，共享资源繁忙或数据库故障返回 503，并带 `Retry-After`。已开始发送的流无法再修改 HTTP 状态，超预算或续租失败会中断流。

流量预算以 256 KiB 为单位预留、按 60 秒固定窗口计数，未用完的预留不退还。这是保护性流量额度，不是平滑限速；窗口边界允许突发，实际已从上游读入但未转发的数据及协议开销也不等于预算值。单分片仍有 256 MiB 大小上限。VOD分片不做本站内容缓存，不保证几十人并发能全部放行；需按源站额度、码率与服务器出口容量调参，并由反向代理/CDN负责带宽整形和分片复用。前端直连上游不经过这些服务端预算。

预算表是运行时状态，不参与用户数据导入导出；清空业务数据不会重置正在生效的限流。应用层每次准入仍需数据库操作，不代替网关抗压和连接池容量规划。

### 换源检测预算

换源检测在普通回源预算之外，另有数据库共享的低优先级请求额度。默认全站最多 8 个服务端检测请求、单账号最多 2 个、全站每分钟最多 480 次；每个浏览器页同时检测 2 个源。详情、懒地址解析、清单和代理分片均接入此额度，响应体读完或取消才释放；普通播放不占用检测额度。多个实例仍须共用数据库，浏览器直连上游的分片不占本站连接额度。

可用 `SOURCE_PROBE_CONCURRENCY`、`SOURCE_PROBE_USER_CONCURRENCY`、`SOURCE_PROBE_RPM` 调整上述服务端限额，`SOURCE_PROBE_MAX_DURATION_SECONDS` 默认 20 秒。繁忙时返回 `Retry-After`，客户端进入共享冷却并显示「检测暂缓」，不自动无限重试、不记作源站播放失败；冷却后可点「重试」或重新检测。离开换源标签后不再启动下一批自动检测。成功结果仍复用 10 分钟，清单延迟取实际 GET 首包时间，不额外发送 HEAD。

### Next Data Cache 边界

仓库的 `next.config.js` 未配置跨实例 `cacheHandler`，Docker镜像也没有配置共享Next缓存目录。单容器的进程缓存/本地磁盘缓存不能当成多个容器的统一结果或限额；多实例部署仍需同一个MySQL库。Vercel的平台Data Cache可能有平台级持久化和共享，其具体范围由平台与项目部署决定，仓库配置不能证明其跨区域行为，本次也未测远端Vercel环境。

本次检查以安装的Next版本和配置为准：`force-dynamic`不代表任何显式fetch缓存策略都相同；还要检查fetch的`cache`、`next.revalidate`及路由`fetchCache`。当前首页上游fetch显式使用`cache: 'no-store'`，12小时推荐复用由IceTV数据库共享缓存负责，因此不依赖Next隐式缓存是否命中。开发模式/HMR下观察到的重复请求也不能直接推算生产多实例行为。

### 业务缓存范围

首页推荐、详情、搜索分页与聚合、调整后的封面和可缓存 VOD 清单使用本地 SWR 加数据库共享缓存。共用同一个 MySQL 数据库的实例复用结果与回源租约；SQLite 只覆盖访问同一数据库文件的本机进程，不支持跨主机挂载 SQLite 文件。

共享缓存不依赖 Next Data Cache 或容器文件系统。签名清单、直播清单不进入 VOD 结果缓存。缓存键包含源配置或去广告策略版本，封面包含宽度与质量；鉴权仍在读缓存前执行。

`shared_cache` 是可丢弃数据，不参与业务数据导入导出。单条共享结果上限 2 MiB；回源写入最多每分钟清理一次，非租约占用数据按最近写入裁剪到 4096 条、128 MiB，清理间隔内允许暂时超出。数据库故障时保留可用旧数据，冷缓存返回 503 而不绕过保护集中回源。

### 升级步骤

**Docker 部署：**

```bash
docker compose pull
docker compose up -d
```

升级前确保保留数据卷（`icetv-data` 或 `icetv-mysql`）。

**Vercel 部署：**

重新部署最新代码即可，数据库数据自动保留。

### 备份建议

**SQLite 备份：**

```bash
docker cp icetv:/data/icetv-data.sqlite ./backup/icetv-$(date +%Y%m%d).sqlite
```

**MySQL 备份：**

```bash
docker exec icetv-mysql mysqldump -u root -p"root_password" icetv > backup-$(date +%Y%m%d).sql
```

**定期备份**：建议每周备份一次数据库文件。

---

## 故障排查

### 弹幕服务连接失败

1. 检查 `DANMAKU_API_BASE_URL` 格式是否正确（包含 token）
2. 确认弹幕服务容器是否正常运行：`docker logs danmu-api`
3. 使用后台"测试连接"按钮验证配置
4. 内网部署时确保设置 `DANMAKU_API_ALLOW_PRIVATE=true`

### 弹幕时有时无

- 在播放器的「弹幕」面板点「重载」，按钮等宽转圈直到装载完成，并在面板和播放器提示结果；关闭弹幕时会提示先开启。无需重新绑定集数或反复刷新整页，调整弹幕偏移不会强制回源。
- 海报悬停或键盘聚焦只预热弹幕候选，点击播放后才加载评论，避免未观看的视频抢占上游评论请求额度。
- 搜索和评论的空结果只缓存 30 秒，到期后重新请求；已有非空评论不会被一次空响应或临时回源失败覆盖。映射失效的 404 仍会触发重新匹配。
- 评论回源前会重新查询标题候选，校验绑定 ID，避免旧搜索缓存放行上游重建后被复用的 ID；已有有效评论命中缓存时不额外回源，不同标题的评论缓存相互隔离。手动绑定会在本机保留当时的搜索词，标题校验暂时失败不会清除绑定。
- 上游返回 429 时，IceTV 会显示等待时间并暂缓回源；有 `Retry-After` 时按其处理，缺失时默认等待 60 秒。检查弹幕服务自身的限流配置，缓存未命中的请求可能共用 IceTV 服务端出口 IP 的额度。
- `200` 且弹幕为空不一定代表原视频没有弹幕。需要对照弹幕容器的原始采集、备用服务和 DNS 日志，不能仅凭 IceTV 的空数组判断。

### MySQL 连接失败

1. 检查 `DATABASE_URL` 格式是否正确
2. 确认 MySQL 容器健康检查通过：`docker ps`
3. 验证数据库账号权限是否足够（需建表权限）

### 反代后登录异常

设置 `TRUSTED_PROXY_COUNT` 为实际代理层数（Nginx = 1，Cloudflare + Nginx = 2）。
