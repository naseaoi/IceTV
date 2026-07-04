# 审计修复验收报告（2026-07-04）

对 `docs/audit-2026-07-03.md` 全部条目的逐条验收。每个遗留点均经过代码逐行核实（文件:行号为当前 dev 分支实际位置）。

## 结论速览

- **P1 三项全部修复**：P1-1 经 Node 实测确认十六进制映射地址已被拦截；P1-2 有针对性单测钉死数据丢失路径；P1-3 登录态接口缓存头全部收敛为 `private, no-store`。
- **P2 十一项全部落地**：P2-2 按文档标注暂缓，现状与描述一致、无半成品残留；其余十项确认修复。
- **P3 大部分落地**：遗留 5 个收尾点（见下），集中在"同类问题未修全 / 多处实现未对齐"，无 P1 级别缺口。
- 本项目为个人自部署形态（单实例、受控访问），遗留点按此形态排定优先级；FU-1 / FU-2 修复成本最低，建议先处理。

## 验证基线（2026-07-04）

| 项目             | 结果                                                               |
| ---------------- | ------------------------------------------------------------------ |
| `pnpm lint`      | 通过，无告警                                                       |
| `pnpm typecheck` | 通过                                                               |
| `pnpm test`      | 303 通过 / 1 跳过 / 0 失败（审计时 269 通过 + 1 偶发，偶发已消除） |

## 验收明细

| 条目  | 内容                        | 结论                                                                                                                                                                                                     |
| ----- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1-1  | url-guard 十六进制映射绕过  | ✅ 已修复。字节级重写（`ipv6ToBytes` + `extractEmbeddedIpv4`），覆盖 `::ffff:/96`、`::/96`、NAT64、6to4；实测 `::ffff:7f00:1`、`::ffff:a9fe:a9fe` 等 7 类输入全部 Blocked、公网对照无误杀；新增 3 个单测 |
| P1-2  | 配置读失败回写默认值        | ✅ 已修复。读失败退旧缓存或抛出，不再落入初始化分支；`config_json` 损坏改为抛错；两条单测断言 `saveAdminConfig` 未被调用                                                                                 |
| P1-3  | 登录态接口 public 缓存头    | ✅ 已修复。search / search/one / suggestions / detail 全部 `private, no-store`；仍带 public 的接口逐一核对均与用户无关                                                                                   |
| P2-1  | 乐观锁冲突不可见            | ✅ 已修复（声明范围）。`configConflictResponse` 统一 409，七个 admin 写路由全接入且无遗漏；DB 级 CAS 为文档明示遗留迁移项                                                                                |
| P2-2  | DNS 重绑定                  | ⏸ 暂缓属实。无 IP 钉住、无 undici 残留，与文档描述一致                                                                                                                                                   |
| P2-3  | 登录限速伪造绕过            | ⚠️ 部分修复，见 FU-3                                                                                                                                                                                     |
| P2-4  | legacy HMAC 兼容期          | ⚠️ 部分修复，见 FU-4                                                                                                                                                                                     |
| P2-5  | initPromise 永久缓存        | ✅ 已修复。`db.ts` / `mysql.db.ts` 失败即置回 null，catch 挂载时机正确                                                                                                                                   |
| P2-6  | 采集源 api URL 不校验       | ✅ 已修复。add / edit 统一 trim + `validateProxyUrlForRequest`                                                                                                                                           |
| P2-7  | giri 无超时 / body 读取缺口 | ✅ 已修复。giri 2 处、downstream 3 处 fetch 全部 signal + finally cleanup                                                                                                                                |
| P2-8  | 两套存储大小写语义          | ✅ 已修复。`src/lib/username.ts` 统一 normalize（小写 + 64 限长 + 白名单），登录/注册/admin/导入/cookie 消费侧全入口覆盖                                                                                 |
| P2-9  | 豆瓣图片代理两套真相源      | ✅ 已修复。`utils.ts` 消费 douban-source helper，值域独立含 img3，面板读写同源                                                                                                                           |
| P2-10 | 卸载保存 effect 每轮触发    | ✅ 已修复。`doSave` / `doCheckpoint` useCallback 空依赖 + 全 ref 化，cleanup 仅卸载执行                                                                                                                  |
| P2-11 | sqlite 测试偶发失败         | ✅ 已修复。`:memory:` 短路 mkdirSync / WAL pragma / legacy 迁移，本轮全量测试无偶发                                                                                                                      |
| P3-1  | 登录用户名枚举              | ✅ 主体修复。先验密码后报封禁 + 等量 dummy bcrypt；封禁分支不计失败次数（仅密码正确后可达，见备注）                                                                                                      |
| P3-2  | proxy 先校验后鉴权 + 回显   | ✅ 已修复。四个 proxy 路由 + image-proxy 均先鉴权后校验，失败响应统一 `Invalid URL`                                                                                                                      |
| P3-3  | 明文比较非恒定时间          | ✅ 已修复。`timingSafeEqual`，长度不等分支做等量假比较                                                                                                                                                   |
| P3-4  | 会话与密钥健壮性            | ⚠️ 部分落地：AUTH_SECRET 强制 + 32 位下限 ✅、TTL 30 天→7 天 ✅；两处收尾见 FU-1 / FU-5                                                                                                                  |
| P3-5  | 外部输入健壮性              | ⚠️ 部分落地：订阅 trim ✅、2MB 响应上限 ✅、空结果 60s 负缓存 ✅、主 douban 路由 ✅；两个子路由漏网见 FU-2                                                                                               |
| P3-6  | 约定与文档一致性            | ✅ 主体落地。本地设置统一 `local-preferences.ts`、三个 page 均薄装配化；README 4 个内容类变量未逐个入表（有归口说明，见备注）                                                                            |
| P3-7  | 本地运行卫生                | ✅ 已修复。`useProgressiveRender` 已删；启动时 `wal_checkpoint(TRUNCATE)`（本地 WAL 文件下次启动收缩）                                                                                                   |

