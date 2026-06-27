export const SIDEBAR_ITEM_LAYOUT_CLASS =
  'group flex min-h-[48px] items-center justify-start gap-4 rounded-xl px-2 py-2.5 pl-4 text-[17px] transition-colors duration-200';

export const SIDEBAR_LINK_STATE_CLASS =
  'text-gray-700 hover:bg-gray-100/30 hover:text-green-600 data-[active=true]:bg-green-500/20 data-[active=true]:text-green-700 dark:text-gray-300 dark:hover:text-green-400 dark:data-[active=true]:bg-green-500/10 dark:data-[active=true]:text-green-400';

export const SIDEBAR_BUTTON_STATE_CLASS =
  'text-gray-500 hover:bg-gray-100/30 hover:text-green-600 dark:text-gray-400 dark:hover:text-green-400';

export const SIDEBAR_ITEM_ICON_WRAP_CLASS =
  'flex h-6 w-6 flex-shrink-0 items-center justify-center';

export const SIDEBAR_ITEM_ICON_CLASS = 'h-6 w-6';

export const SIDEBAR_LINK_ICON_CLASS =
  'h-6 w-6 text-gray-500 group-hover:text-green-600 data-[active=true]:text-green-700 dark:text-gray-400 dark:group-hover:text-green-400 dark:data-[active=true]:text-green-400';

export function getSidebarItemLabelClass(isCollapsed: boolean) {
  return `overflow-hidden whitespace-nowrap transition-[max-width,opacity] duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)] ${
    isCollapsed ? 'max-w-0 opacity-0' : 'max-w-[135px] opacity-100'
  }`;
}
