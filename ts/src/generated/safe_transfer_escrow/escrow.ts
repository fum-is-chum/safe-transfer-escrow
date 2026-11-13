/**************************************************************
 * THIS FILE IS GENERATED AND SHOULD NOT BE MANUALLY MODIFIED *
 **************************************************************/


/**
 * Safe transfer escrow. A sender locks any number of coin types for one recipient.
 * Only the recipient can claim and only the sender can refund, at any time (no
 * expiry). Each escrow is its own shared object and is deleted when settled. A
 * shared `EscrowIndex` maps both sides so either party can find pending transfers
 * on chain.
 * 
 * Party objects are not used: `transfer::party_transfer` accepts a single owner
 * only, so one party-owned escrow cannot serve both claim and refund.
 */

import { MoveStruct, MoveEnum, normalizeMoveArguments, type RawTransactionArgument } from '../utils/index.js';
import { bcs } from '@mysten/sui/bcs';
import { type Transaction, type TransactionArgument } from '@mysten/sui/transactions';
import * as table from './deps/sui/table.js';
import * as type_name from './deps/std/type_name.js';
import * as bag from './deps/sui/bag.js';
const $moduleName = '@local-pkg/safe-transfer-escrow::escrow';
export const EscrowIndex = new MoveStruct({ name: `${$moduleName}::EscrowIndex`, fields: {
        id: bcs.Address,
        version: bcs.u64(),
        by_sender: table.Table,
        by_recipient: table.Table
    } });
export const AdminCap = new MoveStruct({ name: `${$moduleName}::AdminCap`, fields: {
        id: bcs.Address
    } });
export const CoinAmount = new MoveStruct({ name: `${$moduleName}::CoinAmount`, fields: {
        coin_type: type_name.TypeName,
        amount: bcs.u64()
    } });
export const Escrow = new MoveStruct({ name: `${$moduleName}::Escrow`, fields: {
        id: bcs.Address,
        sender: bcs.Address,
        recipient: bcs.Address,
        balances: bag.Bag,
        coins: bcs.vector(CoinAmount)
    } });
export const EscrowDraft = new MoveStruct({ name: `${$moduleName}::EscrowDraft`, fields: {
        version: bcs.u64(),
        recipient: bcs.Address,
        balances: bag.Bag,
        coins: bcs.vector(CoinAmount)
    } });
export const Outcome = new MoveEnum({ name: `${$moduleName}::Outcome`, fields: {
        Claimed: null,
        Refunded: null
    } });
export const Settlement = new MoveStruct({ name: `${$moduleName}::Settlement`, fields: {
        version: bcs.u64(),
        escrow_id: bcs.Address,
        sender: bcs.Address,
        recipient: bcs.Address,
        outcome: Outcome,
        balances: bag.Bag,
        coins: bcs.vector(CoinAmount)
    } });
export const EscrowCreated = new MoveStruct({ name: `${$moduleName}::EscrowCreated`, fields: {
        escrow_id: bcs.Address,
        recipient: bcs.Address,
        coins: bcs.vector(CoinAmount)
    } });
export const EscrowSettled = new MoveStruct({ name: `${$moduleName}::EscrowSettled`, fields: {
        escrow_id: bcs.Address,
        sender: bcs.Address,
        recipient: bcs.Address,
        outcome: Outcome,
        coins: bcs.vector(CoinAmount)
    } });
export const VersionMigrated = new MoveStruct({ name: `${$moduleName}::VersionMigrated`, fields: {
        old: bcs.u64(),
        new: bcs.u64()
    } });
