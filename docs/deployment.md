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

volumes:
  icetv-data:
```

```bash
docker compose up -d
```

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
- 启动、升级等操作须沿用相同的 Compose `-f` 文件组合。

## Vercel + MySQL

使用外部 MySQL，不使用 SQLite。除下节的账号和密钥外，配置：

```bash
NEXT_PUBLIC_STORAGE_TYPE=mysql
DATABASE_URL=mysql://user:password@host:3306/dbname
```

云数据库要求 TLS 时，用 `MYSQL_SSL_CA` 提供 CA PEM 文本。Vercel 不托管 `danmu_api` 常驻进程，弹幕服务需独立部署并配置可达的地址。

## 环境变量边界

| 配置                                | 易错点                                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------- |
| `ICETV_USERNAME` / `ICETV_PASSWORD` | 站长账号不来自普通用户表，密码须使用强随机值                                    |
| `AUTH_SECRET`                       | 会话签名密钥，不用站长密码代替；各实例保持一致                                  |
| `CRON_SECRET`                       | 定时接口凭证，Docker 启动时必填；不要依赖旧兼容变量名                           |
| `LOCAL_DB_PATH`                     | Docker 默认在 `/data`；本地开发路径以 `.env.example` 为准                       |
| `TRUSTED_PROXY_COUNT`               | 填实际代理层数，如 Nginx 为 1、Cloudflare + Nginx 为 2；默认 0 不能防伪造转发头 |
| `CACHE_PROFILE`                     | 默认 `small` 仅限制业务缓存，不限制 Node、SQLite、sharp 等进程总内存            |

## 缓存与资源边界

### 多实例与缓存

- 业务共享缓存和资源租约在数据库，不依赖 Next Data Cache 或容器文件系统。SQLite 仅支持本机进程访问同一文件，不跨主机挂载。
- 首页推荐、详情、搜索、调整后的封面和可缓存 VOD 清单复用共享结果；签名清单、直播清单及分片内容不进入 VOD 结果缓存。
- 缓存键包含源配置或去广告策略版本，封面还包含尺寸和质量。鉴权先于缓存读取，命中缓存不等于公开访问。
- `shared_cache` 是可丢弃数据，不参与业务导入导出。单条上限 2 MiB，清理目标为 4096 条 / 128 MiB，清理间隔内允许暂时超出。
- 数据库故障时保留可用旧缓存；无缓存时返回 503，不绕过资源保护集中回源。
- `force-dynamic` 不等于所有显式 fetch 都不缓存。首页上游 fetch 使用 `no-store`，推荐复用由 IceTV 共享缓存负责；开发模式/HMR 的请求次数不能代表生产表现。

### 回源预算

默认值如下，变量名和调参入口见 [.env.example](../.env.example)：

| 类别             | 全局 / 主机并发 | 单用户并发 | 全局 / 主机每分钟请求数 | 最长请求时间 |
| ---------------- | --------------- | ---------- | ----------------------- | ------------ |
| 元数据           | 64 / 12         | —          | 1800 / 300              | 60 秒        |
| VOD + 直播分片   | 96 / 32         | 6          | 12000 / 6000            | 120 秒       |
| 换源检测额外额度 | 8 / 8           | 2          | 480 / 480               | 20 秒        |

- 直播另有总并发 32 的上限；分片全局 / 主机 / 单用户流量额度为 1536 / 768 / 192 MiB 每分钟。VOD 与直播共用媒体预算。
- 主机按目标 URL 的 hostname 合并，不按可修改的 source 参数或端口拆分。会话按账号计数，仅有播放签名时按客户端 IP 计数，同出口用户可能共享额度。
- 连接租约持续到响应体读完、取消或出错，不在收到响应头时释放；每 10 秒续租，实例失联后 30 秒过期。
- 用户超额返回 429，共享资源繁忙或数据库故障返回 503，附带 `Retry-After`；已开始发送的流只能中断，不能改 HTTP 状态。
- 流量按 256 KiB 预留、60 秒固定窗口计数，未用完的额度不退还。它是保护性上限，不是平滑限速或实际网卡流量统计；单分片仍有 256 MiB 上限。
- 缓存命中只消耗入口额度，浏览器直连不消耗本站回源额度。预算不随业务数据导入或清空重置。
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
