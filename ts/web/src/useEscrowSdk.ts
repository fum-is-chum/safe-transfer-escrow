import { useCurrentClient } from '@mysten/dapp-kit-react';
import { useMemo } from 'react';
import { SafeTransferEscrowClient } from '../../src/index.js';
import type { AppConfig } from './config';
import type { AccountKit } from './dapp-kit';

/** SDK bound to this side's client. */
export function useEscrowSdk(dAppKit: AccountKit, config: AppConfig) {
  const client = useCurrentClient({ dAppKit });

  return useMemo(
    () =>
      new SafeTransferEscrowClient({
        client,
        packageId: config.packageId,
        indexId: config.indexId,
        publishedAt: config.publishedAt,
      }),
    [client, config.packageId, config.indexId, config.publishedAt],
  );
}
