import { readResponseTextWithLimit } from './response-text';

const CONFIG_SUBSCRIPTION_MAX_BYTES = 2 * 1024 * 1024;

export function decodeConfigSubscriptionContent(
  content: string,
): Promise<string> {
  return import('bs58').then(({ default: bs58 }) => {
    const decodedBytes = bs58.decode(content.trim());
    return new TextDecoder().decode(decodedBytes);
  });
}

export function readConfigSubscriptionText(
  response: Response,
): Promise<string> {
  return readResponseTextWithLimit(
    response,
    CONFIG_SUBSCRIPTION_MAX_BYTES,
    '配置订阅',
  );
}
