import {
  PROFILE_REQUIRED_EVENT,
  setFollowing,
  updateProfile,
} from '@/lib/profile.client';
import {
  reportVideoReview,
  saveVideoReview,
  setReviewLiked,
} from '@/lib/video-reviews.client';

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});
it('社交写操作遇到缺少昵称时触发统一会话刷新事件', async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: false,
    status: 403,
    json: async () => ({ code: 'NICKNAME_REQUIRED', error: '请先设置昵称' }),
  });
  const listener = jest.fn();
  window.addEventListener(PROFILE_REQUIRED_EVENT, listener);
  const target = {
    profileId: 'profileAlice',
    title_norm: '三体',
    year: '2023',
  };
  try {
    await expect(setFollowing(target.profileId, true)).rejects.toThrow(
      '请先设置昵称',
    );
    await expect(setReviewLiked(target, true)).rejects.toThrow('请先设置昵称');
    await expect(reportVideoReview(target, 'spam', '')).rejects.toThrow(
      '请先设置昵称',
    );
    await expect(
      saveVideoReview({
        title: '三体',
        year: '2023',
        cover: '',
        douban_id: 0,
        rating: 8,
        content: '',
        is_public: true,
        spoiler: true,
        source_key: 'a+1',
      }),
    ).rejects.toThrow('请先设置昵称');
    expect(listener).toHaveBeenCalledTimes(4);
  } finally {
    window.removeEventListener(PROFILE_REQUIRED_EVENT, listener);
  }
});
it('资料接口保留可展示的昵称冲突错误', async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: false,
    status: 409,
    json: async () => ({ error: '昵称已被使用' }),
  });
  await expect(updateProfile({ nickname: '光影旅人' })).rejects.toThrow(
    '昵称已被使用',
  );
});
it('取消点赞查询参数安全编码作品身份', async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ liked: false, likeCount: 1 }),
  });
  await setReviewLiked(
    { profileId: 'profileAlice', title_norm: '甲&乙', year: '' },
    false,
  );
  expect(global.fetch).toHaveBeenCalledWith(
    '/api/reviews/likes?profileId=profileAlice&title_norm=%E7%94%B2%26%E4%B9%99&year=',
    expect.objectContaining({ method: 'DELETE' }),
  );
});
