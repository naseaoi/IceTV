'use client';

import { Link2, Share2, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useAuthSession } from '@/components/AuthProvider';
import {
  MODAL_CLOSE_BUTTON_CLASS,
  MODAL_TITLE_CLASS,
} from '@/components/modals/modal-styles';
import ModalShell, { useDeferredClose } from '@/components/modals/ModalShell';
import { OptionSwitchRow } from '@/components/OptionSwitchRow';
import { RECAP_BUTTON } from '@/features/annual-report/components/RecapPrimitives';
import {
  AnnualReportError,
  fetchRecapShareState,
  publishRecap,
  unpublishRecap,
} from '@/features/annual-report/lib/client';
import type { AnnualRecapShareState } from '@/features/playback-stats/types';
import { copyTextToClipboard } from '@/lib/clipboard';
import { showToast } from '@/lib/toast';

function errorText(error: unknown, fallback: string) {
  return error instanceof AnnualReportError ? error.message : fallback;
}

function ShareSheet({ year, onClose }: { year: number; onClose: () => void }) {
  const [open, requestClose] = useDeferredClose(onClose);
  const { session } = useAuthSession();
  const [state, setState] = useState<AnnualRecapShareState | null>(null);
  // 未公开时先记下选择，公开时一并提交
  const [hideRhythm, setHideRhythm] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetchRecapShareState(year, controller.signal)
      .then((next) => {
        setState(next);
        setHideRhythm(next.hideRhythm);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        showToast(errorText(error, '读取公开状态失败'), 'error');
        requestClose();
      });
    return () => controller.abort();
  }, [year, requestClose]);

  const published = state?.published ?? false;

  async function save(nextPublished: boolean, nextHideRhythm: boolean) {
    const previous = { state, hideRhythm };
    setSaving(true);
    setHideRhythm(nextHideRhythm);
    if (state) setState({ ...state, published: nextPublished });
    try {
      setState(
        nextPublished
          ? await publishRecap(year, nextHideRhythm)
          : await unpublishRecap(year),
      );
    } catch (error) {
      setState(previous.state);
      setHideRhythm(previous.hideRhythm);
      showToast(errorText(error, '保存失败，请稍后重试'), 'error');
    } finally {
      setSaving(false);
    }
  }

  const profileId =
    session.status === 'authenticated' ? session.profileId : null;

  async function copyLink() {
    if (!profileId) return;
    const ok = await copyTextToClipboard(
      `${window.location.origin}/u/${encodeURIComponent(profileId)}/recap/${year}`,
    );
    if (ok) showToast('已复制报告链接', 'success');
    else showToast('复制失败，请稍后重试', 'error');
  }

  return (
    <ModalShell
      isOpen={open}
      onClose={requestClose}
      panelClassName='max-w-sm p-5'
    >
      <div className='flex items-center justify-between gap-3'>
        <h2 className={MODAL_TITLE_CLASS}>分享 {year} 年度报告</h2>
        <button
          type='button'
          onClick={requestClose}
          aria-label='关闭'
          className={MODAL_CLOSE_BUTTON_CLASS}
        >
          <X className='h-4 w-4' />
        </button>
      </div>

      <div className='-mx-3 mt-3'>
        <OptionSwitchRow
          label='公开到个人主页'
          checked={published}
          pending={state === null}
          disabled={saving}
          onChange={(next) => {
            if (!saving) void save(next, hideRhythm);
          }}
        />
        <OptionSwitchRow
          label='隐藏作息时间'
          checked={hideRhythm}
          pending={state === null}
          disabled={saving}
          onChange={(next) => {
            if (saving) return;
            if (published) void save(true, next);
            else setHideRhythm(next);
          }}
        />
      </div>

      {published && profileId && (
        <button
          type='button'
          onClick={() => void copyLink()}
          disabled={saving}
          className={`${RECAP_BUTTON.primary} mt-4 w-full justify-center disabled:opacity-60`}
        >
          <Link2 className='h-4 w-4' />
          复制报告链接
        </button>
      )}
    </ModalShell>
  );
}

export function RecapShareButton({ year }: { year: number }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type='button'
        onClick={() => setOpen(true)}
        className={`${RECAP_BUTTON.secondary} gap-1.5`}
      >
        <Share2 className='h-4 w-4' />
        分享
      </button>
      {open && <ShareSheet year={year} onClose={() => setOpen(false)} />}
    </>
  );
}
