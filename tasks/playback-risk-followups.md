# 播放链路待核实风险

来源：2026-11 播放 BUG 排查中发现、尚未复现或验证的三处风险。每项先复现，确认是问题再修，修完把长期有效的约束写入 `docs/playback.md` 并删除本文件。

## 1. 换源时跳过片头片尾配置的迁移时序

- 现象假设：换源后 `useSkipConfig` 加载新源配置，与登记继承、旧配置删除（`finalizeSourceSwitchCleanup()` 等 `skipConfigCleanupReady`）存在竞态，可能出现新源读到空配置、旧配置已删的情况。
- 入口：`src/features/play/hooks/useSourceSwitch.ts`（`registerSkipConfigMigration`）、`src/features/play/lib/sourceSwitchCleanup.ts`、`useSkipConfig`。
- 验收：设置片头片尾后连续快速换源 A→B→C、换源后立即切集，跳过配置在最终源上保留，旧源配置仅在迁移成功后删除；补对应 Jest 用例。

## 2. 原始清单缓存跨签名键共享

- 现象假设：m3u8 代理按粘性键缓存原始清单，不同签名参数或出口的请求可能命中同一份原始清单，导致拿到绑定其他出口或已过期签名的分片地址。
- 入口：`src/app/api/proxy/m3u8/service.ts` 的缓存键构造、`src/lib/signed-url-params.ts`。
- 验收：确认缓存键是否包含签名或出口维度；若共享会导致 403，按签名有效期规则隔离或缩短缓存，并补测试。

## 3. 已解析的选集地址播放时 403 无法强制重新解析

- 现象假设：逐集懒解析得到的地址在缓存有效期内被源站拒绝（403），播放器重试仍使用同一缓存地址，没有绕过缓存重新解析的路径，只能换源。
- 入口：`src/features/play/lib/lazyEpisode.ts`、`src/app/api/episode-url/cache.ts`、点播运行时恢复控制器。
- 验收：对已解析地址返回 403 时，客户端带强制刷新参数重新解析一次（服务端跳过缓存），仍失败再走现有换源或报错流程；补测试。
