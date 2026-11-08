'use client';

import { ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { buttonStyles } from '@/features/admin/lib/buttonStyles';

type SourceProxyMode = 'server' | 'browser' | 'auto';

interface BatchSourceMenuProps {
  selectedCount: number;
  isEnableLoading: boolean;
  isDisableLoading: boolean;
  isDeleteLoading: boolean;
  isValidationLoading: boolean;
  isBrowserRouteLoading: boolean;
  isServerRouteLoading: boolean;
  isAutoRouteLoading: boolean;
  isAdminOnlyLoading: boolean;
  isPublicLoading: boolean;
  onEnable: () => void;
  onDisable: () => void;
  onDelete: () => void;
  onValidate: () => void;
  onSetProxyMode: (proxyMode: SourceProxyMode) => void;
  onSetAdminOnly: (adminOnly: boolean) => void;
}

export function BatchSourceMenu({
  selectedCount,
  isEnableLoading,
  isDisableLoading,
  isDeleteLoading,
  isValidationLoading,
  isBrowserRouteLoading,
  isServerRouteLoading,
  isAutoRouteLoading,
  isAdminOnlyLoading,
  isPublicLoading,
  onEnable,
  onDisable,
  onDelete,
  onValidate,
  onSetProxyMode,
  onSetAdminOnly,
}: BatchSourceMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const disabled = selectedCount === 0;

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [isOpen]);

  const handleAction = (action: () => void) => {
    setIsOpen(false);
    action();
  };

  const routeItems: Array<{
    label: string;
    mode: SourceProxyMode;
    loading: boolean;
  }> = [
    { label: '浏览器直连', mode: 'browser', loading: isBrowserRouteLoading },
    { label: '服务端代理', mode: 'server', loading: isServerRouteLoading },
    { label: '自动选择', mode: 'auto', loading: isAutoRouteLoading },
  ];
  const scopeItems = [
    { label: '仅管理员可用', adminOnly: true, loading: isAdminOnlyLoading },
    { label: '所有用户可用', adminOnly: false, loading: isPublicLoading },
  ];

  return (
    <div ref={menuRef} className='relative'>
      <button
        type='button'
        onClick={() => setIsOpen((value) => !value)}
        disabled={disabled}
        aria-haspopup='menu'
        aria-expanded={isOpen}
        className={`inline-flex items-center gap-1 ${buttonStyles.outline}`}
      >
        <span>批量</span>
        <ChevronDown className='h-3.5 w-3.5' />
      </button>

      {isOpen && (
        <div
          role='menu'
          aria-label='批量操作'
          className='absolute right-0 top-full z-30 mt-2 w-max overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-900'
        >
          <button
            type='button'
            role='menuitem'
            onClick={() => handleAction(onEnable)}
            disabled={isEnableLoading}
            className='block w-full whitespace-nowrap px-3 py-2 text-right text-sm text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-200 dark:hover:bg-gray-800'
          >
            {isEnableLoading ? '启用中...' : '启用'}
          </button>
          <button
            type='button'
            role='menuitem'
            onClick={() => handleAction(onDisable)}
            disabled={isDisableLoading}
            className='block w-full whitespace-nowrap px-3 py-2 text-right text-sm text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-200 dark:hover:bg-gray-800'
          >
            {isDisableLoading ? '禁用中...' : '禁用'}
          </button>
          <button
            type='button'
            role='menuitem'
            onClick={() => handleAction(onValidate)}
            disabled={isValidationLoading}
            className='block w-full whitespace-nowrap px-3 py-2 text-right text-sm text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-200 dark:hover:bg-gray-800'
          >
            {isValidationLoading ? '检测中...' : '检测'}
          </button>

          <div className='my-1 border-t border-gray-200 dark:border-gray-700' />
          <div className='px-3 py-1.5 text-right text-xs text-gray-500 dark:text-gray-400'>
            流量路由
          </div>
          {routeItems.map((item) => (
            <button
              key={item.mode}
              type='button'
              role='menuitem'
              onClick={() => handleAction(() => onSetProxyMode(item.mode))}
              disabled={item.loading}
              className='block w-full whitespace-nowrap px-3 py-2 text-right text-sm text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-200 dark:hover:bg-gray-800'
            >
              {item.loading ? '设置中...' : item.label}
            </button>
          ))}

          <div className='my-1 border-t border-gray-200 dark:border-gray-700' />
          <div className='px-3 py-1.5 text-right text-xs text-gray-500 dark:text-gray-400'>
            可见范围
          </div>
          {scopeItems.map((item) => (
            <button
              key={item.label}
              type='button'
              role='menuitem'
              onClick={() => handleAction(() => onSetAdminOnly(item.adminOnly))}
              disabled={item.loading}
              className='block w-full whitespace-nowrap px-3 py-2 text-right text-sm text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-200 dark:hover:bg-gray-800'
            >
              {item.loading ? '设置中...' : item.label}
            </button>
          ))}

          <div className='my-1 border-t border-gray-200 dark:border-gray-700' />
          <button
            type='button'
            role='menuitem'
            onClick={() => handleAction(onDelete)}
            disabled={isDeleteLoading}
            className='block w-full whitespace-nowrap px-3 py-2 text-right text-sm text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950/30'
          >
            {isDeleteLoading ? '删除中...' : '删除'}
          </button>
        </div>
      )}
    </div>
  );
}
