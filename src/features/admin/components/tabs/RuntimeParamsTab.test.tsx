import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';

import RuntimeParamsTab from '@/features/admin/components/tabs/RuntimeParamsTab';
import { RUNTIME_PARAMS_FORM_ID } from '@/features/admin/lib/admin-form-ids';
import { adminPost } from '@/features/admin/lib/api';
import { IMPORT_ADMIN_CONFIG } from '@/lib/__tests__/__fixtures__/import-admin-config';
import {
  type RuntimeParamSettings,
  DEFAULT_RUNTIME_PARAMS,
  RUNTIME_PARAM_RANGES,
} from '@/lib/runtime-params';

jest.mock('@/components/modals/AlertModal', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/features/admin/lib/api', () => ({ adminPost: jest.fn() }));
jest.mock('@/lib/runtime-config', () => ({
  applyClientServerConfig: jest.fn(),
  fetchClientServerConfig: jest.fn().mockResolvedValue({}),
}));
jest.mock('@/hooks/useAlertModal', () => ({
  useAlertModal: () => ({
    alertModal: { isOpen: false, type: 'success', title: '' },
    showAlert: jest.fn(),
    hideAlert: jest.fn(),
  }),
}));

function setup() {
  const refreshConfig = jest.fn().mockResolvedValue(undefined);
  const onDirtyChange = jest.fn();
  const view = render(
    <RuntimeParamsTab
      config={IMPORT_ADMIN_CONFIG}
      refreshConfig={refreshConfig}
      onDirtyChange={onDirtyChange}
    />,
  );
  const form = view.container.querySelector(
    `#${RUNTIME_PARAMS_FORM_ID}`,
  ) as HTMLFormElement;
  return { ...view, form, refreshConfig, onDirtyChange };
}

describe('RuntimeParamsTab', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(adminPost).mockResolvedValue({ ok: true });
  });

  it('groups danmaku settings separately and keeps every parameter exactly once', () => {
    const { container } = setup();
    const danmaku = screen.getByRole('region', { name: '弹幕' });
    expect(within(danmaku).getByLabelText('单集弹幕条数上限')).toHaveValue(
      8000,
    );
    expect(within(danmaku).getByLabelText('弹幕上游请求超时')).toHaveValue(12);
    expect(within(danmaku).getByText('站点未开启')).toBeInTheDocument();
    expect(
      within(danmaku).queryByText(/总开关与连接测试/),
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: '搜索' })).getByLabelText(
        '搜索源失败冷却',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('播放源失败冷却')).not.toBeInTheDocument();
    const inputs = [
      ...container.querySelectorAll<HTMLInputElement>('input[name]'),
    ];
    expect(inputs.map((input) => input.name).sort()).toEqual(
      Object.keys(DEFAULT_RUNTIME_PARAMS).sort(),
    );
    expect(container.querySelector('details')).not.toHaveAttribute('open');
    expect(screen.getByLabelText('封面加载记录上限')).toHaveValue(500);
  });

  it('does not save an unchanged form', () => {
    const { form, onDirtyChange } = setup();
    fireEvent.submit(form);
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    expect(adminPost).not.toHaveBeenCalled();
  });

  it('places ranges immediately before the inputs instead of below labels', () => {
    const { container } = setup();
    const inputs = container.querySelectorAll<HTMLInputElement>('input[name]');

    inputs.forEach((input) => {
      const key = input.name as keyof RuntimeParamSettings;
      const range = RUNTIME_PARAM_RANGES[key];
      const rangeDescription = document.getElementById(`${input.id}-range`);
      const label = container.querySelector(`label[for="${input.id}"]`);

      expect(input.previousElementSibling).toBe(rangeDescription);
      expect(rangeDescription).toHaveTextContent(`${range.min}–${range.max}`);
      expect(rangeDescription).toHaveTextContent(
        `默认 ${DEFAULT_RUNTIME_PARAMS[key]}`,
      );
      expect(label?.parentElement).not.toContainElement(rangeDescription);
      expect(input.getAttribute('aria-describedby')?.split(' ')).toContain(
        rangeDescription?.id,
      );
    });

    expect(
      screen.getByLabelText('弹幕上游请求超时'),
    ).toHaveAccessibleDescription(
      '1–60 默认 12 用于弹幕搜索、绑定校验、内容拉取和连接测试的单次回源请求。',
    );
  });

  it('omits the introductory note above the parameter groups', () => {
    const { form } = setup();
    expect(form.querySelector(':scope > p')).toBeNull();
    expect(screen.queryByText(/常用参数集中展示/)).not.toBeInTheDocument();
  });

  it('saves danmaku and folded advanced values together', async () => {
    const { container, form, refreshConfig, onDirtyChange } = setup();
    const details = container.querySelector('details') as HTMLDetailsElement;
    details.open = true;
    fireEvent.change(screen.getByLabelText('封面加载记录上限'), {
      target: { value: '750' },
    });
    details.open = false;
    fireEvent.change(screen.getByLabelText('弹幕上游请求超时'), {
      target: { value: '25' },
    });
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);

    fireEvent.submit(form);

    await waitFor(() => expect(refreshConfig).toHaveBeenCalledTimes(1));
    expect(adminPost).toHaveBeenCalledWith(
      '/api/admin/runtime',
      expect.objectContaining({
        DanmakuEpisodeLimit: 8000,
        DanmakuRequestTimeoutSeconds: 25,
        CoverImageCacheSize: 750,
        SearchDownstreamMaxPage:
          IMPORT_ADMIN_CONFIG.SiteConfig.SearchDownstreamMaxPage,
      }),
      '保存失败',
    );
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });

  it('keeps the draft dirty when saving fails', async () => {
    jest.mocked(adminPost).mockRejectedValueOnce(new Error('保存失败'));
    const { form, refreshConfig, onDirtyChange } = setup();
    fireEvent.change(screen.getByLabelText('弹幕上游请求超时'), {
      target: { value: '25' },
    });
    fireEvent.submit(form);
    await waitFor(() => expect(adminPost).toHaveBeenCalledTimes(1));
    expect(refreshConfig).not.toHaveBeenCalled();
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  });

  it('opens advanced settings so an invalid input can receive focus', () => {
    const { container } = setup();
    const details = container.querySelector('details') as HTMLDetailsElement;
    fireEvent.invalid(screen.getByLabelText('封面加载记录上限'));
    expect(details.open).toBe(true);
    expect(adminPost).not.toHaveBeenCalled();
  });

  it('exposes integer bounds on the danmaku timeout input', () => {
    setup();
    const input = screen.getByLabelText('弹幕上游请求超时');
    expect(input).toHaveAttribute('min', '1');
    expect(input).toHaveAttribute('max', '60');
    expect(input).toHaveAttribute('step', '1');
    expect(input).toBeRequired();
  });
});
