import {
  BIO_MAX_LENGTH,
  ProfileValidationError,
  validateBio,
  validateShowcaseKeys,
  validateWatchTimePublic,
} from '../user-profile';

describe('个人主页资料校验', () => {
  it('简介规范化、移除控制字符并折叠换行空白', () => {
    expect(validateBio('  Ａ\r\n\t B\u0000   C  ')).toBe('A B C');
    expect(validateBio(' \n\t\u0000')).toBeNull();
  });

  it('简介按 Unicode 码点限制长度', () => {
    expect(validateBio('𠮷'.repeat(BIO_MAX_LENGTH))).toHaveLength(
      BIO_MAX_LENGTH * 2,
    );
    expect(() => validateBio('𠮷'.repeat(BIO_MAX_LENGTH + 1))).toThrow(
      '简介最多 60 个字',
    );
    for (const input of [null, false, 1, [], {}])
      expect(() => validateBio(input)).toThrow(ProfileValidationError);
  });

  it('本命键保留首次出现顺序，去重后检查上限', () => {
    expect(validateShowcaseKeys(['a+2', 'a+1', 'a+2'])).toEqual(['a+2', 'a+1']);
    expect(validateShowcaseKeys(Array(10).fill('a+1'))).toEqual(['a+1']);
    expect(validateShowcaseKeys([])).toEqual([]);
    expect(() =>
      validateShowcaseKeys(['a+1', 'a+2', 'a+3', 'a+4', 'a+5']),
    ).toThrow('本命作品最多选择 3 部');
    for (const input of [
      null,
      'a+1',
      [1],
      ['+1'],
      ['a+'],
      ['x'.repeat(513) + '+1'],
    ])
      expect(() => validateShowcaseKeys(input)).toThrow(ProfileValidationError);
  });

  it('时长公开开关仅接受布尔值', () => {
    expect(validateWatchTimePublic(true)).toBe(true);
    expect(validateWatchTimePublic(false)).toBe(false);
    for (const input of [null, 0, 1, 'true'])
      expect(() => validateWatchTimePublic(input)).toThrow(
        '观影时长公开状态必须为布尔值',
      );
  });
});
