// 与 MODAL_INPUT_CLASS 同风格；移动端保持 16px 字号，避免 iOS 聚焦时放大页面
const INPUT_BASE_CLASS =
  'block h-11 w-full rounded-lg border-0 bg-gray-900/[0.04] px-3.5 text-base text-gray-900 ring-1 ring-inset transition-colors placeholder:text-gray-400 focus:bg-white focus:ring-2 dark:bg-white/[0.06] dark:text-gray-100 dark:placeholder:text-gray-500 dark:focus:bg-gray-950 sm:text-sm';

const INPUT_VALID_RING_CLASS =
  'ring-gray-900/[0.08] focus:ring-brand-500 dark:ring-white/[0.08]';

const INPUT_INVALID_RING_CLASS =
  'ring-rose-500/60 focus:ring-rose-500 dark:ring-rose-500/60';

export const inputClass = (invalid = false) =>
  `${INPUT_BASE_CLASS} ${
    invalid ? INPUT_INVALID_RING_CLASS : INPUT_VALID_RING_CLASS
  }`;

export const FIELD_ERROR_CLASS =
  'mt-1.5 text-xs text-rose-600 dark:text-rose-400';

export const FIELD_HINT_CLASS =
  'mt-1.5 text-xs text-gray-500 dark:text-gray-400';

export const FIELD_OK_CLASS =
  'mt-1.5 text-xs text-brand-600 dark:text-brand-400';

export const PRIMARY_SUBMIT_CLASS =
  '!mt-6 inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-brand-600 text-[15px] font-medium text-white transition-colors hover:bg-brand-500 active:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50';

export const SWITCH_LINK_CLASS =
  'font-medium text-brand-600 transition-colors hover:text-brand-500 dark:text-brand-400 dark:hover:text-brand-300';
