import type { VideoReview } from '@/lib/types';

type Row = Record<string, any>;
export type SocialFakeState = {
  social: Record<string, Row[]>;
  users: Map<string, string>;
  videoReviews: Map<string, { username: string; review: VideoReview }>;
};

export function executeSocial(
  sql: string,
  params: unknown[],
  state: SocialFakeState,
): number | undefined {
  const table =
    /(?:INTO|UPDATE|FROM) (user_profiles|user_follows|video_review_likes|video_review_reports)\b/.exec(
      sql,
    )?.[1];
  if (!table || sql.startsWith('SELECT')) return undefined;
  const rows = state.social[table];
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

export function querySocial(
  sql: string,
  params: unknown[],
  state: SocialFakeState,
): Row[] | undefined {
  if (sql.startsWith('SHOW COLUMNS FROM user_profiles'))
    return [{ Field: 'avatar_seed' }];
  const profiles = state.social.user_profiles;
  const follows = state.social.user_follows;
  const likes = state.social.video_review_likes;
  const reports = state.social.video_review_reports;
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
  if (sql.includes('FROM user_follows f JOIN video_reviews'))
    return follows
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
  if (sql.includes('FROM user_follows')) {
    if (sql.includes('JOIN user_profiles')) {
      const followers = sql.includes('f.followee = ?');
      return follows
        .filter((row) => row[followers ? 'followee' : 'follower'] === params[0])
        .flatMap((row) => {
          const p = profiles.find(
            (p) => p.username === row[followers ? 'follower' : 'followee'],
          );
          return p ? [{ ...p, created_at: row.created_at }] : [];
        });
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
