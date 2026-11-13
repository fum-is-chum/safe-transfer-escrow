import { normalizeStructTag } from '@mysten/sui/utils';

/**
 * Converts a Move `TypeName` string (addresses are 64 hex digits without `0x`) into a
 * normalized type tag usable as a Move call type argument.
 */
export function toCoinType(typeName: string): string {
  return normalizeStructTag(typeName.replace(/(?<![0-9a-fA-Fx])([0-9a-f]{64})::/g, '0x$1::'));
}
