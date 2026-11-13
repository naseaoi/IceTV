export const CAPSULE_CONTENT_MAX_LENGTH = 500;
export const CAPSULE_PENDING_MAX_COUNT = 100;
export const CAPSULE_MIN_DELAY_MS = 60 * 60 * 1000;
export const CAPSULE_MAX_DELAY_MS = 5 * 365 * 24 * 60 * 60 * 1000;

export interface PendingCapsule {
  id: string;
  title: string;
  year: string;
  cover: string;
  createdAt: number;
  deliverAt: number;
}

export interface DeliveredCapsule extends PendingCapsule {
  source: string;
  videoId: string;
  content: string;
  ratingThen: number | null;
  ratingNow: number | null;
  openedAt: number | null;
}

export interface CapsuleInput {
  title: string;
  year: string;
  cover: string;
  source: string;
  videoId: string;
  content: string;
  deliverAt: number;
}

export interface CapsulePage {
  pending: PendingCapsule[];
  delivered: DeliveredCapsule[];
  nextCursor: string | null;
}

export interface TimeCapsuleUserMessage extends Omit<
  DeliveredCapsule,
  'createdAt'
> {
  type: 'time-capsule';
  capsuleId: string;
  writtenAt: number;
  createdAt: number;
}
