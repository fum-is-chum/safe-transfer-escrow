import type { ClientWithCoreApi } from '@mysten/sui/client';
import { coinWithBalance, type Transaction } from '@mysten/sui/transactions';
import * as escrow from './generated/safe_transfer_escrow/escrow.js';
import { callPackage, getEscrow, type SafeTransferEscrowConfig } from './queries.js';

export interface DepositInput {
  /** Full coin type, e.g. `0x2::sui::SUI`. */
  coinType: string;
  amount: bigint | number;
}

export interface CreateEscrowInput {
  /** The signer. `tx.createEscrow` sets it as the transaction sender, which sources non-SUI coins. */
  sender: string;
  recipient: string;
  /** Repeated coin types are merged by the contract. At most 16 distinct types. */
  coins: DepositInput[];
}

/**
 * `new` -> `deposit` per coin -> `send`. The transaction sender becomes the escrow sender and
 * must be set for non-SUI coins (`tx.setSender`). Returns the new escrow's ID as a PTB result.
 */
export function createEscrow(config: SafeTransferEscrowConfig, input: CreateEscrowInput) {
  return (tx: Transaction) => {
    const draft = tx.add(
      escrow._new({ package: callPackage(config), arguments: [input.recipient] }),
    );
    for (const { coinType, amount } of input.coins) {
      tx.add(
        escrow.deposit({
          package: callPackage(config),
          arguments: [draft, coinWithBalance({ balance: amount, type: coinType })],
          typeArguments: [coinType],
        }),
      );
    }

    return tx.add(
      escrow.send({ package: callPackage(config), arguments: [draft, config.indexId] }),
    );
  };
}

/** Recipient takes every coin. Reads the escrow first, since coin types are only stored on it. */
export function claim(
  client: ClientWithCoreApi,
  config: SafeTransferEscrowConfig,
  escrowId: string,
) {
  return settle(client, config, escrowId, 'claim');
}

/** Sender takes every coin back. Reads the escrow first, since coin types are only stored on it. */
export function refund(
  client: ClientWithCoreApi,
  config: SafeTransferEscrowConfig,
  escrowId: string,
) {
  return settle(client, config, escrowId, 'refund');
}

/** `claim|refund` -> `withdraw` per coin type -> transfer to the caller -> `finish`. */
function settle(
  client: ClientWithCoreApi,
  config: SafeTransferEscrowConfig,
  escrowId: string,
  action: 'claim' | 'refund',
) {
  return async (tx: Transaction) => {
    const info = await getEscrow(client, config, escrowId);

    const settlement = tx.add(
      escrow[action]({
        package: callPackage(config),
        arguments: [escrowId, config.indexId],
      }),
    );
    const coins = info.coins.map(({ coinType }) =>
      tx.add(
        escrow.withdraw({
          package: callPackage(config),
          arguments: [settlement],
          typeArguments: [coinType],
        }),
      ),
    );
    tx.transferObjects(coins, action === 'claim' ? info.recipient : info.sender);
    tx.add(escrow.finish({ package: callPackage(config), arguments: [settlement] }));
  };
}
