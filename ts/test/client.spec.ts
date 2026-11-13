import { SuiGrpcClient } from '@mysten/sui/grpc';
import { describe, expect, it } from 'vitest';
import { safeTransferEscrow } from '../src/index.js';
import { CONFIG, RECIPIENT, SENDER, SUI_TYPE } from './fixtures.js';

describe('safeTransferEscrow extension', () => {
  const client = new SuiGrpcClient({
    network: 'testnet',
    baseUrl: 'https://fullnode.testnet.sui.io:443',
  }).$extend(safeTransferEscrow(CONFIG));

  it('registers under the default name on any Core API client', () => {
    expect(client.safeTransferEscrow.listReceived).toBeTypeOf('function');
  });

  it('createEscrow sets the sender, which is the escrow sender and sources non-SUI coins', () => {
    const tx = client.safeTransferEscrow.tx.createEscrow({
      sender: SENDER,
      recipient: RECIPIENT,
      coins: [{ coinType: SUI_TYPE, amount: 1n }],
    });

    expect(tx.getData().sender).toBe(SENDER);
  });
});
