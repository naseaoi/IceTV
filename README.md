# IceTV

<div align="center">
  <img src="public/logo.webp" alt="IceTV Logo" width="120">
</div>

> 影视聚合播放器。基于 Next.js 16 构建，支持多源搜索、在线播放、收藏、播放记录、弹幕、去广告。

<div align="center">

![Next.js](https://img.shields.io/badge/Next.js-16-000?logo=nextdotjs)
![TailwindCSS](https://img.shields.io/badge/TailwindCSS-3-38bdf8?logo=tailwindcss)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?logo=typescript)
![License](https://img.shields.io/badge/License-CC%20BY--NC--SA%204.0-green)
![Docker Ready](https://img.shields.io/badge/Docker-ready-blue?logo=docker)

</div>

> [!IMPORTANT]
> 部署后为空壳项目，无内置播放源，需要在后台配置资源站。

> [!WARNING]
> 请勿在中国大陆社交平台宣传本项目，不授权任何"科技周刊/月刊"类项目收录。

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
- [环境变量](#环境变量)
- [开发](#开发)
- [客户端](#客户端)
- [AndroidTV](#androidtv)
- [安全与隐私](#安全与隐私)
- [License](#license)
- [致谢](#致谢)

## 功能特性

- **多源聚合搜索** — 一次搜索返回全源结果
- **流畅在线播放** — 集成 HLS.js & ArtPlayer
- **弹幕支持** — 对接第三方弹幕源，支持偏移调整与本地记忆
- **收藏 + 继续观看** — 多端同步进度
- **多用户与邀请码注册** — 用户组按源分配权限
- **PWA** — 离线缓存、安装到桌面
- **响应式布局** — 桌面侧边栏 + 移动底部导航
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

| 方案                                                 | 适用范围                     |
| ---------------------------------------------------- | ---------------------------- |
| [Docker + SQLite](docs/deployment.md#docker--sqlite) | 单机部署，数据库保存在数据卷 |
| [Docker + MySQL](docs/deployment.md#docker--mysql)   | 多实例共用数据库             |
| [Vercel + MySQL](docs/deployment.md#vercel--mysql)   | 云部署，依赖外部 MySQL       |

弹幕服务可独立接入以上方案，见 [接入弹幕服务](docs/deployment.md#接入弹幕服务)。

## 配置文件

部署后在管理后台填写配置。

示例：

```json
{
  "cache_time": 7200,
  "api_site": {
    "example": {
      "api": "http://xxx.com/api.php/provide/vod",
      "name": "示例资源"
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

- `cache_time`：缓存时间（秒）
- `api_site`：资源站配置，支持苹果 CMS V10 API
  - `key`：唯一标识
  - `api`：JSON API 地址
  - `name`：显示名称
  - `detail`：（可选）详情页根 URL
- `custom_category`：自定义分类，type 为 `movie` 或 `tv`

## 环境变量

变量与默认值以 [.env.example](.env.example) 为准；签名密钥、反代层数、内网弹幕等易错配置见 [环境变量边界](docs/deployment.md#环境变量边界)。

## 开发

```bash
pnpm install
cp .env.example .env
pnpm dev
```

改代码前看 [AGENTS.md](AGENTS.md)，其余文档见 [docs/](docs/README.md)。

本地默认 Turbopack；遇兼容问题用 `pnpm dev:webpack`。验证范围按 [AGENTS.md](AGENTS.md#验证) 选择，不必每次编辑都全量跑。

## 客户端

配合 [Selene](https://github.com/MoonTechLab/Selene) 使用，数据同步。

## AndroidTV

配合 [OrionTV](https://github.com/zimplexing/OrionTV) 使用，播放记录同步。

## 安全与隐私

**建议不开放公网注册**：

1. 设置强密码：`ICETV_PASSWORD` 与 `AUTH_SECRET` 使用高熵随机值
2. 注册默认关闭：需要时在后台开启并要求邀请码
3. 反代后设置 `TRUSTED_PROXY_COUNT`
4. 仅供个人使用

**声明**：本项目仅供学习和个人使用，请勿用于商业或公开服务。公开分享导致的法律问题由用户自行承担，开发者不对用户使用行为承担法律责任。本项目不在中国大陆地区提供服务，如有向该地区提供服务属个人行为，产生的法律风险及责任由用户自行承担。

## License

[CC BY-NC-SA 4.0](LICENSE) © 2025 IceTV & Contributors

## 致谢

- [ts-nextjs-tailwind-starter](https://github.com/theodorusclarence/ts-nextjs-tailwind-starter)
- [LibreTV](https://github.com/LibreSpark/LibreTV)
- [ArtPlayer](https://github.com/zhw2590582/ArtPlayer)
- [HLS.js](https://github.com/video-dev/hls.js)
- [Zwei](https://github.com/bestzwei) — 豆瓣 CORS proxy
- [CMLiussss](https://github.com/cmliu) — 豆瓣 CDN
