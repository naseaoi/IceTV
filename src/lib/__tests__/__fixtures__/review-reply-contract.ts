import { videoReview } from '@/lib/__tests__/__fixtures__/video-review-contract';
import { replyMessageId } from '@/lib/review-reply-storage';
import type { IStorage } from '@/lib/types';

async function assertReplyAuthorRoles(storage: IStorage, prefix: string) {
  const owner = `${prefix}-role-owner`;
  const admin = `${prefix}-role-admin`;
  const user = `${prefix}-role-user`;
  const missing = `${prefix}-role-missing`;
  const previousOwner = process.env.ICETV_USERNAME;
  try {
    for (const username of [owner, admin, user])
      await storage.registerUser(username, 'test-password');
    await storage.updateUserAccess([admin], { role: 'admin' });
    process.env.ICETV_USERNAME = ` ${owner.toUpperCase()} `;
    await storage.ensureUserProfile(missing);
    await storage.setVideoReview(owner, videoReview);
    const target = [owner, videoReview.title_norm, videoReview.year] as const;
    const first = await storage.postReviewReply(...target, owner, '站长回复');
    expect(first?.author.role).toBe('owner');
    const second = await storage.postReviewReply(
      ...target,
      admin,
      '管理员回复',
      first!.id,
    );
    expect(second?.author.role).toBe('admin');
    expect(second?.replyTo).not.toHaveProperty('role');
    const third = await storage.postReviewReply(
      ...target,
      user,
      '普通用户回复',
    );
    expect(third?.author).not.toHaveProperty('role');
    const fourth = await storage.postReviewReply(
      ...target,
      missing,
      '无权限记录回复',
    );
    expect(fourth?.author).not.toHaveProperty('role');
    const page = await storage.getReviewReplies(...target, user);
    expect(page.items).toHaveLength(4);
    for (const reply of page.items) {
      if (reply.id === first!.id) expect(reply.author.role).toBe('owner');
      else if (reply.id === second!.id) expect(reply.author.role).toBe('admin');
      else expect(reply.author).not.toHaveProperty('role');
      expect(reply.author).not.toHaveProperty('username');
    }
    await storage.updateUserAccess([admin], { role: 'user' });
    process.env.ICETV_USERNAME = ` ${missing.toUpperCase()} `;
    const updated = await storage.getReviewReplies(...target, user);
    expect(
      updated.items.find((reply) => reply.id === second!.id)!.author,
    ).not.toHaveProperty('role');
    expect(
      updated.items.find((reply) => reply.id === fourth!.id)!.author.role,
    ).toBe('owner');
  } finally {
    if (previousOwner === undefined) delete process.env.ICETV_USERNAME;
    else process.env.ICETV_USERNAME = previousOwner;
  }
}

export async function assertReviewReplies(storage: IStorage, prefix: string) {
  await assertReplyAuthorRoles(storage, prefix);
  const author = `${prefix}-author`;
  const reader = `${prefix}-reader`;
  const third = `${prefix}-third`;
  for (const username of [author, reader, third])
    await storage.ensureUserProfile(username);
  await storage.setVideoReview(author, videoReview);
  const target = [author, videoReview.title_norm, videoReview.year] as const;
  const first = await storage.postReviewReply(...target, reader, ' 第一条 ');
  expect(first?.content).toBe('第一条');
  expect(first?.isMine).toBe(true);
  expect(JSON.stringify(first)).not.toContain(reader);
  const second = await storage.postReviewReply(
    ...target,
    third,
    '提及读者',
    first!.id,
  );
  expect(second?.replyTo?.profileId).toBe(first?.author.profileId);
  expect(
    await storage.getReviewReplyMessageCount(author, 0, [], Date.now()),
  ).toBe(1);
  expect(
    await storage.getReviewReplyMessageCount(reader, 0, [], Date.now()),
  ).toBe(1);
  expect(
    await storage.getReviewReplyMessageCount(third, 0, [], Date.now()),
  ).toBe(0);
  const mine = await storage.postReviewReply(...target, author, '作者回复');
  await storage.postReviewReply(...target, reader, '提及作者', mine!.id);
  expect(
    await storage.getReviewReplyMessageCount(author, 0, [], Date.now()),
  ).toBe(2);
  const messages = await storage.getReviewReplyMessages(
    author,
    0,
    [],
    Date.now(),
  );
  expect(new Set(messages.map((item) => item.id)).size).toBe(2);
  await storage.updateUserMessageState(author, {
    reviewReply: { id: messages[0].id, createdAt: messages[0].createdAt },
  });
  const state = await storage.getUserMessageState(author);
  expect(
    await storage.getReviewReplyMessageCount(
      author,
      state.reviewReplyReadAt ?? 0,
      state.reviewReplyReadIds ?? [],
      Date.now(),
    ),
  ).toBe(1);
  expect(
    await storage.getReviewReplyMessageCount(
      author,
      Date.now(),
      [],
      Date.now(),
    ),
  ).toBe(0);
  expect(await storage.deleteReviewReply(first!.id, third)).toBe(false);
  await expect(
    storage.postReviewReply(...target, reader, ' '.repeat(5)),
  ).rejects.toThrow();
  await expect(
    storage.postReviewReply(...target, reader, '字'.repeat(301)),
  ).rejects.toThrow();
  await storage.setVideoReview(author, { ...videoReview, title_norm: 'other' });
  await expect(
    storage.postReviewReply(
      author,
      'other',
      videoReview.year,
      reader,
      '跨评价',
      first!.id,
    ),
  ).rejects.toThrow();
  await storage.setVideoReview(author, { ...videoReview, is_public: false });
  expect((await storage.getReviewReplies(...target, reader)).items).toEqual([]);
  expect(await storage.postReviewReply(...target, reader, '私密')).toBeNull();
  expect(await storage.reportReviewReply(first!.id, third, 'abuse', '')).toBe(
    false,
  );
  expect(
    await storage.getReviewReplyMessageCount(author, 0, [], Date.now()),
  ).toBe(0);
  await storage.setVideoReview(author, videoReview);
  expect(
    (await storage.getReviewReplies(...target, reader)).items,
  ).toHaveLength(4);
  expect(
    (
      await storage.getWorkVideoReviewPage(
        videoReview.title_norm,
        videoReview.year,
        reader,
      )
    ).reviews[0].replyCount,
  ).toBe(4);
  expect(await storage.reportReviewReply(first!.id, reader, 'abuse', '')).toBe(
    false,
  );
  expect(
    await storage.reportReviewReply(first!.id, third, 'abuse', '说明'),
  ).toBe(true);
  expect(
    (await storage.getReviewReportPage()).items.find(
      (item) => item.reply?.id === first!.id,
    )?.reports[0].detail,
  ).toBe('说明');
  await storage.moderateReplyReports(first!.id, 'dismiss');
  expect((await storage.getUserSocialData(third)).replyReports).toEqual([]);
  await storage.reportReviewReply(first!.id, third, 'spam', '');
  await storage.deleteVideoReview(...target);
  expect((await storage.getUserSocialData(reader)).replies).toEqual([]);
  expect((await storage.getUserSocialData(third)).replyReports).toEqual([]);
  expect(
    await storage.getReviewReplyMessages(author, 0, [], Date.now(), {
      id: replyMessageId(first!.id, first!.created_at),
    }),
  ).toEqual([]);
}
