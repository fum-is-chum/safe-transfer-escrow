#[test_only]
module safe_transfer_escrow::escrow_tests;

use safe_transfer_escrow::escrow::{
    Self,
    AdminCap,
    Escrow,
    EscrowCreated,
    EscrowDraft,
    EscrowIndex,
    EscrowSettled,
    Settlement,
    VersionMigrated
};
use std::unit_test::assert_eq;
use sui::{coin::{Self, Coin}, event, test_scenario::{Self, Scenario}};

use fun deposit_one as EscrowDraft.deposit_one;
use fun deposit_row as EscrowDraft.deposit_row;
use fun withdraw_one as Settlement.withdraw_one;
use fun withdraw_row as Settlement.withdraw_row;

// === Constants ===

const PUBLISHER: address = @0x0;
const SENDER: address = @0xA;
const RECIPIENT: address = @0xB;
const STRANGER: address = @0xC;

// === Test Coin Types ===

public struct Usdc()
public struct Eth()

/// Distinct coin types (Pair<Ti, Tj>) for capacity tests.
public struct Pair<phantom A, phantom B>()
public struct T0()
public struct T1()
public struct T2()
public struct T3()
public struct T4()
public struct T5()

// === Tests ===

#[test]
fun claim_pays_the_recipient_and_clears_the_escrow() {
    let mut f = start();

    f.next_tx(SENDER);
    let id = f.create(RECIPIENT, 100, 50, 25);
    assert_eq!(
        event::events_by_type<EscrowCreated>(),
        vector[
            escrow::created_event(
                id,
                RECIPIENT,
                vector[escrow::coin_amount<Usdc>(125), escrow::coin_amount<Eth>(50)],
            ),
        ],
    );

    f.next_tx(RECIPIENT);
    f.claim(id);
    assert_eq!(
        event::events_by_type<EscrowSettled>(),
        vector[
            escrow::claimed_event(
                id,
                SENDER,
                RECIPIENT,
                vector[escrow::coin_amount<Usdc>(125), escrow::coin_amount<Eth>(50)],
            ),
        ],
    );

    f.next_tx(RECIPIENT);
    assert_eq!(f.coin_value<Usdc>(RECIPIENT), 125);
    assert_eq!(f.coin_value<Eth>(RECIPIENT), 50);
    assert!(!f.has_escrow());
    assert_eq!(f.pending_counts(SENDER), vector[0, 0]);
    assert_eq!(f.pending_counts(RECIPIENT), vector[0, 0]);

    f.end();
}

#[test]
fun escrow_records_its_coin_types_and_merged_amounts() {
    let mut f = start();

    f.next_tx(SENDER);
    let id = f.create(RECIPIENT, 100, 50, 25);

    f.next_tx(STRANGER);
    let escrow = f.scenario.take_shared_by_id<Escrow>(id);
    assert_eq!(
        escrow.coins(),
        vector[escrow::coin_amount<Usdc>(125), escrow::coin_amount<Eth>(50)],
    );
    test_scenario::return_shared(escrow);

    f.end();
}

#[test]
fun refund_returns_every_coin_to_the_sender() {
    let mut f = start();

    f.next_tx(SENDER);
    let id = f.create(RECIPIENT, 100, 50, 0);

    f.next_tx(SENDER);
    f.refund(id);
    assert_eq!(
        event::events_by_type<EscrowSettled>(),
        vector[
            escrow::refunded_event(
                id,
                SENDER,
                RECIPIENT,
                vector[escrow::coin_amount<Usdc>(100), escrow::coin_amount<Eth>(50)],
            ),
        ],
    );

    f.next_tx(SENDER);
    assert_eq!(f.coin_value<Usdc>(SENDER), 100);
    assert_eq!(f.coin_value<Eth>(SENDER), 50);
    assert!(!f.has_escrow());
    assert_eq!(f.pending_counts(SENDER), vector[0, 0]);
    assert_eq!(f.pending_counts(RECIPIENT), vector[0, 0]);

    f.end();
}

