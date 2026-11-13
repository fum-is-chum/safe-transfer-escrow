import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { readConfig } from './config';
import { createAccountKit } from './dapp-kit';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

const configResult = readConfig(import.meta.env);

// Kits are created once, outside React, so re-renders never recreate wallet connections.
const root = createRoot(document.getElementById('root')!);

if (!configResult.ok) {
  root.render(
    <StrictMode>
      <main className="page">
        <h1>Safe Transfer Escrow</h1>
        <div className="banner banner-error" role="alert">
          <p>Set these in ts/web/.env and restart the dev server:</p>
          <ul>
            {configResult.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
          <pre>{'VITE_PACKAGE_ID=0x...\nVITE_INDEX_ID=0x...\nVITE_NETWORK=testnet'}</pre>
        </div>
      </main>
    </StrictMode>,
  );
} else {
  const { config } = configResult;
  const kits = {
    a: createAccountKit(config, 'escrow-test:account-a'),
    b: createAccountKit(config, 'escrow-test:account-b'),
  };

  root.render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <App config={config} kitA={kits.a} kitB={kits.b} />
      </QueryClientProvider>
    </StrictMode>,
  );
}
