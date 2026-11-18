import type { FavoriteWatchStatus, PublicUserRef } from '@/lib/types';

// members 仅登录用户可见；everyone 含游客，可凭链接查看
export type ListVisibility = 'private' | 'members' | 'everyone';

export interface ListSummary {
  id: string;
  name: string;
  description: string;
  visibility: ListVisibility;
  itemCount: number;
  viewCount: number;
  likeCount: number;
  covers: string[];
  version: number;
  updatedAt: number;
  contains?: boolean;
  containsItemId?: string | null;
}

export type PlazaSort = 'hot' | 'new';
export const PLAZA_PAGE_SIZE = 24;

export interface PlazaListSummary extends ListSummary {
  owner: PublicUserRef;
}

export interface PlazaPage {
  lists: PlazaListSummary[];
  nextCursor: string | null;
}

export interface ListLikeState {
  liked: boolean;
  likeCount: number;
}

export interface ListItem {
  viewerStatus?: FavoriteWatchStatus | null;
  id: string;
  title: string;
  year: string;
  cover: string;
  source: string;
  sourceId: string | null;
  searchTitle: string;
  addedAt: number;
}

export interface ListItemInput {
  title: string;
  year: string;
  cover: string;
  source: string;
  id: string | null;
  searchTitle?: string;
}

export interface ListViewerProgress {
  completed: number;
  total: number;
  nextItemId: string | null;
}

export interface ListDetail {
  viewerProgress?: ListViewerProgress;
  list: ListSummary;
  owner: PublicUserRef;
  isOwner: boolean;
  // 游客恒为 false
  liked: boolean;
  items: ListItem[];
}

export interface ListPatch {
  name?: string;
  description?: string;
  visibility?: ListVisibility;
}

export interface CreateListInput extends ListPatch {
  name: string;
  item?: ListItemInput;
}
