import { NextRequest, NextResponse } from 'next/server';
import { promisify } from 'util';
import { gunzip } from 'zlib';

import { isGuardFailure, requireOwner } from '@/lib/api-auth';
import { SimpleCrypto } from '@/lib/crypto';
import { ImportValidationError, parseImportData } from '@/lib/data-import';
import { db } from '@/lib/db';
import { setCachedConfig } from '@/lib/config';

export const runtime = 'nodejs';

const gunzipAsync = promisify(gunzip);
const MAX_IMPORT_FILE_BYTES = 25 * 1024 * 1024;
const MAX_DECOMPRESSED_BYTES = 50 * 1024 * 1024;

export async function POST(req: NextRequest) {
  try {
    const guardResult = await requireOwner(req, {
      unauthorizedMessage: '未登录',
      forbiddenMessage: '权限不足，只有站长可以导入数据',
    });
    if (isGuardFailure(guardResult)) return guardResult.response;

    // 解析表单数据
    const formData = await req.formData();
    const file = formData.get('file') as File;
    const password = formData.get('password') as string;

    if (!file) {
      return NextResponse.json({ error: '请选择备份文件' }, { status: 400 });
    }

    if (file.size > MAX_IMPORT_FILE_BYTES) {
      return NextResponse.json(
        { error: '备份文件大小超出限制' },
        { status: 413 },
      );
    }

    if (!password) {
      return NextResponse.json({ error: '请提供解密密码' }, { status: 400 });
    }

    // 读取文件内容
    const encryptedData = await file.text();

    // 解密数据
    let decryptedData: string;
    try {
      decryptedData = SimpleCrypto.decrypt(encryptedData, password);
    } catch (error) {
      return NextResponse.json(
        { error: '解密失败，请检查密码是否正确' },
        { status: 400 },
      );
    }

    // 解压缩数据
    if (!isBase64Text(decryptedData)) {
      return NextResponse.json({ error: '备份文件格式错误' }, { status: 400 });
    }

    const compressedBuffer = Buffer.from(decryptedData, 'base64');
    if (compressedBuffer.byteLength > MAX_IMPORT_FILE_BYTES) {
      return NextResponse.json(
        { error: '备份文件大小超出限制' },
        { status: 413 },
      );
    }

    let decompressedBuffer: Buffer;
    try {
      decompressedBuffer = await gunzipAsync(compressedBuffer, {
        maxOutputLength: MAX_DECOMPRESSED_BYTES,
      });
    } catch {
      return NextResponse.json(
        { error: '备份文件解压失败或大小超出限制' },
        { status: 400 },
      );
    }

    if (decompressedBuffer.byteLength > MAX_DECOMPRESSED_BYTES) {
      return NextResponse.json(
        { error: '备份文件解压后大小超出限制' },
        { status: 413 },
      );
    }

    const decompressedData = decompressedBuffer.toString();

    // 解析JSON数据
    let importData: any;
    try {
      importData = JSON.parse(decompressedData);
    } catch (error) {
      return NextResponse.json({ error: '备份文件格式错误' }, { status: 400 });
    }

    const parsedImport = await parseImportData(importData);

    await db.replaceAllData(parsedImport.snapshot);
    await setCachedConfig(parsedImport.snapshot.adminConfig);

    return NextResponse.json({
      message: '数据导入成功',
      importedUsers: parsedImport.importedUsers,
      timestamp: parsedImport.timestamp,
      serverVersion: parsedImport.serverVersion,
    });
  } catch (error) {
    if (error instanceof ImportValidationError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }

    console.error('数据导入失败:', error);
    return NextResponse.json({ error: '导入失败' }, { status: 500 });
  }
}

function isBase64Text(value: string): boolean {
  return (
    value.length > 0 &&
    value.length % 4 === 0 &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(value)
  );
}
