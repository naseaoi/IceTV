import { NextRequest, NextResponse } from 'next/server';
import { promisify } from 'util';
import { gzip } from 'zlib';

import { isGuardFailure, requireOwner } from '@/lib/api-auth';
import { SimpleCrypto } from '@/lib/crypto';
import {
  formatBytes,
  MAX_BACKUP_DECOMPRESSED_BYTES,
  MAX_BACKUP_FILE_BYTES,
} from '@/lib/data-migration-limits';
import { db } from '@/lib/db';
import { getOwnerUsername } from '@/lib/env.server';
import { readSiteIconForBackup } from '@/lib/site-icon-storage.server';
import { CURRENT_VERSION } from '@/lib/version';

export const runtime = 'nodejs';

const gzipAsync = promisify(gzip);

export async function POST(req: NextRequest) {
  try {
    const ownerUsername = getOwnerUsername();

    const guardResult = await requireOwner(req, {
      unauthorizedMessage: '未登录',
      forbiddenMessage: '权限不足，只有站长可以导出数据',
    });
    if (isGuardFailure(guardResult)) return guardResult.response;

    const config = await db.getAdminConfig();
    if (!config) {
      return NextResponse.json({ error: '无法获取配置' }, { status: 500 });
    }

    // 解析请求体获取密码
    let password: unknown;
    try {
      ({ password } = await req.json());
    } catch {
      return NextResponse.json({ error: '请求体无效' }, { status: 400 });
    }
    if (!password || typeof password !== 'string') {
      return NextResponse.json({ error: '请提供加密密码' }, { status: 400 });
    }

    // 收集所有数据
    const exportData = {
      timestamp: new Date().toISOString(),
      serverVersion: CURRENT_VERSION,
      // 导入端据此把站长数据改挂到本机站长名下
      ownerUsername,
      data: {
        // 管理员配置
        adminConfig: config,
        // 用户密码
        users: await db.getAllUsersWithPasswords(),
        // 源站路由统计（按天原始行）
        sourceRouteStats: await db.getAllSourceRouteStatBuckets(),
        // 邀请码已用次数，真相源是用量表
        inviteCodeUsage: await db.getAllInviteCodeUsage(),
        // 本地上传的站点图标，外链图标为 null
        siteIcon: readSiteIconForBackup(),
        // 所有用户数据
        userData: {} as { [username: string]: any },
      },
    };

    // 获取所有用户
    let allUsers = await db.getAllUsers();
    // 添加站长用户
    allUsers.push(ownerUsername);
    allUsers = Array.from(new Set(allUsers));

    // 为每个用户收集数据
    for (const username of allUsers) {
      const danmakuEnabled = await db.getDanmakuEnabledPreference(username);
      const userData = {
        // 播放记录
        playRecords: await db.getAllPlayRecords(username),
        // 收藏夹
        favorites: await db.getAllFavorites(username),
        // 搜索历史
        searchHistory: await db.getSearchHistory(username),
        // 跳过片头片尾配置
        skipConfigs: await db.getAllSkipConfigs(username),
        playbackSessions: Object.fromEntries(
          (await db.getAllPlaybackSessions(username)).map((session) => [
            session.id,
            session,
          ]),
        ),
        messageState: await db.getUserMessageState(username),
        ...(typeof danmakuEnabled === 'boolean' ? { danmakuEnabled } : {}),
        lastLoginAt: (await db.getUserLastActive(username)) ?? undefined,
      };

      exportData.data.userData[username] = userData;
    }

    // 将数据转换为JSON字符串
    const jsonData = JSON.stringify(exportData);

    const rawBytes = Buffer.byteLength(jsonData);
    if (rawBytes > MAX_BACKUP_DECOMPRESSED_BYTES) {
      return NextResponse.json(
        {
          error: `数据量 ${formatBytes(rawBytes)} 超过备份上限 ${formatBytes(
            MAX_BACKUP_DECOMPRESSED_BYTES,
          )}，请先清理播放记录或观看统计`,
        },
        { status: 413 },
      );
    }

    // 先压缩数据
    const compressedData = await gzipAsync(jsonData);

    // 使用提供的密码加密压缩后的数据
    const encryptedData = SimpleCrypto.encrypt(
      compressedData.toString('base64'),
      password,
    );

    // 导入端校验的是这个成品体积，导出端提前拦住
    const fileBytes = Buffer.byteLength(encryptedData);
    if (fileBytes > MAX_BACKUP_FILE_BYTES) {
      return NextResponse.json(
        {
          error: `备份文件 ${formatBytes(fileBytes)} 超过导入上限 ${formatBytes(
            MAX_BACKUP_FILE_BYTES,
          )}，请先清理播放记录或观看统计`,
        },
        { status: 413 },
      );
    }

    // 生成文件名
    const now = new Date();
    const timestamp = `${now.getFullYear()}${String(
      now.getMonth() + 1,
    ).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(
      now.getHours(),
    ).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(
      now.getSeconds(),
    ).padStart(2, '0')}`;
    const filename = `icetv-backup-${timestamp}.dat`;

    // 返回加密的数据作为文件下载
    return new NextResponse(encryptedData, {
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': encryptedData.length.toString(),
      },
    });
  } catch (error) {
    console.error('数据导出失败:', error);
    return NextResponse.json({ error: '导出失败' }, { status: 500 });
  }
}
