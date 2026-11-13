import type { CompletionSummary } from '@/features/play/lib/completion-types';
import { socialRequest } from '@/lib/profile.client';

export function fetchCompletion(source: string, id: string) {
  return socialRequest<CompletionSummary>(
    `/api/playrecords/completion?${new URLSearchParams({ source, id })}`,
  );
}

export function markCompletionCelebrated(source: string, id: string) {
  return socialRequest<{ ok: true }>('/api/playrecords/completion', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source, id }),
  });
}