#[test]
fun pending_escrow_is_listed_for_both_parties() {
    let mut f = start();

    f.next_tx(SENDER);
    let id = f.create(RECIPIENT, 100, 50, 0);

    f.next_tx(STRANGER);
    assert!(f.is_indexed(id, SENDER, RECIPIENT));
    assert!(!f.is_indexed(id, SENDER, STRANGER));
    assert!(!f.is_indexed(id, STRANGER, RECIPIENT));
    assert_eq!(f.pending_counts(SENDER), vector[1, 0]);
    assert_eq!(f.pending_counts(RECIPIENT), vector[0, 1]);
    assert_eq!(f.pending_counts(STRANGER), vector[0, 0]);

    f.end();
}

#[test]
fun each_settlement_clears_only_its_own_entry() {
    let mut f = start();

    f.next_tx(SENDER);
    let first = f.create(RECIPIENT, 10, 10, 0);
    f.next_tx(SENDER);
    let second = f.create(RECIPIENT, 20, 20, 0);
    assert_eq!(f.pending_counts(SENDER), vector[2, 0]);
    assert_eq!(f.pending_counts(RECIPIENT), vector[0, 2]);

    f.next_tx(RECIPIENT);
    f.claim(first);
    f.next_tx(SENDER);
    assert!(!f.is_indexed(first, SENDER, RECIPIENT));
    assert!(f.is_indexed(second, SENDER, RECIPIENT));
    assert_eq!(f.pending_counts(SENDER), vector[1, 0]);

    f.next_tx(SENDER);
    f.refund(second);
    f.next_tx(SENDER);
    assert_eq!(f.pending_counts(SENDER), vector[0, 0]);
    assert_eq!(f.pending_counts(RECIPIENT), vector[0, 0]);

    f.end();
}

#[test]
fun index_stays_usable_after_its_last_escrow_settles() {
    let mut f = start();

    f.next_tx(SENDER);
    let first = f.create(RECIPIENT, 10, 10, 0);
    f.next_tx(RECIPIENT);
    f.claim(first);

    f.next_tx(SENDER);
    let second = f.create(RECIPIENT, 20, 20, 0);
    f.next_tx(SENDER);
    assert!(f.is_indexed(second, SENDER, RECIPIENT));
    assert_eq!(f.pending_counts(SENDER), vector[1, 0]);

    f.end();
}

#[test]
fun escrow_at_the_coin_type_limit_can_still_be_claimed() {
    let mut f = start();

    f.next_tx(SENDER);
    let id = f.create_max_types(RECIPIENT);

    f.next_tx(RECIPIENT);
    f.claim_max_types(id);
    assert_eq!(event::events_by_type<EscrowSettled>().length(), 1);

    f.next_tx(RECIPIENT);
    assert!(!f.has_escrow());
    assert_eq!(f.pending_counts(SENDER), vector[0, 0]);
    assert_eq!(f.pending_counts(RECIPIENT), vector[0, 0]);

    f.end();
}

#[test]
fun migrate_restores_service_after_an_upgrade() {
    let mut f = start();
    f.set_version(0);
    f.migrate();

    f.next_tx(SENDER);
    let id = f.create(RECIPIENT, 100, 50, 0);
    f.next_tx(RECIPIENT);
    f.claim(id);

    f.end();
}

#[test]
fun escrows_from_different_senders_share_the_recipient_list() {
    let mut f = start();

    f.next_tx(SENDER);
    f.create(RECIPIENT, 10, 10, 0);
    f.next_tx(STRANGER);
    f.create(RECIPIENT, 20, 20, 0);

    assert_eq!(f.pending_counts(RECIPIENT), vector[0, 2]);
    assert_eq!(f.pending_counts(SENDER), vector[1, 0]);
    assert_eq!(f.pending_counts(STRANGER), vector[1, 0]);
    assert_eq!(f.owner_counts(), vector[2, 1]);

    f.end();
}

#[test]
fun settling_the_last_escrow_drops_the_owners_tables() {
    let mut f = start();

    f.next_tx(SENDER);
    let id = f.create(RECIPIENT, 10, 10, 0);
    assert_eq!(f.owner_counts(), vector[1, 1]);

    f.next_tx(RECIPIENT);
    f.claim(id);
    assert_eq!(f.owner_counts(), vector[0, 0]);

    // The next escrow rebuilds them.
    f.next_tx(SENDER);
    let second = f.create(RECIPIENT, 10, 10, 0);
    assert!(f.is_indexed(second, SENDER, RECIPIENT));

    f.end();
}

