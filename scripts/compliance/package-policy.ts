// Exact pins for every manifest; internal workspace links are the only non-semver form.
const EXACT = /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/;

export function pinViolations(
  manifest: string,
  dependencies: Readonly<Record<string, string>>,
): string[] {
  return Object.entries(dependencies).flatMap(([name, version]) => {
    if (name.startsWith('@aetherion/') && version === 'workspace:*') return [];
    return EXACT.test(version) ? [] : [`${manifest}: dependency ${name} is not exact-pinned`];
  });
}
