import type { IStorage, SiteAnnouncement } from '@/lib/types';

export interface AnnouncementRow {
  id: string;
  content: string;
  created_at: number | string;
  updated_at: number | string;
  published_at: number | string | null;
}

export function readAnnouncement(row: AnnouncementRow): SiteAnnouncement {
  return {
    id: row.id,
    content: row.content,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    publishedAt: row.published_at === null ? null : Number(row.published_at),
  };
}

export const ANNOUNCEMENT_LIST_SQL = `SELECT * FROM announcements
  ORDER BY (published_at IS NULL) DESC,
    CASE WHEN published_at IS NULL THEN created_at ELSE published_at END DESC,
    id DESC LIMIT ?`;

export const ANNOUNCEMENT_INSERT_SQL = `INSERT INTO announcements
  (id, content, created_at, updated_at, published_at) VALUES (?, ?, ?, ?, ?)`;

export function publishedAnnouncementQuery(
  options: Parameters<IStorage['getPublishedAnnouncements']>[0],
) {
  const predicates = ['published_at IS NOT NULL'];
  const params: (number | string)[] = [];
  if (options.since !== undefined) {
    predicates.push('published_at > ?');
    params.push(options.since);
  }
  if (options.before) {
    predicates.push('(published_at < ? OR (published_at = ? AND id < ?))');
    params.push(
      options.before.publishedAt,
      options.before.publishedAt,
      options.before.id,
    );
  }
  params.push(options.limit);
  return {
    sql: `SELECT * FROM announcements WHERE ${predicates.join(' AND ')} ORDER BY published_at DESC, id DESC LIMIT ?`,
    params,
  };
}

export function announcementUpdateQuery(
  id: string,
  patch: Parameters<IStorage['updateAnnouncement']>[1],
) {
  const fields = ['updated_at = ?'];
  const params: (string | number | null)[] = [patch.updatedAt];
  if (patch.content !== undefined) {
    fields.push('content = ?');
    params.push(patch.content);
  }
  if (patch.publishedAt !== undefined) {
    fields.push('published_at = ?');
    params.push(patch.publishedAt);
  }
  params.push(id);
  return {
    sql: `UPDATE announcements SET ${fields.join(', ')} WHERE id = ?`,
    params,
  };
}
