import { bcs } from '@mysten/sui/bcs';
import { Transaction } from '@mysten/sui/transactions';
import { describe, expect, it } from 'vitest';
import { claim, createEscrow, refund } from '../src/tx.js';
import {
  FakeChain,
  CONFIG,
  INDEX_ID,
  PACKAGE_ID,
  RECIPIENT,
  SENDER,
  SUI_TYPE,
  SUI_TYPE_NAME,
  USDC_TYPE,
  USDC_TYPE_NAME,
  id,
} from './fixtures.js';

const config = CONFIG;

/** One line per command: `function<types>` for Move calls, the kind otherwise. */
function describeCommands(tx: Transaction): string[] {
  return tx.getData().commands.map((command) => {
    if (command.$kind === 'MoveCall') {
      const call = command.MoveCall;
      expect(call.package).toBe(PACKAGE_ID);
      expect(call.module).toBe('escrow');
      return `${call.function}<${call.typeArguments.join(',')}>`;
    }
    return command.$kind === '$Intent' ? command.$Intent.name : command.$kind;
  });
}

/** Object IDs the transaction takes as inputs, in order of first use. */
function objectInputs(tx: Transaction): string[] {
  return tx.getData().inputs.flatMap((input) =>
    input.UnresolvedObject ? [input.UnresolvedObject.objectId] : [],
  );
}

/** Address a `TransferObjects` command sends to, read back from its pure input. */
function transferTarget(tx: Transaction): string {
  const data = tx.getData();
  const transfer = data.commands.find((command) => command.$kind === 'TransferObjects');
  if (transfer?.$kind !== 'TransferObjects') throw new Error('no TransferObjects command');
  const input = data.inputs[(transfer.TransferObjects.address as { Input: number }).Input];
  return bcs.Address.fromBase64(input.Pure!.bytes);
}

function chainWithEscrow() {
  const chain = new FakeChain();
  chain.addEscrow({
    id: id(1),
    bagId: id(0x11),
    coins: [
      { typeName: USDC_TYPE_NAME, amount: 500n },
      { typeName: SUI_TYPE_NAME, amount: 100n },
    ],
  });
  return chain;
}

const COINS = [
  { coinType: SUI_TYPE, amount: 100n },
  { coinType: USDC_TYPE, amount: 500 },
];

describe('createEscrow', () => {
  it('creates a draft, deposits each coin with its own type, then sends with the index', () => {
    const tx = new Transaction();

    tx.add(createEscrow(config, { sender: SENDER, recipient: RECIPIENT, coins: COINS }));

    // Each deposit is preceded by the coin the SDK will source for it.
    expect(describeCommands(tx)).toEqual([
      'new<>',
      'CoinWithBalance',
      `deposit<${SUI_TYPE}>`,
      'CoinWithBalance',
      `deposit<${USDC_TYPE}>`,
      'send<>',
    ]);
    expect(objectInputs(tx)).toEqual([INDEX_ID]);
  });

  it('deposits repeated coin types separately and leaves merging to the contract', () => {
    const tx = new Transaction();

    tx.add(
      createEscrow(config, {
        sender: SENDER,
        recipient: RECIPIENT,
        coins: [
          { coinType: SUI_TYPE, amount: 1n },
          { coinType: SUI_TYPE, amount: 2n },
        ],
      }),
    );

    expect(describeCommands(tx).filter((c) => c.startsWith('deposit'))).toHaveLength(2);
  });
});

describe('publishedAt', () => {
  const LATEST = id(0xeee);
  const upgraded = { ...config, publishedAt: LATEST };
  const packages = (tx: Transaction) =>
    tx.getData().commands.flatMap((c) => (c.$kind === 'MoveCall' ? [c.MoveCall.package] : []));

  it('sends every Move call to the latest package after an upgrade', async () => {
    const tx = new Transaction();
    tx.add(
      createEscrow(upgraded, {
        sender: SENDER,
        recipient: RECIPIENT,
        coins: [{ coinType: SUI_TYPE, amount: 1n }],
      }),
    );
    await claim(chainWithEscrow().client(), upgraded, id(1))(tx);

    expect(new Set(packages(tx))).toEqual(new Set([LATEST]));
  });
});

// Async thunks only run at build time via `tx.add`, so tests call them directly.
describe('claim / refund', () => {
  it('claim drains every coin type and pays the recipient', async () => {
    const tx = new Transaction();

    await claim(chainWithEscrow().client(), config, id(1))(tx);

    // Coin types come from the escrow's own coin list (sorted), not from the caller.
    expect(describeCommands(tx)).toEqual([
      'claim<>',
      `withdraw<${SUI_TYPE}>`,
      `withdraw<${USDC_TYPE}>`,
      'TransferObjects',
      'finish<>',
    ]);
    expect(transferTarget(tx)).toBe(RECIPIENT);
    expect(objectInputs(tx)).toEqual([id(1), INDEX_ID]);
  });

  it('refund drains every coin type and pays the sender', async () => {
    const tx = new Transaction();

    await refund(chainWithEscrow().client(), config, id(1))(tx);

    expect(describeCommands(tx)[0]).toBe('refund<>');
    expect(transferTarget(tx)).toBe(SENDER);
  });

  it('fails before building anything when the escrow does not exist', async () => {
    const tx = new Transaction();

    await expect(claim(new FakeChain().client(), config, id(9))(tx)).rejects.toThrow();
    expect(tx.getData().commands).toEqual([]);
  });
});
