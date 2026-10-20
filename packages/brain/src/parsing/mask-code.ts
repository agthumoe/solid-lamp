const blank = (text: string): string => text.replace(/[^\r\n]/g, ' ');

// Mask only code, keeping UTF-16 positions and newlines so extracted spans remain exact.
export const maskCode = (body: string): string => {
  let fence: { marker: string; length: number } | undefined;
  const lines = [...body.matchAll(/([^\r\n]*)(\r\n|\r|\n|$)/g)].filter((line) => line[0]);
  const withoutBlocks = lines
    .map(([raw, content = '']) => {
      const marker = content.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
      if (fence) {
        if (
          marker?.[1]?.[0] === fence.marker &&
          marker[1].length >= fence.length &&
          !marker[2]?.trim()
        )
          fence = undefined;
        return blank(raw);
      }
      if (marker?.[1] && !(marker[1][0] === '`' && marker[2]?.includes('`'))) {
        fence = { marker: marker[1][0] ?? '`', length: marker[1].length };
        return blank(raw);
      }
      return /^(?: {4}|\t)/.test(content) ? blank(raw) : raw;
    })
    .join('');
  // Compare complete delimiter runs: a regexp may backtrack a double opener into a single.
  const runs = [...withoutBlocks.matchAll(/`+/g)];
  let output = '';
  let cursor = 0;
  for (let i = 0; i < runs.length; i++) {
    const opener = runs[i];
    if (!opener || isEscaped(withoutBlocks, opener.index)) continue;
    let j = i + 1;
    while (j < runs.length && runs[j]?.[0].length !== opener[0].length) j++;
    const closer = runs[j];
    if (!closer) continue;
    const end = closer.index + closer[0].length;
    output +=
      withoutBlocks.slice(cursor, opener.index) + blank(withoutBlocks.slice(opener.index, end));
    cursor = end;
    i = j;
  }
  return output + withoutBlocks.slice(cursor);
};

export const isEscaped = (text: string, offset: number): boolean => {
  let count = 0;
  for (let cursor = offset - 1; cursor >= 0 && text[cursor] === '\\'; cursor--) count++;
  return count % 2 === 1;
};