---

## 遗留问题

### FU-1 change-password 未接入密码策略（P3-4d 收尾）

- **问题** `src/app/api/change-password/route.ts:22-24`：新密码仅判非空。`register/route.ts:47-50` 与 `userActions.ts:148,245` 均已接入 `password-policy.ts` 的 8 位下限，此接口漏接，用户自助改密可设 1 位密码。
- **修复**：与 register 同构，校验 `newPassword` 长度不足 `MIN_PASSWORD_LENGTH` 时返回 400。一处 import + 一个条件分支。

### FU-2 douban 两个子路由参数校验未修全（P3-5a 收尾）

- **问题** 主路由 `douban/route.ts` 已改 `Number.isInteger` + `encodeURIComponent`，但同类子路由漏网：
  - `src/app/api/douban/categories/route.ts:21-22`：仍 `parseInt`，`limit=abc` 得 NaN 后 `:39` / `:46` 的区间判断均 false，NaN 穿透拼进 `:53` 的 target；`category` / `type` 未编码直接拼 URL。
  - `src/app/api/douban/recommends/route.ts:29-30`：仍 `parseInt` 且无区间校验，`"NaN"` 进入 `:80-81` 的参数并经 `:93` 以 target 为键污染 SWR 缓存；`kind` 未做白名单即拼进 `:77` 路径。
- **修复**：照抄主路由模式——`Number()` + `Number.isInteger` + 区间校验，`kind` 白名单（`movie` / `tv`），拼接段 `encodeURIComponent`。

### FU-3 登录限速：默认配置可被伪造头绕过，且无用户名维度桶（P2-3 收尾）

- **问题** `src/app/api/login/route.ts`：
  - `:52-55` `TRUSTED_PROXY_COUNT` 已实现但默认 0；默认走 `:72-80` 的 fallback 链（`cf-connecting-ip` → `x-real-ip` → XFF 最左值），三者在应用直接暴露或代理未清洗头时均可由客户端任意指定，每换头值即新桶。
  - `:85-87` key 仍是单一 `ip:username`，无与 IP 无关的用户名全局桶（审计修复项之一）。
