import type { ClientWithCoreApi } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import {
  getEscrow,
  listReceived,
  listSent,
  type ListOptions,
  type SafeTransferEscrowConfig,
} from './queries.js';
import * as txBuilders from './tx.js';
import type { CreateEscrowInput } from './tx.js';

export interface SafeTransferEscrowOptions<Name = 'safeTransferEscrow'>
  extends SafeTransferEscrowConfig {
  name?: Name;
}

/**
 * Client extension: `client.$extend(safeTransferEscrow({ packageId, indexId }))`, then
 * `client.safeTransferEscrow.listReceived(address)`.
 */
export function safeTransferEscrow<const Name = 'safeTransferEscrow'>({
  name = 'safeTransferEscrow' as Name,
  ...config
}: SafeTransferEscrowOptions<Name>) {
  return {
    name,
    register: (client: ClientWithCoreApi) => new SafeTransferEscrowClient({ client, ...config }),
  };
}

export class SafeTransferEscrowClient {
  #client: ClientWithCoreApi;
  #config: SafeTransferEscrowConfig;

  constructor({ client, ...config }: { client: ClientWithCoreApi } & SafeTransferEscrowConfig) {
    this.#client = client;
    this.#config = config;
  }

  getEscrow(escrowId: string) {
    return getEscrow(this.#client, this.#config, escrowId);
  }

  /** Pending escrows created by `address`. */
  listSent(address: string, options?: ListOptions) {
    return listSent(this.#client, this.#config, address, options);
  }

  /** Pending escrows addressed to `address`. */
  listReceived(address: string, options?: ListOptions) {
    return listReceived(this.#client, this.#config, address, options);
  }

  /** Ready-to-sign transactions. */
  tx = {
    createEscrow: (input: CreateEscrowInput) => {
      const transaction = new Transaction();
      transaction.setSender(input.sender);
      transaction.add(this.call.createEscrow(input));
      return transaction;
    },
    claim: (escrowId: string) => {
      const transaction = new Transaction();
      transaction.add(this.call.claim(escrowId));
      return transaction;
    },
    refund: (escrowId: string) => {
      const transaction = new Transaction();
      transaction.add(this.call.refund(escrowId));
      return transaction;
    },
  };

  /** Thunks to compose into a larger transaction with `transaction.add`. */
  call = {
    createEscrow: (input: CreateEscrowInput) => txBuilders.createEscrow(this.#config, input),
    claim: (escrowId: string) => txBuilders.claim(this.#client, this.#config, escrowId),
    refund: (escrowId: string) => txBuilders.refund(this.#client, this.#config, escrowId),
  };
}