export interface NewArguments {
    recipient: RawTransactionArgument<string>;
}
export interface NewOptions {
    package?: string;
    arguments: NewArguments | [
        recipient: RawTransactionArgument<string>
    ];
}
/** Starts an escrow for `recipient`. Sending to yourself is not allowed. */
export function _new(options: NewOptions) {
    const packageAddress = options.package ?? '@local-pkg/safe-transfer-escrow';
    const argumentsTypes = [
        'address'
    ] satisfies (string | null)[];
    const parameterNames = ["recipient"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'new',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
    });
}
export interface DepositArguments {
    self: TransactionArgument;
    coin: RawTransactionArgument<string>;
}
export interface DepositOptions {
    package?: string;
    arguments: DepositArguments | [
        self: TransactionArgument,
        coin: RawTransactionArgument<string>
    ];
    typeArguments: [
        string
    ];
}
/** Adds `coin` to the draft. Repeated coin types are merged. */
export function deposit(options: DepositOptions) {
    const packageAddress = options.package ?? '@local-pkg/safe-transfer-escrow';
    const argumentsTypes = [
        null,
        null
    ] satisfies (string | null)[];
    const parameterNames = ["self", "coin"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'deposit',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface SendArguments {
    self: TransactionArgument;
    index: RawTransactionArgument<string>;
}
export interface SendOptions {
    package?: string;
    arguments: SendArguments | [
        self: TransactionArgument,
        index: RawTransactionArgument<string>
    ];
}
/**
 * Locks the draft as a shared escrow for the recipient and lists it in the index.
 * The sender is the transaction sender.
 */
export function send(options: SendOptions) {
    const packageAddress = options.package ?? '@local-pkg/safe-transfer-escrow';
    const argumentsTypes = [
        null,
        null
    ] satisfies (string | null)[];
    const parameterNames = ["self", "index"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'send',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
    });
}
export interface ClaimArguments {
    escrow: RawTransactionArgument<string>;
    index: RawTransactionArgument<string>;
}
export interface ClaimOptions {
    package?: string;
    arguments: ClaimArguments | [
        escrow: RawTransactionArgument<string>,
        index: RawTransactionArgument<string>
    ];
}
/** Recipient takes the escrow. Deletes it and returns the `Settlement` to drain. */
export function claim(options: ClaimOptions) {
    const packageAddress = options.package ?? '@local-pkg/safe-transfer-escrow';
    const argumentsTypes = [
        null,
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow", "index"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'claim',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
    });
}
export interface RefundArguments {
    escrow: RawTransactionArgument<string>;
    index: RawTransactionArgument<string>;
}
export interface RefundOptions {
    package?: string;
    arguments: RefundArguments | [
        escrow: RawTransactionArgument<string>,
        index: RawTransactionArgument<string>
    ];
}
/** Sender takes the escrow back. Deletes it and returns the `Settlement` to drain. */
export function refund(options: RefundOptions) {
    const packageAddress = options.package ?? '@local-pkg/safe-transfer-escrow';
    const argumentsTypes = [
        null,
        null
    ] satisfies (string | null)[];
    const parameterNames = ["escrow", "index"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'refund',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
    });
}
export interface WithdrawArguments {
    self: TransactionArgument;
}
export interface WithdrawOptions {
    package?: string;
    arguments: WithdrawArguments | [
        self: TransactionArgument
    ];
    typeArguments: [
        string
    ];
}
/** Takes all escrowed `T` out of the settlement. Aborts if `T` is not held. */
export function withdraw(options: WithdrawOptions) {
    const packageAddress = options.package ?? '@local-pkg/safe-transfer-escrow';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["self"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'withdraw',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
        typeArguments: options.typeArguments
    });
}
export interface FinishArguments {
    self: TransactionArgument;
}
export interface FinishOptions {
    package?: string;
    arguments: FinishArguments | [
        self: TransactionArgument
    ];
}
/** Completes the settlement once every coin type is withdrawn. */
export function finish(options: FinishOptions) {
    const packageAddress = options.package ?? '@local-pkg/safe-transfer-escrow';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["self"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'finish',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
    });
}
export interface MigrateArguments {
    index: RawTransactionArgument<string>;
    _: RawTransactionArgument<string>;
}
export interface MigrateOptions {
    package?: string;
    arguments: MigrateArguments | [
        index: RawTransactionArgument<string>,
        _: RawTransactionArgument<string>
    ];
}
/**
 * Raises the index version to this package's `VERSION`, which disables every older
 * package version. Call it once after publishing an upgrade.
 */
export function migrate(options: MigrateOptions) {
    const packageAddress = options.package ?? '@local-pkg/safe-transfer-escrow';
    const argumentsTypes = [
        null,
        null
    ] satisfies (string | null)[];
    const parameterNames = ["index", "_"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'escrow',
        function: 'migrate',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
    });
}