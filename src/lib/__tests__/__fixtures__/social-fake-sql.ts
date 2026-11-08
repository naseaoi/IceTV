import type { VideoReview } from '@/lib/types';

type Row = Record<string, any>;
export type SocialFakeState = {
  social: Record<string, Row[]>;
  users: Map<string, string>;
  userAccess: Map<string, Row>;
  videoReviews: Map<string, { username: string; review: VideoReview }>;
};

export function executeSocial(
  sql: string,
  params: unknown[],
  state: SocialFakeState,
): number | undefined {
  const table =
    /(?:INTO|UPDATE|FROM) (user_profiles|user_follows|video_review_likes|video_review_reports|video_review_replies|video_review_reply_reports)\b/.exec(
      sql,
    )?.[1];
  if (!table || sql.startsWith('SELECT')) return undefined;
  const rows = state.social[table];
  if (
    table === 'video_review_replies' ||
    table === 'video_review_reply_reports'
  ) {
    // 此 fake 仅覆盖无回复的旧契约；回复行为由 SQLite 与真实 MySQL 共用契约验证。
    if (
      rows.length === 0 &&
      (sql.startsWith('DELETE') || sql.startsWith('UPDATE'))
    )
      return 0;
  }
  if (sql.startsWith('DELETE')) {
    const before = rows.length;
    state.social[table] = rows.filter((row) => {
      if (!sql.includes(' WHERE ')) return false;
      if (table === 'user_profiles') return row.username !== params[0];
      if (sql.includes(' OR '))
        return (
          row[table === 'user_follows' ? 'follower' : 'author'] !== params[0] &&
          row[
            table === 'user_follows'
              ? 'followee'
              : table === 'video_review_likes'
                ? 'liker'
                : 'reporter'
          ] !== params[1]
        );
      if (table === 'user_follows')
        return row.follower !== params[0] || row.followee !== params[1];
      return (
        row.author !== params[0] ||
        row.title_norm !== params[1] ||
        row.year !== params[2] ||
        (params.length > 3 && row.liker !== params[3])
      );
    });
    return before - state.social[table].length;
  }
  if (sql.startsWith('UPDATE user_profiles')) {
    const row = rows.find((row) => row.username === params[params.length - 1]);
    if (!row) return 0;
    let index = 0;
    for (const column of [
      'nickname',
      'nickname_norm',
      'avatar_seed',
      'favorites_public',
      'updated_at',
    ]) {
      if (sql.includes(`${column} = ?`)) {
        const value = params[index++];
        if (
          column === 'nickname_norm' &&
          rows.some((other) => other !== row && other.nickname_norm === value)
        )
          throw Object.assign(new Error('duplicate nickname'), {
            code: 'ER_DUP_ENTRY',
          });
        row[column] = value;
      }
    }
    return 1;
  }
  if (sql.startsWith('INSERT')) {
    let row: Row;
    if (table === 'user_profiles') {
      row = {
        username: params[0],
        profile_id: params[1],
        nickname: params.length === 3 ? null : params[2],
        nickname_norm: params.length === 3 ? null : params[3],
        avatar_seed: params.length === 3 ? null : params[4],
        favorites_public: params.length === 3 ? 0 : params[5],
        updated_at: params[params.length - 1],
      };
      if (
        rows.some(
          (other) =>
            other.username === row.username ||
            other.profile_id === row.profile_id,
        )
      )
        return 0;
    } else if (table === 'user_follows') {
      row = sql.includes('SELECT')
        ? { follower: params[0], followee: params[2], created_at: params[1] }
        : { follower: params[0], followee: params[1], created_at: params[2] };
      if (
        sql.includes('SELECT') &&
        !state.social.user_profiles.some((p) => p.username === row.followee)
      )
        return 0;
    } else {
      const report = table === 'video_review_reports';
      const selecting = sql.includes('SELECT');
      const offset = report ? 4 : 2;
      const target = selecting
        ? params.slice(offset, offset + 3)
        : params.slice(0, 3);
      if (
        selecting &&
        !state.videoReviews.get(JSON.stringify(target))?.review.is_public
      )
        return 0;
      row = {
        author: target[0],
        title_norm: target[1],
        year: target[2],
        [report ? 'reporter' : 'liker']: selecting ? params[0] : params[3],
        created_at: selecting ? params[offset - 1] : params[report ? 6 : 4],
      };
      if (report) {
        row.reason = params[selecting ? 1 : 4];
        row.detail = params[selecting ? 2 : 5];
      }
    }
    const keys =
      table === 'user_profiles'
        ? ['username']
        : table === 'user_follows'
          ? ['follower', 'followee']
          : [
              'author',
              'title_norm',
              'year',
              table === 'video_review_likes' ? 'liker' : 'reporter',
            ];
    const existing = rows.find((other) =>
      keys.every((key) => row[key] === other[key]),
    );
    if (existing) {
      if (table === 'video_review_reports') Object.assign(existing, row);
      return 1;
    }
    rows.push(row);
    return 1;
  }
  return undefined;
}

