'use client';

import {
  ExternalLink,
  GitBranch,
  KeyRound,
  LogIn,
  LogOut,
  Settings,
  Shield,
  User,
  X,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import {
  type CSSProperties,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

import {
  SIDEBAR_BUTTON_STATE_CLASS,
  SIDEBAR_ITEM_ICON_CLASS,
  SIDEBAR_ITEM_ICON_WRAP_CLASS,
  SIDEBAR_ITEM_LAYOUT_CLASS,
  getSidebarItemLabelClass,
} from './SidebarItem';

import AdminSelect from '@/features/admin/components/AdminSelect';
import AlertModal from '@/features/admin/components/AlertModal';
import { useAlertModal } from '@/features/admin/hooks/useAlertModal';
import { getAuthInfoFromBrowserCookie } from '@/lib/auth';
import {
  doubanDataSourceOptions,
  doubanImageProxyTypeOptions,
  getThanksInfo,
} from '@/lib/douban-options';
import {
  AUTO_SWITCH_SOURCE_ON_TIMEOUT_STORAGE_KEY,
  readBooleanLocalSetting,
  writeBooleanLocalSetting,
} from '@/lib/local-settings';
import { getClientAuthRuntimeConfig } from '@/lib/runtime-config';
import { CURRENT_VERSION } from '@/lib/version';
import { checkForUpdates, UpdateStatus } from '@/lib/version-check';

import { VersionPanel } from './VersionPanel';

interface AuthInfo {
  username?: string;
  role?: 'owner' | 'admin' | 'user';
}

interface UserMenuProps {
  variant?: 'icon' | 'sidebar';
  isCollapsed?: boolean;
}

export const UserMenu: React.FC<UserMenuProps> = ({
  variant = 'icon',
  isCollapsed = false,
}) => {
  const router = useRouter();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [menuPlacement, setMenuPlacement] = useState<'up' | 'down'>('down');
  const [menuPos, setMenuPos] = useState<CSSProperties>({});
  const [isOpen, setIsOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);
  const [isVersionPanelOpen, setIsVersionPanelOpen] = useState(false);
  const [authInfo, setAuthInfo] = useState<AuthInfo | null>(null);
  const [storageType, setStorageType] = useState<string>('localdb');
  const [mounted, setMounted] = useState(false);

  // Body 滚动锁定 - 使用 overflow 方式避免布局问题
  useEffect(() => {
    if (isSettingsOpen || isChangePasswordOpen) {
      const body = document.body;
      const html = document.documentElement;

      // 保存原始样式
      const originalBodyOverflow = body.style.overflow;
      const originalHtmlOverflow = html.style.overflow;

      // 只设置 overflow 来阻止滚动
      body.style.overflow = 'hidden';
      html.style.overflow = 'hidden';

      return () => {
        // 恢复所有原始样式
        body.style.overflow = originalBodyOverflow;
        html.style.overflow = originalHtmlOverflow;
      };
    }
  }, [isSettingsOpen, isChangePasswordOpen]);

  // 设置相关状态
  const [defaultAggregateSearch, setDefaultAggregateSearch] = useState(true);
  const [doubanProxyUrl, setDoubanProxyUrl] = useState('');
  const [enableOptimization, setEnableOptimization] = useState(true);
  const [autoSwitchSourceOnTimeout, setAutoSwitchSourceOnTimeout] =
    useState(false);
  const [fluidSearch, setFluidSearch] = useState(true);
  const [liveDirectConnect, setLiveDirectConnect] = useState(false);
  const [doubanDataSource, setDoubanDataSource] = useState('direct');
  const [doubanImageProxyType, setDoubanImageProxyType] = useState('direct');
  const [doubanImageProxyUrl, setDoubanImageProxyUrl] = useState('');

  // 代理切换提示弹窗
  const { alertModal, showAlert, hideAlert } = useAlertModal();

  // 修改密码相关状态
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordError, setPasswordError] = useState('');

  // 版本检查相关状态
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [isChecking, setIsChecking] = useState(true);

  // 组件挂载：初始化认证信息、读取本地设置、检查版本
  useEffect(() => {
    let cancelled = false;

    setMounted(true);

    if (typeof window !== 'undefined') {
      const loadClientState = async () => {
        const auth = getAuthInfoFromBrowserCookie();
        const { storageType } = await getClientAuthRuntimeConfig();
        if (cancelled) {
          return;
        }

        setAuthInfo(auth);
        setStorageType(storageType);

        const savedAggregateSearch = localStorage.getItem(
          'defaultAggregateSearch',
        );
        if (savedAggregateSearch !== null) {
          setDefaultAggregateSearch(JSON.parse(savedAggregateSearch));
        }

        const defaultDoubanProxyType =
          window.RUNTIME_CONFIG?.DOUBAN_PROXY_TYPE || 'direct';
        const savedDoubanDataSource = localStorage.getItem('doubanDataSource');
        if (savedDoubanDataSource !== null) {
          setDoubanDataSource(savedDoubanDataSource);
        } else if (defaultDoubanProxyType) {
          setDoubanDataSource(defaultDoubanProxyType);
        }

        const defaultDoubanProxy = window.RUNTIME_CONFIG?.DOUBAN_PROXY || '';
        const savedDoubanProxyUrl = localStorage.getItem('doubanProxyUrl');
        if (savedDoubanProxyUrl !== null) {
          setDoubanProxyUrl(savedDoubanProxyUrl);
        } else if (defaultDoubanProxy) {
          setDoubanProxyUrl(defaultDoubanProxy);
        }

        const defaultDoubanImageProxyType =
          window.RUNTIME_CONFIG?.DOUBAN_IMAGE_PROXY_TYPE || 'direct';
        const savedDoubanImageProxyType = localStorage.getItem(
          'doubanImageProxyType',
        );
        if (savedDoubanImageProxyType !== null) {
          setDoubanImageProxyType(savedDoubanImageProxyType);
        } else if (defaultDoubanImageProxyType) {
          setDoubanImageProxyType(defaultDoubanImageProxyType);
        }

        const defaultDoubanImageProxyUrl =
          window.RUNTIME_CONFIG?.DOUBAN_IMAGE_PROXY || '';
        const savedDoubanImageProxyUrl = localStorage.getItem(
          'doubanImageProxyUrl',
        );
        if (savedDoubanImageProxyUrl !== null) {
          setDoubanImageProxyUrl(savedDoubanImageProxyUrl);
        } else if (defaultDoubanImageProxyUrl) {
          setDoubanImageProxyUrl(defaultDoubanImageProxyUrl);
        }

        const savedEnableOptimization =
          localStorage.getItem('enableOptimization');
        if (savedEnableOptimization !== null) {
          setEnableOptimization(JSON.parse(savedEnableOptimization));
        }

        setAutoSwitchSourceOnTimeout(
          readBooleanLocalSetting(
            AUTO_SWITCH_SOURCE_ON_TIMEOUT_STORAGE_KEY,
            false,
          ),
        );

        const savedFluidSearch = localStorage.getItem('fluidSearch');
        const defaultFluidSearch =
          window.RUNTIME_CONFIG?.FLUID_SEARCH !== false;
        if (savedFluidSearch !== null) {
          setFluidSearch(JSON.parse(savedFluidSearch));
        } else {
          setFluidSearch(defaultFluidSearch);
        }

        const savedLiveDirectConnect =
          localStorage.getItem('liveDirectConnect');
        if (savedLiveDirectConnect !== null) {
          setLiveDirectConnect(JSON.parse(savedLiveDirectConnect));
        }
      };

      loadClientState();
    }

    // 版本检查
    const checkUpdate = async () => {
      try {
        const status = await checkForUpdates();
        setUpdateStatus(status);
      } catch (error) {
        console.warn('版本检查失败:', error);
      } finally {
        setIsChecking(false);
      }
    };
    checkUpdate();

    return () => {
      cancelled = true;
    };
  }, []);

  const computeMenuPos = useMemo(() => {
    const PANEL_WIDTH_PX = 224;
    const VIEWPORT_GAP_PX = 8;
    const ANCHOR_GAP_PX = 8;
    const MIN_PANEL_HEIGHT_GUESS_PX = 280;

    const clamp = (value: number, min: number, max: number) =>
      Math.max(min, Math.min(value, max));

    return (rect: DOMRect) => {
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      const preferUp = variant === 'sidebar';
      const shouldOpenUp =
        preferUp ||
        (spaceBelow < MIN_PANEL_HEIGHT_GUESS_PX && spaceAbove > spaceBelow);

      setMenuPlacement(shouldOpenUp ? 'up' : 'down');

      if (variant === 'icon') {
        const right = Math.max(window.innerWidth - rect.right, VIEWPORT_GAP_PX);
        if (shouldOpenUp) {
          return {
            bottom: Math.max(window.innerHeight - rect.top + ANCHOR_GAP_PX, 0),
            right,
          };
        }
        return {
          top: rect.bottom + ANCHOR_GAP_PX,
          right,
        };
      }

      const left = clamp(
        rect.left,
        VIEWPORT_GAP_PX,
        window.innerWidth - PANEL_WIDTH_PX - VIEWPORT_GAP_PX,
      );
      if (shouldOpenUp) {
        return {
          bottom: Math.max(window.innerHeight - rect.top + ANCHOR_GAP_PX, 0),
          left,
        };
      }
      return {
        top: rect.bottom + ANCHOR_GAP_PX,
        left,
      };
    };
  }, [variant]);

  const handleMenuClick = () => {
    if (!isOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setMenuPos(computeMenuPos(rect));
    }
    setIsOpen(!isOpen);
  };

  const handleCloseMenu = () => {
    setIsOpen(false);
  };

  const handleLogin = () => {
    const redirect =
      typeof window !== 'undefined'
        ? `${window.location.pathname}${window.location.search}`
        : '/';
    router.push(`/login?redirect=${encodeURIComponent(redirect)}`);
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      console.error('注销请求失败:', error);
    }
    window.location.href = '/';
  };

  const handleAdminPanel = () => {
    router.push('/admin');
  };

  const handleChangePassword = () => {
    setIsOpen(false);
    setIsChangePasswordOpen(true);
    setOldPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setPasswordError('');
  };

  const handleCloseChangePassword = () => {
    setIsChangePasswordOpen(false);
    setOldPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setPasswordError('');
  };

  const handleSubmitChangePassword = async () => {
    setPasswordError('');

    // 验证密码
    if (!oldPassword) {
      setPasswordError('请输入当前密码');
      return;
    }

    if (!newPassword) {
      setPasswordError('新密码不得为空');
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError('两次输入的密码不一致');
      return;
    }

    setPasswordLoading(true);

    try {
      const response = await fetch('/api/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          oldPassword,
          newPassword,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setPasswordError(data.error || '修改密码失败');
        return;
      }

      // 修改成功，关闭弹窗并登出
      setIsChangePasswordOpen(false);
      await handleLogout();
    } catch (error) {
      setPasswordError('网络错误，请稍后重试');
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleSettings = () => {
    setIsOpen(false);
    setIsSettingsOpen(true);
  };

  const handleCloseSettings = () => {
    setIsSettingsOpen(false);
  };

  // 设置相关的处理函数
  const handleAggregateToggle = (value: boolean) => {
    setDefaultAggregateSearch(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('defaultAggregateSearch', JSON.stringify(value));
    }
  };

  const handleDoubanProxyUrlChange = (value: string) => {
    setDoubanProxyUrl(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('doubanProxyUrl', value);
    }
  };

  const handleOptimizationToggle = (value: boolean) => {
    setEnableOptimization(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('enableOptimization', JSON.stringify(value));
    }
  };

  const handleAutoSwitchSourceOnTimeoutToggle = (value: boolean) => {
    setAutoSwitchSourceOnTimeout(value);
    writeBooleanLocalSetting(AUTO_SWITCH_SOURCE_ON_TIMEOUT_STORAGE_KEY, value);
  };

  const handleFluidSearchToggle = (value: boolean) => {
    setFluidSearch(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('fluidSearch', JSON.stringify(value));
    }
  };

  const handleLiveDirectConnectToggle = (value: boolean) => {
    setLiveDirectConnect(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('liveDirectConnect', JSON.stringify(value));
    }
  };

  const showProxyToast = () => {
    showAlert({
      type: 'success',
      title: '更换成功',
      message: '刷新页面后生效',
      timer: 2000,
    });
  };

  const handleDoubanDataSourceChange = (value: string) => {
    setDoubanDataSource(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('doubanDataSource', value);
    }
    showProxyToast();
  };

  const handleDoubanImageProxyTypeChange = (value: string) => {
    setDoubanImageProxyType(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('doubanImageProxyType', value);
    }
    showProxyToast();
  };

  const handleDoubanImageProxyUrlChange = (value: string) => {
    setDoubanImageProxyUrl(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('doubanImageProxyUrl', value);
    }
  };

  const handleResetSettings = () => {
    const defaultDoubanProxyType =
      window.RUNTIME_CONFIG?.DOUBAN_PROXY_TYPE || 'direct';
    const defaultDoubanProxy = window.RUNTIME_CONFIG?.DOUBAN_PROXY || '';
    const defaultDoubanImageProxyType =
      window.RUNTIME_CONFIG?.DOUBAN_IMAGE_PROXY_TYPE || 'direct';
    const defaultDoubanImageProxyUrl =
      window.RUNTIME_CONFIG?.DOUBAN_IMAGE_PROXY || '';
    const defaultFluidSearch = window.RUNTIME_CONFIG?.FLUID_SEARCH !== false;

    setDefaultAggregateSearch(true);
    setEnableOptimization(true);
    setAutoSwitchSourceOnTimeout(false);
    setFluidSearch(defaultFluidSearch);
    setLiveDirectConnect(false);
    setDoubanProxyUrl(defaultDoubanProxy);
    setDoubanDataSource(defaultDoubanProxyType);
    setDoubanImageProxyType(defaultDoubanImageProxyType);
    setDoubanImageProxyUrl(defaultDoubanImageProxyUrl);

    if (typeof window !== 'undefined') {
      localStorage.setItem('defaultAggregateSearch', JSON.stringify(true));
      localStorage.setItem('enableOptimization', JSON.stringify(true));
      writeBooleanLocalSetting(
        AUTO_SWITCH_SOURCE_ON_TIMEOUT_STORAGE_KEY,
        false,
      );
      localStorage.setItem('fluidSearch', JSON.stringify(defaultFluidSearch));
      localStorage.setItem('liveDirectConnect', JSON.stringify(false));
      localStorage.setItem('doubanProxyUrl', defaultDoubanProxy);
      localStorage.setItem('doubanDataSource', defaultDoubanProxyType);
      localStorage.setItem('doubanImageProxyType', defaultDoubanImageProxyType);
      localStorage.setItem('doubanImageProxyUrl', defaultDoubanImageProxyUrl);
    }
  };

  // 检查是否显示管理面板按钮
  const showAdminPanel =
    authInfo?.role === 'owner' || authInfo?.role === 'admin';
  const isAuthenticated = Boolean(authInfo?.username);

  // 检查是否显示修改密码按钮
  const showChangePassword = isAuthenticated && authInfo?.role !== 'owner';

  // 角色中文映射
  const getRoleText = (role?: string) => {
    switch (role) {
      case 'owner':
        return '站长';
      case 'admin':
        return '管理员';
      case 'user':
        return '用户';
      default:
        return '';
    }
  };

  // 功能按钮配置
  const menuActions = [
    { icon: Settings, label: '设置', onClick: handleSettings, show: true },
    {
      icon: Shield,
      label: '管理',
      onClick: handleAdminPanel,
      show: showAdminPanel,
    },
    {
      icon: KeyRound,
      label: '密码',
      onClick: handleChangePassword,
      show: showChangePassword,
    },
    {
      icon: GitBranch,
      label: `v${CURRENT_VERSION}`,
      onClick: () => {
        setIsVersionPanelOpen(true);
        handleCloseMenu();
      },
      show: true,
      version: true,
    },
    {
      icon: isAuthenticated ? LogOut : LogIn,
      label: isAuthenticated ? '登出' : '登录',
      onClick: isAuthenticated ? handleLogout : handleLogin,
      show: true,
      danger: isAuthenticated,
    },
  ].filter((a) => a.show);

  // 菜单面板内容
  const menuPanel = (
    <>
      <div
        className='fixed inset-0 z-[1000] bg-transparent'
        onClick={handleCloseMenu}
      />

      <div
        className={`fixed z-[1001] w-56 max-w-[calc(100vw-16px)] select-none overflow-hidden rounded-2xl border border-gray-200/70 bg-white/80 shadow-2xl ring-1 ring-black/10 backdrop-blur-xl dark:border-white/10 dark:bg-gray-900/70 dark:ring-white/10 ${
          menuPlacement === 'up' ? 'origin-bottom' : 'origin-top'
        }`}
        style={menuPos}
      >
        {/* 用户卡片区 */}
        <div className='relative px-4 pb-3 pt-4'>
          <div className='absolute inset-x-0 top-0 h-14 bg-gradient-to-br from-emerald-500/10 via-green-400/5 to-transparent dark:from-emerald-500/15 dark:via-green-500/5' />

          <button
            onClick={handleCloseMenu}
            className='absolute right-2 top-2 z-10 rounded-lg p-1 text-gray-400 transition-colors hover:bg-gray-100/70 hover:text-gray-600 dark:hover:bg-white/[0.06] dark:hover:text-gray-200'
            aria-label='关闭菜单'
          >
            <X className='h-4 w-4' />
          </button>

          <div className='relative flex flex-col items-center text-center'>
            <div className='flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-200 to-green-100 text-emerald-700 shadow-lg ring-2 ring-white/80 dark:from-emerald-500/20 dark:to-green-500/15 dark:text-emerald-200 dark:ring-white/10'>
              <User className='h-6 w-6' />
            </div>
            <div className='mt-2.5 max-w-full truncate text-sm font-semibold text-gray-900 dark:text-gray-100'>
              {authInfo?.username || '未登录'}
            </div>
            <div className='mt-1 flex items-center gap-2'>
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
                  !isAuthenticated
                    ? 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
                    : (authInfo?.role || 'user') === 'owner'
                      ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-200'
                      : (authInfo?.role || 'user') === 'admin'
                        ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200'
                        : 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200'
                }`}
              >
                {isAuthenticated
                  ? getRoleText(authInfo?.role || 'user')
                  : '游客'}
              </span>
              <span className='text-[10px] text-gray-400 dark:text-gray-500'>
                {storageType}
              </span>
            </div>
          </div>
        </div>

        <div className='mx-3 h-px bg-gradient-to-r from-transparent via-gray-200/80 to-transparent dark:via-white/[0.10]' />

        {/* 功能按钮网格 - 统一包含登出和版本 */}
        <div className='grid grid-cols-2 gap-1.5 px-2.5 py-2'>
          {menuActions.map(
            ({ icon: Icon, label, onClick, danger, version }) => (
              <button
                key={label}
                onClick={onClick}
                className={`relative flex flex-col items-center gap-2 rounded-xl px-1 py-3 transition-colors ${
                  danger
                    ? 'text-rose-600 hover:bg-rose-50/70 dark:text-rose-300 dark:hover:bg-rose-500/10'
                    : 'text-gray-600 hover:bg-gray-100/70 dark:text-gray-300 dark:hover:bg-white/[0.06]'
                }`}
              >
                <div
                  className={`flex h-12 w-12 items-center justify-center rounded-xl ${
                    danger
                      ? 'bg-rose-50/80 dark:bg-rose-500/10'
                      : 'bg-gray-100/80 dark:bg-white/[0.06]'
                  }`}
                >
                  <Icon className='h-[22px] w-[22px]' />
                </div>
                <span
                  className={`text-sm font-medium ${version ? 'font-mono' : ''}`}
                >
                  {label}
                </span>
                {version &&
                  !isChecking &&
                  updateStatus === UpdateStatus.HAS_UPDATE && (
                    <div className='absolute right-2 top-2 h-2 w-2 rounded-full bg-yellow-500' />
                  )}
              </button>
            ),
          )}
        </div>
      </div>
    </>
  );

  // 设置面板内容
  const settingsPanel = (
    <>
      {/* 背景遮罩 */}
      <div
        className='fixed inset-0 z-[1000] bg-black/50 backdrop-blur-sm'
        onClick={handleCloseSettings}
        onTouchMove={(e) => {
          // 只阻止滚动，允许其他触摸事件
          e.preventDefault();
        }}
        onWheel={(e) => {
          // 阻止滚轮滚动
          e.preventDefault();
        }}
        style={{
          touchAction: 'none',
        }}
      />

      {/* 设置面板 */}
      <div className='fixed left-1/2 top-1/2 z-[1001] flex max-h-[90vh] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border border-gray-200/70 bg-white/80 shadow-2xl ring-1 ring-black/10 backdrop-blur-xl dark:border-white/10 dark:bg-gray-900/70 dark:ring-white/10'>
        {/* 内容容器 - 独立的滚动区域 */}
        <div
          className='flex-1 overflow-y-auto p-6'
          data-panel-content
          style={{
            touchAction: 'pan-y', // 只允许垂直滚动
            overscrollBehavior: 'contain', // 防止滚动冒泡
          }}
        >
          {/* 标题栏 */}
          <div className='mb-6 flex items-center justify-between'>
            <div className='flex items-center gap-3'>
              <h3 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
                本地设置
              </h3>
              <button
                onClick={handleResetSettings}
                className='rounded border border-red-200 px-2 py-1 text-xs text-red-500 transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-700 dark:border-red-800 dark:text-red-400 dark:hover:border-red-700 dark:hover:bg-red-900/20 dark:hover:text-red-300'
                title='重置为默认设置'
              >
                恢复默认
              </button>
            </div>
            <button
              onClick={handleCloseSettings}
              className='flex h-8 w-8 items-center justify-center rounded-full p-1 text-gray-500 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800'
              aria-label='Close'
            >
              <X className='h-full w-full' />
            </button>
          </div>

          {/* 设置项 */}
          <div className='space-y-6'>
            {/* 豆瓣数据源选择 */}
            <div className='space-y-3'>
              <div>
                <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                  豆瓣数据代理
                </h4>
                <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                  选择获取豆瓣数据的方式
                </p>
              </div>
              <AdminSelect
                value={doubanDataSource}
                onChange={(value) => handleDoubanDataSourceChange(value)}
                options={doubanDataSourceOptions}
              />

              {/* 感谢信息 */}
              {getThanksInfo(doubanDataSource) && (
                <div className='mt-3'>
                  <button
                    type='button'
                    onClick={() =>
                      window.open(
                        getThanksInfo(doubanDataSource)!.url,
                        '_blank',
                      )
                    }
                    className='flex w-full cursor-pointer items-center justify-center gap-1.5 px-3 text-xs text-gray-500 dark:text-gray-400'
                  >
                    <span className='font-medium'>
                      {getThanksInfo(doubanDataSource)!.text}
                    </span>
                    <ExternalLink className='w-3.5 opacity-70' />
                  </button>
                </div>
              )}
            </div>

            {/* 豆瓣代理地址设置 - 仅在选择自定义代理时显示 */}
            {doubanDataSource === 'custom' && (
              <div className='space-y-3'>
                <div>
                  <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                    豆瓣代理地址
                  </h4>
                  <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                    自定义代理服务器地址
                  </p>
                </div>
                <input
                  type='text'
                  className='w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder-gray-500 shadow-sm transition-all duration-200 hover:border-gray-400 focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-400 dark:hover:border-gray-500'
                  placeholder='例如: https://proxy.example.com/fetch?url='
                  value={doubanProxyUrl}
                  onChange={(e) => handleDoubanProxyUrlChange(e.target.value)}
                />
              </div>
            )}

            {/* 分割线 */}
            <div className='border-t border-gray-200 dark:border-gray-700'></div>

            {/* 豆瓣图片代理设置 */}
            <div className='space-y-3'>
              <div>
                <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                  豆瓣图片代理
                </h4>
                <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                  选择获取豆瓣图片的方式
                </p>
              </div>
              <AdminSelect
                value={doubanImageProxyType}
                onChange={(value) => handleDoubanImageProxyTypeChange(value)}
                options={doubanImageProxyTypeOptions}
              />

              {/* 感谢信息 */}
              {getThanksInfo(doubanImageProxyType) && (
                <div className='mt-3'>
                  <button
                    type='button'
                    onClick={() =>
                      window.open(
                        getThanksInfo(doubanImageProxyType)!.url,
                        '_blank',
                      )
                    }
                    className='flex w-full cursor-pointer items-center justify-center gap-1.5 px-3 text-xs text-gray-500 dark:text-gray-400'
                  >
                    <span className='font-medium'>
                      {getThanksInfo(doubanImageProxyType)!.text}
                    </span>
                    <ExternalLink className='w-3.5 opacity-70' />
                  </button>
                </div>
              )}
            </div>

            {/* 豆瓣图片代理地址设置 - 仅在选择自定义代理时显示 */}
            {doubanImageProxyType === 'custom' && (
              <div className='space-y-3'>
                <div>
                  <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                    豆瓣图片代理地址
                  </h4>
                  <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                    自定义图片代理服务器地址
                  </p>
                </div>
                <input
                  type='text'
                  className='w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder-gray-500 shadow-sm transition-all duration-200 hover:border-gray-400 focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-400 dark:hover:border-gray-500'
                  placeholder='例如: https://proxy.example.com/fetch?url='
                  value={doubanImageProxyUrl}
                  onChange={(e) =>
                    handleDoubanImageProxyUrlChange(e.target.value)
                  }
                />
              </div>
            )}

            {/* 分割线 */}
            <div className='border-t border-gray-200 dark:border-gray-700'></div>

            {/* 默认聚合搜索结果 */}
            <div className='flex items-center justify-between'>
              <div>
                <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                  默认聚合搜索结果
                </h4>
                <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                  搜索时默认按标题和年份聚合显示结果
                </p>
              </div>
              <label className='flex cursor-pointer items-center'>
                <div className='relative'>
                  <input
                    type='checkbox'
                    className='peer sr-only'
                    checked={defaultAggregateSearch}
                    onChange={(e) => handleAggregateToggle(e.target.checked)}
                  />
                  <div className='h-6 w-11 rounded-full bg-gray-300 transition-colors peer-checked:bg-green-500 dark:bg-gray-600'></div>
                  <div className='absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform peer-checked:translate-x-5'></div>
                </div>
              </label>
            </div>

            {/* 优选和测速 */}
            <div className='flex items-center justify-between'>
              <div>
                <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                  优选和测速
                </h4>
                <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                  如出现播放器劫持问题可关闭
                </p>
              </div>
              <label className='flex cursor-pointer items-center'>
                <div className='relative'>
                  <input
                    type='checkbox'
                    className='peer sr-only'
                    checked={enableOptimization}
                    onChange={(e) => handleOptimizationToggle(e.target.checked)}
                  />
                  <div className='h-6 w-11 rounded-full bg-gray-300 transition-colors peer-checked:bg-green-500 dark:bg-gray-600'></div>
                  <div className='absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform peer-checked:translate-x-5'></div>
                </div>
              </label>
            </div>

            {/* 源站超时自动换源 */}
            <div className='flex items-center justify-between'>
              <div>
                <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                  源站超时自动换源(实验性)
                </h4>
                <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                  播放源加载超时后，自动切换到下一个候选源
                </p>
              </div>
              <label className='flex cursor-pointer items-center'>
                <div className='relative'>
                  <input
                    type='checkbox'
                    className='peer sr-only'
                    checked={autoSwitchSourceOnTimeout}
                    onChange={(e) =>
                      handleAutoSwitchSourceOnTimeoutToggle(e.target.checked)
                    }
                  />
                  <div className='h-6 w-11 rounded-full bg-gray-300 transition-colors peer-checked:bg-green-500 dark:bg-gray-600'></div>
                  <div className='absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform peer-checked:translate-x-5'></div>
                </div>
              </label>
            </div>

            {/* 流式搜索 */}
            <div className='flex items-center justify-between'>
              <div>
                <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                  流式搜索输出
                </h4>
                <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                  启用搜索结果实时流式输出，关闭后使用传统一次性搜索
                </p>
              </div>
              <label className='flex cursor-pointer items-center'>
                <div className='relative'>
                  <input
                    type='checkbox'
                    className='peer sr-only'
                    checked={fluidSearch}
                    onChange={(e) => handleFluidSearchToggle(e.target.checked)}
                  />
                  <div className='h-6 w-11 rounded-full bg-gray-300 transition-colors peer-checked:bg-green-500 dark:bg-gray-600'></div>
                  <div className='absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform peer-checked:translate-x-5'></div>
                </div>
              </label>
            </div>

            {/* 直播视频浏览器直连 */}
            <div className='flex items-center justify-between'>
              <div>
                <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                  IPTV 视频浏览器直连
                </h4>
                <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                  开启 IPTV 视频浏览器直连时，需要自备 Allow CORS 插件
                </p>
              </div>
              <label className='flex cursor-pointer items-center'>
                <div className='relative'>
                  <input
                    type='checkbox'
                    className='peer sr-only'
                    checked={liveDirectConnect}
                    onChange={(e) =>
                      handleLiveDirectConnectToggle(e.target.checked)
                    }
                  />
                  <div className='h-6 w-11 rounded-full bg-gray-300 transition-colors peer-checked:bg-green-500 dark:bg-gray-600'></div>
                  <div className='absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform peer-checked:translate-x-5'></div>
                </div>
              </label>
            </div>
          </div>

          {/* 底部说明 */}
          <div className='mt-6 border-t border-gray-200 pt-4 dark:border-gray-700'>
            <p className='text-center text-xs text-gray-500 dark:text-gray-400'>
              这些设置保存在本地浏览器中
            </p>
          </div>
        </div>
      </div>
      <AlertModal
        isOpen={alertModal.isOpen}
        onClose={hideAlert}
        type={alertModal.type}
        title={alertModal.title}
        message={alertModal.message}
        timer={alertModal.timer}
      />
    </>
  );

  // 修改密码面板内容
  const changePasswordPanel = (
    <>
      {/* 背景遮罩 */}
      <div
        className='fixed inset-0 z-[1000] bg-black/50 backdrop-blur-sm'
        onClick={handleCloseChangePassword}
        onTouchMove={(e) => {
          // 只阻止滚动，允许其他触摸事件
          e.preventDefault();
        }}
        onWheel={(e) => {
          // 阻止滚轮滚动
          e.preventDefault();
        }}
        style={{
          touchAction: 'none',
        }}
      />

      {/* 修改密码面板 */}
      <div className='fixed left-1/2 top-1/2 z-[1001] w-full max-w-md -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border border-gray-200/70 bg-white/80 shadow-2xl ring-1 ring-black/10 backdrop-blur-xl dark:border-white/10 dark:bg-gray-900/70 dark:ring-white/10'>
        {/* 内容容器 - 独立的滚动区域 */}
        <div
          className='h-full p-6'
          data-panel-content
          onTouchMove={(e) => {
            // 阻止事件冒泡到遮罩层，但允许内部滚动
            e.stopPropagation();
          }}
          style={{
            touchAction: 'auto', // 允许所有触摸操作
          }}
        >
          {/* 标题栏 */}
          <div className='mb-6 flex items-center justify-between'>
            <h3 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
              修改密码
            </h3>
            <button
              onClick={handleCloseChangePassword}
              className='flex h-8 w-8 items-center justify-center rounded-full p-1 text-gray-500 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800'
              aria-label='Close'
            >
              <X className='h-full w-full' />
            </button>
          </div>

          {/* 表单 */}
          <div className='space-y-4'>
            {/* 当前密码输入 */}
            <div>
              <label className='mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300'>
                当前密码
              </label>
              <input
                type='password'
                className='w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-500 transition-colors focus:border-transparent focus:outline-none focus:ring-2 focus:ring-green-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-400'
                placeholder='请输入当前密码'
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                disabled={passwordLoading}
              />
            </div>

            {/* 新密码输入 */}
            <div>
              <label className='mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300'>
                新密码
              </label>
              <input
                type='password'
                className='w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-500 transition-colors focus:border-transparent focus:outline-none focus:ring-2 focus:ring-green-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-400'
                placeholder='请输入新密码'
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                disabled={passwordLoading}
              />
            </div>

            {/* 确认密码输入 */}
            <div>
              <label className='mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300'>
                确认密码
              </label>
              <input
                type='password'
                className='w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-500 transition-colors focus:border-transparent focus:outline-none focus:ring-2 focus:ring-green-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-400'
                placeholder='请再次输入新密码'
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={passwordLoading}
              />
            </div>

            {/* 错误信息 */}
            {passwordError && (
              <div className='rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-500 dark:border-red-800 dark:bg-red-900/20'>
                {passwordError}
              </div>
            )}
          </div>

          {/* 操作按钮 */}
          <div className='mt-6 flex gap-3 border-t border-gray-200 pt-4 dark:border-gray-700'>
            <button
              onClick={handleCloseChangePassword}
              className='flex-1 rounded-md bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
              disabled={passwordLoading}
            >
              取消
            </button>
            <button
              onClick={handleSubmitChangePassword}
              className='flex-1 rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-green-700 dark:hover:bg-green-600'
              disabled={
                passwordLoading ||
                !oldPassword ||
                !newPassword ||
                !confirmPassword
              }
            >
              {passwordLoading ? '修改中...' : '确认修改'}
            </button>
          </div>

          {/* 底部说明 */}
          <div className='mt-4 border-t border-gray-200 pt-4 dark:border-gray-700'>
            <p className='text-center text-xs text-gray-500 dark:text-gray-400'>
              修改密码后需要重新登录
            </p>
          </div>
        </div>
      </div>
    </>
  );

  return (
    <>
      {variant === 'sidebar' ? (
        <div className='relative w-full'>
          <button
            ref={buttonRef}
            onClick={handleMenuClick}
            className={`${SIDEBAR_ITEM_LAYOUT_CLASS} w-full ${SIDEBAR_BUTTON_STATE_CLASS}`}
            aria-label='User Menu'
            title='用户'
          >
            <div className={`relative ${SIDEBAR_ITEM_ICON_WRAP_CLASS}`}>
              <User className={SIDEBAR_ITEM_ICON_CLASS} />
              {updateStatus === UpdateStatus.HAS_UPDATE && (
                <div className='absolute -right-1 -top-1 h-2 w-2 rounded-full bg-yellow-500'></div>
              )}
            </div>
            <span className={getSidebarItemLabelClass(isCollapsed)}>用户</span>
          </button>
        </div>
      ) : (
        <div className='relative'>
          <button
            ref={buttonRef}
            onClick={handleMenuClick}
            className='flex h-10 w-10 items-center justify-center rounded-full p-2 text-gray-600 transition-colors hover:bg-gray-200/50 dark:text-gray-300 dark:hover:bg-gray-700/50'
            aria-label='User Menu'
          >
            <User className='h-full w-full' />
          </button>
          {updateStatus === UpdateStatus.HAS_UPDATE && (
            <div className='absolute right-[2px] top-[2px] h-2 w-2 rounded-full bg-yellow-500'></div>
          )}
        </div>
      )}

      {/* 使用 Portal 将菜单面板渲染到 document.body */}
      {isOpen && mounted && createPortal(menuPanel, document.body)}

      {/* 使用 Portal 将设置面板渲染到 document.body */}
      {isSettingsOpen && mounted && createPortal(settingsPanel, document.body)}

      {/* 使用 Portal 将修改密码面板渲染到 document.body */}
      {isChangePasswordOpen &&
        mounted &&
        createPortal(changePasswordPanel, document.body)}

      {/* 版本面板 */}
      <VersionPanel
        isOpen={isVersionPanelOpen}
        onClose={() => setIsVersionPanelOpen(false)}
      />
    </>
  );
};
