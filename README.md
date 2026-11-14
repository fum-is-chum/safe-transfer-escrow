# safe-transfer-escrow

A Sui Move escrow where one sender locks several coin types for one recipient. The recipient
claims them, or the sender takes them back (refund). Either can happen at any time; there is no
expiry. Each escrow is deleted once it settles.

This repo contains:

- **Move package** (`sources/escrow.move`): the on-chain escrow logic.
- **TypeScript SDK** (`ts/`): builds transactions and lists pending escrows. See [ts/README.md](ts/README.md).
- **Test web app** (`ts/web/`): a two-wallet UI for trying escrows by hand.
- **Audit report**: [safe-transfer-escrow-exvul-sui-move-audit-report.md](safe-transfer-escrow-exvul-sui-move-audit-report.md).

## How it works

- One escrow holds up to 16 coin types (`MAX_COIN_TYPES`), so a full claim or refund fits in one
  transaction.
- Escrows are shared objects. Claim and refund check that the caller is the stored recipient or
  sender. The sender and recipient must be different addresses.
- A shared `EscrowIndex` tracks pending escrows by sender and by recipient, so wallets can list
  them without scanning the chain.
- Creating and settling use "hot potato" values (no abilities, so they must be consumed in the
  same transaction):
  - Create: `new` → `deposit` (repeat) → `send`.
  - Settle: `claim` or `refund` → `withdraw` per coin type → `finish`. `finish` fails if any coin
    type is left.
- Versioning: every call checks the index version. After an upgrade, the `AdminCap` holder calls
  `migrate` to turn off older package versions.

Events: `EscrowCreated`, `EscrowSettled` (claimed or refunded, with the amounts actually withdrawn),
and `VersionMigrated`.

## Repo layout

```
sources/escrow.move     Move module
tests/escrow_tests.move Move tests
ts/                     TypeScript SDK, test web app, publish and upgrade scripts
.github/workflows/      npm publish workflow
Move.toml               Move package manifest (no dependencies; framework is implicit)
Published.toml          Testnet publish record written by the Sui CLI
publish-result.*.json   Object IDs from each publish (gitignored, local only)
```

## Move package

Requires the Sui CLI (1.68 or newer).

```bash
sui move build --lint   # must report 0 warnings
sui move test           # all tests
sui move test claim_pays # tests whose name matches a substring
sui move test --coverage && sui move coverage summary
sui move summary        # writes package_summaries/, used by the TypeScript codegen
```

Some tests touch many coin types and can hit the per-test gas limit (`TIMEOUT`). Raise it with
`-i <gas>` instead of lowering `MAX_COIN_TYPES`.

## TypeScript SDK

```bash
cd ts
pnpm install
pnpm test       # typecheck + vitest, no network
pnpm build
pnpm codegen    # regenerate src/generated after any Move struct, event or signature change
```

Usage, setup and the test web app are documented in [ts/README.md](ts/README.md).

## Publishing and upgrades

Publishing and upgrades are run from `ts/` and sign with a key from `ts/examples/.env` (see
`ts/examples/.env.example` for the variables). Each run writes `publish-result.<network>.json` at the repo
root with the package, upgrade cap, index and admin cap IDs.

```bash
cd ts
pnpm publish-package          # publish; add -- --build-only to compile without a key
pnpm upgrade-package          # upgrade a bumped VERSION, then call migrate
```

The SDK package is published to npm by [.github/workflows/publish-sdk.yml](.github/workflows/publish-sdk.yml)
when a GitHub release is published.

## Status

The package has a testnet publish record (`Published.toml`). The TypeScript SDK has not yet been run
against the published package.

## License

MIT. See [LICENSE](LICENSE).
