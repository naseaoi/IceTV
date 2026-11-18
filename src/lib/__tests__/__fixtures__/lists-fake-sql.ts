import type { ListRow } from '@/features/lists/lib/list-storage';

export interface ListFakeState {
  lists: ListRow[];
  listItems: ListRow[];
  listLikes: ListRow[];
}
export function queryLists(
  sql: string,
  params: unknown[],
  state: ListFakeState,
  profiles: ListRow[] = [],
): ListRow[] | undefined {
  if (sql.startsWith('SELECT l.*, p.profile_id')) {
    const score = (row: ListRow) =>
      sql.includes('l.like_count * 10')
        ? Number(row.view_count) + Number(row.like_count) * 10
        : Number(row.updated_at);
    return state.lists
      .filter(
        (row) =>
          Number(row.item_count) > 0 &&
          Number(row.is_public) >= Number(params[0]),
      )
      .flatMap((row): ListRow[] => {
        const profile = profiles.find(
          (entry) => entry.username === row.username,
        );
        return profile
          ? [
              {
                ...row,
                profile_id: profile.profile_id,
                nickname: profile.nickname,
                avatar_seed: profile.avatar_seed,
              },
            ]
          : [];
      })
      .filter(
        (row) =>
          params.length === 1 ||
          score(row) < Number(params[1]) ||
          (score(row) === Number(params[2]) &&
            String(row.id) > String(params[3])),
      )
      .sort(
        (a, b) =>
          score(b) - score(a) || String(a.id).localeCompare(String(b.id)),
      )
      .slice(0, 25);
  }
  if (sql.startsWith('SELECT list_id FROM list_likes'))
    return state.listLikes
      .filter((row) => row.list_id === params[0] && row.username === params[1])
      .map((row) => ({ ...row }));
  if (sql.startsWith('SELECT * FROM user_lists WHERE id IN'))
    return state.lists
      .filter(
        (row) =>
          row.username === params[1] ||
          state.listLikes.some(
            (like) => like.list_id === row.id && like.username === params[0],
          ),
      )
      .map((row) => ({ ...row }));
  if (sql.includes('ROW_NUMBER() OVER')) {
    const counts = new Map<string, number>();
    return state.listItems
      .filter((row) => params.includes(row.list_id))
      .sort(
        (a, b) =>
          Number(a.position) - Number(b.position) ||
          String(a.id).localeCompare(String(b.id)),
      )
      .filter((row) => {
        const key = String(row.list_id);
        const count = (counts.get(key) ?? 0) + 1;
        counts.set(key, count);
        return count <= 4;
      })
      .map((row) => ({ ...row }));
  }
  if (sql.startsWith('SELECT COUNT(*) AS total FROM user_lists l INNER JOIN'))
    return [
      {
        total: state.lists.filter(
          (row) =>
            Number(row.item_count) > 0 &&
            Number(row.is_public) >= Number(params[0]) &&
            profiles.some((profile) => profile.username === row.username),
        ).length,
      },
    ];
  if (sql.startsWith('SELECT COUNT(*) AS total FROM user_lists'))
    return [
      { total: state.lists.filter((row) => row.username === params[0]).length },
    ];
  if (sql.startsWith('SELECT * FROM user_lists')) {
    if (sql.includes('WHERE id ='))
      return state.lists
        .filter((row) => row.id === params[0])
        .map((row) => ({ ...row }));
    return state.lists
      .filter(
        (row) =>
          row.username === params[0] &&
          (!sql.includes('AND is_public >= 1') || Number(row.is_public) >= 1),
      )
      .sort(
        (a, b) =>
          Number(b.updated_at) - Number(a.updated_at) ||
          String(a.id).localeCompare(String(b.id)),
      )
      .map((row) => ({ ...row }));
  }
  if (sql.startsWith('SELECT * FROM user_list_items'))
    return state.listItems
      .filter((row) =>
        sql.includes('list_id IN')
          ? params.includes(row.list_id)
          : row.list_id === params[0],
      )
      .sort(
        (a, b) =>
          Number(a.position) - Number(b.position) ||
          String(a.id).localeCompare(String(b.id)),
      )
      .map((row) => ({ ...row }));
}
export function executeLists(
  sql: string,
  params: unknown[],
  state: ListFakeState,
): number | undefined {
  if (sql.startsWith('INSERT IGNORE INTO list_likes')) {
    if (
      state.listLikes.some(
        (row) => row.list_id === params[0] && row.username === params[1],
      )
    )
      return 0;
    state.listLikes.push({
      list_id: String(params[0]),
      username: String(params[1]),
      created_at: Number(params[2]),
    });
    return 1;
  }
  if (sql.startsWith('DELETE FROM list_likes')) {
    const before = state.listLikes.length;
    state.listLikes = state.listLikes.filter((row) => {
      if (sql.includes('SELECT id FROM user_lists'))
        return !state.lists.some(
          (list) => list.id === row.list_id && list.username === params[0],
        );
      if (sql.includes('WHERE username =')) return row.username !== params[0];
      return (
        row.list_id !== params[0] ||
        (sql.includes('AND username =') && row.username !== params[1])
      );
    });
    return before - state.listLikes.length;
  }
  if (sql.startsWith('UPDATE user_lists SET like_count')) {
    const row = state.lists.find((entry) => entry.id === params[1]);
    if (row)
      row.like_count = state.listLikes.filter(
        (like) => like.list_id === params[0],
      ).length;
    return row ? 1 : 0;
  }
  const insert = sql.match(
    /^INSERT INTO (user_lists|user_list_items) \(([^)]+)\)/,
  );
  if (insert) {
    const columns = insert[2].split(', ');
    const row = Object.fromEntries(
      columns.map((column, index) => [column, params[index]]),
    ) as ListRow;
    const rows = insert[1] === 'user_lists' ? state.lists : state.listItems;
    if (
      rows.some(
        (entry) =>
          entry.id === row.id ||
          (insert[1] === 'user_list_items' &&
            entry.list_id === row.list_id &&
            entry.title_norm === row.title_norm &&
            entry.year === row.year),
      )
    )
      throw new Error('duplicate list key');
    if (insert[1] === 'user_lists') {
      row.view_count ??= 0;
      row.like_count ??= 0;
    }
    rows.push(row);
    return 1;
  }
  if (sql.startsWith('DELETE FROM user_list_items')) {
    const before = state.listItems.length;
    if (sql.includes('SELECT id FROM user_lists')) {
      const ids = new Set(
        state.lists
          .filter((row) => row.username === params[0])
          .map((row) => row.id),
      );
      state.listItems = state.listItems.filter((row) => !ids.has(row.list_id));
    } else
      state.listItems = state.listItems.filter(
        (row) =>
          row.list_id !== params[0] ||
          (sql.includes('AND id =') && row.id !== params[1]),
      );
    return before - state.listItems.length;
  }
  if (sql.startsWith('DELETE FROM user_lists')) {
    const before = state.lists.length;
    state.lists = state.lists.filter(
      (row) =>
        row[sql.includes('WHERE username') ? 'username' : 'id'] !== params[0],
    );
    return before - state.lists.length;
  }
  if (
    sql === 'UPDATE user_lists SET view_count = view_count + 1 WHERE id = ?'
  ) {
    const row = state.lists.find((entry) => entry.id === params[0]);
    if (row) row.view_count = Number(row.view_count) + 1;
    return row ? 1 : 0;
  }
  if (sql.startsWith('UPDATE user_lists SET item_count')) {
    const row = state.lists.find((entry) => entry.id === params[2]);
    if (row) {
      row.item_count = state.listItems.filter(
        (entry) => entry.list_id === params[0],
      ).length;
      row.version = Number(row.version) + 1;
      row.updated_at = Number(params[1]);
    }
    return row ? 1 : 0;
  }
  if (sql.startsWith('UPDATE user_lists SET name')) {
    const row = state.lists.find((entry) => entry.id === params[3]);
    if (row)
      Object.assign(row, {
        name: params[0],
        description: params[1],
        is_public: params[2],
      });
    return row ? 1 : 0;
  }
  if (sql.startsWith('UPDATE user_list_items SET position')) {
    const row = state.listItems.find(
      (entry) => entry.list_id === params[1] && entry.id === params[2],
    );
    if (row) row.position = Number(params[0]);
    return row ? 1 : 0;
  }
}
