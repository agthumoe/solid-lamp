const unsafeCharacters = (path: string): boolean =>
  path.includes('\\') ||
  [...path].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);

// Lexical source identifiers only. Real file containment/opening is enforced by task #88.
export const validSourcePath = (path: string): boolean =>
  path.length > 0 &&
  path.length <= 2048 &&
  !/^(?:\/|[a-z][a-z\d+.-]*:)/i.test(path) &&
  !unsafeCharacters(path) &&
  path.split('/').every((part) => part !== '' && part !== '.' && part !== '..');

export const validNotePath = (path: string): boolean =>
  validSourcePath(path) && path.endsWith('.md');

export const fileStem = (path: string): string =>
  (path.split('/').at(-1) ?? '').replace(/\.md$/, '');

export const localTarget = (path: string, directory = ''): string | undefined => {
  if (/^(?:\/|[a-z][a-z\d+.-]*:)/i.test(path) || unsafeCharacters(path)) return undefined;
  const parts = directory ? directory.split('/') : [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (!parts.length) return undefined;
      parts.pop();
    } else parts.push(part);
  }
  return parts.length ? parts.join('/') : undefined;
};
