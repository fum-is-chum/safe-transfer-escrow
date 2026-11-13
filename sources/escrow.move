/// Safe transfer escrow. A sender locks any number of coin types for one
/// recipient. Only the recipient can claim and only the sender can refund, at
/// any time (no expiry). Each escrow is its own shared object and is deleted
/// when settled. A shared `EscrowIndex` maps both sides so either party can
/// find pending transfers on chain.
///
/// Party objects are not used: `transfer::party_transfer` accepts a single
/// owner only, so one party-owned escrow cannot serve both claim and refund.
module safe_transfer_escrow::escrow;

use std::type_name::{Self, TypeName};
use sui::{bag::{Self, Bag}, balance::Balance, coin::{Self, Coin}, event, table::{Self, Table}};

// === Constants ===

/// Code version. Raising it and calling `migrate` disables every older version.
const VERSION: u64 = 1;

/// Hard bound on distinct coin types per escrow. Keeps settlement within one
/// transaction, so funds can never be stuck behind a too-large claim.
const MAX_COIN_TYPES: u64 = 16;

// === Errors ===

#[error(code = 0)]
const ENotRecipient: vector<u8> = b"Only the escrow recipient can claim.";
#[error(code = 1)]
const ENotSender: vector<u8> = b"Only the escrow sender can refund.";
#[error(code = 2)]
const EZeroAmount: vector<u8> = b"Deposited coin must not be zero.";
#[error(code = 3)]
const EEmptyEscrow: vector<u8> = b"Escrow must hold at least one coin.";
#[error(code = 4)]
const ETooManyCoinTypes: vector<u8> = b"Escrow exceeds the maximum number of coin types.";
#[error(code = 5)]
const ESettlementNotEmpty: vector<u8> = b"Every escrowed coin type must be withdrawn.";
#[error(code = 6)]
const EZeroRecipient: vector<u8> = b"Recipient must not be the zero address.";
#[error(code = 7)]
const ESelfEscrow: vector<u8> = b"Recipient must differ from the sender.";
#[error(code = 9)]
const EWrongVersion: vector<u8> = b"Package version does not match the index version.";
#[error(code = 10)]
const ENotUpgraded: vector<u8> = b"Index is already at this package version.";

// === Public Types ===

/// Shared singleton created at publication. `version` is checked by every
/// public function that touches it; both maps hold
/// `owner -> escrow id -> counterparty` for every pending escrow.
public struct EscrowIndex has key {
    id: UID,
    version: u64,
    by_sender: Table<address, Table<ID, address>>,
    by_recipient: Table<address, Table<ID, address>>,
}

/// Held by the publisher. Authorizes `migrate`.
public struct AdminCap has key, store {
    id: UID,
}

/// One shared object per transfer, deleted on claim or refund. `balances` maps
/// `TypeName -> Balance<T>`; `coins` lists the same coin types and amounts so a
/// reader needs only this object, not the bag. No `store`: it cannot be wrapped
/// or re-owned.
public struct Escrow has key {
    id: UID,
    sender: address,
    recipient: address,
    balances: Bag,
    coins: vector<CoinAmount>,
}

/// Escrow under construction. Has no abilities, so a transaction must finish it
/// with `send`. `version` is the package version that built it, so older package
/// versions cannot keep working on it after `migrate`.
public struct EscrowDraft {
    version: u64,
    recipient: address,
    balances: Bag,
    coins: vector<CoinAmount>,
}

/// Proof that an escrow was claimed or refunded and its coins are still owed to
/// the caller. Has no abilities, so a transaction must `withdraw` every coin
/// type and then `finish`. `version` is the package version that created it.
public struct Settlement {
    version: u64,
    escrow_id: ID,
    sender: address,
    recipient: address,
    outcome: Outcome,
    balances: Bag,
    coins: vector<CoinAmount>,
}

public enum Outcome has copy, drop {
    Claimed,
    Refunded,
}

public struct CoinAmount has copy, drop, store {
    coin_type: TypeName,
    amount: u64,
}

public struct EscrowCreated has copy, drop {
    escrow_id: ID,
    recipient: address,
    coins: vector<CoinAmount>,
}

public struct EscrowSettled has copy, drop {
    escrow_id: ID,
    sender: address,
    recipient: address,
    outcome: Outcome,
    coins: vector<CoinAmount>,
}

