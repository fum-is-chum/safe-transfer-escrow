# safe-transfer-escrow-sdk

TypeScript SDK for the `safe_transfer_escrow` Move package (one escrow holds several coin types; the
recipient claims, the sender can refund any time).

## Setup

```ts
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { safeTransferEscrow } from 'safe-transfer-escrow-sdk';

const client = new SuiGrpcClient({
  network: 'testnet',
  baseUrl: 'https://fullnode.testnet.sui.io:443',
}).$extend(
  safeTransferEscrow({
    packageId: '0x...', // original (first published) package ID
    publishedAt: '0x...', // optional: latest package ID after an upgrade (calls go here)
    indexId: '0x...', // shared EscrowIndex created at publication
  }),
);
```

## Use

```ts
const sdk = client.safeTransferEscrow;

// Create: the sender is the escrow sender and must differ from the recipient.
const tx = sdk.tx.createEscrow({
  sender,
  recipient,
  coins: [
    { coinType: '0x2::sui::SUI', amount: 1_000_000_000n },
    { coinType: usdcType, amount: 5_000_000n },
  ],
});

// Find pending transfers from either side.
const received = await sdk.listReceived(address);
const sent = await sdk.listSent(address);

// Settle: recipient claims, sender refunds. Coins are sent to the signer's side of the escrow.
const claimTx = sdk.tx.claim(escrowId);
const refundTx = sdk.tx.refund(escrowId);
```

`sdk.call.*` returns the same operations as thunks for `transaction.add(...)`. `listReceived` and
`listSent` (optional `{ limit }`; order is arbitrary, so a cap can hide real escrows) return `{ id, sender, recipient, coins: { coinType, amount }[] }`; `coinType` is
normalized, so compare with `normalizeStructTag`.

## Develop

```bash
pnpm codegen   # regenerate src/generated after any Move change (run `sui move summary` in the repo root first)
pnpm test      # typecheck + vitest (no network)
pnpm build
```

Tests run against an in-memory stand-in for the chain. Nothing here has been run against a published
package yet.

## Publish and upgrade

`pnpm publish-package` publishes with `@scallop-io/sui-package-kit` and writes `publish-result.<network>.json` at the repo root (package, `UpgradeCap`, `EscrowIndex`, `AdminCap` IDs) and prints the env lines to copy. `pnpm publish-package -- --build-only` compiles without a key. `pnpm upgrade-package` upgrades to a bumped `VERSION` (from a temp copy), calls `migrate`, and records the new `publishedAt`; set `publishedAt` / `VITE_PUBLISHED_AT` to it afterwards. Both sign with `PUBLISHER_KEY` from `examples/.env`.

## Test frontend (`web/`)

Two-sided UI for trying escrows by hand: connect a wallet account on each side, list each address's
pending escrows (received → Claim, sent → Refund), and create escrows.

```bash
# ts/web/.env (restart the dev server after editing)
VITE_PACKAGE_ID=0x...   # original package ID
VITE_INDEX_ID=0x...     # shared EscrowIndex
VITE_PUBLISHED_AT=0x... # optional: latest package ID after an upgrade
VITE_NETWORK=testnet    # mainnet | testnet | devnet, default testnet

pnpm web:dev            # http://localhost:5173
pnpm web:build
```

Each side is its own dApp Kit instance, so connect two different accounts (two accounts in one
wallet, or two wallets). The create form's coin dropdown lists the account's balances; amounts are
typed in normal units (`1.5`) and shifted by the coin's on-chain decimals.
