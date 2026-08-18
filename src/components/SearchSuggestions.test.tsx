import { act, render } from '@testing-library/react';

import SearchSuggestions from './SearchSuggestions';

const originalFetch = global.fetch;
const noop = () => {};

describe('SearchSuggestions', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ suggestions: [] }),
    });
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    global.fetch = originalFetch;
  });

  it('skips short and composing queries', async () => {
    const { rerender } = render(
      <SearchSuggestions
        query='影'
        isVisible
        onSelect={noop}
        onClose={noop}
        onEnterKey={noop}
      />,
    );

    await act(async () => {
      jest.advanceTimersByTime(300);
    });
    expect(global.fetch).not.toHaveBeenCalled();

    rerender(
      <SearchSuggestions
        query='电影'
        isVisible
        isComposing
        onSelect={noop}
        onClose={noop}
        onEnterKey={noop}
      />,
    );
    await act(async () => {
      jest.advanceTimersByTime(300);
    });
    expect(global.fetch).not.toHaveBeenCalled();

    rerender(
      <SearchSuggestions
        query='电影'
        isVisible
        onSelect={noop}
        onClose={noop}
        onEnterKey={noop}
      />,
    );
    await act(async () => {
      jest.advanceTimersByTime(300);
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('aborts the active request as soon as the query changes', async () => {
    (global.fetch as jest.Mock).mockImplementation(
      () => new Promise(() => undefined),
    );
    const { rerender } = render(
      <SearchSuggestions
        query='电影'
        isVisible
        onSelect={noop}
        onClose={noop}
        onEnterKey={noop}
      />,
    );

    await act(async () => {
      jest.advanceTimersByTime(300);
    });
    const firstSignal = (global.fetch as jest.Mock).mock.calls[0][1]
      .signal as AbortSignal;
    expect(firstSignal.aborted).toBe(false);

    rerender(
      <SearchSuggestions
        query='电影推荐'
        isVisible
        onSelect={noop}
        onClose={noop}
        onEnterKey={noop}
      />,
    );
    expect(firstSignal.aborted).toBe(true);

    await act(async () => {
      jest.advanceTimersByTime(300);
    });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
