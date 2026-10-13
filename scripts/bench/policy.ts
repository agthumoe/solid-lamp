export function parseOptions(args: string[]) {
  const toggles = new Set(['--no-fallbacks', '--no-think', '--no-coresidency']);
  const valued = new Set(['--only', '--label']);
  const options = new Map<string, string | true>();
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (!key || (!toggles.has(key) && !valued.has(key))) throw new Error(`unknown option: ${key}`);
    if (options.has(key)) throw new Error(`duplicate option: ${key}`);
    if (toggles.has(key)) options.set(key, true);
    else {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error(`missing value: ${key}`);
      options.set(key, value);
    }
  }
  return {
    flag: (name: string) => options.get(`--${name}`) === true,
    opt: (name: string) => {
      const value = options.get(`--${name}`);
      return typeof value === 'string' ? value : undefined;
    },
  };
}
export function scoreRefusal(answer: string) {
  return {
    semantic: /^I don['’]t know\.?$/.test(answer.trim()),
    exact: answer.trim() === "I don't know.",
  };
}
export function completionStatus(
  requiredMissing: number,
  optionalSkipped: number,
  probes: { kind: string; pass: boolean }[],
) {
  if (requiredMissing) return 'incomplete';
  if (probes.some((probe) => probe.kind === 'residency' && !probe.pass)) return 'residency_failed';
  return optionalSkipped ? 'complete_with_skips' : 'complete';
}
