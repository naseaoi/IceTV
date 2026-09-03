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
      - LOCAL_DB_PATH=/data/icetv.sqlite
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
      - LOCAL_DB_PATH=/data/icetv.sqlite
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
| `LOCAL_DB_PATH`            | SQLite 路径 | `/data/icetv.sqlite`               |
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

`CACHE_PROFILE` 默认 `small`，按 1C1G 小鸡规格限制内存缓存。4GB 以上内存且搜索命中率低时可改 `standard`。

---

## 升级与备份

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
docker cp icetv:/data/icetv.sqlite ./backup/icetv-$(date +%Y%m%d).sqlite
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

### MySQL 连接失败

1. 检查 `DATABASE_URL` 格式是否正确
2. 确认 MySQL 容器健康检查通过：`docker ps`
3. 验证数据库账号权限是否足够（需建表权限）

### 反代后登录异常

设置 `TRUSTED_PROXY_COUNT` 为实际代理层数（Nginx = 1，Cloudflare + Nginx = 2）。
