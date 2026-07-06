import fs from 'fs';
import { NextRequest, NextResponse } from 'next/server';
import path from 'path';

import { isGuardFailure, requireAdmin } from '@/lib/api-auth';

export const runtime = 'nodejs';

// 上传的图标存储路径（Docker 容器中持久化到 /data，开发环境用项目 data 目录）
function getIconDir(): string {
  const dataDir =
    process.env.NODE_ENV === 'production'
      ? '/data'
      : path.resolve(process.cwd(), 'data');
  return path.join(dataDir, 'icons');
}

// POST: 上传站点图标
export async function POST(request: NextRequest) {
  const guardResult = await requireAdmin(request);
  if (isGuardFailure(guardResult)) return guardResult.response;

  try {
    const formData = await request.formData();
    const file = formData.get('icon') as File | null;
    if (!file) {
      return NextResponse.json({ error: '未提供文件' }, { status: 400 });
    }

    // 限制文件大小 (512KB)
    if (file.size > 512 * 1024) {
      return NextResponse.json(
        { error: '图标文件不能超过 512KB' },
        { status: 400 },
      );
    }

    // 仅允许图片格式
    const allowedTypes = [
      'image/png',
      'image/jpeg',
      'image/webp',
      'image/svg+xml',
      'image/gif',
      'image/x-icon',
      'image/vnd.microsoft.icon',
    ];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { error: '仅支持 PNG/JPEG/WebP/SVG/GIF/ICO 格式' },
        { status: 400 },
      );
    }

    // 确定文件扩展名
    const extMap: Record<string, string> = {
      'image/png': '.png',
      'image/jpeg': '.jpg',
      'image/webp': '.webp',
      'image/svg+xml': '.svg',
      'image/gif': '.gif',
      'image/x-icon': '.ico',
      'image/vnd.microsoft.icon': '.ico',
    };
    const ext = extMap[file.type] || '.png';

    // 确保目录存在
    const iconDir = getIconDir();
    if (!fs.existsSync(iconDir)) {
      fs.mkdirSync(iconDir, { recursive: true });
    }

    // 删除旧图标文件
    const existingFiles = fs.readdirSync(iconDir);
    for (const f of existingFiles) {
      if (f.startsWith('site-icon')) {
        fs.unlinkSync(path.join(iconDir, f));
      }
    }

    // 写入新文件
    const fileName = `site-icon${ext}`;
    const filePath = path.join(iconDir, fileName);
    const buffer = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(filePath, buffer);

    const iconUrl = `/api/admin/site-icon?t=${Date.now()}`;
    return NextResponse.json({ ok: true, url: iconUrl });
  } catch (error) {
    console.error('上传站点图标失败:', error);
    return NextResponse.json({ error: '上传失败' }, { status: 500 });
  }
}

// GET: 读取站点图标
export async function GET() {
  try {
    const iconDir = getIconDir();
    if (!fs.existsSync(iconDir)) {
      return new NextResponse(null, { status: 404 });
    }

    const files = fs.readdirSync(iconDir);
    const iconFile = files.find((f) => f.startsWith('site-icon'));
    if (!iconFile) {
      return new NextResponse(null, { status: 404 });
    }

    const filePath = path.join(iconDir, iconFile);
    const buffer = fs.readFileSync(filePath);
    const ext = path.extname(iconFile).toLowerCase();

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

// DELETE: 删除站点图标
export async function DELETE(request: NextRequest) {
  const guardResult = await requireAdmin(request);
  if (isGuardFailure(guardResult)) return guardResult.response;

  try {
    const iconDir = getIconDir();
    if (fs.existsSync(iconDir)) {
      const files = fs.readdirSync(iconDir);
      for (const f of files) {
        if (f.startsWith('site-icon')) {
          fs.unlinkSync(path.join(iconDir, f));
        }
      }
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('删除站点图标失败:', error);
    return NextResponse.json({ error: '删除失败' }, { status: 500 });
  }
}