// === Failure Tests ===

#[test, expected_failure(abort_code = escrow::ENotRecipient, location = escrow)]
fun sender_cannot_claim() {
    let mut f = start();
    f.next_tx(SENDER);
    let id = f.create(RECIPIENT, 100, 50, 0);

    f.next_tx(SENDER);
    f.claim(id);
    abort
}

#[test, expected_failure(abort_code = escrow::ENotRecipient, location = escrow)]
fun stranger_cannot_claim() {
    let mut f = start();
    f.next_tx(SENDER);
    let id = f.create(RECIPIENT, 100, 50, 0);

    f.next_tx(STRANGER);
    f.claim(id);
    abort
}

#[test, expected_failure(abort_code = escrow::ENotSender, location = escrow)]
fun recipient_cannot_refund() {
    let mut f = start();
    f.next_tx(SENDER);
    let id = f.create(RECIPIENT, 100, 50, 0);

    f.next_tx(RECIPIENT);
    f.refund(id);
    abort
}

#[test, expected_failure(abort_code = escrow::EZeroAmount, location = escrow)]
fun deposit_rejects_a_zero_coin() {
    let mut f = start();
    f.next_tx(SENDER);

    f.create(RECIPIENT, 0, 50, 0);
    abort
}

#[test, expected_failure(abort_code = escrow::EEmptyEscrow, location = escrow)]
fun send_rejects_an_escrow_without_coins() {
    let mut f = start();
    f.next_tx(SENDER);

    let draft = escrow::new(RECIPIENT, f.scenario.ctx());
    f.send_draft(draft);
    abort
}

#[test, expected_failure(abort_code = escrow::EZeroRecipient, location = escrow)]
fun new_rejects_the_zero_address() {
    let mut f = start();
    f.next_tx(SENDER);

    let _draft = escrow::new(@0x0, f.scenario.ctx());
    abort
}

#[test, expected_failure(abort_code = escrow::ESelfEscrow, location = escrow)]
fun new_rejects_the_sender_as_recipient() {
    let mut f = start();
    f.next_tx(SENDER);

    let _draft = escrow::new(SENDER, f.scenario.ctx());
    abort
}

#[test, expected_failure(abort_code = escrow::ETooManyCoinTypes, location = escrow)]
fun deposit_rejects_the_first_coin_type_over_the_limit() {
    let mut f = start();
    f.next_tx(SENDER);

    let mut draft = escrow::new(RECIPIENT, f.scenario.ctx());
    draft.deposit_row<T0>(f.scenario.ctx());
    draft.deposit_row<T1>(f.scenario.ctx());
    draft.deposit_one<Pair<T2, T0>>(f.scenario.ctx());
    draft.deposit_one<Pair<T2, T1>>(f.scenario.ctx());
    draft.deposit_one<Pair<T2, T2>>(f.scenario.ctx());
    draft.deposit_one<Pair<T2, T3>>(f.scenario.ctx());
    draft.deposit_one<Pair<T2, T4>>(f.scenario.ctx());
    abort
}

#[test, expected_failure(abort_code = escrow::ESettlementNotEmpty, location = escrow)]
fun finish_rejects_a_settlement_with_coins_left() {
    let mut f = start();
    f.next_tx(SENDER);
    let id = f.create(RECIPIENT, 100, 50, 0);

    f.next_tx(RECIPIENT);
    let escrow = f.scenario.take_shared_by_id<Escrow>(id);
    let mut index = f.scenario.take_shared<EscrowIndex>();
    let mut settlement = escrow.claim(&mut index, f.scenario.ctx());
    transfer::public_transfer(settlement.withdraw<Usdc>(f.scenario.ctx()), RECIPIENT);
    settlement.finish();
    abort
}

