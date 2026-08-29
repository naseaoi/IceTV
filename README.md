# IceTV

<div align="center">
  <img src="public/logo.webp" alt="IceTV Logo" width="120">
</div>

> IceTV 是一个开箱即用的、跨平台的影视聚合播放器。基于 Next.js 16 + Tailwind CSS + TypeScript 构建，支持多资源搜索、在线播放、收藏同步、播放记录、云端存储，随时随地畅享海量免费影视内容。

<div align="center">

![Next.js](https://img.shields.io/badge/Next.js-16-000?logo=nextdotjs)
![TailwindCSS](https://img.shields.io/badge/TailwindCSS-3-38bdf8?logo=tailwindcss)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?logo=typescript)
![License](https://img.shields.io/badge/License-CC%20BY--NC--SA%204.0-green)
![Docker Ready](https://img.shields.io/badge/Docker-ready-blue?logo=docker)

</div>

> [!IMPORTANT]
> 部署后项目为空壳项目，无内置播放源和直播源，需要自行收集。

> [!WARNING]
> 请不要在 B 站、小红书、微信公众号、抖音、今日头条或其他中国大陆社交平台发布视频或文章宣传本项目，不授权任何"科技周刊/月刊"类项目或站点收录本项目。

<details>
  <summary>项目截图</summary>
  <table>
    <tr>
      <th>桌面端</th>
      <th>移动端</th>
    </tr>
    <tr>
      <td><img src="public/screenshot-home-desktop.webp" alt="首页 - 桌面端" width="640"></td>
      <td><img src="public/screenshot-home-mobile.webp" alt="首页 - 移动端" width="203"></td>
    </tr>
    <tr>
      <td><img src="public/screenshot-play-desktop.webp" alt="点播页 - 桌面端" width="640"></td>
      <td><img src="public/screenshot-play-mobile.webp" alt="点播页 - 移动端" width="203"></td>
    </tr>
    <tr>
      <td><img src="public/screenshot-me-desktop.webp" alt="我的 - 桌面端" width="640"></td>
      <td><img src="public/screenshot-me-mobile.webp" alt="我的 - 移动端" width="203"></td>
    </tr>
  </table>
</details>

---

## 目录

- [功能特性](#功能特性)
- [技术栈](#技术栈)
- [部署](#部署)
- [配置文件](#配置文件)
- [订阅](#订阅)
- [环境变量](#环境变量)
- [开发](#开发)
- [客户端](#客户端)
- [AndroidTV 使用](#androidtv-使用)
- [安全与隐私提醒](#安全与隐私提醒)
- [License](#license)
- [致谢](#致谢)

## 功能特性

- **多源聚合搜索** — 一次搜索立刻返回全源结果
- **丰富详情页** — 支持剧集列表、演员、年份、简介等完整信息展示
- **流畅在线播放** — 集成 HLS.js & ArtPlayer，支持直播源
- **收藏 + 继续观看 + 追更** — 多端同步进度，剧集更新后消息提醒
- **多用户与邀请码注册** — 用户组按源分配权限，注册可要求邀请码
- **PWA** — 离线缓存、安装到桌面/主屏，移动端原生体验
- **响应式布局** — 桌面侧边栏 + 移动底部导航，自适应各种屏幕尺寸
- **智能去广告** — 自动跳过视频中的切片广告（实验性）

## 技术栈

| 分类      | 主要依赖                                                                                              |
| --------- | ----------------------------------------------------------------------------------------------------- |
| 前端框架  | [Next.js 16](https://nextjs.org/) · App Router                                                        |
| UI & 样式 | [Tailwind CSS 3](https://tailwindcss.com/)                                                            |
| 语言      | TypeScript 5                                                                                          |
| 播放器    | [ArtPlayer](https://github.com/zhw2590582/ArtPlayer) · [HLS.js](https://github.com/video-dev/hls.js/) |
| 代码质量  | ESLint · Prettier · Jest                                                                              |

## 部署

本项目支持以下常见部署方式：

- Docker + 本地 SQLite
- Docker + MySQL
- Vercel + MySQL 云数据库

Docker 镜像同时包含 SQLite 和 MySQL 驱动。未显式设置存储类型时，配置了 `DATABASE_URL` 会自动使用 MySQL，否则使用 SQLite。

### 服务器本地 SQLite 存储

```yml
services:
  icetv-core:
    image: ghcr.io/naseaoi/icetv:latest
    container_name: icetv-core
    restart: on-failure
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

说明：

- 升级镜像前请保留 `icetv-data` 卷，避免数据丢失。
- 建议定期备份 `icetv-data` 卷。

### Docker + MySQL 存储

以下示例会同时启动 IceTV 和 MySQL 8.4：

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

  icetv-core:
    image: ghcr.io/naseaoi/icetv:latest
    container_name: icetv-core
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

说明：

- IceTV 首次使用存储功能时会自动创建所需数据表，数据库账号需要拥有目标数据库的建表和读写权限。
- 同一 Compose 网络内应使用 MySQL 服务名 `mysql`，不能使用 `localhost`。连接宿主机上的 MySQL 时，Windows 和 macOS Docker Desktop 可使用 `host.docker.internal`。
- 用户名或密码包含 `@`、`:`、`/`、`#` 等字符时，需要在 `DATABASE_URL` 中进行 URL 编码。
- 升级或重建容器前请保留并备份 `icetv-mysql` 卷。
- 使用已有 MySQL 服务时可以移除示例中的 `mysql` 服务和 `depends_on`，将 `DATABASE_URL` 指向实际数据库地址。

### Vercel + MySQL 云数据库

Vercel 项目中至少配置以下环境变量：

```bash
ICETV_USERNAME=admin
ICETV_PASSWORD=your_strong_password
AUTH_SECRET=replace_with_random_auth_secret
CRON_SECRET=replace_with_random_cron_secret
NEXT_PUBLIC_STORAGE_TYPE=mysql
DATABASE_URL=mysql://user:password@host:3306/dbname
```

云数据库要求 TLS 时，通过 `MYSQL_SSL_CA` 提供 CA PEM 文本。连接串中的 `ssl-mode` 参数不会启用 TLS。

## 配置文件

完成部署后为空壳应用，无播放源，需要站长在管理后台的配置文件设置中填写配置文件。

配置文件示例如下：

```json
{
  "cache_time": 7200,
  "api_site": {
    "dyttzy": {
      "api": "http://xxx.com/api.php/provide/vod",
      "name": "示例资源",
      "detail": "http://xxx.com"
    }
  },
  "custom_category": [
    {
      "name": "华语",
      "type": "movie",
      "query": "华语"
    }
  ]
}
```

- `cache_time`：接口缓存时间（秒）。
- `api_site`：你可以增删或替换任何资源站，字段说明：
  - `key`：唯一标识，保持小写字母/数字。
  - `api`：资源站提供的 `vod` JSON API 根地址。
  - `name`：在人机界面中展示的名称。
  - `detail`：（可选）部分无法通过 API 获取剧集详情的站点，需要提供网页详情根 URL，用于爬取。
- `custom_category`：自定义分类配置，用于在导航中添加个性化的影视分类。以 type + query 作为唯一标识。支持以下字段：
  - `name`：分类显示名称（可选，如不提供则使用 query 作为显示名）
  - `type`：分类类型，支持 `movie`（电影）或 `tv`（电视剧）
  - `query`：搜索关键词，用于在豆瓣 API 中搜索相关内容

custom_category 支持的自定义分类已知如下：

- movie：热门、最新、经典、豆瓣高分、冷门佳片、华语、欧美、韩国、日本、动作、喜剧、爱情、科幻、悬疑、恐怖、治愈
- tv：热门、美剧、英剧、韩剧、日剧、国产剧、港剧、日本动画、综艺、纪录片

也可输入如 "哈利波特" 效果等同于豆瓣搜索。

IceTV 支持标准的苹果 CMS V10 API 格式。

## 订阅

将完整的配置文件 base58 编码后提供 http 服务即为订阅链接，可在 IceTV 后台/Helios 中使用。

## 环境变量

| 变量                                 | 用途           | 必填           | 默认值                                           | 可选值 / 格式                                             |
| ------------------------------------ | -------------- | -------------- | ------------------------------------------------ | --------------------------------------------------------- |
| `ICETV_USERNAME`                     | 站长账号       | 是             | 无                                               | 任意字符串                                                |
| `ICETV_PASSWORD`                     | 站长密码       | 是             | 无                                               | 任意字符串                                                |
| `AUTH_SECRET`                        | 签名密钥       | 是             | 无                                               | 高熵随机字符串，至少 32 字符                              |
| `CRON_SECRET`                        | 定时任务密钥   | Docker 必填    | 无                                               | 高熵随机字符串                                            |
| `CRON_LOCK_PATH`                     | cron 租约文件  | 否             | `/data/icetv-cron.lock`（Docker）                | 可写且可由多个实例共享的绝对路径；空值关闭                |
| `CRON_LOCK_TTL_MS`                   | cron 租约时长  | 否             | `900000`                                         | 正整数毫秒                                                |
| `CRON_PLAYBACK_STATS_RETENTION_DAYS` | 播放统计保留期 | 否             | `0`                                              | 正整数天；`0` 或未设置时不自动清理                        |
| `LEGACY_COOKIE_CUTOFF_DATE`          | 旧登录态截止   | 否             | `2026-08-01T00:00:00.000Z`                       | ISO 日期字符串                                            |
| `AUTH_SESSION_TTL_HOURS`             | 登录态时长     | 否             | `168`                                            | 正整数                                                    |
| `NEXT_PUBLIC_STORAGE_TYPE`           | 存储类型       | 否             | 有 `DATABASE_URL` 时为 `mysql`，否则为 `localdb` | `localdb` / `mysql`                                       |
| `LOCAL_DB_PATH`                      | SQLite 路径    | 否             | `/data/icetv-data.sqlite`（Docker）              | 绝对路径                                                  |
| `DATABASE_URL`                       | MySQL 连接     | MySQL 模式必填 | 无                                               | `mysql://用户:密码@主机:端口/数据库`，特殊字符需 URL 编码 |
| `MYSQL_SSL_CA`                       | MySQL TLS CA   | 否             | 无                                               | PEM 文本；配置后启用 TLS                                  |
| `MYSQL_SSL_REJECT_UNAUTHORIZED`      | MySQL TLS 校验 | 否             | `true`                                           | `true` / `false`；仅在配置 `MYSQL_SSL_CA` 时生效          |
| `MYSQL_CONNECTION_LIMIT`             | MySQL 连接池   | 否             | `5`                                              | 正整数                                                    |
| `MYSQL_MAX_IDLE`                     | MySQL 空闲池   | 否             | 同连接池上限                                     | 正整数                                                    |
| `MYSQL_IDLE_TIMEOUT_MS`              | MySQL 空闲超时 | 否             | `60000`                                          | 毫秒                                                      |
| `TRUSTED_PROXY_COUNT`                | 反代层数       | 反代后建议     | `0`                                              | 正整数                                                    |
| `NEXT_PUBLIC_UPDATE_REPOS`           | 版本检查       | 否             | `naseaoi/IceTV`                                  | `owner/repo,owner/repo...`                                |
| `NEXT_PUBLIC_UPDATE_BRANCH`          | 版本检查       | 否             | `main`                                           | 分支名                                                    |

变量样例见 [.env.example](.env.example)。

> [!IMPORTANT]
> 部署在 Nginx、Cloudflare 等反向代理后面时应设置 `TRUSTED_PROXY_COUNT` 为代理层数。默认值 `0` 会取 `x-forwarded-for` 的第一段，而该值由客户端可控，注册限流可被伪造请求头绕过。

站点名称、图标、公告、豆瓣/Bangumi 代理、流式搜索、搜索最大页数等运行选项可在后台配置，不建议优先使用环境变量覆盖。

高级调优变量：`CONFIG_CACHE_TTL_MS`、`PROXY_FETCH_TIMEOUT_MS`、`PROXY_DNS_CACHE_TTL_MS`、`PROXY_DNS_NEGATIVE_CACHE_TTL_MS`、`SEARCH_SOURCE_FAILURE_COOLDOWN_MS`、`SQLITE_BUSY_TIMEOUT_MS`、`SQLITE_INIT_RETRY_COUNT`、`SQLITE_INIT_RETRY_DELAY_MS`、`SQLITE_CACHE_SIZE_KIB`、`SQLITE_MMAP_SIZE_BYTES`、`CRON_METADATA_*`、`LIVE_REFRESH_CONCURRENCY`。

Docker 默认把 cron 租约写入 `/data/icetv-cron.lock`。多容器部署时，所有实例必须挂载同一个可写 `/data` 卷，租约才能阻止重复维护；没有共享文件系统时请保持单实例 cron 调度，或将 `CRON_LOCK_PATH` 设为空关闭文件租约。

当前配置写入采用应用层乐观锁，推荐单实例部署；多实例部署需让管理操作固定路由到同一实例。

## 开发

```bash
pnpm install
cp .env.example .env   # 按注释填写
pnpm dev
```

改代码前先看 [AGENTS.md](AGENTS.md)（项目约束与易错点），其余文档见 [docs/](docs/README.md)。

## 客户端

可配合 [Selene](https://github.com/MoonTechLab/Selene) 使用，移动端体验更加友好，数据完全同步。

## AndroidTV 使用

可配合 [OrionTV](https://github.com/zimplexing/OrionTV) 在 Android TV 上使用，直接作为 OrionTV 后端。

已实现播放记录和网页端同步。

## 安全与隐私提醒

为了您的安全和避免潜在的法律风险，部署时**建议不要开放公网注册**：

1. **设置强密码**：`ICETV_PASSWORD` 与 `AUTH_SECRET` 都使用高熵随机值
2. **注册默认关闭**：如需放开，在后台「用户配置 - 注册设置」开启并要求邀请码，可设置有效期与可用次数
3. **反代后设置 `TRUSTED_PROXY_COUNT`**：否则注册限流可被绕过
4. **仅供个人使用**：请勿将您的实例链接公开分享或传播
5. **遵守当地法律**：请确保您的使用行为符合当地法律法规

**重要声明**

- 本项目仅供学习和个人使用
- 请勿将部署的实例用于商业用途或公开服务
- 如因公开分享导致的任何法律问题，用户需自行承担责任
- 项目开发者不对用户的使用行为承担任何法律责任
- 本项目不在中国大陆地区提供服务。如有该项目在向中国大陆地区提供服务，属个人行为。在该地区使用所产生的法律风险及责任，属于用户个人行为，与本项目无关，须自行承担全部责任，特此声明

## License

[CC BY-NC-SA 4.0](LICENSE) © 2025 IceTV & Contributors

## 致谢

- [ts-nextjs-tailwind-starter](https://github.com/theodorusclarence/ts-nextjs-tailwind-starter) — 项目最初基于该脚手架
- [LibreTV](https://github.com/LibreSpark/LibreTV) — 由此启发，站在巨人的肩膀上
- [ArtPlayer](https://github.com/zhw2590582/ArtPlayer) — 提供强大的网页视频播放器
- [HLS.js](https://github.com/video-dev/hls.js) — 实现 HLS 流媒体在浏览器中的播放支持
- [Zwei](https://github.com/bestzwei) — 提供获取豆瓣数据的 cors proxy
- [CMLiussss](https://github.com/cmliu) — 提供豆瓣 CDN 服务
- 感谢所有提供免费影视接口的站点
