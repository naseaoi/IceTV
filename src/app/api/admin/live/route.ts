import { NextRequest, NextResponse } from 'next/server';

import { isGuardFailure, requireAdmin } from '@/lib/api-auth';
import { getConfig, saveConfig } from '@/lib/config';
import { removeConfigFileEntries } from '@/lib/config-file-json';
import { deleteCachedLiveChannels, refreshLiveChannels } from '@/lib/live';

export const runtime = 'nodejs';

type EditableLiveInfo = {
  key: string;
  name: string;
  url: string;
  ua: string;
  epg: string;
  from: 'custom' | 'config';
  channelNumber: number;
  disabled: boolean;
};

async function refreshOrRejectLiveSource(liveInfo: EditableLiveInfo) {
  const channelNumber = await refreshLiveChannels(liveInfo);
  if (channelNumber <= 0) {
    throw new Error('未获取到频道列表，请检查直播源地址');
  }
  return channelNumber;
}

export async function POST(request: NextRequest) {
  try {
    const guardResult = await requireAdmin(request);
    if (isGuardFailure(guardResult)) return guardResult.response;

    const config = await getConfig();

    const body = await request.json();
    const { action, key, name, url, ua, epg } = body;
    const cleanKey = typeof key === 'string' ? key.trim() : '';
    const cleanName = typeof name === 'string' ? name.trim() : '';
    const cleanUrl = typeof url === 'string' ? url.trim() : '';
    const cleanUa = typeof ua === 'string' ? ua.trim() : '';
    const cleanEpg = typeof epg === 'string' ? epg.trim() : '';

    if (!config) {
      return NextResponse.json({ error: '配置不存在' }, { status: 404 });
    }

    // 确保 LiveConfig 存在
    if (!config.LiveConfig) {
      config.LiveConfig = [];
    }

    switch (action) {
      case 'add':
        if (!cleanKey || !cleanName || !cleanUrl) {
          return NextResponse.json(
            { error: '直播源参数不完整' },
            { status: 400 },
          );
        }

        // 检查是否已存在相同的 key
        if (config.LiveConfig.some((l) => l.key === cleanKey)) {
          return NextResponse.json(
            { error: '直播源 key 已存在' },
            { status: 400 },
          );
        }

        const liveInfo = {
          key: cleanKey,
          name: cleanName,
          url: cleanUrl,
          ua: cleanUa,
          epg: cleanEpg,
          from: 'custom' as 'custom' | 'config',
          channelNumber: 0,
          disabled: false,
        };

        try {
          liveInfo.channelNumber = await refreshOrRejectLiveSource(liveInfo);
        } catch (error) {
          console.error('刷新直播源失败:', error);
          return NextResponse.json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : '未获取到频道列表，请检查直播源地址',
            },
            { status: 400 },
          );
        }

        // 添加新的直播源
        config.LiveConfig.push(liveInfo);
        break;

      case 'delete':
        // 删除直播源
        if (!cleanKey) {
          return NextResponse.json({ error: '缺少 key 参数' }, { status: 400 });
        }
        const deleteIndex = config.LiveConfig.findIndex(
          (l) => l.key === cleanKey,
        );
        if (deleteIndex === -1) {
          return NextResponse.json({ error: '直播源不存在' }, { status: 404 });
        }

        deleteCachedLiveChannels(cleanKey);

        config.LiveConfig.splice(deleteIndex, 1);
        config.ConfigFile = removeConfigFileEntries(
          config.ConfigFile,
          'lives',
          [cleanKey],
        );
        break;

      case 'enable':
        // 启用直播源
        const enableSource = config.LiveConfig.find((l) => l.key === cleanKey);
        if (!enableSource) {
          return NextResponse.json({ error: '直播源不存在' }, { status: 404 });
        }
        enableSource.disabled = false;
        break;

      case 'disable':
        // 禁用直播源
        const disableSource = config.LiveConfig.find((l) => l.key === cleanKey);
        if (!disableSource) {
          return NextResponse.json({ error: '直播源不存在' }, { status: 404 });
        }
        disableSource.disabled = true;
        break;

      case 'edit':
        // 编辑直播源
        const editSource = config.LiveConfig.find((l) => l.key === cleanKey);
        if (!editSource) {
          return NextResponse.json({ error: '直播源不存在' }, { status: 404 });
        }

        if (!cleanName || !cleanUrl) {
          return NextResponse.json(
            { error: '直播源参数不完整' },
            { status: 400 },
          );
        }

        const nextEditSource = {
          ...editSource,
          name: cleanName,
          url: cleanUrl,
          ua: cleanUa,
          epg: cleanEpg,
          disabled: editSource.disabled === true,
          channelNumber: editSource.channelNumber || 0,
        };

        try {
          nextEditSource.channelNumber =
            await refreshOrRejectLiveSource(nextEditSource);
        } catch (error) {
          console.error('刷新直播源失败:', error);
          return NextResponse.json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : '未获取到频道列表，请检查直播源地址',
            },
            { status: 400 },
          );
        }

        // 更新字段（除了 key 和 from）
        editSource.name = nextEditSource.name;
        editSource.url = nextEditSource.url;
        editSource.ua = nextEditSource.ua;
        editSource.epg = nextEditSource.epg;
        editSource.channelNumber = nextEditSource.channelNumber;
        break;

      case 'sort':
        // 排序直播源
        const { order } = body;
        if (!Array.isArray(order)) {
          return NextResponse.json(
            { error: '排序数据格式错误' },
            { status: 400 },
          );
        }

        // 创建新的排序后的数组
        const sortedLiveConfig: typeof config.LiveConfig = [];
        order.forEach((key) => {
          const source = config.LiveConfig?.find((l) => l.key === key);
          if (source) {
            sortedLiveConfig.push(source);
          }
        });

        // 添加未在排序列表中的直播源（保持原有顺序）
        config.LiveConfig.forEach((source) => {
          if (!order.includes(source.key)) {
            sortedLiveConfig.push(source);
          }
        });

        config.LiveConfig = sortedLiveConfig;
        break;

      default:
        return NextResponse.json({ error: '未知操作' }, { status: 400 });
    }

    // 保存配置
    await saveConfig(config);

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '操作失败' },
      { status: 500 },
    );
  }
}
