# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Sui Move package `safe_transfer_escrow` (edition 2024, no `[dependencies]` or `[addresses]`; framework is implicit). One module: `sources/escrow.move`; tests in `tests/escrow_tests.move`.

## Commands

```bash
sui move build --lint          # must stay at 0 warnings (`sui move lint` does not exist in CLI 1.68)
sui move test                  # all tests
sui move test <name_substring> # single test, e.g. `sui move test claim_pays`
sui move test --coverage && sui move coverage summary
```

`sui move test` has a per-test gas limit. Tests that touch many coin types can show `TIMEOUT`; raise it with `-i <gas>` rather than shrinking production bounds.

## Architecture

Sender locks several coin types for one recipient. Recipient claims or sender refunds, any time (no expiry). Each escrow is deleted when settled.

- **Escrow is a shared object, not a party object.** `transfer::party_transfer` accepts a single owner only, so one party-owned escrow cannot serve both claim and refund. `claim`/`refund` check `ctx.sender()` against the stored `recipient`/`sender`. Sender and recipient must differ (`new` aborts `ESelfEscrow`).
- **Coins live in a `Bag`** keyed by `TypeName` (`with_defining_ids<T>()`), holding `Balance<T>`. A Bag cannot be iterated, so both ends use hot potatoes (no abilities) the caller must finish in one PTB:
  - Create: `new` -> `deposit<T>` (repeat; same type merges) -> `send(draft, &mut EscrowIndex)`. `EscrowDraft` must end in `send`.
  - Settle: `claim`/`refund` (escrow, `&mut EscrowIndex`) delete the escrow and return `Settlement`; then `withdraw<T>` per coin type -> `finish`. `finish` aborts if any coin type is left.
- **`MAX_COIN_TYPES` (16)** bounds one escrow so a full settlement always fits in one transaction. Changing it also changes the capacity tests.
- **One global `EscrowIndex`.** Shared singleton with `by_sender` and `by_recipient`: `Table<address, Table<ID, address>>` (owner -> escrow id -> counterparty). The inner table is created with an owner's first entry and dropped with the last. Every `send`/`claim`/`refund` writes it, so all escrows are processed one at a time (accepted tradeoff for no setup step and one signature on first use); anyone can send an escrow to any address (spam accepted, filtered off-chain). It also holds `version`.
- **Versioning:** `EscrowIndex.version`; every public fn that touches it takes `&mut EscrowIndex` and asserts `version == VERSION` (`EWrongVersion`). After publishing an upgrade with a higher `VERSION`, the holder of `AdminCap` (sent to the publisher in `init`) calls `migrate(&mut EscrowIndex, &AdminCap)`, which disables all older package versions. `ENotUpgraded` if already current. `EscrowDraft` and `Settlement` also carry the `VERSION` that built them, checked in `deposit`/`send`/`withdraw`/`finish`, so an older package version cannot keep running the fund-moving helpers on current objects.
- **Events:** `EscrowCreated` (omits sender; native event metadata has it) and a single `EscrowSettled` with `Outcome::{Claimed, Refunded}`. Settled coins are recorded from actual `withdraw` amounts. `VersionMigrated {old, new}` covers the version change.

## Conventions

- Errors use `#[error(code = N)]` with descriptive byte-string messages; append new codes, never renumber.
- Test-only seams (`init_for_testing`, `set_version_for_testing`, event constructors, index readers) sit at the end of `escrow.move` under `#[test_only]`. Struct fields are private, so tests need them.
- Tests use a `Fixture` over `test_scenario`. A shared object returned in a transaction cannot be re-taken in the same transaction, so query helpers start a new one first.
- `assert_eq!` cannot compare tuples; helpers return `vector<u64>`.
- Skills used for this package: `/sui-move-guide` route (architecture, security, source-style, testing) and `/sui-dev-skills` move sub-skills.

## TypeScript SDK (`ts/`)

pnpm, ESM, `@mysten/sui` v2 (peer dependency), vitest. Client-extension pattern: `client.$extend(safeTransferEscrow({ packageId, indexId }))`. The package must be republished after any struct change (layouts are not upgrade-compatible); the index redesign needs a fresh publish, and `Published.toml` is stale until then. `EscrowIndex`/`AdminCap` IDs come from the publish output and `indexId` is caller config.

```bash
sui move summary                    # in repo root; writes gitignored package_summaries/
cd ts && pnpm codegen               # regenerates src/generated/ (committed; never edit by hand)
pnpm test                           # typecheck + vitest, no network
pnpm test -- tx                     # one spec file (test/tx.spec.ts)
pnpm build
pnpm example                        # examples/index.ts end-to-end run; needs examples/.env (see .env.example)
pnpm publish-package                # publish via @scallop-io/sui-package-kit; writes publish-result.<network>.json (add `-- --build-only` to just compile)
pnpm upgrade-package                # upgrades that package to a bumped VERSION in a temp copy, then migrates and moves publishedAt in the result file
pnpm web:dev                        # test frontend, see below
```

