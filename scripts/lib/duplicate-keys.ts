// Duplicate object keys in JSON text. JSON.parse keeps the last copy silently, so a check that
// parses first can never see them. Token-aware: braces, brackets, commas and quotes inside
// strings (including escaped quotes) are not structure.
export const duplicateJsonKeys = (text: string): string[] => {
  const duplicates: string[] = [];
  // One entry per open container: the keys seen so far for an object, null for an array.
  const stack: (Set<string> | null)[] = [];
  let expectKey = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      let end = i + 1;
      while (end < text.length && text[end] !== '"') end += text[end] === '\\' ? 2 : 1;
      const top = stack.at(-1);
      if (expectKey && top) {
        const key = JSON.parse(text.slice(i, end + 1)) as string;
        if (top.has(key)) duplicates.push(key);
        top.add(key);
        expectKey = false;
      }
      i = end;
    } else if (char === '{') {
      stack.push(new Set());
      expectKey = true;
    } else if (char === '[') {
      stack.push(null);
      expectKey = false;
    } else if (char === '}' || char === ']') stack.pop();
    else if (char === ',') expectKey = stack.at(-1) instanceof Set;
  }
  return duplicates;
};
