import { useCurrentClient } from '@mysten/dapp-kit-react';
import { useMutation, useQueries, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { EscrowCoin, EscrowInfo, SafeTransferEscrowClient } from '../../src/index.js';
import type { Network } from './config';
import type { AccountKit } from './dapp-kit';
import { formatUnits, shortId } from './format';
import { coinMetaQuery, useCoinMeta } from './useCoins';
import { useExecute } from './useExecute';

type Side = 'received' | 'sent';

interface EscrowListProps {
  title: string;
  side: Side;
  address: string;
  sdk: SafeTransferEscrowClient;
  dAppKit: AccountKit;
  network: Network;
}

export function EscrowList({ title, side, address, sdk, dAppKit, network }: EscrowListProps) {
  const { data, isPending, isFetching, error, refetch } = useQuery({
    queryKey: ['escrows', network, side, address],
    queryFn: () => (side === 'received' ? sdk.listReceived(address) : sdk.listSent(address)),
    refetchInterval: 10_000,
  });

  return (
    <div className="list">
      <div className="list-header">
        <h3>{title}</h3>
        <button type="button" onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
      {isPending ? <p className="muted">Loading…</p> : null}
      {error ? (
        <p className="error" role="alert">
          {error.message}
        </p>
      ) : null}
      {data?.length === 0 ? <p className="muted">No pending escrows.</p> : null}
      <ul>
        {data?.map((escrow) => (
          <EscrowRow
            key={escrow.id}
            escrow={escrow}
            side={side}
            sdk={sdk}
            dAppKit={dAppKit}
            network={network}
          />
        ))}
      </ul>
    </div>
  );
}

interface EscrowRowProps {
  escrow: EscrowInfo;
  side: Side;
  sdk: SafeTransferEscrowClient;
  dAppKit: AccountKit;
  network: Network;
}

/** Normal units with the symbol once metadata loads; base units until then or if none exists. */
function CoinAmountText({
  coin,
  dAppKit,
  network,
}: {
  coin: EscrowCoin;
  dAppKit: AccountKit;
  network: Network;
}) {
  const { data: meta } = useCoinMeta(dAppKit, network, coin.coinType);

  return (
    <li>
      {meta
        ? `${formatUnits(coin.amount, meta.decimals)} ${meta.symbol}`
        : `${coin.amount} (base units, no metadata)`}{' '}
      {/* Anyone can publish a coin named like a real one; the full type is the only proof. */}
      <code>{coin.coinType}</code>
    </li>
  );
}

function EscrowRow({ escrow, side, sdk, dAppKit, network }: EscrowRowProps) {
  const execute = useExecute(dAppKit);
  const settle = useMutation({
    mutationFn: (id: string) =>
      execute(side === 'received' ? sdk.tx.claim(id) : sdk.tx.refund(id)),
  });
  const counterparty = side === 'received' ? escrow.sender : escrow.recipient;
  const client = useCurrentClient({ dAppKit });
  const metas = useQueries({
    queries: escrow.coins.map((coin) => coinMetaQuery(client, network, coin.coinType)),
  });
  const [revealed, setRevealed] = useState(false);
  // Anyone can send an escrow to any address. Hide received ones with coins that have no
  // metadata until the user asks, since such coins can imitate real ones. Sent ones stay visible
  // so the sender can always refund.
  const unverified = side === 'received' && metas.some((meta) => meta.data === null);

  if (unverified && !revealed) {
    return (
      <li className="row">
        <div>
          <p className="muted">
            Hidden: from <code title={counterparty}>{shortId(counterparty)}</code> with a coin that has
            no metadata.
          </p>
        </div>
        <button type="button" onClick={() => setRevealed(true)}>
          Show
        </button>
      </li>
    );
  }

  return (
    <li className="row">
      <div>
        <code title={escrow.id}>{shortId(escrow.id)}</code>{' '}
        <button type="button" onClick={() => navigator.clipboard.writeText(escrow.id)}>
          Copy ID
        </button>
        <p className="muted">
          {side === 'received' ? 'from' : 'to'} <code title={counterparty}>{shortId(counterparty)}</code>
        </p>
        <ul className="coins">
          {escrow.coins.map((coin) => (
            <CoinAmountText key={coin.coinType} coin={coin} dAppKit={dAppKit} network={network} />
          ))}
        </ul>
        {settle.error ? (
          <p className="error" role="alert">
            {settle.error.message}
          </p>
        ) : null}
      </div>
      <button type="button" onClick={() => settle.mutate(escrow.id)} disabled={settle.isPending}>
        {settle.isPending ? 'Waiting…' : side === 'received' ? 'Claim' : 'Refund'}
      </button>
    </li>
  );
}
