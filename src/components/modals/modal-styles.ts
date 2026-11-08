// 弹窗与面板共用的实底风格，外壳见 ModalShell
export const MODAL_TITLE_CLASS =
  'text-base font-semibold text-gray-900 dark:text-gray-100';

export const MODAL_CLOSE_BUTTON_CLASS =
  'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-gray-900/[0.05] hover:text-gray-900 dark:text-gray-400 dark:hover:bg-white/[0.06] dark:hover:text-white';

const MODAL_BUTTON_BASE_CLASS =
  'inline-flex h-10 items-center justify-center rounded-full px-5 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50';

export const MODAL_PRIMARY_BUTTON_CLASS = `${MODAL_BUTTON_BASE_CLASS} bg-brand-600 text-white hover:bg-brand-500`;

export const MODAL_DANGER_BUTTON_CLASS = `${MODAL_BUTTON_BASE_CLASS} bg-rose-600 text-white hover:bg-rose-500`;

export const MODAL_SECONDARY_BUTTON_CLASS = `${MODAL_BUTTON_BASE_CLASS} bg-gray-900/[0.05] text-gray-700 hover:bg-gray-900/[0.09] dark:bg-white/[0.08] dark:text-gray-200 dark:hover:bg-white/[0.12]`;

export const MODAL_INPUT_CLASS =
  'h-10 w-full rounded-lg border-0 bg-gray-900/[0.04] px-3 text-sm text-gray-900 ring-1 ring-inset ring-gray-900/[0.08] transition-colors placeholder:text-gray-400 focus:bg-white focus:ring-2 focus:ring-brand-500 disabled:opacity-60 dark:bg-white/[0.06] dark:text-gray-100 dark:ring-white/[0.08] dark:placeholder:text-gray-500 dark:focus:bg-gray-900';

export const MODAL_LABEL_CLASS =
  'mb-1.5 block text-[13px] font-medium text-gray-700 dark:text-gray-300';
