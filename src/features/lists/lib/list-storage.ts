import { randomUUID } from 'crypto';

import type {
  CreateListInput,
  ListItem,
  ListItemInput,
  ListPatch,
  ListSummary,
} from '@/features/lists/types';
import { isCatalogFavoriteSource } from '@/lib/catalog-favorites';
import { normalizeWorkTitle, normalizeWorkYear } from '@/lib/source-match';
import { normalizeUsername } from '@/lib/username';

import {
  LIST_DESCRIPTION_MAX_LENGTH,
  LIST_ITEM_MAX_COUNT,
  LIST_MAX_COUNT,
  LIST_NAME_MAX_LENGTH,
} from './limits';

export class ListError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code?: string,
  ) {
    super(message);
  }
}
export function listNotFound(): never {
  throw new ListError('片单不存在', 404);
}
export type ListRow = Record<string, string | number | null>;
export interface ListStatement {
  sql: string;
  params: (string | number | null)[];
}
export type ListPlan<T> = Generator<ListStatement, T, ListRow[]>;
export interface ListStore {
  getLists(
    username: string,
    viewer: string,
    work?: { title: string; year: string },
  ): Promise<ListSummary[]>;
  countUserLists(username: string): Promise<number>;
  getList(
    id: string,
    viewer: string,
  ): Promise<{ list: ListSummary; username: string; items: ListItem[] }>;
  createList(username: string, input: CreateListInput): Promise<ListSummary>;
  updateList(
    username: string,
    id: string,
    patch: ListPatch,
  ): Promise<ListSummary>;
  deleteList(username: string, id: string): Promise<void>;
  addListItem(
    username: string,
    id: string,
    input: ListItemInput,
  ): Promise<{ item: ListItem; list: ListSummary }>;
  removeListItem(
    username: string,
    id: string,
    itemId: string,
  ): Promise<ListSummary>;
  reorderListItems(
    username: string,
    id: string,
    itemIds: string[],
    version: number,
  ): Promise<ListSummary>;
}
export function listSchema(dialect: 'sqlite' | 'mysql'): string[] {
  const time = dialect === 'mysql' ? 'BIGINT' : 'INTEGER';
  const suffix =
    dialect === 'mysql' ? ' CHARACTER SET utf8mb4 COLLATE utf8mb4_bin' : '';
  return [
    `CREATE TABLE IF NOT EXISTS user_lists (id VARCHAR(36) PRIMARY KEY, username VARCHAR(191) NOT NULL, name VARCHAR(30) NOT NULL, description VARCHAR(200) NOT NULL, is_public INTEGER NOT NULL, item_count INTEGER NOT NULL, version INTEGER NOT NULL, created_at ${time} NOT NULL, updated_at ${time} NOT NULL${dialect === 'mysql' ? ', KEY idx_user_lists_owner (username, updated_at, id)' : ''})${suffix}`,
    `CREATE TABLE IF NOT EXISTS user_list_items (id VARCHAR(36) PRIMARY KEY, list_id VARCHAR(36) NOT NULL, title VARCHAR(300) NOT NULL, year VARCHAR(16) NOT NULL, title_norm VARCHAR(300) NOT NULL, cover TEXT NOT NULL, source VARCHAR(191) NOT NULL, source_id VARCHAR(300), search_title VARCHAR(300) NOT NULL, position INTEGER NOT NULL, added_at ${time} NOT NULL, UNIQUE (list_id, title_norm, year)${dialect === 'mysql' ? ', KEY idx_user_list_items_order (list_id, position)' : ''})${suffix}`,
    ...(dialect === 'sqlite'
      ? [
          'CREATE INDEX IF NOT EXISTS idx_user_lists_owner ON user_lists (username, updated_at, id)',
          'CREATE INDEX IF NOT EXISTS idx_user_list_items_order ON user_list_items (list_id, position)',
        ]
      : []),
  ];
}
function statement(
  sql: string,
  ...params: ListStatement['params']
): ListStatement {
  return { sql, params };
}
function text(
  value: unknown,
  max: number,
  label: string,
  empty = false,
): string {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    (!empty && !value.trim())
  )
    throw new ListError(`${label}格式不正确`);
  return value.trim();
}
export function validateListPatch(input: unknown, create = false): ListPatch {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new ListError('请求体必须为有效 JSON 对象');
  const value = input as Record<string, unknown>;
  const patch: ListPatch = {};
  if (create || value.name !== undefined)
    patch.name = text(value.name, LIST_NAME_MAX_LENGTH, '片单名称');
  if (value.description !== undefined)
    patch.description = text(
      value.description,
      LIST_DESCRIPTION_MAX_LENGTH,
      '片单简介',
      true,
    );
  if (value.isPublic !== undefined) {
    if (typeof value.isPublic !== 'boolean')
      throw new ListError('公开设置格式不正确');
    patch.isPublic = value.isPublic;
  }
  if (!create && !Object.keys(patch).length)
    throw new ListError('请提供要修改的片单信息');
  return patch;
}
export function validateListItem(input: unknown): ListItemInput {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new ListError('作品格式不正确');
  const value = input as Record<string, unknown>;
  const title = text(value.title, 300, '作品标题');
  const titleNorm = normalizeWorkTitle(title);
  if (!titleNorm || titleNorm.length > 300)
    throw new ListError('作品标题格式不正确');
  const year = normalizeWorkYear(text(value.year, 16, '年份', true));
  const cover = text(value.cover, 4096, '封面', true);
  if (cover) {
    try {
      const url = new URL(cover);
      if (
        !['https:', 'http:'].includes(url.protocol) ||
        url.username ||
        url.password
      )
        throw new Error();
    } catch {
      throw new ListError('封面地址格式不正确');
    }
  }
  const source = text(value.source, 191, '来源', true);
  const id =
    value.id == null ? null : text(value.id, 300, '来源作品编号', true) || null;
  return {
    title,
    year,
    cover,
    source,
    id: !source || isCatalogFavoriteSource(source) ? null : id,
    searchTitle:
      value.searchTitle === undefined
        ? title
        : text(value.searchTitle, 300, '搜索标题', true) || title,
  };
}
function item(row: ListRow): ListItem {
  return {
    id: String(row.id),
    title: String(row.title),
    year: String(row.year),
    cover: String(row.cover),
    source: String(row.source),
    sourceId: row.source_id === null ? null : String(row.source_id),
    searchTitle: String(row.search_title),
    addedAt: Number(row.added_at),
  };
}
function summary(
  row: ListRow,
  items: ListRow[],
  work?: { title: string; year: string },
): ListSummary {
  const found = work
    ? items.find(
        (entry) =>
          entry.title_norm === normalizeWorkTitle(work.title) &&
          entry.year === normalizeWorkYear(work.year),
      )
    : undefined;
  return {
    id: String(row.id),
    name: String(row.name),
    description: String(row.description),
    isPublic: Number(row.is_public) === 1,
    itemCount: Number(row.item_count),
    covers: items.slice(0, 4).map((entry) => String(entry.cover)),
    version: Number(row.version),
    updatedAt: Number(row.updated_at),
    ...(work
      ? { contains: !!found, containsItemId: found ? String(found.id) : null }
      : {}),
  };
}
export class ListPlans {
  constructor(private readonly dialect: 'sqlite' | 'mysql') {}
  private *row(id: string, viewer: string, write = false): ListPlan<ListRow> {
    if (write && this.dialect === 'mysql')
      yield statement(
        'SELECT username FROM user_profiles WHERE username = ? FOR UPDATE',
        normalizeUsername(viewer),
      );
    const [row] = yield statement(
      `SELECT * FROM user_lists WHERE id = ?${write && this.dialect === 'mysql' ? ' FOR UPDATE' : ''}`,
      id,
    );
    if (
      !row ||
      (row.username !== normalizeUsername(viewer) &&
        (write || Number(row.is_public) !== 1))
    )
      listNotFound();
    return row;
  }
  private *items(id: string): ListPlan<ListRow[]> {
    return yield statement(
      'SELECT * FROM user_list_items WHERE list_id = ? ORDER BY position ASC, id ASC',
      id,
    );
  }
  private *result(id: string, username: string): ListPlan<ListSummary> {
    return summary(yield* this.row(id, username), yield* this.items(id));
  }
  private *touch(id: string): ListPlan<void> {
    yield statement(
      'UPDATE user_lists SET item_count = (SELECT COUNT(*) FROM user_list_items WHERE list_id = ?), version = version + 1, updated_at = ? WHERE id = ?',
      id,
      Date.now(),
      id,
    );
  }
  *getLists(
    username: string,
    viewer: string,
    work?: { title: string; year: string },
  ): ListPlan<ListSummary[]> {
    if (work) {
      text(work.title, 300, '作品标题');
      text(work.year, 16, '年份', true);
    }
    const rows = yield statement(
      `SELECT * FROM user_lists WHERE username = ?${normalizeUsername(viewer) === normalizeUsername(username) ? '' : ' AND is_public = 1'} ORDER BY updated_at DESC, id ASC`,
      normalizeUsername(username),
    );
    if (!rows.length) return [];
    const items = yield statement(
      `SELECT * FROM user_list_items WHERE list_id IN (${rows.map(() => '?').join(',')}) ORDER BY position ASC, id ASC`,
      ...rows.map((row) => row.id),
    );
    return rows.map((row) =>
      summary(
        row,
        items.filter((entry) => entry.list_id === row.id),
        work,
      ),
    );
  }
  *countUserLists(username: string): ListPlan<number> {
    const [row] = yield statement(
      'SELECT COUNT(*) AS total FROM user_lists WHERE username = ?',
      normalizeUsername(username),
    );
    return Number(row.total);
  }
  *getList(
    id: string,
    viewer: string,
  ): ListPlan<{ list: ListSummary; username: string; items: ListItem[] }> {
    const row = yield* this.row(id, viewer);
    const items = yield* this.items(id);
    return {
      list: summary(row, items),
      username: String(row.username),
      items: items.map(item),
    };
  }
  *createList(username: string, input: CreateListInput): ListPlan<ListSummary> {
    username = normalizeUsername(username);
    const patch = validateListPatch(input, true);
    const firstItem =
      input.item === undefined ? undefined : validateListItem(input.item);
    // 用户资料同时覆盖无 users 行的站长，行锁使并发创建的数量检查串行化。
    const profiles = yield statement(
      `SELECT username FROM user_profiles WHERE username = ?${this.dialect === 'mysql' ? ' FOR UPDATE' : ''}`,
      username,
    );
    if (!profiles.length) listNotFound();
    if ((yield* this.countUserLists(username)) >= LIST_MAX_COUNT)
      throw new ListError(`每人最多创建 ${LIST_MAX_COUNT} 个片单`);
    const id = randomUUID();
    const now = Date.now();
    yield statement(
      'INSERT INTO user_lists (id, username, name, description, is_public, item_count, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id,
      username,
      patch.name!,
      patch.description ?? '',
      patch.isPublic ? 1 : 0,
      0,
      1,
      now,
      now,
    );
    if (firstItem)
      return (yield* this.addListItem(username, id, firstItem)).list;
    return yield* this.result(id, username);
  }
  *updateList(
    username: string,
    id: string,
    input: ListPatch,
  ): ListPlan<ListSummary> {
    const row = yield* this.row(id, username, true);
    const patch = validateListPatch(input);
    yield statement(
      'UPDATE user_lists SET name = ?, description = ?, is_public = ? WHERE id = ?',
      patch.name ?? row.name,
      patch.description ?? row.description,
      patch.isPublic === undefined ? row.is_public : patch.isPublic ? 1 : 0,
      id,
    );
    yield* this.touch(id);
    return yield* this.result(id, username);
  }
  *deleteList(username: string, id: string): ListPlan<void> {
    yield* this.row(id, username, true);
    yield statement('DELETE FROM user_list_items WHERE list_id = ?', id);
    yield statement('DELETE FROM user_lists WHERE id = ?', id);
  }
  *addListItem(
    username: string,
    id: string,
    input: ListItemInput,
  ): ListPlan<{ item: ListItem; list: ListSummary }> {
    yield* this.row(id, username, true);
    const value = validateListItem(input);
    const items = yield* this.items(id);
    const norm = normalizeWorkTitle(value.title);
    const existing = items.find(
      (row) => row.title_norm === norm && row.year === value.year,
    );
    if (existing)
      return { item: item(existing), list: yield* this.result(id, username) };
    if (items.length >= LIST_ITEM_MAX_COUNT)
      throw new ListError(`每个片单最多添加 ${LIST_ITEM_MAX_COUNT} 部作品`);
    const itemId = randomUUID();
    const now = Date.now();
    yield statement(
      'INSERT INTO user_list_items (id, list_id, title, year, title_norm, cover, source, source_id, search_title, position, added_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      itemId,
      id,
      value.title,
      value.year,
      norm,
      value.cover,
      value.source,
      value.id,
      value.searchTitle!,
      items.length
        ? Math.max(...items.map((row) => Number(row.position))) + 1
        : 0,
      now,
    );
    yield* this.touch(id);
    return {
      item: {
        id: itemId,
        title: value.title,
        year: value.year,
        cover: value.cover,
        source: value.source,
        sourceId: value.id,
        searchTitle: value.searchTitle!,
        addedAt: now,
      },
      list: yield* this.result(id, username),
    };
  }
  *removeListItem(
    username: string,
    id: string,
    itemId: string,
  ): ListPlan<ListSummary> {
    yield* this.row(id, username, true);
    if (!(yield* this.items(id)).some((row) => row.id === itemId))
      listNotFound();
    yield statement(
      'DELETE FROM user_list_items WHERE list_id = ? AND id = ?',
      id,
      itemId,
    );
    yield* this.touch(id);
    return yield* this.result(id, username);
  }
  *reorderListItems(
    username: string,
    id: string,
    itemIds: string[],
    version: number,
  ): ListPlan<ListSummary> {
    const row = yield* this.row(id, username, true);
    if (
      !Number.isSafeInteger(version) ||
      version < 1 ||
      !Array.isArray(itemIds) ||
      itemIds.length > LIST_ITEM_MAX_COUNT ||
      itemIds.some((value) => typeof value !== 'string')
    )
      throw new ListError('排序参数格式不正确');
    if (Number(row.version) !== version)
      throw new ListError(
        '片单已更新，请刷新后重试',
        409,
        'LIST_VERSION_CONFLICT',
      );
    const items = yield* this.items(id);
    const expected = new Set(items.map((entry) => entry.id));
    if (
      itemIds.length !== items.length ||
      new Set(itemIds).size !== expected.size ||
      itemIds.some((value) => !expected.has(value))
    )
      throw new ListError('排序必须包含当前片单的全部作品');
    for (let position = 0; position < itemIds.length; position++)
      yield statement(
        'UPDATE user_list_items SET position = ? WHERE list_id = ? AND id = ?',
        position,
        id,
        itemIds[position],
      );
    yield* this.touch(id);
    return yield* this.result(id, username);
  }
}
