'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import CardActionOverlay, {
  type CardActionContent,
} from '@/components/card-actions/CardActionOverlay';
import ConfirmModal from '@/components/modals/ConfirmModal';
import {
  Favorite,
  generateStorageKey,
  getAllFavorites,
  subscribeToDataUpdates,
} from '@/lib/db.client';

type ActionSheetPayload = CardActionContent;

type ConfirmPayload = {
  objectKey?: string;
  operation?: string;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
};

type ActionSheetState = {
  ownerId: string;
  payload: ActionSheetPayload;
  onClose?: () => void;
} | null;

type ConfirmState = {
  ownerId: string;
  payload: ConfirmPayload;
} | null;

type FavoriteListener = () => void;

type CardInteractionContextValue = {
  showActionSheet: (
    ownerId: string,
    payload: ActionSheetPayload,
    onClose?: () => void,
  ) => void;
  hideActionSheet: (ownerId?: string) => void;
  showConfirm: (ownerId: string, payload: ConfirmPayload) => void;
  hideConfirm: (ownerId?: string) => void;
  ensureFavoritesLoaded: () => Promise<void>;
  getFavoriteStatus: (storageKey: string) => boolean;
  subscribeFavoriteKey: (
    storageKey: string,
    listener: FavoriteListener,
  ) => () => void;
};

const CardInteractionContext =
  createContext<CardInteractionContextValue | null>(null);

function getChangedFavoriteKeys(
  previous: Record<string, Favorite>,
  next: Record<string, Favorite>,
) {
  const changedKeys = new Set<string>();

  Object.keys(previous).forEach((key) => {
    if (!(key in next)) {
      changedKeys.add(key);
    }
  });

  Object.keys(next).forEach((key) => {
    if (!(key in previous) || previous[key] !== next[key]) {
      changedKeys.add(key);
    }
  });

  return changedKeys;
}

