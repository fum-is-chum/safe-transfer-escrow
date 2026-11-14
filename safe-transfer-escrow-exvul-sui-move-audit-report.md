# Audit Report

## Information

| Field | Value |
|---|---|
| Review Time | 2026-11-13 |
| Project | safe-transfer-escrow |
| Scope | `sources/escrow.move` (module `safe_transfer_escrow::escrow`); `tests/escrow_tests.move` read for intended invariants only |

## Findings Summary

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 2 |
| Informational | 1 |
| Unvalidated | 9 |

## F-01 Single Global Index Serializes Every Send, Claim and Refund

| Field | Value |
|---|---|
| Risk | Low |
| Affected | `escrow::send` (L172), `escrow::claim` (L192), `escrow::refund` (L200), `EscrowIndex` (L51) |
| Status | ✅ Validated |

**Description**  
Every escrow operation takes `&mut EscrowIndex` and writes it (`add_entry` / `remove_entry`). All users therefore contend on one shared object. Settlement (`claim`, `refund`) is gated by the same object, so fund recovery shares the bottleneck with spammable creation. Funds are never lost, but access to them can be delayed.

```move
public fun claim(escrow: Escrow, index: &mut EscrowIndex, ctx: &mut TxContext): Settlement {
    index.assert_current();
    ...
    settle(escrow, index, Outcome::Claimed)   // writes index.by_sender / by_recipient
}
```

**Impact**  
A caller flooding `new` → `deposit` (1 base unit) → `send` raises congestion on the index. Claims and refunds from honest users are deferred, and can be cancelled by the network's per-object congestion control, until they outbid the attacker on gas price. Cost to the attacker is gas plus storage (mostly rebated when settled). Scope: availability only.

**Exploit Path**  
1. Attacker submits many cheap `send` transactions, each writing the index.
2. Honest `claim` / `refund` transactions queue behind them on the same shared object.
3. Honest users see delays or cancellations and must raise gas price to settle.

**Recommendation**  
Accepted tradeoff per `CLAUDE.md`. If throughput matters later, shard the index (for example by address prefix), or drop the index and rely on events for discovery. At minimum, document that settlement latency depends on index load.

## F-02 Single-Key Upgrade and Admin Control Over Custody, With No Escape Hatch

| Field | Value |
|---|---|
| Risk | Low |
| Affected | `escrow::init` (L129), `escrow::migrate` (L230), `AdminCap` (L59) |
| Status | ✅ Validated |

**Description**  
`init` sends `AdminCap` (`key, store`) to the publisher address. The `UpgradeCap` goes to the same publisher. Nothing in code wraps either behind a multisig, delay or approval step. Escrow balances sit in shared `Escrow` objects that any later package version can operate on.

```move
transfer::public_transfer(AdminCap { id: object::new(ctx) }, ctx.sender());
...
public fun migrate(index: &mut EscrowIndex, _: &AdminCap) {
    assert!(index.version < VERSION, ENotUpgraded);
    index.version = VERSION;   // one-way; disables every older package version
}
```

**Impact**  
- Whoever holds the `UpgradeCap` can publish code that reads or withdraws from any pending escrow. This is the normal upgrade trust model, but here it covers user custody with no delay for users to react.
- `migrate` only moves the version up. If a buggy version is migrated, every older version is disabled, and `claim` / `refund` stay broken until another upgrade with a higher `VERSION` is published.
- If `AdminCap` is lost, `migrate` can never run, so an older vulnerable version stays callable after a security upgrade.

**Exploit Path**  
1. Publisher key is compromised (or acts maliciously).
2. Attacker upgrades the package with a function that drains shared `Escrow` balances.
3. Users have no on-chain delay or veto.

**Recommendation**  
Move `UpgradeCap` and `AdminCap` to a multisig, ideally behind a timelock. Consider making the package immutable once stable. Document the recovery procedure for a bad migration (publish a fixed version, bump `VERSION`, migrate).

## F-03 Unsolicited Escrows Grow the Index With No Recipient Opt-Out

| Field | Value |
|---|---|
| Risk | Informational |
| Affected | `escrow::deposit` (L150), `escrow::send` (L172), `add_entry` (L253) |
| Status | ✅ Validated |

**Description**  
Any address can send an escrow of any coin type, with any non-zero amount, to any other address. `add_entry` appends to `by_recipient[recipient]` without a cap or a recipient-side consent step. The only way a recipient removes an entry is to `claim` it (which pays gas, and takes the junk coin).

**Impact**  
Spam pollutes the recipient's pending list and the `EscrowCreated` event stream. Clients that cap listings can show spam ahead of real escrows, because the table order is arbitrary. No funds at risk; storage rebate on claim favours the recipient, so spam is not free for the attacker.

**Exploit Path**  
1. Attacker mints a junk coin type and runs `new(victim)` → `deposit` (1 unit) → `send` many times.
2. Victim's `by_recipient` table fills with attacker-chosen entries.
3. Victim must claim each entry to clear it, or filter off-chain.

**Recommendation**  
Accepted tradeoff per `CLAUDE.md`. Keep off-chain filtering (known-coin allowlist, hide unknown metadata). Optionally add a recipient-side `reject` that refunds to the sender without handing the recipient the coins.

## Checklist Coverage

| Checklist | Status | Notes |
|---|---|---|
| `check-01` | ✅ Applied | `AdminCap`, sender-gating in `claim`/`refund` |
| `check-02` | ✅ Applied | Shared `Escrow` and `EscrowIndex`, contention (F-01), growth (F-03) |
| `check-03` | ✅ Applied | Bag balances, zero amounts, merge, no math or precision paths |
| `check-04` | ✅ Applied | Nested tables, inner-table create/drop, bag key by `TypeName` |
| `check-05` | ✅ Applied | Versioning, `migrate`, upgrade trust (F-02); no `friend` or `public(package)` |
| `check-06` | ❌ Skipped | No clock, oracle, epoch or price logic |
| `check-07` | ✅ Applied | Hot-potato PTB flows, version-gated recovery, no pause control |
| `check-08` | ✅ Applied | Event/function matrix, abort codes (code 8 unused by design) |

Dynamic checks: `sui move build --lint` clean; `sui move test` 29/29 pass. No prior audit report exists in the workspace, so no regression matrix.
