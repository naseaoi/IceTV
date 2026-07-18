import fs from 'fs';
import { NextRequest, NextResponse } from 'next/server';
import path from 'path';

import { isGuardFailure, requireAdmin } from '@/lib/api-auth';
import {
  findSiteIconFile,
  removeSiteIcon,
  SITE_ICON_CONTENT_TYPES,
  SITE_ICON_MAX_SIZE,
  stageSiteIcon,
} from '@/lib/site-icon-storage.server';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const guardResult = await requireAdmin(request);
  if (isGuardFailure(guardResult)) return guardResult.response;

  try {
    const formData = await request.formData();
    const file = formData.get('icon') as File | null;
    if (!file) {
      return NextResponse.json({ error: '未提供文件' }, { status: 400 });
    }

    if (file.size > SITE_ICON_MAX_SIZE) {
      return NextResponse.json(
        { error: '图标文件不能超过 512KB' },
        { status: 400 },
      );
    }

    if (!SITE_ICON_CONTENT_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: '仅支持 PNG/JPEG/WebP/SVG/GIF/ICO 格式' },
        { status: 400 },
      );
    }

    const stagingToken = await stageSiteIcon(file);
    return NextResponse.json({ ok: true, stagingToken });
  } catch (error) {
    console.error('上传站点图标失败:', error);
    return NextResponse.json({ error: '上传失败' }, { status: 500 });
  }
}

export async function GET() {
  try {
    const filePath = findSiteIconFile();
    if (!filePath) {
      return new NextResponse(null, { status: 404 });
    }
    const buffer = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();

    const contentTypeMap: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
      '.gif': 'image/gif',
      '.ico': 'image/x-icon',
    };

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': contentTypeMap[ext] || 'image/png',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}

export async function DELETE(request: NextRequest) {
  const guardResult = await requireAdmin(request);
  if (isGuardFailure(guardResult)) return guardResult.response;

  try {
    removeSiteIcon();
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('删除站点图标失败:', error);
    return NextResponse.json({ error: '删除失败' }, { status: 500 });
  }
}
