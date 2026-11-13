import { useWalletConnection } from '@mysten/dapp-kit-react';
import { AccountPanel } from './AccountPanel';
import type { AppConfig } from './config';
import type { AccountKit } from './dapp-kit';
import { shortId } from './format';

interface AppProps {
  config: AppConfig;
  kitA: AccountKit;
  kitB: AccountKit;
}

export function App({ config, kitA, kitB }: AppProps) {
  const addressA = useWalletConnection({ dAppKit: kitA }).account?.address;
  const addressB = useWalletConnection({ dAppKit: kitB }).account?.address;

  return (
    <main className="page">
      <header className="header">
        <h1>Safe Transfer Escrow</h1>
        <p className="muted">
          {config.network} · package {shortId(config.packageId)} · index {shortId(config.indexId)}
        </p>
        <p className="muted">
          Connect a different wallet account on each side (two accounts in one wallet, or two
          wallets).
        </p>
      </header>
      <div className="panels">
        <AccountPanel
          label="Account A"
          dAppKit={kitA}
          config={config}
          otherAddress={addressB}
        />
        <AccountPanel
          label="Account B"
          dAppKit={kitB}
          config={config}
          otherAddress={addressA}
        />
      </div>
    </main>
  );
}