public struct VersionMigrated has copy, drop {
    old: u64,
    new: u64,
}

// === Private Initialization ===

fun init(ctx: &mut TxContext) {
    transfer::share_object(EscrowIndex {
        id: object::new(ctx),
        version: VERSION,
        by_sender: table::new(ctx),
        by_recipient: table::new(ctx),
    });
    transfer::public_transfer(AdminCap { id: object::new(ctx) }, ctx.sender());
}

// === Public Functions ===

/// Starts an escrow for `recipient`. Sending to yourself is not allowed.
public fun new(recipient: address, ctx: &mut TxContext): EscrowDraft {
    assert!(recipient != @0x0, EZeroRecipient);
    assert!(recipient != ctx.sender(), ESelfEscrow);

    EscrowDraft { version: VERSION, recipient, balances: bag::new(ctx), coins: vector[] }
}

/// Adds `coin` to the draft. Repeated coin types are merged.
public fun deposit<T>(self: &mut EscrowDraft, coin: Coin<T>) {
    assert!(self.version == VERSION, EWrongVersion);

    let amount = coin.value();
    assert!(amount > 0, EZeroAmount);

    let coin_type = type_name::with_defining_ids<T>();
    let position = self.coins.find_index!(|entry| entry.coin_type == coin_type);
    if (position.is_some()) {
        let entry = &mut self.coins[position.destroy_some()];
        entry.amount = entry.amount + amount;
        let balance: &mut Balance<T> = &mut self.balances[coin_type];
        balance.join(coin.into_balance());
    } else {
        assert!(self.coins.length() < MAX_COIN_TYPES, ETooManyCoinTypes);
        self.coins.push_back(CoinAmount { coin_type, amount });
        self.balances.add(coin_type, coin.into_balance());
    }
}

/// Locks the draft as a shared escrow for the recipient and lists it in the
/// index. The sender is the transaction sender.
public fun send(self: EscrowDraft, index: &mut EscrowIndex, ctx: &mut TxContext): ID {
    index.assert_current();

    let EscrowDraft { version, recipient, balances, coins } = self;
    assert!(version == VERSION, EWrongVersion);
    assert!(!coins.is_empty(), EEmptyEscrow);

    let sender = ctx.sender();
    let id = object::new(ctx);
    let escrow_id = id.to_inner();
    add_entry(&mut index.by_sender, sender, escrow_id, recipient, ctx);
    add_entry(&mut index.by_recipient, recipient, escrow_id, sender, ctx);

    event::emit(EscrowCreated { escrow_id, recipient, coins: copy coins });
    transfer::share_object(Escrow { id, sender, recipient, balances, coins });

    escrow_id
}

/// Recipient takes the escrow. Deletes it and returns the `Settlement` to drain.
public fun claim(escrow: Escrow, index: &mut EscrowIndex, ctx: &mut TxContext): Settlement {
    index.assert_current();
    assert!(ctx.sender() == escrow.recipient, ENotRecipient);

    settle(escrow, index, Outcome::Claimed)
}

/// Sender takes the escrow back. Deletes it and returns the `Settlement` to drain.
public fun refund(escrow: Escrow, index: &mut EscrowIndex, ctx: &mut TxContext): Settlement {
    index.assert_current();
    assert!(ctx.sender() == escrow.sender, ENotSender);

    settle(escrow, index, Outcome::Refunded)
}

/// Takes all escrowed `T` out of the settlement. Aborts if `T` is not held.
public fun withdraw<T>(self: &mut Settlement, ctx: &mut TxContext): Coin<T> {
    assert!(self.version == VERSION, EWrongVersion);

    let coin_type = type_name::with_defining_ids<T>();
    let balance: Balance<T> = self.balances.remove(coin_type);
    self.coins.push_back(CoinAmount { coin_type, amount: balance.value() });

    coin::from_balance(balance, ctx)
}

/// Completes the settlement once every coin type is withdrawn.
public fun finish(self: Settlement) {
    let Settlement { version, escrow_id, sender, recipient, outcome, balances, coins } = self;
    assert!(version == VERSION, EWrongVersion);
    assert!(balances.is_empty(), ESettlementNotEmpty);

    balances.destroy_empty();
    event::emit(EscrowSettled { escrow_id, sender, recipient, outcome, coins });
}

