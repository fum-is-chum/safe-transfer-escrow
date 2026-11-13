import { useCurrentClient } from '@mysten/dapp-kit-react';
import type { Transaction } from '@mysten/sui/transactions';
import { useQueryClient } from '@tanstack/react-query';
import type { AccountKit } from './dapp-kit';

/**
 * Signs with this side's wallet, throws on a failed transaction, waits for indexing, then
 * refreshes every escrow list (settling changes the counterparty's list too). Returns the digest.
 */
export function useExecute(dAppKit: AccountKit) {
  const client = useCurrentClient({ dAppKit });
  const queryClient = useQueryClient();

  return async (transaction: Transaction): Promise<string> => {
    const result = await dAppKit.signAndExecuteTransaction({ transaction });
    if (result.$kind === 'FailedTransaction') {
      const message = result.FailedTransaction.status.error?.message ?? 'Transaction failed';
      throw new Error(
        message.includes('EWrongVersion') || message.includes('Package version does not match')
          ? `${message} The contract was upgraded: set VITE_PUBLISHED_AT to the latest package ID and restart.`
          : message,
      );
    }

    await client.waitForTransaction({ digest: result.Transaction.digest });
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['escrows'] }),
      // Balances change on create (spent) and on claim/refund (received).
      queryClient.invalidateQueries({ queryKey: ['coin-options'] }),
    ]);

    return result.Transaction.digest;
  };
}
