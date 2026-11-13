import { describe, expect, it } from 'vitest';
import { formatUnits, parseUnits, shortId, shortType } from '../web/src/format.js';
import { USDC_TYPE } from './fixtures.js';

const U64_MAX = 18_446_744_073_709_551_615n;

describe('formatUnits', () => {
  it('shifts by the coin decimals and drops trailing zeros', () => {
    expect(formatUnits(1_500_000_000n, 9)).toBe('1.5');
    expect(formatUnits(1_000_000_000n, 9)).toBe('1');
    expect(formatUnits(1n, 9)).toBe('0.000000001');
    expect(formatUnits(0n, 9)).toBe('0');
    expect(formatUnits(2_500_000n, 6)).toBe('2.5');
  });

  it('shows base units unchanged for a coin with 0 decimals', () => {
    expect(formatUnits(42n, 0)).toBe('42');
  });

  it('keeps full precision for the largest u64', () => {
    expect(formatUnits(U64_MAX, 9)).toBe('18446744073.709551615');
  });
});

describe('parseUnits', () => {
  it('turns what a user types into base units for the coin decimals', () => {
    expect(parseUnits('1', 9)).toBe(1_000_000_000n);
    expect(parseUnits('100', 6)).toBe(100_000_000n);
    expect(parseUnits(' 1.5 ', 9)).toBe(1_500_000_000n);
    expect(parseUnits('0.000001', 6)).toBe(1n);
    expect(parseUnits('7', 0)).toBe(7n);
  });

  it('is the inverse of formatUnits', () => {
    for (const [amount, decimals] of [
      [1n, 9],
      [123_456_789n, 9],
      [U64_MAX, 9],
      [5n, 0],
    ] as const) {
      expect(parseUnits(formatUnits(amount, decimals), decimals)).toBe(amount);
    }
  });

  it('accepts exactly the u64 maximum and nothing above it', () => {
    expect(parseUnits('18446744073.709551615', 9)).toBe(U64_MAX);
    expect(parseUnits('18446744073.709551616', 9)).toBeNull();
  });

  it.each([
    ['empty', ''],
    ['blank', ' '],
    ['zero', '0'],
    ['zero with fraction', '0.0'],
    ['negative', '-1'],
    ['exponent', '1e3'],
    ['hex', '0x10'],
    ['text', 'abc'],
    ['bare dot', '.'],
    ['trailing dot', '1.'],
    ['leading dot', '.5'],
    ['comma', '1,5'],
  ])('rejects %s', (_name, text) => {
    expect(parseUnits(text, 9)).toBeNull();
  });

  it('rejects more fractional digits than the coin has decimals instead of rounding', () => {
    expect(parseUnits('1.1234567', 6)).toBeNull();
    expect(parseUnits('1.5', 0)).toBeNull();
  });
});

describe('shortType / shortId', () => {
  it('names the SUI coin and shortens other addresses', () => {
    expect(shortType('0x2::sui::SUI')).toBe('SUI');
    expect(shortType(USDC_TYPE)).toBe(`0x0000…000a::usdc::USDC`);
  });

  it('leaves short ids alone', () => {
    expect(shortId('0x1234')).toBe('0x1234');
  });
});
