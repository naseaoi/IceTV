import { act, renderHook } from '@testing-library/react';

import { useLiveInactivityStop } from '@/features/live/hooks/useLiveInactivityStop';
import {
  LIVE_HIDDEN_STOP_MS,
  LIVE_IDLE_STOP_MS,
  LIVE_INACTIVITY_CHECK_MS,
} from '@/features/live/lib/liveInactivityPolicy';

let visibilityState: DocumentVisibilityState = 'visible';
let pictureInPictureElement: Element | null = null;

beforeAll(() => {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibilityState,
  });
  Object.defineProperty(document, 'pictureInPictureElement', {
    configurable: true,
    get: () => pictureInPictureElement,
  });
});

beforeEach(() => {
  jest.useFakeTimers();
  visibilityState = 'visible';
  pictureInPictureElement = null;
});

afterEach(() => {
  jest.useRealTimers();
});

function setHidden(hidden: boolean) {
  visibilityState = hidden ? 'hidden' : 'visible';
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

function advance(ms: number) {
  act(() => {
    jest.advanceTimersByTime(ms);
  });
}

function renderStop(streamKey = 'a', isStreaming = () => true) {
  const onStop = jest.fn();
  const hook = renderHook(
    ({ key }) => useLiveInactivityStop({ streamKey: key, isStreaming, onStop }),
    { initialProps: { key: streamKey } },
  );
  return { ...hook, onStop };
}

it('stops after the page stays hidden long enough', () => {
  const { result, onStop } = renderStop();
  setHidden(true);
  advance(LIVE_HIDDEN_STOP_MS - LIVE_INACTIVITY_CHECK_MS);
  expect(onStop).not.toHaveBeenCalled();

  advance(LIVE_INACTIVITY_CHECK_MS * 2);
  expect(onStop).toHaveBeenCalledTimes(1);
  expect(result.current.stopped).toBe(true);
});

it('restarts the hidden countdown when the page becomes visible again', () => {
  const { onStop } = renderStop();
  setHidden(true);
  advance(LIVE_HIDDEN_STOP_MS - LIVE_INACTIVITY_CHECK_MS * 2);
  setHidden(false);
  setHidden(true);
  advance(LIVE_HIDDEN_STOP_MS - LIVE_INACTIVITY_CHECK_MS * 2);
  expect(onStop).not.toHaveBeenCalled();
});

it('keeps streaming while hidden in picture-in-picture', () => {
  const { onStop } = renderStop();
  pictureInPictureElement = document.createElement('video');
  setHidden(true);
  advance(LIVE_HIDDEN_STOP_MS * 2);
  expect(onStop).not.toHaveBeenCalled();
});

it('stops a visible page after a long time without input', () => {
  const { onStop } = renderStop();
  advance(LIVE_IDLE_STOP_MS + LIVE_INACTIVITY_CHECK_MS);
  expect(onStop).toHaveBeenCalledTimes(1);
});

it('treats user input as activity', () => {
  const { onStop } = renderStop();
  advance(LIVE_IDLE_STOP_MS - LIVE_INACTIVITY_CHECK_MS * 4);
  act(() => {
    window.dispatchEvent(new Event('keydown'));
  });
  advance(LIVE_INACTIVITY_CHECK_MS * 8);
  expect(onStop).not.toHaveBeenCalled();
});

it('does not stop when no stream is playing', () => {
  const { onStop } = renderStop('a', () => false);
  setHidden(true);
  advance(LIVE_HIDDEN_STOP_MS * 2);
  expect(onStop).not.toHaveBeenCalled();
});

it('resumes on request or when the channel changes', () => {
  const { result, rerender } = renderStop();
  setHidden(true);
  advance(LIVE_HIDDEN_STOP_MS + LIVE_INACTIVITY_CHECK_MS);
  expect(result.current.stopped).toBe(true);

  rerender({ key: 'b' });
  expect(result.current.stopped).toBe(false);

  advance(LIVE_HIDDEN_STOP_MS + LIVE_INACTIVITY_CHECK_MS);
  expect(result.current.stopped).toBe(true);
  act(() => result.current.resume());
  expect(result.current.stopped).toBe(false);
});