#[test, expected_failure(abort_code = sui::dynamic_field::EFieldDoesNotExist)]
fun withdraw_rejects_a_coin_type_the_escrow_does_not_hold() {
    let mut f = start();
    f.next_tx(SENDER);
    let id = f.create(RECIPIENT, 100, 50, 0);

    f.next_tx(RECIPIENT);
    let escrow = f.scenario.take_shared_by_id<Escrow>(id);
    let mut index = f.scenario.take_shared<EscrowIndex>();
    let mut settlement = escrow.claim(&mut index, f.scenario.ctx());
    transfer::public_transfer(settlement.withdraw<T0>(f.scenario.ctx()), RECIPIENT);
    abort
}

#[test, expected_failure(abort_code = escrow::EWrongVersion, location = escrow)]
fun send_rejects_an_outdated_version() {
    let mut f = start();
    f.set_version(0);

    f.next_tx(SENDER);
    f.create(RECIPIENT, 100, 50, 0);
    abort
}

#[test, expected_failure(abort_code = escrow::EWrongVersion, location = escrow)]
fun claim_rejects_an_outdated_version() {
    let mut f = start();
    f.next_tx(SENDER);
    let id = f.create(RECIPIENT, 100, 50, 0);
    f.set_version(0);

    f.next_tx(RECIPIENT);
    f.claim(id);
    abort
}

#[test, expected_failure(abort_code = escrow::EWrongVersion, location = escrow)]
fun refund_rejects_a_newer_version() {
    let mut f = start();
    f.next_tx(SENDER);
    let id = f.create(RECIPIENT, 100, 50, 0);
    f.set_version(2);

    f.next_tx(SENDER);
    f.refund(id);
    abort
}

#[test, expected_failure(abort_code = escrow::ENotUpgraded, location = escrow)]
fun migrate_rejects_an_index_already_at_this_version() {
    let mut f = start();
    f.migrate();
    abort
}

// === Version And Event Tests ===

#[test]
fun migrate_emits_the_old_and_new_version() {
    let mut f = start();
    f.set_version(0);
    f.migrate();

    assert_eq!(event::events_by_type<VersionMigrated>(), vector[escrow::migrated_event(0, 1)]);

    f.end();
}

#[test, expected_failure(abort_code = escrow::EWrongVersion, location = escrow)]
fun deposit_rejects_a_draft_from_another_version() {
    let mut f = start();
    f.next_tx(SENDER);

    let mut draft = escrow::new(RECIPIENT, f.scenario.ctx());
    escrow::set_draft_version_for_testing(&mut draft, 0);
    draft.deposit_one<Usdc>(f.scenario.ctx());
    abort
}

#[test, expected_failure(abort_code = escrow::EWrongVersion, location = escrow)]
fun send_rejects_a_draft_from_another_version() {
    let mut f = start();
    f.next_tx(SENDER);

    let mut draft = escrow::new(RECIPIENT, f.scenario.ctx());
    draft.deposit_one<Usdc>(f.scenario.ctx());
    escrow::set_draft_version_for_testing(&mut draft, 0);
    f.send_draft(draft);
    abort
}

#[test, expected_failure(abort_code = escrow::EWrongVersion, location = escrow)]
fun withdraw_rejects_a_settlement_from_another_version() {
    let mut f = start();
    f.next_tx(SENDER);
    let id = f.create(RECIPIENT, 100, 50, 0);

    f.next_tx(RECIPIENT);
    let mut settlement = f.open_settlement(id);
    escrow::set_settlement_version_for_testing(&mut settlement, 0);
    transfer::public_transfer(settlement.withdraw<Usdc>(f.scenario.ctx()), RECIPIENT);
    abort
}

#[test, expected_failure(abort_code = escrow::EWrongVersion, location = escrow)]
fun finish_rejects_a_settlement_from_another_version() {
    let mut f = start();
    f.next_tx(SENDER);
    let id = f.create(RECIPIENT, 100, 50, 0);

    f.next_tx(RECIPIENT);
    let mut settlement = f.open_settlement(id);
    transfer::public_transfer(settlement.withdraw<Usdc>(f.scenario.ctx()), RECIPIENT);
    transfer::public_transfer(settlement.withdraw<Eth>(f.scenario.ctx()), RECIPIENT);
    escrow::set_settlement_version_for_testing(&mut settlement, 0);
    settlement.finish();
    abort
}