export function CardInteractionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [actionSheetState, setActionSheetState] =
    useState<ActionSheetState>(null);
  const actionSheetStateRef = useRef<ActionSheetState>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState>(null);

  const inFlight = useRef(new Set<string>());
  const [pendingActions, setPendingActions] = useState(new Set<string>());
  const actionKey =
    actionSheetState?.payload.objectKey ?? actionSheetState?.ownerId ?? '';
  const runAction = (key: string, run: () => void | Promise<void>) => {
    if (inFlight.current.has(key)) return;
    inFlight.current.add(key);
    setPendingActions(new Set(inFlight.current));
    return (async () => run())().finally(() => {
      inFlight.current.delete(key);
      setPendingActions(new Set(inFlight.current));
    });
  };

  const favoritesRef = useRef<Record<string, Favorite>>({});
  const favoritesLoadedRef = useRef(false);
  const favoriteListenersRef = useRef<Map<string, Set<FavoriteListener>>>(
    new Map(),
  );
  const pendingFavoritesLoadRef = useRef<Promise<void> | null>(null);

  const notifyFavoriteKeys = useCallback((keys: Iterable<string>) => {
    Array.from(keys).forEach((key) => {
      favoriteListenersRef.current.get(key)?.forEach((listener) => listener());
    });
  }, []);

  const applyFavorites = useCallback(
    (nextFavorites: Record<string, Favorite>) => {
      const changedKeys = getChangedFavoriteKeys(
        favoritesRef.current,
        nextFavorites,
      );

      favoritesRef.current = nextFavorites;
      favoritesLoadedRef.current = true;

      if (changedKeys.size > 0) {
        notifyFavoriteKeys(changedKeys);
      }
    },
    [notifyFavoriteKeys],
  );

  const ensureFavoritesLoaded = useCallback(async () => {
    if (favoritesLoadedRef.current) {
      return;
    }

    if (!pendingFavoritesLoadRef.current) {
      pendingFavoritesLoadRef.current = getAllFavorites()
        .then((favorites) => {
          applyFavorites(favorites);
        })
        .finally(() => {
          pendingFavoritesLoadRef.current = null;
        });
    }

    await pendingFavoritesLoadRef.current;
  }, [applyFavorites]);

  useEffect(() => {
    return subscribeToDataUpdates(
      'favoritesUpdated',
      (newFavorites: Record<string, Favorite>) => {
        applyFavorites(newFavorites);
      },
    );
  }, [applyFavorites]);

  const showActionSheet = useCallback(
    (ownerId: string, payload: ActionSheetPayload, onClose?: () => void) => {
      const current = actionSheetStateRef.current;
      if (current && current.ownerId !== ownerId) {
        current.onClose?.();
      }

      const nextState = { ownerId, payload, onClose };
      actionSheetStateRef.current = nextState;
      setActionSheetState(nextState);
    },
    [],
  );

  const hideActionSheet = useCallback((ownerId?: string) => {
    const current = actionSheetStateRef.current;
    if (!current || (ownerId && current.ownerId !== ownerId)) {
      return;
    }

    actionSheetStateRef.current = null;
    setActionSheetState(null);
    if (!ownerId) {
      current.onClose?.();
    }
  }, []);

  const showConfirm = useCallback(
    (ownerId: string, payload: ConfirmPayload) => {
      setConfirmState({ ownerId, payload });
    },
    [],
  );

  const hideConfirm = useCallback((ownerId?: string) => {
    setConfirmState((current) => {
      if (!current) {
        return current;
      }

      if (ownerId && current.ownerId !== ownerId) {
        return current;
      }

      return null;
    });
  }, []);

  const subscribeFavoriteKey = useCallback(
    (storageKey: string, listener: FavoriteListener) => {
      let listeners = favoriteListenersRef.current.get(storageKey);

      if (!listeners) {
        listeners = new Set();
        favoriteListenersRef.current.set(storageKey, listeners);
      }

      listeners.add(listener);

      return () => {
        const currentListeners = favoriteListenersRef.current.get(storageKey);

        if (!currentListeners) {
          return;
        }

        currentListeners.delete(listener);

        if (currentListeners.size === 0) {
          favoriteListenersRef.current.delete(storageKey);
        }
      };
    },
    [],
  );

  const getFavoriteStatus = useCallback((storageKey: string) => {
    return !!favoritesRef.current[storageKey];
  }, []);

  const contextValue = useMemo<CardInteractionContextValue>(
    () => ({
      showActionSheet,
      hideActionSheet,
      showConfirm,
      hideConfirm,
      ensureFavoritesLoaded,
      getFavoriteStatus,
      subscribeFavoriteKey,
    }),
    [
      ensureFavoritesLoaded,
      getFavoriteStatus,
      hideActionSheet,
      hideConfirm,
      showActionSheet,
      showConfirm,
      subscribeFavoriteKey,
    ],
  );

  return (
    <CardInteractionContext.Provider value={contextValue}>
      {children}
      <CardActionOverlay
        isOpen={!!actionSheetState}
        onClose={() => hideActionSheet()}
        title={actionSheetState?.payload.title || ''}
        actions={(actionSheetState?.payload.actions || []).map((action) => {
          if (
            !['favorite', 'tracking', 'mark-update-read', 'delete'].includes(
              action.id,
            )
          )
            return action;
          const key = `${actionKey}:${action.id}`;
          return {
            ...action,
            disabled: action.disabled || pendingActions.has(key),
            onClick: () => runAction(key, action.onClick),
          };
        })}
        poster={actionSheetState?.payload.poster}
        sources={actionSheetState?.payload.sources}
        sourceName={actionSheetState?.payload.sourceName}
        origin={actionSheetState?.payload.origin}
        anchorRect={actionSheetState?.payload.anchorRect}
      />
      <ConfirmModal
        isOpen={!!confirmState}
        title={confirmState?.payload.title || ''}
        message={confirmState?.payload.message || ''}
        confirmText={confirmState?.payload.confirmText}
        cancelText={confirmState?.payload.cancelText}
        danger={confirmState?.payload.danger}
        onCancel={() => hideConfirm()}
        onConfirm={() => {
          if (!confirmState) return;
          const { payload, ownerId } = confirmState;
          return runAction(
            `${payload.objectKey ?? ownerId}:${payload.operation ?? 'delete'}`,
            payload.onConfirm,
          );
        }}
      />
    </CardInteractionContext.Provider>
  );
}

export function useCardInteractionManager() {
  const context = useOptionalCardInteractionManager();

  if (!context) {
    throw new Error(
      'useCardInteractionManager 必须在 CardInteractionProvider 内使用',
    );
  }

  return context;
}

export function useOptionalCardInteractionManager() {
  return useContext(CardInteractionContext);
}

export function useFavoriteStatus(
  source?: string,
  id?: string,
  enabled = true,
  loadOnMount = false,
) {
  const { ensureFavoritesLoaded, getFavoriteStatus, subscribeFavoriteKey } =
    useCardInteractionManager();

  const storageKey = useMemo(() => {
    if (!enabled || !source || !id) {
      return null;
    }

    return generateStorageKey(source, id);
  }, [enabled, id, source]);

  useEffect(() => {
    if (!storageKey || !loadOnMount) {
      return;
    }

    void ensureFavoritesLoaded();
  }, [ensureFavoritesLoaded, loadOnMount, storageKey]);

  const subscribe = useCallback(
    (listener: FavoriteListener) => {
      if (!storageKey) {
        return () => {};
      }

      return subscribeFavoriteKey(storageKey, listener);
    },
    [storageKey, subscribeFavoriteKey],
  );

  const getSnapshot = useCallback(() => {
    if (!storageKey) {
      return false;
    }

    return getFavoriteStatus(storageKey);
  }, [getFavoriteStatus, storageKey]);

  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
