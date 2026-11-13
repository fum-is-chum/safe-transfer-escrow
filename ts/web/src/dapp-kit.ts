import { createDAppKit } from '@mysten/dapp-kit-react';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import type { AppConfig } from './config';

/**
 * One dApp Kit instance holds one wallet connection, so each side of the page gets its own.
 * Distinct `storageKey`s keep each side's last account separate across reloads.
 */
export function createAccountKit(config: AppConfig, storageKey: string) {
  return createDAppKit({
    networks: [config.network] as const,
    defaultNetwork: config.network,
    createClient: (network) =>
      new SuiGrpcClient({ network, baseUrl: `https://fullnode.${network}.sui.io:443` }),
    storageKey,
  });
}

export type AccountKit = ReturnType<typeof createAccountKit>;