// === Test Fixture ===

public struct Fixture { scenario: Scenario }

/// Publishes; the publisher then owns the `AdminCap`.
fun start(): Fixture {
    let mut scenario = test_scenario::begin(PUBLISHER);
    escrow::init_for_testing(scenario.ctx());

    Fixture { scenario }
}

fun end(self: Fixture) {
    let Fixture { scenario } = self;
    scenario.end();
}

fun next_tx(self: &mut Fixture, sender: address) {
    self.scenario.next_tx(sender);
}

/// Queries re-take shared objects, which needs a fresh transaction.
fun next_tx_as_sender(self: &mut Fixture) {
    let sender = self.scenario.sender();
    self.scenario.next_tx(sender);
}

/// Claims as the recipient and returns the `Settlement` undrained.
fun open_settlement(self: &mut Fixture, id: ID): Settlement {
    let escrow = self.scenario.take_shared_by_id<Escrow>(id);
    let mut index = self.scenario.take_shared<EscrowIndex>();

    let settlement = escrow.claim(&mut index, self.scenario.ctx());
    test_scenario::return_shared(index);

    settlement
}

/// Sets the stored version in its own transaction.
fun set_version(self: &mut Fixture, version: u64) {
    self.next_tx(STRANGER);
    let mut index = self.scenario.take_shared<EscrowIndex>();
    escrow::set_version_for_testing(&mut index, version);
    test_scenario::return_shared(index);
}

/// The publisher calls `migrate`.
fun migrate(self: &mut Fixture) {
    self.next_tx(PUBLISHER);
    let cap = self.scenario.take_from_sender<AdminCap>();
    let mut index = self.scenario.take_shared<EscrowIndex>();
    escrow::migrate(&mut index, &cap);
    test_scenario::return_shared(index);
    test_scenario::return_to_sender(&self.scenario, cap);
}

/// Sender deposits `usdc`, `eth`, then `usdc_top_up` more Usdc when non-zero.
fun create(self: &mut Fixture, recipient: address, usdc: u64, eth: u64, usdc_top_up: u64): ID {
    let mut draft = escrow::new(recipient, self.scenario.ctx());
    draft.deposit(coin::mint_for_testing<Usdc>(usdc, self.scenario.ctx()));
    draft.deposit(coin::mint_for_testing<Eth>(eth, self.scenario.ctx()));
    if (usdc_top_up > 0) {
        draft.deposit(coin::mint_for_testing<Usdc>(usdc_top_up, self.scenario.ctx()));
    };

    self.send_draft(draft)
}

fun send_draft(self: &mut Fixture, draft: EscrowDraft): ID {
    let mut index = self.scenario.take_shared<EscrowIndex>();
    let id = draft.send(&mut index, self.scenario.ctx());
    test_scenario::return_shared(index);

    id
}

fun claim(self: &mut Fixture, id: ID) {
    let escrow = self.scenario.take_shared_by_id<Escrow>(id);
    let mut index = self.scenario.take_shared<EscrowIndex>();
    let settlement = escrow.claim(&mut index, self.scenario.ctx());
    self.drain(settlement);
    test_scenario::return_shared(index);
}

fun refund(self: &mut Fixture, id: ID) {
    let escrow = self.scenario.take_shared_by_id<Escrow>(id);
    let mut index = self.scenario.take_shared<EscrowIndex>();
    let settlement = escrow.refund(&mut index, self.scenario.ctx());
    self.drain(settlement);
    test_scenario::return_shared(index);
}

/// Withdraws Usdc and Eth to the transaction sender and finishes.
fun drain(self: &mut Fixture, mut settlement: Settlement) {
    let owner = self.scenario.sender();
    transfer::public_transfer(settlement.withdraw<Usdc>(self.scenario.ctx()), owner);
    transfer::public_transfer(settlement.withdraw<Eth>(self.scenario.ctx()), owner);
    settlement.finish();
}

