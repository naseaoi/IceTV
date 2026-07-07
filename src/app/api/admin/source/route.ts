import { NextRequest, NextResponse } from 'next/server';

import { isGuardFailure, requireAdmin } from '@/lib/api-auth';
import { configConflictResponse } from '@/lib/api-config-error';
import { getConfig, saveConfig } from '@/lib/config';
import {
  buildConfigFileFromAdminConfig,
  removeConfigFileEntries,
} from '@/lib/config-file-json';
import { validateProxyUrlForRequest } from '@/lib/url-guard';

export const runtime = 'nodejs';

// 支持的操作类型
type Action =
  | 'add'
  | 'edit'
  | 'disable'
  | 'enable'
  | 'delete'
  | 'sort'
  | 'batch_disable'
  | 'batch_enable'
  | 'batch_delete'
  | 'batch_set_proxy_mode'
  | 'set_proxy_mode';

interface BaseBody {
  action?: Action;
}

async function validateSourceApiUrl(
  api: string,
): Promise<{ ok: true; api: string } | { ok: false; response: NextResponse }> {
  const cleanApi = api.trim();
  if (!cleanApi) {
    return {
      ok: false,
      response: NextResponse.json({ error: '缺少必要参数' }, { status: 400 }),
    };
  }

  const validation = await validateProxyUrlForRequest(cleanApi);
  if (!validation.ok) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: '视频源地址不可用' },
        { status: 400 },
      ),
    };
  }

  return { ok: true, api: validation.url.trim() };
}

