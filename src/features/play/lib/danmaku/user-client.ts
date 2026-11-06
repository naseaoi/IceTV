import type {
  UserDanmakuItem,
  UserDanmakuListResponse,
  UserDanmakuSendInput,
} from '@/lib/user-danmaku';

const ENDPOINT = '/api/danmaku/user';
// 发送成功后派发，detail 为归属键，供选集面板刷新“我发送的弹幕”
export const USER_DANMAKU_SENT_EVENT = 'icetv:user-danmaku-sent';

async function readError(response: Response, fallback: string) {
  const payload = await response.json().catch(() => null);
  return typeof payload?.error === 'string' && payload.error
    ? payload.error
    : fallback;
}

export async function fetchUserDanmaku(
  key: string,
): Promise<UserDanmakuListResponse> {
  const response = await fetch(`${ENDPOINT}?key=${encodeURIComponent(key)}`, {
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`用户弹幕请求失败: ${response.status}`);
  const payload = (await response.json()) as Partial<UserDanmakuListResponse>;
  return {
    items: Array.isArray(payload.items) ? payload.items : [],
    limit: typeof payload.limit === 'number' ? payload.limit : 0,
  };
}

export async function sendUserDanmaku(
  input: UserDanmakuSendInput,
): Promise<UserDanmakuItem> {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(await readError(response, '发送失败'));
  const payload = (await response.json()) as { item: UserDanmakuItem };
  window.dispatchEvent(
    new CustomEvent(USER_DANMAKU_SENT_EVENT, { detail: input.key }),
  );
  return payload.item;
}

export async function deleteUserDanmaku(id: string): Promise<void> {
  const response = await fetch(`${ENDPOINT}?id=${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!response.ok) throw new Error(await readError(response, '删除失败'));
}
