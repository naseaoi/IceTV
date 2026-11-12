import type { ListRow } from '@/features/lists/lib/list-storage';

export interface ListFakeState {
  lists: ListRow[];
  listItems: ListRow[];
}
export function queryLists(
  sql: string,
  params: unknown[],
  state: ListFakeState,
): ListRow[] | undefined {
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
          (!sql.includes('AND is_public = 1') || row.is_public === 1),
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
