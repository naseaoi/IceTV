import {
  isServerRelayPausedHlsError,
  SERVER_RELAY_PAUSED_HEADER,
} from '@/lib/server-relay';

it('reads the relay pause marker from XHR and fetch error details', () => {
  const xhr = {
    getResponseHeader: (name: string) =>
      name === SERVER_RELAY_PAUSED_HEADER ? '1' : null,
  };
  const fetchResponse = {
    headers: new Map([[SERVER_RELAY_PAUSED_HEADER, '1']]),
  };
  expect(isServerRelayPausedHlsError({ networkDetails: xhr })).toBe(true);
  expect(isServerRelayPausedHlsError({ networkDetails: fetchResponse })).toBe(
    true,
  );
});

it('ignores ordinary failures', () => {
  expect(isServerRelayPausedHlsError(null)).toBe(false);
  expect(isServerRelayPausedHlsError({ response: { code: 503 } })).toBe(false);
  expect(
    isServerRelayPausedHlsError({
      networkDetails: { getResponseHeader: () => null },
    }),
  ).toBe(false);
});
