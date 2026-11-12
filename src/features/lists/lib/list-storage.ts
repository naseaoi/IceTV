import { randomUUID } from 'crypto';

import type {
  CreateListInput,
  ListItem,
  ListItemInput,
  ListLikeState,
  ListPatch,
  ListSummary,
  ListVisibility,
  PlazaPage,
  PlazaSort,
} from '@/features/lists/types';
import { PLAZA_PAGE_SIZE } from '@/features/lists/types';
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
// user_lists.is_public 存可见等级，数值越大可见范围越广
const VISIBILITY_LEVEL: Record<ListVisibility, number> = {
  private: 0,
  members: 1,
  everyone: 2,
};
function visibilityOf(level: unknown): ListVisibility {
  const value = Number(level);
  return value >= 2 ? 'everyone' : value === 1 ? 'members' : 'private';
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
  countPlazaLists(viewer: string | null): Promise<number>;
  getListItemCount(id: string, viewer: string | null): Promise<number | null>;
  setListLike(
    username: string,
    id: string,
    liked: boolean,
  ): Promise<ListLikeState>;
  recordListView(id: string): Promise<void>;
  getPlazaLists(
    viewer: string | null,
    sort: PlazaSort,
    cursor: string | null,
  ): Promise<PlazaPage>;
  getLists(
    username: string,
    viewer: string,
    work?: { title: string; year: string },
  ): Promise<ListSummary[]>;
  countUserLists(username: string): Promise<number>;
  getList(
    id: string,
    viewer: string | null,
  ): Promise<{
    list: ListSummary;
    username: string;
    items: ListItem[];
    liked: boolean;
  }>;
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
    `CREATE TABLE IF NOT EXISTS user_lists (id VARCHAR(36) PRIMARY KEY, username VARCHAR(191) NOT NULL, name VARCHAR(30) NOT NULL, description VARCHAR(200) NOT NULL, is_public INTEGER NOT NULL, item_count INTEGER NOT NULL, like_count ${dialect === 'mysql' ? 'INT' : 'INTEGER'} NOT NULL DEFAULT 0, view_count ${dialect === 'mysql' ? 'INT' : 'INTEGER'} NOT NULL DEFAULT 0, version INTEGER NOT NULL, created_at ${time} NOT NULL, updated_at ${time} NOT NULL${dialect === 'mysql' ? ', KEY idx_user_lists_owner (username, updated_at, id)' : ''})${suffix}`,
    `CREATE TABLE IF NOT EXISTS user_list_items (id VARCHAR(36) PRIMARY KEY, list_id VARCHAR(36) NOT NULL, title VARCHAR(300) NOT NULL, year VARCHAR(16) NOT NULL, title_norm VARCHAR(300) NOT NULL, cover TEXT NOT NULL, source VARCHAR(191) NOT NULL, source_id VARCHAR(300), search_title VARCHAR(300) NOT NULL, position INTEGER NOT NULL, added_at ${time} NOT NULL, UNIQUE (list_id, title_norm, year)${dialect === 'mysql' ? ', KEY idx_user_list_items_order (list_id, position)' : ''})${suffix}`,
    `CREATE TABLE IF NOT EXISTS list_likes (list_id VARCHAR(36) NOT NULL, username VARCHAR(191) NOT NULL, created_at ${time} NOT NULL, PRIMARY KEY (list_id, username)${dialect === 'mysql' ? ', KEY idx_list_likes_username (username)' : ''})${suffix}`,
    ...(dialect === 'sqlite'
      ? [
          'CREATE INDEX IF NOT EXISTS idx_list_likes_username ON list_likes (username)',
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
  if (value.visibility !== undefined) {
    if (
      typeof value.visibility !== 'string' ||
      !Object.hasOwn(VISIBILITY_LEVEL, value.visibility)
    )
      throw new ListError('公开设置格式不正确');
    patch.visibility = value.visibility as ListVisibility;
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
    visibility: visibilityOf(row.is_public),
    itemCount: Number(row.item_count),
    viewCount: Number(row.view_count ?? 0),
    likeCount: Number(row.like_count ?? 0),
    covers: items.slice(0, 4).map((entry) => String(entry.cover)),
    version: Number(row.version),
    updatedAt: Number(row.updated_at),
    ...(work
      ? { contains: !!found, containsItemId: found ? String(found.id) : null }
      : {}),
  };
}
function plazaCursor(
  cursor: string | null,
  sort: PlazaSort,
): [number, string] | null {
  if (cursor === null) return null;
  try {
    if (cursor.length > 256 || !/^[A-Za-z0-9_-]+$/.test(cursor))
      throw new Error();
    const value: unknown = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    );
    if (
      !Array.isArray(value) ||
      value.length !== 3 ||
      value[0] !== sort ||
      !Number.isSafeInteger(value[1]) ||
      value[1] < 0 ||
      typeof value[2] !== 'string' ||
      !/^[a-f0-9-]{36}$/.test(value[2])
    )
      throw new Error();
    return [value[1], value[2]];
  } catch {
    throw new ListError('分页游标格式不正确');
  }
}
export class ListPlans {
  constructor(private readonly dialect: 'sqlite' | 'mysql') {}
  *countPlazaLists(viewer: string | null): ListPlan<number> {
    const [row] = yield statement(
      'SELECT COUNT(*) AS total FROM user_lists l INNER JOIN user_profiles p ON p.username = l.username WHERE l.item_count > 0 AND l.is_public >= ?',
      viewer === null ? VISIBILITY_LEVEL.everyone : VISIBILITY_LEVEL.members,
    );
    return Number(row.total);
  }
  *getListItemCount(
    id: string,
    viewer: string | null,
  ): ListPlan<number | null> {
    try {
      return Number((yield* this.row(id, viewer)).item_count);
    } catch (error) {
      if (error instanceof ListError && error.status === 404) return null;
      throw error;
    }
  }
  private *hasListLike(id: string, username: string): ListPlan<boolean> {
    const rows = yield statement(
      'SELECT list_id FROM list_likes WHERE list_id = ? AND username = ?',
      id,
      username,
    );
    return rows.length > 0;
  }
  private *recountLikes(id: string): ListPlan<void> {
    yield statement(
      'UPDATE user_lists SET like_count = (SELECT COUNT(*) FROM list_likes WHERE list_id = ?) WHERE id = ?',
      id,
      id,
    );
  }
  *setListLike(
    username: string,
    id: string,
    liked: boolean,
  ): ListPlan<ListLikeState> {
    username = normalizeUsername(username);
    const [profile] = yield statement(
      `SELECT username FROM user_profiles WHERE username = ?${this.dialect === 'mysql' ? ' FOR UPDATE' : ''}`,
      username,
    );
    if (!profile) listNotFound();
    const [row] = yield statement(
      `SELECT * FROM user_lists WHERE id = ?${this.dialect === 'mysql' ? ' FOR UPDATE' : ''}`,
      id,
    );
    if (
      !row ||
      (row.username !== username &&
        Number(row.is_public) < VISIBILITY_LEVEL.members)
    )
      listNotFound();
    if (row.username === username) throw new ListError('不能给自己点赞');
    if (liked) {
      const insert =
        this.dialect === 'sqlite' ? 'INSERT OR IGNORE' : 'INSERT IGNORE';
      yield statement(
        `${insert} INTO list_likes (list_id, username, created_at) VALUES (?, ?, ?)`,
        id,
        username,
        Date.now(),
      );
    } else
      yield statement(
        'DELETE FROM list_likes WHERE list_id = ? AND username = ?',
        id,
        username,
      );
    yield* this.recountLikes(id);
    const [updated] = yield statement(
      'SELECT * FROM user_lists WHERE id = ?',
      id,
    );
    return { liked, likeCount: Number(updated.like_count) };
  }
  *deleteUserLikes(username: string): ListPlan<void> {
    const affected = yield statement(
      `SELECT * FROM user_lists WHERE id IN (SELECT list_id FROM list_likes WHERE username = ?) OR username = ? ORDER BY id ASC${this.dialect === 'mysql' ? ' FOR UPDATE' : ''}`,
      username,
      username,
    );
    yield statement('DELETE FROM list_likes WHERE username = ?', username);
    yield statement(
      'DELETE FROM list_likes WHERE list_id IN (SELECT id FROM user_lists WHERE username = ?)',
      username,
    );
    for (const row of affected) yield* this.recountLikes(String(row.id));
  }
  *recordListView(id: string): ListPlan<void> {
    yield statement(
      'UPDATE user_lists SET view_count = view_count + 1 WHERE id = ?',
      id,
    );
  }
  *getPlazaLists(
    viewer: string | null,
    sort: PlazaSort,
    cursor: string | null,
  ): ListPlan<PlazaPage> {
    if (sort !== 'hot' && sort !== 'new') throw new ListError('排序方式不正确');
    const after = plazaCursor(cursor, sort);
    const order =
      sort === 'hot' ? '(l.view_count + l.like_count * 10)' : 'l.updated_at';
    const rows = yield statement(
      `SELECT l.*, p.profile_id, p.nickname, p.avatar_seed FROM user_lists l INNER JOIN user_profiles p ON p.username = l.username WHERE l.item_count > 0 AND l.is_public >= ?${after ? ` AND (${order} < ? OR (${order} = ? AND l.id > ?))` : ''} ORDER BY ${order} DESC, l.id ASC LIMIT ${PLAZA_PAGE_SIZE + 1}`,
      viewer === null ? VISIBILITY_LEVEL.everyone : VISIBILITY_LEVEL.members,
      ...(after ? [after[0], after[0], after[1]] : []),
    );
    const page = rows.slice(0, PLAZA_PAGE_SIZE);
    const items = yield* this.summaryItems(page);
    const last = page.at(-1);
    return {
      lists: page.map((row) => ({
        ...summary(
          row,
          items.filter((entry) => entry.list_id === row.id),
        ),
        owner: {
          profileId: String(row.profile_id),
          nickname: row.nickname === null ? null : String(row.nickname),
          avatarSeed: row.avatar_seed === null ? null : String(row.avatar_seed),
        },
      })),
      nextCursor:
        rows.length > PLAZA_PAGE_SIZE && last
          ? Buffer.from(
              JSON.stringify([
                sort,
                sort === 'hot'
                  ? Number(last.view_count) + Number(last.like_count) * 10
                  : Number(last.updated_at),
                last.id,
              ]),
            ).toString('base64url')
          : null,
    };
  }
  // viewer 为 null 表示游客，只能读取对所有人可见的片单
  private *row(
    id: string,
    viewer: string | null,
    write = false,
  ): ListPlan<ListRow> {
    if (write && this.dialect === 'mysql')
      yield statement(
        'SELECT username FROM user_profiles WHERE username = ? FOR UPDATE',
        normalizeUsername(viewer!),
      );
    const [row] = yield statement(
      `SELECT * FROM user_lists WHERE id = ?${write && this.dialect === 'mysql' ? ' FOR UPDATE' : ''}`,
      id,
    );
    const owned =
      viewer !== null && row?.username === normalizeUsername(viewer);
    const required = viewer === null ? 'everyone' : 'members';
    if (
      !row ||
      (!owned && (write || Number(row.is_public) < VISIBILITY_LEVEL[required]))
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
  private *summaryItems(rows: ListRow[], all = false): ListPlan<ListRow[]> {
    if (!rows.length) return [];
    const placeholders = rows.map(() => '?').join(',');
    return yield statement(
      all
        ? `SELECT * FROM user_list_items WHERE list_id IN (${placeholders}) ORDER BY position ASC, id ASC`
        : `SELECT * FROM (SELECT user_list_items.*, ROW_NUMBER() OVER (PARTITION BY list_id ORDER BY position ASC, id ASC) AS cover_rank FROM user_list_items WHERE list_id IN (${placeholders})) ranked WHERE cover_rank <= 4 ORDER BY position ASC, id ASC`,
      ...rows.map((row) => row.id),
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
      `SELECT * FROM user_lists WHERE username = ?${normalizeUsername(viewer) === normalizeUsername(username) ? '' : ` AND is_public >= ${VISIBILITY_LEVEL.members}`} ORDER BY updated_at DESC, id ASC`,
      normalizeUsername(username),
    );
    if (!rows.length) return [];
    const items = yield* this.summaryItems(rows, !!work);
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
    viewer: string | null,
  ): ListPlan<{
    list: ListSummary;
    username: string;
    items: ListItem[];
    liked: boolean;
  }> {
    const row = yield* this.row(id, viewer);
    const items = yield* this.items(id);
    return {
      list: summary(row, items),
      username: String(row.username),
      items: items.map(item),
      liked:
        viewer !== null &&
        (yield* this.hasListLike(id, normalizeUsername(viewer))),
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
      VISIBILITY_LEVEL[patch.visibility ?? 'private'],
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
      patch.visibility === undefined
        ? row.is_public
        : VISIBILITY_LEVEL[patch.visibility],
      id,
    );
    yield* this.touch(id);
    return yield* this.result(id, username);
  }
  *deleteList(username: string, id: string): ListPlan<void> {
    yield* this.row(id, username, true);
    yield statement('DELETE FROM list_likes WHERE list_id = ?', id);
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
