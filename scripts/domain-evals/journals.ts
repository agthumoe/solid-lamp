import { fail } from './errors.ts';
import type { Suite } from './schema.ts';

type Case = Suite['cases'][number];
export function cents(amount: string): bigint {
  // No floating-point conversion; the schema checks exact two-decimal shape.
  if (!/^(?:0|[1-9][0-9]*)\.[0-9]{2}$/.test(amount)) fail('DOMAIN_MONEY_INVALID');
  return BigInt(amount.replace('.', ''));
}
export function validateJournals(entry: Case, sources: Suite['sources']): void {
  const entries = entry.expected.journal_entries ?? [];
  if (!entries.length) return;
  if (entry.agent !== 'accountant') fail('DOMAIN_JOURNAL_WRONG_AGENT');
  const chart = sources.find(
    (source) =>
      entry.source_ids.includes(source.source_id) && source.source_id === 'SYN-BAKERY-COA',
  );
  if (!chart) fail('DOMAIN_CHART_MISSING');
  // Version-2 fixture chart: "1000 Cash (debit); ...". Data parsing only.
  const accounts = new Map<string, string>();
  const header = 'Chart of accounts (number, name, normal balance): ';
  if (!chart.text.startsWith(header) || !chart.text.endsWith('.')) fail('DOMAIN_CHART_INVALID');
  const records = chart.text.slice(header.length, -1).split('; ');
  for (const record of records) {
    const match = /^([0-9]{4}) (.+?) \((?:debit|credit)\)$/.exec(record);
    const code = match?.[1];
    const name = match?.[2];
    if (!code || !name || accounts.has(code)) fail('DOMAIN_CHART_INVALID');
    accounts.set(code, name);
  }
  if (!accounts.size) fail('DOMAIN_CHART_INVALID');
  for (const journal of entries) {
    let debit = 0n;
    let credit = 0n;
    const used = new Set<string>();
    for (const line of journal.lines) {
      if (accounts.get(line.account) !== line.name) fail('DOMAIN_ACCOUNT_INVALID');
      const d = cents(line.debit);
      const c = cents(line.credit);
      if (d > 0n === c > 0n) fail('DOMAIN_LINE_TWO_SIDED_OR_ZERO');
      used.add(line.account);
      debit += d;
      credit += c;
    }
    if (used.size < 2) fail('DOMAIN_ENTRY_ACCOUNT_SPREAD');
    if (debit !== credit || debit !== cents(journal.total) || debit === 0n) {
      fail('DOMAIN_JOURNAL_UNBALANCED');
    }
  }
}
