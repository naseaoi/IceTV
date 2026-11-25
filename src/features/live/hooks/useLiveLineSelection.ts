import { useRef, useState } from 'react';

import {
  type LiveChannelGroup,
  liveChannelGroupKey,
  liveLineKey,
  sortLiveLines,
} from '@/features/live/lib/liveChannelGroups';
import type { LiveChannel, LiveSource } from '@/features/live/types';
import {
  readLiveLineResults,
  recordLiveLineResult,
} from '@/lib/live-line-results';
import { writeLastLiveChannel } from '@/lib/local-preferences';
import { showToast } from '@/lib/toast';

export function useLiveLineSelection({
  groups,
  currentChannel,
  currentSource,
  onChange,
}: {
  groups: LiveChannelGroup[];
  currentChannel: LiveChannel | null;
  currentSource: LiveSource | null;
  onChange: (line: LiveChannel) => void;
}) {
  const manual = useRef(new Map<string, string>());
  const attempted = useRef(new Set<string>());
  const failed = useRef(new Set<string>());
  const intent = useRef('');
  const latest = useRef({ currentChannel, currentSource, groups, onChange });
  latest.current = { currentChannel, currentSource, groups, onChange };
  const [resultVersion, setResultVersion] = useState(0);
  const currentGroup =
    groups.find(
      (group) =>
        group.groupKey ===
        (currentChannel && liveChannelGroupKey(currentChannel.name)),
    ) || null;
  const scope =
    currentSource && currentGroup
      ? JSON.stringify([currentSource.key, currentGroup.groupKey])
      : '';
  if (intent.current !== scope) {
    intent.current = scope;
    attempted.current = new Set();
    failed.current.clear();
  }
  if (currentChannel) attempted.current.add(liveLineKey(currentChannel));
  const ranked = currentGroup
    ? sortLiveLines(currentGroup.lines, readLiveLineResults())
    : [];
  const nextLine = ranked.find(
    (line) => !attempted.current.has(liveLineKey(line)),
  );
  const reset = () => {
    attempted.current.clear();
    failed.current.clear();
  };
  const selectGroup = (group: LiveChannelGroup) => {
    const key = JSON.stringify([currentSource?.key, group.groupKey]);
    const selected =
      group.lines.find(
        (line) => liveLineKey(line) === manual.current.get(key),
      ) || sortLiveLines(group.lines, readLiveLineResults())[0];
    if (
      currentGroup?.groupKey === group.groupKey &&
      liveLineKey(selected) === (currentChannel && liveLineKey(currentChannel))
    )
      return;
    reset();
    onChange(selected);
  };
  const selectLine = (line: LiveChannel) => {
    manual.current.set(scope, liveLineKey(line));
    reset();
    onChange(line);
  };
  const onFirstFrame = (line: LiveChannel, sourceKey: string) => {
    const current = latest.current;
    if (
      current.currentSource?.key !== sourceKey ||
      current.currentChannel?.id !== line.id
    )
      return;
    recordLiveLineResult(line.lineId, true);
    writeLastLiveChannel({
      sourceKey,
      groupKey: liveChannelGroupKey(line.name),
    });
    setResultVersion((version) => version + 1);
  };
  const onFailure = (line: LiveChannel, sourceKey: string) => {
    const current = latest.current;
    if (
      current.currentSource?.key !== sourceKey ||
      current.currentChannel?.id !== line.id
    )
      return;
    if (failed.current.has(liveLineKey(line))) return;
    failed.current.add(liveLineKey(line));
    recordLiveLineResult(line.lineId, false);
    attempted.current.add(liveLineKey(line));
    const group = current.groups.find(
      (group) => group.groupKey === liveChannelGroupKey(line.name),
    );
    const next =
      group &&
      sortLiveLines(group.lines, readLiveLineResults()).find(
        (candidate) => !attempted.current.has(liveLineKey(candidate)),
      );
    setResultVersion((version) => version + 1);
    if (!next || !group) return;
    attempted.current.add(liveLineKey(next));
    showToast(
      `线路 ${group.lines.indexOf(line) + 1} 无法播放，已切换到线路 ${group.lines.indexOf(next) + 1}`,
      'notice',
      { key: 'live-line-switch' },
    );
    current.onChange(next);
  };
  const retry = (retryPlayback: () => void) => {
    reset();
    const first =
      currentGroup &&
      sortLiveLines(currentGroup.lines, readLiveLineResults())[0];
    if (first && first.id !== currentChannel?.id) onChange(first);
    else retryPlayback();
  };
  return {
    currentGroup,
    nextLine,
    selectGroup,
    selectLine,
    onFirstFrame,
    onFailure,
    retry,
    resultVersion,
    switchNext: () => {
      if (nextLine) {
        attempted.current.add(liveLineKey(nextLine));
        onChange(nextLine);
      }
    },
  };
}
