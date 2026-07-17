import { NextRequest, NextResponse } from 'next/server';

import { isGuardFailure, requireAdmin } from '@/lib/api-auth';
import { configConflictResponse } from '@/lib/api-config-error';
import { getConfig, saveConfig } from '@/lib/config';
import { buildConfigFileFromAdminConfig } from '@/lib/config-file-json';

export const runtime = 'nodejs';

// 支持的操作类型
type Action = 'add' | 'edit' | 'disable' | 'enable' | 'delete' | 'sort';

interface BaseBody {
  action?: Action;
}

function readCategoryFields(body: Record<string, any>): {
  name: string;
  type: 'movie' | 'tv' | null;
  query: string;
} {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const query = typeof body.query === 'string' ? body.query.trim() : '';
  const type = body.type === 'movie' || body.type === 'tv' ? body.type : null;
  return { name, type, query };
}

function isValidCategoryFields(
  fields: ReturnType<typeof readCategoryFields>,
): fields is { name: string; type: 'movie' | 'tv'; query: string } {
  return (
    !!fields.type &&
    fields.name.length > 0 &&
    fields.name.length <= 64 &&
    fields.query.length > 0 &&
    fields.query.length <= 200
  );
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
    ];
    if (!action || !ACTIONS.includes(action)) {
      return NextResponse.json({ error: '参数格式错误' }, { status: 400 });
    }

    // 获取配置与存储
    const adminConfig = await getConfig();

    switch (action) {
      case 'add': {
        const fields = readCategoryFields(body);
        if (!isValidCategoryFields(fields)) {
          return NextResponse.json(
            { error: '分类参数格式错误' },
            { status: 400 },
          );
        }
        const { name, type, query } = fields;
        // 检查是否已存在相同的查询和类型组合
        if (
          adminConfig.CustomCategories.some(
            (c) => c.query === query && c.type === type,
          )
        ) {
          return NextResponse.json({ error: '该分类已存在' }, { status: 400 });
        }
        adminConfig.CustomCategories.push({
          name,
          type,
          query,
          from: 'custom',
          disabled: false,
        });
        break;
      }
      case 'edit': {
        const originalQuery =
          typeof body.originalQuery === 'string'
            ? body.originalQuery.trim()
            : '';
        const originalType =
          body.originalType === 'movie' || body.originalType === 'tv'
            ? body.originalType
            : null;
        const fields = readCategoryFields(body);
        if (!originalQuery || !originalType || !isValidCategoryFields(fields)) {
          return NextResponse.json(
            { error: '分类参数格式错误' },
            { status: 400 },
          );
        }
        const entry = adminConfig.CustomCategories.find(
          (category) =>
            category.query === originalQuery && category.type === originalType,
        );
        if (!entry) {
          return NextResponse.json({ error: '分类不存在' }, { status: 404 });
        }
        const duplicate = adminConfig.CustomCategories.some(
          (category) =>
            category !== entry &&
            category.query === fields.query &&
            category.type === fields.type,
        );
        if (duplicate) {
          return NextResponse.json({ error: '该分类已存在' }, { status: 400 });
        }
        entry.name = fields.name;
        entry.type = fields.type;
        entry.query = fields.query;
        break;
      }
      case 'disable': {
        const { query, type } = body as {
          query?: string;
          type?: 'movie' | 'tv';
        };
        if (!query || !type)
          return NextResponse.json(
            { error: '缺少 query 或 type 参数' },
            { status: 400 },
          );
        const entry = adminConfig.CustomCategories.find(
          (c) => c.query === query && c.type === type,
        );
        if (!entry)
          return NextResponse.json({ error: '分类不存在' }, { status: 404 });
        entry.disabled = true;
        break;
      }
      case 'enable': {
        const { query, type } = body as {
          query?: string;
          type?: 'movie' | 'tv';
        };
        if (!query || !type)
          return NextResponse.json(
            { error: '缺少 query 或 type 参数' },
            { status: 400 },
          );
        const entry = adminConfig.CustomCategories.find(
          (c) => c.query === query && c.type === type,
        );
        if (!entry)
          return NextResponse.json({ error: '分类不存在' }, { status: 404 });
        entry.disabled = false;
        break;
      }
      case 'delete': {
        const { query, type } = body as {
          query?: string;
          type?: 'movie' | 'tv';
        };
        if (!query || !type)
          return NextResponse.json(
            { error: '缺少 query 或 type 参数' },
            { status: 400 },
          );
        const idx = adminConfig.CustomCategories.findIndex(
          (c) => c.query === query && c.type === type,
        );
        if (idx === -1)
          return NextResponse.json({ error: '分类不存在' }, { status: 404 });
        adminConfig.CustomCategories.splice(idx, 1);
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
        const map = new Map(
          adminConfig.CustomCategories.map((c) => [`${c.query}:${c.type}`, c]),
        );
        const newList: typeof adminConfig.CustomCategories = [];
        order.forEach((key) => {
          const item = map.get(key);
          if (item) {
            newList.push(item);
            map.delete(key);
          }
        });
        // 未在 order 中的保持原顺序
        adminConfig.CustomCategories.forEach((item) => {
          if (map.has(`${item.query}:${item.type}`)) newList.push(item);
        });
        adminConfig.CustomCategories = newList;
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
    console.error('分类管理操作失败:', error);
    return NextResponse.json({ error: '分类管理操作失败' }, { status: 500 });
  }
}