- **影响**：仅在暴露公网且未配置 `TRUSTED_PROXY_COUNT` 时构成爆破面；内网/受控访问形态下风险有限。
- **修复**：部署层面按代理层数设置 `TRUSTED_PROXY_COUNT` 即闭合主要缺口；代码层面补一个 `user:${username}` 维度的第二限速桶（阈值可放宽为 IP 桶的 3-5 倍），换 IP 头也无法对同一用户名无限尝试。

### FU-4 legacy 验签兼容期未缩短（P2-4 收尾）

- **问题** `src/lib/signing-secret.server.ts:7` 默认截止日仍为 `2026-10-01`；三个会话验证入口（`src/proxy.ts:113`、`src/lib/api-auth.ts:103`、`src/app/api/auth/session/route.ts:61`）均 `allowLegacyOwnerPassword: true`。兼容期内拿到一条 legacy cookie 仍可离线爆破 owner 口令。
- **影响**：签发侧已强制 `AUTH_SECRET`（32 位下限），会话 TTL 已缩至 7 天——旧密钥签发的 cookie 最迟 7 天内自然过期，兼容期留到 10 月远超必要窗口。
- **修复**：本地 `.env` 设 `LEGACY_COOKIE_CUTOFF_DATE` 为已过日期立即关闭；或把 `DEFAULT_LEGACY_COOKIE_CUTOFF_DATE` 提前到"AUTH_SECRET 强制化上线日 + 最长会话 TTL"。

### FU-5 isSecureRequest 三处实现未对齐（P3-4c 收尾）

- **问题** `login/route.ts:177-183` 已加 `NODE_ENV === 'production'` 恒置 Secure，但 `src/proxy.ts:15-20`（会话滑动刷新会重设 auth cookie）与 `src/app/api/logout/route.ts:5-10` 的同名函数仍仅依赖协议/代理头。生产环境 `x-forwarded-proto` 缺失时，刷新路径重设的 cookie 丢 Secure，login 的修复被回退。
- **修复**：抽一个共享 helper（如放 `src/lib/auth.server.ts`），三处统一消费。

---

## 备注级观察（不阻塞，择机处理）

- **P3-1 封禁分支不计失败次数**（`login/route.ts:330-333`）：该分支仅密码正确后可达，无实际爆破增益，可不处理。
- **README 4 个内容类变量未逐个入表**（`NEXT_PUBLIC_SITE_NAME`、`ANNOUNCEMENT`、`NEXT_PUBLIC_DOUBAN_IMAGE_PROXY_TYPE`、`NEXT_PUBLIC_FLUID_SEARCH`）：README:186 有"优先走后台配置"的归口说明，属有意的文档策略；接受归口说明即可关闭。
- **`proxy/key` VOD 分支以 public 缓存 HLS AES 密钥**（`proxy/key/route.ts:112`）：鉴权后可达、与用户无关，合规；纵深角度密钥类响应宜改 `private`。
- **`server-config` 未加 `Vary: Cookie`**（`server-config/route.ts:89-95`）：共享缓存可能把匿名精简变体回给登录用户，功能降级方向、非泄漏方向。
- **`version/latest` changelog 拉取无大小上限**（`version/latest/route.ts:47`）：URL 来自服务端配置清单，非用户输入。
- **search 空结果与 suggestions 空查询路径无显式 Cache-Control**（`search/route.ts:74-76` 等）：动态响应默认不被共享缓存，严格化可补显式头。
- **segment / m3u8 fetch 阶段 `UrlValidationError` message 透传**（`proxy-diagnostics.ts:127-135`）：仅鉴权后可达。
- **P2-8 的一致性依赖应用层约束**：MySQL DDL 仍 `utf8mb4_unicode_ci`（审计允许的二选一方案），新增用户名写入口须保持走 `src/lib/username.ts`。

## 建议处理顺序

1. **FU-1、FU-2**：明确的同类遗漏，各自几行改动，先修。
2. **FU-4**：一行环境变量或改默认值即可关闭。
3. **FU-5**：抽 helper 对齐三处。
4. **FU-3**：部署时配置 `TRUSTED_PROXY_COUNT`；用户名桶按需补。