/// Raises the index version to this package's `VERSION`, which disables every
/// older package version. Call it once after publishing an upgrade.
public fun migrate(index: &mut EscrowIndex, _: &AdminCap) {
    assert!(index.version < VERSION, ENotUpgraded);

    event::emit(VersionMigrated { old: index.version, new: VERSION });
    index.version = VERSION;
}

// === Private Functions ===

fun assert_current(self: &EscrowIndex) {
    assert!(self.version == VERSION, EWrongVersion);
}

fun settle(escrow: Escrow, index: &mut EscrowIndex, outcome: Outcome): Settlement {
    let Escrow { id, sender, recipient, balances, coins: _ } = escrow;
    let escrow_id = id.to_inner();
    remove_entry(&mut index.by_sender, sender, escrow_id);
    remove_entry(&mut index.by_recipient, recipient, escrow_id);
    id.delete();

    Settlement { version: VERSION, escrow_id, sender, recipient, outcome, balances, coins: vector[] }
}

fun add_entry(
    side: &mut Table<address, Table<ID, address>>,
    owner: address,
    escrow_id: ID,
    counterparty: address,
    ctx: &mut TxContext,
) {
    if (!side.contains(owner)) side.add(owner, table::new(ctx));
    let entries = &mut side[owner];
    entries.add(escrow_id, counterparty);
}

/// Drops the owner's inner table with its last entry.
fun remove_entry(side: &mut Table<address, Table<ID, address>>, owner: address, escrow_id: ID) {
    let entries = &mut side[owner];
    entries.remove(escrow_id);
    if (entries.is_empty()) side.remove(owner).destroy_empty();
}

// === Test-Only Functions ===

#[test_only]
public fun init_for_testing(ctx: &mut TxContext) {
    init(ctx);
}

#[test_only]
public fun set_version_for_testing(index: &mut EscrowIndex, version: u64) {
    index.version = version;
}

#[test_only]
public fun set_draft_version_for_testing(draft: &mut EscrowDraft, version: u64) {
    draft.version = version;
}

#[test_only]
public fun set_settlement_version_for_testing(settlement: &mut Settlement, version: u64) {
    settlement.version = version;
}

#[test_only]
public fun coins(self: &Escrow): vector<CoinAmount> {
    self.coins
}

#[test_only]
public fun coin_amount<T>(amount: u64): CoinAmount {
    CoinAmount { coin_type: type_name::with_defining_ids<T>(), amount }
}

#[test_only]
public fun created_event(
    escrow_id: ID,
    recipient: address,
    coins: vector<CoinAmount>,
): EscrowCreated {
    EscrowCreated { escrow_id, recipient, coins }
}

#[test_only]
public fun claimed_event(
    escrow_id: ID,
    sender: address,
    recipient: address,
    coins: vector<CoinAmount>,
): EscrowSettled {
    EscrowSettled { escrow_id, sender, recipient, outcome: Outcome::Claimed, coins }
}

#[test_only]
public fun refunded_event(
    escrow_id: ID,
    sender: address,
    recipient: address,
    coins: vector<CoinAmount>,
): EscrowSettled {
    EscrowSettled { escrow_id, sender, recipient, outcome: Outcome::Refunded, coins }
}

#[test_only]
public fun migrated_event(old: u64, new: u64): VersionMigrated {
    VersionMigrated { old, new }
}

/// True when both sides map `escrow_id` to the other party.
#[test_only]
public fun is_indexed(
    index: &EscrowIndex,
    escrow_id: ID,
    sender: address,
    recipient: address,
): bool {
    index.by_sender.contains(sender) &&
    index.by_recipient.contains(recipient) &&
    index.by_sender[sender].contains(escrow_id) &&
    index.by_recipient[recipient].contains(escrow_id) &&
    index.by_sender[sender][escrow_id] == recipient &&
    index.by_recipient[recipient][escrow_id] == sender
}

/// Pending escrow counts of `owner`: sent, then received.
#[test_only]
public fun pending_counts(index: &EscrowIndex, owner: address): (u64, u64) {
    let sent = if (index.by_sender.contains(owner)) index.by_sender[owner].length() else 0;
    let received = if (index.by_recipient.contains(owner)) {
        index.by_recipient[owner].length()
    } else 0;

    (sent, received)
}

/// Number of owners with at least one pending escrow, per side.
#[test_only]
public fun owner_counts(index: &EscrowIndex): (u64, u64) {
    (index.by_sender.length(), index.by_recipient.length())
}
