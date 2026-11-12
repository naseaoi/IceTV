import type { PublicUserRef } from '@/lib/types';

export interface ListSummary {
  id: string;
  name: string;
  description: string;
  isPublic: boolean;
  itemCount: number;
  covers: string[];
  version: number;
  updatedAt: number;
  contains?: boolean;
  containsItemId?: string | null;
}

export interface ListItem {
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

export interface ListDetail {
  list: ListSummary;
  owner: PublicUserRef;
  isOwner: boolean;
  items: ListItem[];
}

export interface ListPatch {
  name?: string;
  description?: string;
  isPublic?: boolean;
}

export interface CreateListInput extends ListPatch {
  name: string;
  item?: ListItemInput;
}
