import { useCurrentClient } from '@mysten/dapp-kit-react';
import type { ClientWithCoreApi } from '@mysten/sui/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Network } from './config';
import type { AccountKit } from './dapp-kit';
import { shortType } from './format';

export interface CoinMeta {
  decimals: number;
  symbol: string;
}

/** A coin type the account holds, with what is needed to show and parse amounts. */
export interface CoinOption extends CoinMeta {
  coinType: string;
  /** Spendable total (coin objects + address balance), in base units. */
  balance: bigint;
  /** False when the coin has no on-chain metadata: decimals fall back to 0 (base units). */
  hasMetadata: boolean;
}

/** Metadata never changes for a coin type, so it is cached forever. `null` = none registered. */
export function coinMetaQuery(client: ClientWithCoreApi, network: Network, coinType: string) {
  return {
    queryKey: ['coin-metadata', network, coinType],
    staleTime: Infinity,
    queryFn: async (): Promise<CoinMeta | null> => {
      const { coinMetadata } = await client.core.getCoinMetadata({ coinType });

      return coinMetadata
        ? { decimals: coinMetadata.decimals, symbol: coinMetadata.symbol }
        : null;
    },
  };
}

export function useCoinMeta(dAppKit: AccountKit, network: Network, coinType: string) {
  const client = useCurrentClient({ dAppKit });

  return useQuery(coinMetaQuery(client, network, coinType));
}

/** Every coin type with a non-zero balance for `address`, SUI first. */
export function useCoinOptions(dAppKit: AccountKit, network: Network, address: string) {
  const client = useCurrentClient({ dAppKit });
  const queryClient = useQueryClient();

  return useQuery({
    queryKey: ['coin-options', network, address],
    queryFn: async (): Promise<CoinOption[]> => {
      const balances = [];
      let cursor: string | null = null;
      do {
        const page = await client.core.listBalances({ owner: address, cursor });
        balances.push(...page.balances);
        cursor = page.hasNextPage ? page.cursor : null;
      } while (cursor !== null);

      const options = await Promise.all(
        balances
          .filter((entry) => BigInt(entry.balance) > 0n)
          .map(async (entry): Promise<CoinOption> => {
            const meta = await queryClient.fetchQuery(
              coinMetaQuery(client, network, entry.coinType),
            );

            return {
              coinType: entry.coinType,
              balance: BigInt(entry.balance),
              decimals: meta?.decimals ?? 0,
              symbol: meta?.symbol ?? shortType(entry.coinType),
              hasMetadata: meta !== null,
            };
          }),
      );

      return options.sort((a, b) =>
        a.symbol === 'SUI' ? -1 : b.symbol === 'SUI' ? 1 : a.symbol.localeCompare(b.symbol),
      );
    },
  });
}