function compareTuple(a: string[], b: string[]): number {
  for (let i = 0; i < a.length; i++) {
    const compared = Buffer.compare(Buffer.from(a[i]), Buffer.from(b[i]));
    if (compared) return compared;
  }
  return 0;
}

export function querySocial(
  sql: string,
  params: unknown[],
  state: SocialFakeState,
): Row[] | undefined {
  if (
    sql.startsWith('SHOW INDEX FROM user_follows') ||
    sql.startsWith('SHOW INDEX FROM video_review_likes')
  )
    return [
      { Key_name: 'idx_follow_notifications' },
      { Key_name: 'idx_like_notifications' },
    ];
  if (sql.startsWith('SHOW COLUMNS FROM user_profiles'))
    return [{ Field: 'avatar_seed' }];
  if (
    sql.startsWith('SELECT username, role FROM user_access WHERE username IN')
  )
    return params.flatMap((username) => {
      const row = state.userAccess.get(String(username));
      return row ? [{ username: row.username, role: row.role }] : [];
    });
  const profiles = state.social.user_profiles;
  if (
    sql.startsWith(
      'SELECT v.username, v.review_json FROM video_reviews v JOIN user_profiles p',
    )
  )
    return [...state.videoReviews.values()]
      .filter(
        ({ username, review }) =>
          profiles.some(
            (profile) =>
              profile.username === username && profile.profile_id === params[0],
          ) &&
          review.title_norm === params[1] &&
          review.year === params[2] &&
          review.is_public,
      )
      .map(({ username, review }) => ({
        username,
        review_json: JSON.stringify(review),
      }));
  const follows = state.social.user_follows;
  const likes = state.social.video_review_likes;
  const reports = state.social.video_review_reports;
  const identity = (row: Row): string[] => [
    row.author,
    row.title_norm,
    row.year,
  ];
  const targetMatches = (row: Row) => {
    for (let i = 0; i < params.length; i += 3)
      if (compareTuple(identity(row), params.slice(i, i + 3).map(String)) === 0)
        return true;
    return false;
  };
  if (sql.includes('latest_reported_at') || sql.includes(') pending')) {
    const grouped = new Map<string, Row>();
    for (const report of reports) {
      const review = state.videoReviews.get(JSON.stringify(identity(report)));
      if (!review?.review.is_public) continue;
      const key = JSON.stringify(identity(report));
      let row = grouped.get(key);
      if (!row) {
        row = {
          ...report,
          kind: 'review',
          reply_id: '',
          username: review.username,
          review_json: JSON.stringify(review.review),
          ...profiles.find((profile) => profile.username === review.username),
          report_count: 0,
          latest_reported_at: 0,
          spoiler: 0,
          abuse: 0,
          spam: 0,
          illegal: 0,
          other: 0,
        };
        grouped.set(key, row);
      }
      row.report_count++;
      row[report.reason]++;
      row.latest_reported_at = Math.max(
        row.latest_reported_at,
        report.created_at,
      );
    }
    if (sql.includes(') pending')) return [{ count: grouped.size }];
    return [...grouped.values()]
      .filter(
        (row) =>
          !params.length ||
          row.latest_reported_at < Number(params[0]) ||
          (row.latest_reported_at === Number(params[0]) &&
            compareTuple(
              ['review', ...identity(row), ''],
              params.slice(2).map(String),
            ) < 0),
      )
      .sort(
        (a, b) =>
          b.latest_reported_at - a.latest_reported_at ||
          -compareTuple(identity(a), identity(b)),
      )
      .slice(0, 31);
  }
  if (
    sql.startsWith(
      'SELECT r.*, p.profile_id, p.nickname, p.avatar_seed FROM video_review_reports',
    )
  ) {
    return reports
      .filter(targetMatches)
      .sort(
        (a, b) =>
          b.created_at - a.created_at ||
          -compareTuple([a.reporter], [b.reporter]),
      )
      .slice(0, 5)
      .map((row) => ({
        ...row,
        ...profiles.find((profile) => profile.username === row.reporter),
      }));
  }
  if (sql.includes('FROM video_review_replies') && !sql.includes('UNION ALL')) {
    if (state.social.video_review_replies.length === 0)
      return sql.startsWith('SELECT COUNT') ? [{ count: 0 }] : [];
  }
  if (
    sql.includes('FROM video_review_reply_reports') &&
    !sql.includes('UNION ALL')
  ) {
    if (state.social.video_review_reply_reports.length === 0) return [];
  }
  if (sql.includes('ROW_NUMBER()')) {
    const counts = new Map<string, number>();
    return reports
      .filter(targetMatches)
      .sort(
        (a, b) =>
          b.created_at - a.created_at ||
          -compareTuple([a.reporter], [b.reporter]),
      )
      .filter((row) => {
        const key = JSON.stringify(identity(row));
        const count = (counts.get(key) ?? 0) + 1;
        counts.set(key, count);
        return count <= 5;
      })
      .map((row) => ({
        ...row,
        ...profiles.find((profile) => profile.username === row.reporter),
      }));
  }
  if (
    sql.includes('FROM video_review_likes') &&
    sql.includes('GROUP BY author')
  ) {
    const counts = new Map<string, Row>();
    for (const row of likes.filter(targetMatches)) {
      const key = JSON.stringify(identity(row));
      const group = counts.get(key) ?? { ...row, count: 0 };
      group.count++;
      counts.set(key, group);
    }
    return [...counts.values()];
  }
  if (sql.includes('LEFT JOIN user_profiles'))
    return [...state.users.keys()]
      .filter((username) => !profiles.some((row) => row.username === username))
      .map((username) => ({ username }));
  if (sql.includes('AS followers'))
    return [
      {
        followers: follows.filter((row) => row.followee === params[0]).length,
        following: follows.filter((row) => row.follower === params[1]).length,
        reviews: [...state.videoReviews.values()].filter(
          (row) => row.username === params[2] && row.review.is_public,
        ).length,
        followed: follows.filter(
          (row) => row.follower === params[3] && row.followee === params[4],
        ).length,
      },
    ];
  if (sql.includes('FROM user_profiles')) {
    if (sql.includes('nickname_norm = ?'))
      return profiles.filter(
        (row) =>
          row.nickname_norm === params[0] &&
          (params.length < 2 || row.username !== params[1]),
      );
    return profiles.filter(
      (row) =>
        row[sql.includes('profile_id = ?') ? 'profile_id' : 'username'] ===
        params[0],
    );
  }
  if (sql.includes('FROM user_follows f JOIN video_reviews')) {
    let rows = follows
      .filter((row) => row.follower === params[0])
      .flatMap((f) =>
        [...state.videoReviews.values()]
          .filter(
            (row) =>
              row.username === f.followee &&
              row.review.is_public &&
              row.review.updated_at > f.created_at &&
              row.review.updated_at > Number(params[1]),
          )
          .flatMap((row) => {
            const p = profiles.find((p) => p.username === row.username);
            return p
              ? [
                  {
                    ...row.review,
                    username: row.username,
                    review_json: JSON.stringify(row.review),
                    profile_id: p.profile_id,
                    nickname: p.nickname,
                    avatar_seed: p.avatar_seed,
                  },
                ]
              : [];
          }),
      );
    let offset = 2;
    for (let i = 0; i < (sql.match(/AND NOT/g) ?? []).length; i++) {
      const target = params.slice(offset, offset + 4);
      rows = rows.filter(
        (row) =>
          ![row.profile_id, row.title_norm, row.year, row.updated_at].every(
            (part, index) => part === target[index],
          ),
      );
      offset += 4;
    }
    if (sql.includes(' AND p.profile_id = ?')) {
      const target = params.slice(offset, offset + 4);
      rows = rows.filter((row) =>
        [row.profile_id, row.title_norm, row.year, row.updated_at].every(
          (part, index) => part === target[index],
        ),
      );
      offset += 4;
    }
    if (sql.includes('AND (v.updated_at < ?')) {
      const time = Number(params[offset]);
      const target = params.slice(offset + 2, offset + 5).map(String);
      rows = rows.filter(
        (row) =>
          row.updated_at < time ||
          (row.updated_at === time &&
            compareTuple([row.profile_id, row.title_norm, row.year], target) <
              0),
      );
    } else if (sql.includes(' AND v.updated_at <= ?'))
      rows = rows.filter((row) => row.updated_at <= Number(params[offset]));
    else if (sql.includes(' AND v.updated_at < ?'))
      rows = rows.filter((row) => row.updated_at < Number(params[offset]));
    if (sql.startsWith('SELECT COUNT(*)')) return [{ count: rows.length }];
    return rows
      .sort(
        (a, b) =>
          b.updated_at - a.updated_at ||
          -compareTuple(
            [a.profile_id, a.title_norm, a.year],
            [b.profile_id, b.title_norm, b.year],
          ),
      )
      .slice(0, Number(params.at(-1)));
  }
  if (sql.includes('FROM user_follows')) {
    if (sql.includes('JOIN user_profiles')) {
      const followers = sql.includes('f.followee = ?');
      return follows
        .filter((row) => row[followers ? 'followee' : 'follower'] === params[0])
        .flatMap((row): Row[] => {
          const p = profiles.find(
            (p) => p.username === row[followers ? 'follower' : 'followee'],
          );
          return p ? [{ ...p, created_at: row.created_at }] : [];
        })
        .filter(
          (row) =>
            params.length === 2 ||
            row.created_at < Number(params[1]) ||
            (row.created_at === Number(params[1]) &&
              row.profile_id < String(params[3])),
        )
        .sort(
          (a, b) =>
            b.created_at - a.created_at ||
            (a.profile_id < b.profile_id ? 1 : -1),
        )
        .slice(0, Number(params.at(-1)));
    }
    const rows = follows.filter(
      (row) =>
        row[sql.includes('WHERE followee') ? 'followee' : 'follower'] ===
        params[0],
    );
    return sql.includes('COUNT(*)')
      ? [{ count: rows.length }]
      : rows.map(({ followee, created_at }) => ({ followee, created_at }));
  }
  if (sql.includes('FROM video_review_likes')) {
    if (sql.includes('WHERE liker'))
      return likes
        .filter((row) => row.liker === params[0])
        .map(({ author, title_norm, year, created_at }) => ({
          author,
          title_norm,
          year,
          created_at,
        }));
    const offset = sql.includes('SUM(') ? 1 : 0;
    const rows = likes.filter(
      (row) =>
        row.author === params[offset] &&
        row.title_norm === params[offset + 1] &&
        row.year === params[offset + 2],
    );
    return [
      {
        count: rows.length,
        liked: rows.filter((row) => row.liker === params[0]).length,
      },
    ];
  }
  if (sql.includes('FROM video_review_reports')) {
    if (sql.includes('JOIN video_reviews'))
      return reports
        .flatMap<Row>((row) => {
          const v = state.videoReviews.get(
            JSON.stringify([row.author, row.title_norm, row.year]),
          );
          return v?.review.is_public
            ? [
                {
                  ...row,
                  username: v.username,
                  review_json: JSON.stringify(v.review),
                },
              ]
            : [];
        })
        .sort((a, b) => b.created_at - a.created_at);
    return reports
      .filter((row) => row.reporter === params[0])
      .map(({ author, title_norm, year, reason, detail, created_at }) => ({
        author,
        title_norm,
        year,
        reason,
        detail,
        created_at,
      }));
  }
  return undefined;
}
