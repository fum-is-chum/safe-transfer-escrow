import { normalizeStructTag } from '@mysten/sui/utils';

const SUI_TYPE = normalizeStructTag('0x2::sui::SUI');
const U64_MAX = 18_446_744_073_709_551_615n;

/** `0x1234…abcd` */
export function shortId(id: string): string {
  return id.length <= 12 ? id : `${id.slice(0, 6)}…${id.slice(-4)}`;
}

/** Shortens every address inside a type tag; the SUI coin becomes `SUI`. */
export function shortType(coinType: string): string {
  if (normalizeStructTag(coinType) === SUI_TYPE) return 'SUI';

  return coinType.replace(/0x[0-9a-fA-F]{64}/g, shortId);
}

/** Base units -> decimal string, e.g. `1500000000n, 9` -> `1.5`. */
export function formatUnits(amount: bigint, decimals: number): string {
  if (decimals === 0) return amount.toString();

  const scale = 10n ** BigInt(decimals);
  const fraction = (amount % scale).toString().padStart(decimals, '0').replace(/0+$/, '');

  return fraction ? `${amount / scale}.${fraction}` : `${amount / scale}`;
}

/**
 * Decimal string -> base units, e.g. `'1.5', 9` -> `1500000000n`. Returns `null` for anything but
 * a positive plain decimal with at most `decimals` fractional digits that fits a u64.
 */
export function parseUnits(text: string, decimals: number): bigint | null {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text.trim());
  if (!match) return null;

  const [, whole, fraction = ''] = match;
  if (fraction.length > decimals) return null;

  const amount = BigInt(whole + fraction.padEnd(decimals, '0'));

  return amount > 0n && amount <= U64_MAX ? amount : null;
}
