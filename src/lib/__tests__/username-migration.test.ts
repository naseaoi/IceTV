import {
  mergeSearchKeywords,
  needsUsernameMigration,
  pickNewerJson,
  planUsernameMigration,
} from '../username-migration';

describe('username-migration', () => {
  it('仅把非规范用户名列入迁移计划', () => {
    expect(needsUsernameMigration('TAT')).toBe(true);
    expect(needsUsernameMigration('tat')).toBe(false);
    expect(planUsernameMigration(['TAT', 'test', 'MiXed'])).toEqual([
      { legacy: 'TAT', canonical: 'tat' },
      { legacy: 'MiXed', canonical: 'mixed' },
    ]);
  });

  it('规范行不存在时直接采用遗留数据', () => {
    expect(pickNewerJson(undefined, '{"save_time":1}')).toBe('{"save_time":1}');
  });

  it('条目冲突时保留 save_time 更新的一份', () => {
    const older = '{"save_time":1000}';
    const newer = '{"save_time":2000}';
    expect(pickNewerJson(older, newer)).toBe(newer);
    expect(pickNewerJson(newer, older)).toBe(newer);
  });

  it('save_time 缺失或 JSON 损坏时按 0 处理', () => {
    expect(pickNewerJson('not-json', '{"save_time":5}')).toBe(
      '{"save_time":5}',
    );
    expect(pickNewerJson('{"save_time":5}', 'not-json')).toBe(
      '{"save_time":5}',
    );
  });

  it('搜索历史合并时规范用户在前并去重截断', () => {
    expect(mergeSearchKeywords(['a', 'b'], ['b', 'c', 'd'], 4)).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
    expect(mergeSearchKeywords(['a'], ['b', 'c'], 2)).toEqual(['a', 'b']);
  });
});
