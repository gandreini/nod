import { money as format } from '../../../src/web/lib/money';

export function money(value: number) {
  return format(value).replace('US$', '$');
}

export function monthlyLimit(typed: string): { usd: number } | { error: string } {
  const match = /^(\d+)(?:[.,](\d*))?$/.exec(typed.trim());
  const usd = match ? Number(`${match[1]}.${match[2] || '0'}`) : NaN;
  if (!(usd >= 1)) return { error: 'Enter a limit of at least $1.' };
  if ((match?.[2]?.length ?? 0) > 2)
    return { error: 'Use at most two decimals, for example 25.50.' };
  return { usd };
}
