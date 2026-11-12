'use client';
import { useEffect, useRef, useState } from 'react';

import type { SourceValidationStatus } from '@/features/admin/components/tabs/video-source/SortableSourceRow';
import { DataSource } from '@/features/admin/types/internal';
import { getErrorMessage } from '@/lib/user-facing-error';

interface ValidationResult {
  key: string;
  name: string;
  status: 'valid' | 'no_results' | 'invalid' | 'validating';
  message: string;
  resultCount: number;
}

interface UseSourceValidationOptions {
  sources: DataSource[];
}

export function useSourceValidation({ sources }: UseSourceValidationOptions) {
  const cleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanupRef.current?.(), []);
  const [error, setError] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [validationResults, setValidationResults] = useState<
    ValidationResult[]
  >([]);

  const startValidation = async (
    searchKeyword: string,
    sourceKeys?: string | string[],
  ) => {
    if (!searchKeyword.trim()) {
      setError('搜索关键词不能为空');
      return;
    }

    const requestedKeys =
      typeof sourceKeys === 'string'
        ? [sourceKeys]
        : Array.isArray(sourceKeys)
          ? sourceKeys
          : [];
    const requestedKeySet =
      requestedKeys.length > 0 ? new Set(requestedKeys) : null;
    const targets = requestedKeySet
      ? sources.filter((source) => requestedKeySet.has(source.key))
      : sources;

    if (requestedKeySet && targets.length !== requestedKeySet.size) {
      setError('源不存在');
      return;
    }

    cleanupRef.current?.();
    setError('');
    setIsValidating(true);
    const initialResults: ValidationResult[] = targets.map((source) => ({
      key: source.key,
      name: source.name,
      status: 'validating',
      message: '检测中...',
      resultCount: 0,
    }));

    setValidationResults((prev) => {
      if (!requestedKeySet) {
        return initialResults;
      }

      const initialResultMap = new Map(
        initialResults.map((result) => [result.key, result]),
      );
      const next = prev.map(
        (result) => initialResultMap.get(result.key) || result,
      );
      const existingKeys = new Set(prev.map((result) => result.key));
      initialResults.forEach((result) => {
        if (!existingKeys.has(result.key)) {
          next.push(result);
        }
      });
      return next;
    });

    const finishRows = (message: string) => {
      setIsValidating(false);
      setValidationResults((previous) =>
        previous.map((row) =>
          targets.some((source) => source.key === row.key) &&
          row.status === 'validating'
            ? { ...row, status: 'invalid', message }
            : row,
        ),
      );
    };
    try {
      const params = new URLSearchParams({
        q: searchKeyword.trim(),
      });
      if (requestedKeys.length === 1) {
        params.set('source', requestedKeys[0]);
      } else if (requestedKeys.length > 1) {
        params.set('sources', requestedKeys.join(','));
      }
      const eventSource = new EventSource(
        `/api/admin/source/validate?${params.toString()}`,
      );

      let done = false;
      const timer = setTimeout(() => finish('检测超时，请重试'), 60000);
      const close = () => {
        done = true;
        clearTimeout(timer);
        eventSource.close();
      };
      const finish = (message: string) => {
        if (done) return;
        close();
        finishRows(message || '未收到检测结果，请重试');
        setError(message);
      };
      cleanupRef.current = close;
      eventSource.onmessage = (event) => {
        if (done) return;
        try {
          const data = JSON.parse(event.data);

          switch (data.type) {
            case 'start':
              break;

            case 'source_result':
            case 'source_error':
              setValidationResults((prev) => {
                const existing = prev.find((r) => r.key === data.source);
                const message =
                  data.status === 'valid'
                    ? '搜索正常'
                    : data.status === 'no_results'
                      ? '无法搜索到结果'
                      : '连接失败';
                const next: ValidationResult = {
                  key: data.source,
                  name:
                    sources.find((s) => s.key === data.source)?.name ||
                    data.source,
                  status: data.status,
                  message,
                  resultCount: data.status === 'valid' ? 1 : 0,
                };
                if (existing) {
                  return prev.map((r) => (r.key === data.source ? next : r));
                }
                return [...prev, next];
              });
              break;

            case 'complete':
              finish('');
              break;
          }
        } catch {
          finish('检测结果读取失败，请重试');
        }
      };

      eventSource.onerror = () => finish('连接错误，请重试');
    } catch (error) {
      const message = getErrorMessage(error, '检测失败，请重试');
      finishRows(message);
      setError(message);
    }
  };

  const getValidationStatus = (
    sourceKey: string,
  ): SourceValidationStatus | null => {
    const result = validationResults.find((r) => r.key === sourceKey);
    if (!result) return null;

    switch (result.status) {
      case 'validating':
        return {
          text: '检测中',
          className:
            'bg-brand-100 dark:bg-brand-900/20 text-brand-800 dark:text-brand-300',
          icon: '⟳',
          message: result.message,
        };
      case 'valid':
        return {
          text: '有效',
          className:
            'bg-brand-100 dark:bg-brand-900/20 text-brand-800 dark:text-brand-300',
          icon: '✓',
          message: result.message,
        };
      case 'no_results':
        return {
          text: '无法搜索',
          className:
            'bg-yellow-100 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-300',
          icon: '⚠',
          message: result.message,
        };
      case 'invalid':
        return {
          text: '无效',
          className:
            'bg-red-100 dark:bg-red-900/20 text-red-800 dark:text-red-300',
          icon: '✗',
          message: result.message,
        };
      default:
        return null;
    }
  };

  return {
    isValidating,
    error,
    startValidation,
    getValidationStatus,
  };
}
