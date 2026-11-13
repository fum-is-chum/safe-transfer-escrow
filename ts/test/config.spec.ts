import { describe, expect, it } from 'vitest';
import { readConfig } from '../web/src/config.js';

const ID = `0x${'a'.repeat(64)}`;

describe('readConfig', () => {
  it('defaults the network to testnet', () => {
    expect(readConfig({ VITE_PACKAGE_ID: ID, VITE_INDEX_ID: ID })).toEqual({
      ok: true,
      config: { packageId: ID, indexId: ID, network: 'testnet' },
    });
  });

  it('accepts an optional published-at ID and rejects a malformed one', () => {
    const base = { VITE_PACKAGE_ID: ID, VITE_INDEX_ID: ID };

    expect(readConfig({ ...base, VITE_PUBLISHED_AT: ID })).toMatchObject({
      ok: true,
      config: { publishedAt: ID },
    });
    expect(readConfig({ ...base, VITE_PUBLISHED_AT: 'nope' })).toEqual({
      ok: false,
      problems: ['VITE_PUBLISHED_AT is not a 0x… object ID'],
    });
  });

  it('reports every problem at once so one restart fixes them all', () => {
    const result = readConfig({ VITE_PACKAGE_ID: 'nope', VITE_NETWORK: 'moon' });

    expect(result).toEqual({
      ok: false,
      problems: [
        'VITE_PACKAGE_ID is not a 0x… object ID',
        'VITE_INDEX_ID is not set',
        'VITE_NETWORK must be one of mainnet, testnet, devnet',
      ],
    });
  });
});
