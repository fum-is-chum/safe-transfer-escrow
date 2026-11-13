import { useCurrentWallet, useWalletConnection } from '@mysten/dapp-kit-react';
import { ConnectButton } from '@mysten/dapp-kit-react/ui';
import { CreateEscrowForm } from './CreateEscrowForm';
import { EscrowList } from './EscrowList';
import type { AppConfig } from './config';
import type { AccountKit } from './dapp-kit';
import { useEscrowSdk } from './useEscrowSdk';

interface AccountPanelProps {
  label: string;
  dAppKit: AccountKit;
  config: AppConfig;
  /** The other side's address, to prefill the create form. */
  otherAddress: string | undefined;
}

export function AccountPanel({ label, dAppKit, config, otherAddress }: AccountPanelProps) {
  const { account, status } = useWalletConnection({ dAppKit });
  const wallet = useCurrentWallet({ dAppKit });
  const sdk = useEscrowSdk(dAppKit, config);

  return (
    <section className="panel" aria-label={label}>
      <h2>{label}</h2>
      <ConnectButton instance={dAppKit} />
      {status === 'connecting' || status === 'reconnecting' ? (
        <p className="muted">Connecting…</p>
      ) : null}
      {account ? (
        <>
          <p className="muted">
            {wallet?.name} · <code title={account.address}>{account.address}</code>
          </p>
          <EscrowList
            title="Received (you can claim)"
            side="received"
            address={account.address}
            sdk={sdk}
            dAppKit={dAppKit}
            network={config.network}
          />
          <EscrowList
            title="Sent (you can refund)"
            side="sent"
            address={account.address}
            sdk={sdk}
            dAppKit={dAppKit}
            network={config.network}
          />
          <CreateEscrowForm
            sender={account.address}
            otherAddress={otherAddress}
            sdk={sdk}
            dAppKit={dAppKit}
            network={config.network}
          />
        </>
      ) : null}
    </section>
  );
}