export async function POST(request: NextRequest) {
  try {
    const guardResult = await requireAdmin(request);
    if (isGuardFailure(guardResult)) return guardResult.response;

    const body = (await request.json()) as BaseBody & Record<string, any>;
    const { action } = body;

    // 基础校验
    const ACTIONS: Action[] = [
      'add',
      'edit',
      'disable',
      'enable',
      'delete',
      'sort',
      'batch_disable',
      'batch_enable',
      'batch_delete',
      'batch_set_proxy_mode',
      'set_proxy_mode',
    ];
    if (!action || !ACTIONS.includes(action)) {
      return NextResponse.json({ error: '参数格式错误' }, { status: 400 });
    }

    // 获取配置与存储
    const adminConfig = await getConfig();

    switch (action) {
      case 'add': {
        const { key, name, api, detail } = body as {
          key?: string;
          name?: string;
          api?: string;
          detail?: string;
        };
        const cleanKey = typeof key === 'string' ? key.trim() : '';
        const cleanName = typeof name === 'string' ? name.trim() : '';
        const cleanApi = typeof api === 'string' ? api.trim() : '';
        const cleanDetail = typeof detail === 'string' ? detail.trim() : '';
        if (!cleanKey || !cleanName || !cleanApi) {
          return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
        }
        const sourceApi = await validateSourceApiUrl(cleanApi);
        if (!sourceApi.ok) {
          return sourceApi.response;
        }
        if (adminConfig.SourceConfig.some((s) => s.key === cleanKey)) {
          return NextResponse.json({ error: '该源已存在' }, { status: 400 });
        }
        adminConfig.SourceConfig.push({
          key: cleanKey,
          name: cleanName,
          api: sourceApi.api,
          detail: cleanDetail,
          from: 'custom',
          disabled: false,
        });
        break;
      }
      case 'edit': {
        const { key, name, api, detail } = body as {
          key?: string;
          name?: string;
          api?: string;
          detail?: string;
        };
        const cleanKey = typeof key === 'string' ? key.trim() : '';
        const cleanName = typeof name === 'string' ? name.trim() : '';
        const cleanApi = typeof api === 'string' ? api.trim() : '';
        const cleanDetail = typeof detail === 'string' ? detail.trim() : '';
        if (!cleanKey || !cleanName || !cleanApi) {
          return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
        }
        const sourceApi = await validateSourceApiUrl(cleanApi);
        if (!sourceApi.ok) {
          return sourceApi.response;
        }
        const entry = adminConfig.SourceConfig.find(
          (source) => source.key === cleanKey,
        );
        if (!entry) {
          return NextResponse.json({ error: '源不存在' }, { status: 404 });
        }
        entry.name = cleanName;
        entry.api = sourceApi.api;
        entry.detail = cleanDetail;
        break;
      }
      case 'disable': {
        const { key } = body as { key?: string };
        if (!key)
          return NextResponse.json({ error: '缺少 key 参数' }, { status: 400 });
        const entry = adminConfig.SourceConfig.find((s) => s.key === key);
        if (!entry)
          return NextResponse.json({ error: '源不存在' }, { status: 404 });
        entry.disabled = true;
        break;
      }
      case 'enable': {
        const { key } = body as { key?: string };
        if (!key)
          return NextResponse.json({ error: '缺少 key 参数' }, { status: 400 });
        const entry = adminConfig.SourceConfig.find((s) => s.key === key);
        if (!entry)
          return NextResponse.json({ error: '源不存在' }, { status: 404 });
        entry.disabled = false;
        break;
      }
      case 'delete': {
        const { key } = body as { key?: string };
        const cleanKey = typeof key === 'string' ? key.trim() : '';
        if (!cleanKey)
          return NextResponse.json({ error: '缺少 key 参数' }, { status: 400 });
        const idx = adminConfig.SourceConfig.findIndex(
          (s) => s.key === cleanKey,
        );
        if (idx === -1)
          return NextResponse.json({ error: '源不存在' }, { status: 404 });
        adminConfig.SourceConfig.splice(idx, 1);
        adminConfig.ConfigFile = removeConfigFileEntries(
          adminConfig.ConfigFile,
          'api_site',
          [cleanKey],
        );

        if (adminConfig.UserConfig.Tags) {
          adminConfig.UserConfig.Tags.forEach((tag) => {
            if (tag.enabledApis) {
              tag.enabledApis = tag.enabledApis.filter(
                (api) => api !== cleanKey,
              );
            }
          });
        }

        adminConfig.UserConfig.Users.forEach((user) => {
          if (user.enabledApis) {
            user.enabledApis = user.enabledApis.filter(
              (api) => api !== cleanKey,
            );
          }
        });
        break;
      }
      case 'batch_disable': {
        const { keys } = body as { keys?: string[] };
        if (!Array.isArray(keys) || keys.length === 0) {
          return NextResponse.json(
            { error: '缺少 keys 参数或为空' },
            { status: 400 },
          );
        }
        keys.forEach((key) => {
          const entry = adminConfig.SourceConfig.find((s) => s.key === key);
          if (entry) {
            entry.disabled = true;
          }
        });
        break;
      }
      case 'batch_enable': {
        const { keys } = body as { keys?: string[] };
        if (!Array.isArray(keys) || keys.length === 0) {
          return NextResponse.json(
            { error: '缺少 keys 参数或为空' },
            { status: 400 },
          );
        }
        keys.forEach((key) => {
          const entry = adminConfig.SourceConfig.find((s) => s.key === key);
          if (entry) {
            entry.disabled = false;
          }
        });
        break;
      }
      case 'batch_delete': {
        const { keys } = body as { keys?: string[] };
        if (!Array.isArray(keys) || keys.length === 0) {
          return NextResponse.json(
            { error: '缺少 keys 参数或为空' },
            { status: 400 },
          );
        }
        const keySet = new Set(
          keys
            .filter((key): key is string => typeof key === 'string')
            .map((key) => key.trim())
            .filter(Boolean),
        );
        const keysToDelete = adminConfig.SourceConfig.filter((entry) =>
          keySet.has(entry.key),
        ).map((entry) => entry.key);

        keysToDelete.forEach((key) => {
          const idx = adminConfig.SourceConfig.findIndex((s) => s.key === key);
          if (idx !== -1) {
            adminConfig.SourceConfig.splice(idx, 1);
          }
        });
        adminConfig.ConfigFile = removeConfigFileEntries(
          adminConfig.ConfigFile,
          'api_site',
          keysToDelete,
        );

        if (keysToDelete.length > 0) {
          if (adminConfig.UserConfig.Tags) {
            adminConfig.UserConfig.Tags.forEach((tag) => {
              if (tag.enabledApis) {
                tag.enabledApis = tag.enabledApis.filter(
                  (api) => !keysToDelete.includes(api),
                );
              }
            });
          }

          adminConfig.UserConfig.Users.forEach((user) => {
            if (user.enabledApis) {
              user.enabledApis = user.enabledApis.filter(
                (api) => !keysToDelete.includes(api),
              );
            }
          });
        }
        break;
      }
      case 'batch_set_proxy_mode': {
        const { keys, proxyMode } = body as {
          keys?: string[];
          proxyMode?: string;
        };
        if (!Array.isArray(keys) || keys.length === 0) {
          return NextResponse.json(
            { error: '缺少 keys 参数或为空' },
            { status: 400 },
          );
        }
        if (
          proxyMode !== 'server' &&
          proxyMode !== 'browser' &&
          proxyMode !== 'auto'
        ) {
          return NextResponse.json(
            { error: 'proxyMode 必须为 server、browser 或 auto' },
            { status: 400 },
          );
        }
        const keySet = new Set(
          keys
            .filter((key): key is string => typeof key === 'string')
            .map((key) => key.trim())
            .filter(Boolean),
        );
        adminConfig.SourceConfig.forEach((entry) => {
          if (keySet.has(entry.key)) {
            entry.proxyMode = proxyMode;
          }
        });
        break;
      }
      case 'sort': {
        const { order } = body as { order?: string[] };
        if (!Array.isArray(order)) {
          return NextResponse.json(
            { error: '排序列表格式错误' },
            { status: 400 },
          );
        }
        const map = new Map(adminConfig.SourceConfig.map((s) => [s.key, s]));
        const newList: typeof adminConfig.SourceConfig = [];
        order.forEach((k) => {
          const item = map.get(k);
          if (item) {
            newList.push(item);
            map.delete(k);
          }
        });
        // 未在 order 中的保持原顺序
        adminConfig.SourceConfig.forEach((item) => {
          if (map.has(item.key)) newList.push(item);
        });
        adminConfig.SourceConfig = newList;
        break;
      }
      case 'set_proxy_mode': {
        const { key, proxyMode } = body as {
          key?: string;
          proxyMode?: string;
        };
        if (!key)
          return NextResponse.json({ error: '缺少 key 参数' }, { status: 400 });
        if (
          proxyMode !== 'server' &&
          proxyMode !== 'browser' &&
          proxyMode !== 'auto'
        ) {
          return NextResponse.json(
            { error: 'proxyMode 必须为 server、browser 或 auto' },
            { status: 400 },
          );
        }
        const entry = adminConfig.SourceConfig.find((s) => s.key === key);
        if (!entry)
          return NextResponse.json({ error: '源不存在' }, { status: 404 });
        entry.proxyMode = proxyMode;
        break;
      }
      default:
        return NextResponse.json({ error: '未知操作' }, { status: 400 });
    }

    adminConfig.ConfigFile = buildConfigFileFromAdminConfig(adminConfig);

    // 持久化到存储
    await saveConfig(adminConfig);

    return NextResponse.json(
      { ok: true },
      {
        headers: {
          'Cache-Control': 'no-store',
        },
      },
    );
  } catch (error) {
    const conflict = configConflictResponse(error);
    if (conflict) return conflict;
    console.error('视频源管理操作失败:', error);
    return NextResponse.json({ error: '视频源管理操作失败' }, { status: 500 });
  }
}
