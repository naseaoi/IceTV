import type { TrackingCalendarItem } from '@/features/continue-watching/lib/tracking-calendar';
import { socialRequest } from '@/lib/profile.client';

export async function fetchTrackingCalendar(
  signal?: AbortSignal,
): Promise<TrackingCalendarItem[]> {
  const data = await socialRequest<{ items?: TrackingCalendarItem[] }>(
    '/api/tracking/calendar',
    { cache: 'no-store', signal },
  );
  return Array.isArray(data.items) ? data.items : [];
}
