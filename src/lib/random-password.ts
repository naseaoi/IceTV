const LOWER = 'abcdefghijkmnpqrstuvwxyz';
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGIT = '23456789';
const SYMBOL = '!@#$%^&*-_=+';
const ALPHABET = LOWER + UPPER + DIGIT + SYMBOL;

export const RANDOM_PASSWORD_LENGTH = 16;

// 拒绝采样消除取模偏置
function randomIndex(bound: number): number {
  const limit = Math.floor(256 / bound) * bound;
  const buffer = new Uint8Array(1);
  let value = limit;
  while (value >= limit) {
    crypto.getRandomValues(buffer);
    value = buffer[0];
  }
  return value % bound;
}

function pick(source: string): string {
  return source[randomIndex(source.length)];
}

function shuffle(chars: string[]): string[] {
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomIndex(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars;
}

// 四类字符各至少一个，剩余位从全表取
export function generateRandomPassword(
  length = RANDOM_PASSWORD_LENGTH,
): string {
  const required = [pick(LOWER), pick(UPPER), pick(DIGIT), pick(SYMBOL)];
  const rest = Array.from(
    { length: Math.max(0, length - required.length) },
    () => pick(ALPHABET),
  );
  return shuffle([...required, ...rest]).join('');
}