/// 16 distinct coin types: two full rows plus four of the third.
fun create_max_types(self: &mut Fixture, recipient: address): ID {
    let mut draft = escrow::new(recipient, self.scenario.ctx());
    draft.deposit_row<T0>(self.scenario.ctx());
    draft.deposit_row<T1>(self.scenario.ctx());
    draft.deposit_one<Pair<T2, T0>>(self.scenario.ctx());
    draft.deposit_one<Pair<T2, T1>>(self.scenario.ctx());
    draft.deposit_one<Pair<T2, T2>>(self.scenario.ctx());
    draft.deposit_one<Pair<T2, T3>>(self.scenario.ctx());

    self.send_draft(draft)
}

fun claim_max_types(self: &mut Fixture, id: ID) {
    let escrow = self.scenario.take_shared_by_id<Escrow>(id);
    let mut index = self.scenario.take_shared<EscrowIndex>();
    let mut settlement = escrow.claim(&mut index, self.scenario.ctx());
    settlement.withdraw_row<T0>(self.scenario.ctx());
    settlement.withdraw_row<T1>(self.scenario.ctx());
    settlement.withdraw_one<Pair<T2, T0>>(self.scenario.ctx());
    settlement.withdraw_one<Pair<T2, T1>>(self.scenario.ctx());
    settlement.withdraw_one<Pair<T2, T2>>(self.scenario.ctx());
    settlement.withdraw_one<Pair<T2, T3>>(self.scenario.ctx());
    settlement.finish();
    test_scenario::return_shared(index);
}

fun deposit_one<T>(draft: &mut EscrowDraft, ctx: &mut TxContext) {
    draft.deposit(coin::mint_for_testing<T>(1, ctx));
}

fun deposit_row<A>(draft: &mut EscrowDraft, ctx: &mut TxContext) {
    draft.deposit_one<Pair<A, T0>>(ctx);
    draft.deposit_one<Pair<A, T1>>(ctx);
    draft.deposit_one<Pair<A, T2>>(ctx);
    draft.deposit_one<Pair<A, T3>>(ctx);
    draft.deposit_one<Pair<A, T4>>(ctx);
    draft.deposit_one<Pair<A, T5>>(ctx);
}

fun withdraw_one<T>(settlement: &mut Settlement, ctx: &mut TxContext) {
    coin::burn_for_testing(settlement.withdraw<T>(ctx));
}

fun withdraw_row<A>(settlement: &mut Settlement, ctx: &mut TxContext) {
    settlement.withdraw_one<Pair<A, T0>>(ctx);
    settlement.withdraw_one<Pair<A, T1>>(ctx);
    settlement.withdraw_one<Pair<A, T2>>(ctx);
    settlement.withdraw_one<Pair<A, T3>>(ctx);
    settlement.withdraw_one<Pair<A, T4>>(ctx);
    settlement.withdraw_one<Pair<A, T5>>(ctx);
}

fun coin_value<T>(self: &Fixture, owner: address): u64 {
    let coin = self.scenario.take_from_address<Coin<T>>(owner);
    let value = coin.value();
    test_scenario::return_to_address(owner, coin);

    value
}

fun has_escrow(_self: &Fixture): bool {
    test_scenario::has_most_recent_shared<Escrow>()
}

fun is_indexed(self: &mut Fixture, id: ID, sender: address, recipient: address): bool {
    self.next_tx_as_sender();
    let index = self.scenario.take_shared<EscrowIndex>();
    let indexed = escrow::is_indexed(&index, id, sender, recipient);
    test_scenario::return_shared(index);

    indexed
}

fun pending_counts(self: &mut Fixture, owner: address): vector<u64> {
    self.next_tx_as_sender();
    let index = self.scenario.take_shared<EscrowIndex>();
    let (sent, received) = escrow::pending_counts(&index, owner);
    test_scenario::return_shared(index);

    vector[sent, received]
}

/// Owners with a pending escrow: as sender, then as recipient.
fun owner_counts(self: &mut Fixture): vector<u64> {
    self.next_tx_as_sender();
    let index = self.scenario.take_shared<EscrowIndex>();
    let (senders, recipients) = escrow::owner_counts(&index);
    test_scenario::return_shared(index);

    vector[senders, recipients]
}
