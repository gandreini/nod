import { money as format } from '../../../src/web/lib/money';

export function money(value: number) {
  return format(value).replace('US$', '$');
}