- **After any Move signature, struct or event change, rerun `sui move summary` then `pnpm codegen`.** The BCS layouts of `Escrow`/`EscrowIndex` in `src/generated/` must match the contract or index queries break silently.
- **Publishing** (`ts/publish/`, modelled on `~/Scallop/sui-lending-protocol`): uses `@scallop-io/sui-package-kit`'s low-level `SuiPackagePublisher`, not the all-in-one `SuiAdvancePackagePublisher`, because that one always passes `--skip-fetch-latest-git-deps`, which Sui CLI 1.68 rejects. package-kit and `@scallop-io/sui-kit` pull in `@mysten/sui` 1.x (dev-only, JSON-RPC client) next to the SDK's v2; `publish/tsconfig.json` maps their types by hand because their `exports` list none. They sign with `PUBLISHER_KEY` (+ optional `SUI_NETWORK`) from `ts/examples/.env`. `publish-result.<network>.json` (gitignored) holds `packageId` (original), `publishedAt` (latest), `upgradeCapId`, `indexId`, `adminCapId`. `Published.toml` is CLI-managed and is **not** updated by package-kit, so it goes stale after a package-kit publish.
- Generated Move calls take a `package` option; the SDK passes `packageId` directly, so no MVR `@local-pkg` override is needed. `packageId` must be the original (first published) ID, since it is also the type origin checked in `getEscrow`. After an upgrade + `migrate`, set `publishedAt` to the latest package ID: Move calls go there (`callPackage`), because calls to the original ID run old code and abort `EWrongVersion`.
- Claim/refund must read the escrow before building: the coin types to withdraw come from its `coins` list. That read runs in an async thunk, and `tx.add(asyncThunk)` does not run it until build, so tests call the thunk directly (`await claim(...)(tx)`).
- Listing: `getObject` on `indexId` (parse `EscrowIndex`) -> the side's table ID -> field of the owner address (`deriveDynamicFieldID` + `getObject`, parse `Field<address, Table>`) -> `listDynamicFields` (escrow ids) -> read each escrow + its bag fields. No entry = empty list (the contract drops an owner's table with its last escrow). `createEscrow` needs `sender` (set as the transaction sender). `listSent`/`listReceived` take an optional `{ limit }`; order is arbitrary, so a cap can hide real escrows. Escrows that settle mid-read are skipped. RPC cost of a list: index read once per client (side table IDs are cached), then 1 `getObject` (owner entry), the owner's table pages, and 1 `getObjects` per 50 escrows. Each `Escrow` stores its own `coins` list (`vector<CoinAmount>`, copied from the draft in `send`), so no bag is read; the `Bag` stays the source of truth for the balances.
- Move `TypeName` strings have 64-digit addresses without `0x`; `toCoinType` converts them. Returned coin types are normalized (zero-padded).
- `test/fixtures.ts` `FakeChain` stands in for the chain with real BCS bytes. Nothing in `ts/` has been run against the published package yet.

### Test frontend (`ts/web/`)

Vite + React 19 UI, run with `pnpm web:dev` / `pnpm web:build` from `ts/`; shares `ts/node_modules` (one `@mysten/sui`) and imports the SDK from `ts/src` directly.

- Config is `VITE_PACKAGE_ID`, `VITE_INDEX_ID`, optional `VITE_PUBLISHED_AT` (latest package ID after an upgrade), `VITE_NETWORK` in `ts/web/.env` (read by Vite only; restart the dev server after editing). `src/config.ts` `readConfig` validates them; missing values render a banner instead of the app.
- **Two wallets at once = two dApp Kit instances** (`createAccountKit` with different `storageKey`s). Hooks and `ConnectButton` take the instance explicitly; there is no `DAppKitProvider`. `ConnectButton` is imported from `@mysten/dapp-kit-react/ui`.
- Received escrows holding a coin with no metadata are hidden behind a Show button (anyone can send any coin type to any address); escrow lists print the full coin type.
- After any transaction, `useExecute` waits for indexing, then invalidates every `['escrows']` query so both panels refresh.
- Create form: coin dropdown = `listBalances` (non-zero, spendable total) + `getCoinMetadata` per coin (`useCoins.ts`, metadata cached forever). Amounts are typed in normal units; `parseUnits`/`formatUnits` shift by decimals and reject extra digits rather than round. A coin with no metadata falls back to 0 decimals (base units) and is labelled so; escrow lists use the same metadata.
- `pnpm typecheck` also checks `web/`. Only `format.ts` and `config.ts` have unit tests; components and wallet signing are untested.
