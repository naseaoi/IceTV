const SCRIPT_JSON_ESCAPE_RE = /[<>&\u2028\u2029]/g;

const SCRIPT_JSON_ESCAPES: Record<string, string> = {
  '<': '\\u003C',
  '>': '\\u003E',
  '&': '\\u0026',
  '\u2028': '\\u2028',
  '\u2029': '\\u2029',
};

export function serializeForInlineScript(value: unknown): string {
  const serialized = JSON.stringify(value);

  if (serialized === undefined) {
    return 'undefined';
  }

  return serialized.replace(
    SCRIPT_JSON_ESCAPE_RE,
    (char) => SCRIPT_JSON_ESCAPES[char],
  );
}
