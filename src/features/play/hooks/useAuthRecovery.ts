import { useCallback, useEffect, useState } from 'react';

import {
  SessionLostDetail,
  SessionLostReason,
} from '@/features/play/lib/playTypes';
import { AUTH_SESSION_LOST_EVENT } from '@/lib/auth.client';

interface UseAuthRecoveryOptions {
  doSaveCheckpoint: (reason?: SessionLostReason) => void;
  setIsVideoLoading: (loading: boolean) => void;
  setRealtimeLoadSpeed: (speed: string) => void;
}

interface AuthRecoveryState {
  authRecoveryVisible: boolean;
  authRecoveryReasonMessage: string;
  dismissAuthRecovery: () => void;
  handleReloginAndRecover: () => void;
}

function getAuthRecoveryMessage(reason: SessionLostReason): string {
  if (reason === 'user_banned')
    return '账号已被封禁，当前播放已保护。请联系管理员处理后重新登录。';
  if (reason === 'user_not_found')
    return '账号信息失效，当前播放已保护。请重新登录恢复观看。';
  return '登录状态已失效，当前播放进度已保护。重新登录后可自动回到当前位置。';
}

export function useAuthRecovery({
  doSaveCheckpoint,
  setIsVideoLoading,
  setRealtimeLoadSpeed,
}: UseAuthRecoveryOptions): AuthRecoveryState {
  const [authRecoveryVisible, setAuthRecoveryVisible] = useState(false);
  const [authRecoveryReason, setAuthRecoveryReason] =
    useState<SessionLostReason>('missing_cookie');
  const [authRecoveryLoginUrl, setAuthRecoveryLoginUrl] = useState('');

  useEffect(() => {
    const onSessionLost = (event: Event) => {
      const customEvent = event as CustomEvent<SessionLostDetail>;
      const sessionDetail = customEvent.detail;
      if (!sessionDetail?.inPlayerPage) return;

      doSaveCheckpoint(sessionDetail.reason);

      setAuthRecoveryReason(sessionDetail.reason);
      setAuthRecoveryLoginUrl(sessionDetail.loginUrl);
      setAuthRecoveryVisible(true);
      setIsVideoLoading(false);
      setRealtimeLoadSpeed('');
    };

    window.addEventListener(
      AUTH_SESSION_LOST_EVENT,
      onSessionLost as EventListener,
    );
    return () => {
      window.removeEventListener(
        AUTH_SESSION_LOST_EVENT,
        onSessionLost as EventListener,
      );
    };
  }, [doSaveCheckpoint, setIsVideoLoading, setRealtimeLoadSpeed]);

  const dismissAuthRecovery = useCallback(() => {
    setAuthRecoveryVisible(false);
  }, []);

  const handleReloginAndRecover = useCallback(() => {
    const target =
      authRecoveryLoginUrl ||
      `/login?redirect=${encodeURIComponent(
        window.location.pathname + window.location.search,
      )}`;
    window.location.href = target;
  }, [authRecoveryLoginUrl]);

  return {
    authRecoveryVisible,
    authRecoveryReasonMessage: getAuthRecoveryMessage(authRecoveryReason),
    dismissAuthRecovery,
    handleReloginAndRecover,
  };
}
