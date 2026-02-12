# IceTV

<div align="center">
  <img src="public/logo.png" alt="IceTV Logo" width="120">
</div>

> 🎬 **IceTV** 是一个开箱即用的、跨平台的影视聚合播放器。它基于 **Next.js 16** + **Tailwind&nbsp;CSS** + **TypeScript** 构建，支持多资源搜索、在线播放、收藏同步、播放记录、云端存储，让你可以随时随地畅享海量免费影视内容。

<div align="center">

![Next.js](https://img.shields.io/badge/Next.js-16-000?logo=nextdotjs)
![TailwindCSS](https://img.shields.io/badge/TailwindCSS-3-38bdf8?logo=tailwindcss)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?logo=typescript)
![License](https://img.shields.io/badge/License-MIT-green)
![Docker Ready](https://img.shields.io/badge/Docker-ready-blue?logo=docker)

</div>

---

## ✨ 功能特性

- 🔍 **多源聚合搜索**：一次搜索立刻返回全源结果。
- 📄 **丰富详情页**：支持剧集列表、演员、年份、简介等完整信息展示。
- ▶️ **流畅在线播放**：集成 HLS.js & ArtPlayer。
- ❤️ **收藏 + 继续观看**：支持本机文件存储，多端同步进度。
- 📱 **PWA**：离线缓存、安装到桌面/主屏，移动端原生体验。
- 🌗 **响应式布局**：桌面侧边栏 + 移动底部导航，自适应各种屏幕尺寸。
- 👿 **智能去广告**：自动跳过视频中的切片广告（实验性）。

### 注意：部署后项目为空壳项目，无内置播放源和直播源，需要自行收集

<details>
  <summary>点击查看项目截图</summary>
  <img src="public/screenshot1.png" alt="项目截图" style="max-width:600px">
  <img src="public/screenshot2.png" alt="项目截图" style="max-width:600px">
  <img src="public/screenshot3.png" alt="项目截图" style="max-width:600px">
</details>

### 请不要在 B 站、小红书、微信公众号、抖音、今日头条或其他中国大陆社交平台发布视频或文章宣传本项目，不授权任何“科技周刊/月刊”类项目或站点收录本项目。

## 🗺 目录

- [技术栈](#技术栈)
- [Admin 维护约定](docs/admin-maintenance.md)
- [部署](#部署)
  - [Docker 部署](#服务器本地-sqlite-存储单机部署推荐)
- [配置文件](#配置文件)
- [订阅](#订阅)
- [自动更新](#自动更新)
- [环境变量](#环境变量)
- [客户端](#客户端)
- [AndroidTV 使用](#AndroidTV-使用)
- [Roadmap](#roadmap)
- [安全与隐私提醒](#安全与隐私提醒)
- [License](#license)
- [致谢](#致谢)

## 技术栈

| 分类      | 主要依赖                                                                                              |
| --------- | ----------------------------------------------------------------------------------------------------- |
| 前端框架  | [Next.js 16](https://nextjs.org/) · App Router                                                        |
| UI & 样式 | [Tailwind&nbsp;CSS 3](https://tailwindcss.com/)                                                       |
| 语言      | TypeScript 5                                                                                          |
| 播放器    | [ArtPlayer](https://github.com/zhw2590582/ArtPlayer) · [HLS.js](https://github.com/video-dev/hls.js/) |
| 代码质量  | ESLint · Prettier · Jest                                                                              |
| 部署      | Docker                                                                                                |

## Admin 维护约定

详细维护约定已迁移到独立文档：`docs/admin-maintenance.md`

## 部署

本项目**仅支持 Docker 或其他基于 Docker 的平台** 部署。

### 服务器本地 SQLite 存储（单机部署推荐）

适用于单台服务器 Docker 部署，不依赖第三方数据库。数据会写入容器挂载卷中的 SQLite 文件。

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
      - NEXT_PUBLIC_STORAGE_TYPE=localdb
      - LOCAL_DB_PATH=/data/icetv-data.sqlite
    volumes:
      - icetv-data:/data

volumes:
  icetv-data:
```

说明：

- `localdb` 是服务端本地 SQLite 存储模式，不是浏览器 `localstorage`。
- 旧版本 JSON 数据文件会在首次启动时自动迁移到 SQLite。
- 升级镜像前请保留 `icetv-data` 卷，避免数据丢失。
- 建议定期备份 `icetv-data` 卷。

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
    // ...更多站点
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

也可输入如 "哈利波特" 效果等同于豆瓣搜索

IceTV 支持标准的苹果 CMS V10 API 格式。

## 订阅

将完整的配置文件 base58 编码后提供 http 服务即为订阅链接，可在 IceTV 后台/Helios 中使用。

## 环境变量

以下仅保留部署启动必需或无法在管理后台修改的变量。可在管理后台修改的站点参数（如站点名、公告、豆瓣代理、搜索页数等）不再列出。

| 变量                      | 说明                                   | 可选值                | 默认值                              |
| ------------------------- | -------------------------------------- | --------------------- | ----------------------------------- |
| ICETV_USERNAME            | 站长账号                               | 任意字符串            | 无默认，必填字段                    |
| ICETV_PASSWORD            | 站长密码                               | 任意字符串            | 无默认，必填字段                    |
| NEXT_PUBLIC_STORAGE_TYPE  | 播放记录/收藏的存储方式                | localdb               | 无默认，必填字段                    |
| LOCAL_DB_PATH             | 本地 SQLite 文件路径（`localdb` 模式） | 绝对路径              | `/data/icetv-data.sqlite`（Docker） |
| AUTH_SESSION_TTL_HOURS    | 登录态有效期（小时）                   | 正整数                | 168                                 |
| NEXT_PUBLIC_UPDATE_REPOS  | 版本检查仓库列表（逗号分隔）           | owner/repo,owner/repo | naseaoi/LunaTV                      |
| NEXT_PUBLIC_UPDATE_BRANCH | 版本检查分支                           | 分支名                | main                                |

- 版本检查由后端接口 `/api/version/latest` 统一获取，前端不再直接请求 GitHub Raw。若仓库改名，更新 `NEXT_PUBLIC_UPDATE_REPOS` 并重启服务即可生效。

## 客户端

v100.0.0 以上版本可配合 [Selene](https://github.com/MoonTechLab/Selene) 使用，移动端体验更加友好，数据完全同步

## AndroidTV 使用

目前该项目可以配合 [OrionTV](https://github.com/zimplexing/OrionTV) 在 Android TV 上使用，可以直接作为 OrionTV 后端

已实现播放记录和网页端同步

## 安全与隐私提醒

### 请设置密码保护并关闭公网注册

为了您的安全和避免潜在的法律风险，我们要求在部署时**强烈建议关闭公网注册**：

### 部署要求

1. **设置环境变量 `ICETV_PASSWORD`**：为您的实例设置一个强密码
2. **仅供个人使用**：请勿将您的实例链接公开分享或传播
3. **遵守当地法律**：请确保您的使用行为符合当地法律法规

### 重要声明

- 本项目仅供学习和个人使用
- 请勿将部署的实例用于商业用途或公开服务
- 如因公开分享导致的任何法律问题，用户需自行承担责任
- 项目开发者不对用户的使用行为承担任何法律责任
- 本项目不在中国大陆地区提供服务。如有该项目在向中国大陆地区提供服务，属个人行为。在该地区使用所产生的法律风险及责任，属于用户个人行为，与本项目无关，须自行承担全部责任。特此声明

## License

[MIT](LICENSE) © 2025 IceTV & Contributors

## 致谢

- [ts-nextjs-tailwind-starter](https://github.com/theodorusclarence/ts-nextjs-tailwind-starter) — 项目最初基于该脚手架。
- [LibreTV](https://github.com/LibreSpark/LibreTV) — 由此启发，站在巨人的肩膀上。
- [ArtPlayer](https://github.com/zhw2590582/ArtPlayer) — 提供强大的网页视频播放器。
- [HLS.js](https://github.com/video-dev/hls.js) — 实现 HLS 流媒体在浏览器中的播放支持。
- [Zwei](https://github.com/bestzwei) — 提供获取豆瓣数据的 cors proxy
- [CMLiussss](https://github.com/cmliu) — 提供豆瓣 CDN 服务
- 感谢所有提供免费影视接口的站点。

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=naseaoi/LunaTV&type=Date)](https://www.star-history.com/#naseaoi/LunaTV&Date)
