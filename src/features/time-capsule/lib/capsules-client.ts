import type {
  CapsuleInput,
  CapsulePage,
  DeliveredCapsule,
  PendingCapsule,
} from '@/features/time-capsule/types';
import { socialRequest } from '@/lib/profile.client';

export const CAPSULES_UPDATED_EVENT = 'capsulesUpdated';

function notifyUpdated() {
  window.dispatchEvent(new Event(CAPSULES_UPDATED_EVENT));
}

export function fetchCapsules(cursor?: string | null, signal?: AbortSignal) {
  const query = cursor ? `?${new URLSearchParams({ cursor })}` : '';
  return socialRequest<CapsulePage>(`/api/capsules${query}`, { signal });
}

export async function createCapsule(input: CapsuleInput) {
  const created = await socialRequest<PendingCapsule>('/api/capsules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  notifyUpdated();
  return created;
}

export async function deleteCapsule(id: string) {
  await socialRequest<unknown>(`/api/capsules/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  notifyUpdated();
}

export async function openCapsule(id: string) {
  const opened = await socialRequest<DeliveredCapsule>(
    `/api/capsules/${encodeURIComponent(id)}/open`,
    { method: 'POST' },
  );
  notifyUpdated();
  return opened;
}

export const CAPSULE_DELIVERY_PRESETS = [
  { months: 1, label: '1 个月后' },
  { months: 3, label: '3 个月后' },
  { months: 6, label: '半年后' },
  { months: 12, label: '1 年后' },
] as const;

// 送达统一落在当地上午 9 点，打开站点时信已经到了
const DELIVERY_HOUR = 9;

export function presetDeliverAt(months: number, now = new Date()) {
  const date = new Date(now);
  const day = date.getDate();
  date.setDate(1);
  date.setMonth(date.getMonth() + months);
  const lastDay = new Date(
    date.getFullYear(),
    date.getMonth() + 1,
    0,
  ).getDate();
  date.setDate(Math.min(day, lastDay));
  date.setHours(DELIVERY_HOUR, 0, 0, 0);
  return date.getTime();
}

// 日期输入值 yyyy-mm-dd → 当地上午 9 点
export function dateInputDeliverAt(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    DELIVERY_HOUR,
  );
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

export function toDateInputValue(timestamp: number) {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function formatDeliveryDate(timestamp: number) {
  const date = new Date(timestamp);
  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}
