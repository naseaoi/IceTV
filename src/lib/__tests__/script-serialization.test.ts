import { serializeForInlineScript } from '../script-serialization';

describe('serializeForInlineScript', () => {
  it('escapes script-breaking characters while preserving data', () => {
    const lineSeparator = String.fromCharCode(0x2028);
    const paragraphSeparator = String.fromCharCode(0x2029);
    const value = {
      text: `</script><script>alert(1)</script>&${lineSeparator}${paragraphSeparator}`,
    };

    const serialized = serializeForInlineScript(value);

    expect(serialized).toContain('\\u003C/script\\u003E');
    expect(serialized).toContain('\\u0026');
    expect(serialized).not.toContain('</script>');
    expect(serialized).not.toContain('<');
    expect(serialized).not.toContain('>');
    expect(serialized).not.toContain('&');
    expect(serialized).not.toContain(lineSeparator);
    expect(serialized).not.toContain(paragraphSeparator);
    expect(JSON.parse(serialized)).toEqual(value);
  });
});
