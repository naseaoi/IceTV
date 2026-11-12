import {
  DisplayableError,
  getErrorMessage,
  isAbortError,
  NETWORK_ERROR_MESSAGE,
  SERVICE_UNAVAILABLE_MESSAGE,
} from './user-facing-error';

describe('getErrorMessage', () => {
  it('展示 DisplayableError 的文案', () => {
    expect(
      getErrorMessage(new DisplayableError('昵称已被占用'), '保存失败'),
    ).toBe('昵称已被占用');
  });

  it('不透传普通异常的原始 message', () => {
    expect(getErrorMessage(new Error('Unexpected token <'), '保存失败')).toBe(
      '保存失败',
    );
    expect(getErrorMessage('boom', '保存失败')).toBe('保存失败');
  });

  it('网络异常给统一中文文案', () => {
    expect(getErrorMessage(new TypeError('Failed to fetch'), '保存失败')).toBe(
      NETWORK_ERROR_MESSAGE,
    );
    expect(getErrorMessage({ kind: 'network' }, '保存失败')).toBe(
      NETWORK_ERROR_MESSAGE,
    );
  });

  it('临时 HTTP 错误提示服务不可用，其余回退', () => {
    expect(getErrorMessage({ kind: 'http', status: 503 }, '保存失败')).toBe(
      SERVICE_UNAVAILABLE_MESSAGE,
    );
    expect(getErrorMessage({ kind: 'http', status: 400 }, '保存失败')).toBe(
      '保存失败',
    );
  });
});

describe('isAbortError', () => {
  it('识别原生与封装的取消', () => {
    expect(isAbortError(new DOMException('aborted', 'AbortError'))).toBe(true);
    expect(isAbortError({ kind: 'request_aborted' })).toBe(true);
    expect(isAbortError(new Error('x'))).toBe(false);
  });
});
