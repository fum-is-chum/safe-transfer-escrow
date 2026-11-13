/**
 * End-to-end walkthrough: create an escrow with several coins, list it from both sides, refund
 * it, then create another and claim it.
 *
 * Needs a published package and two funded accounts:
 *
 *   PACKAGE_ID=0x... INDEX_ID=0x... SENDER_KEY=suiprivkey... RECIPIENT_KEY=suiprivkey... \
 *     pnpm example
 *
 * Optional: PUBLISHED_AT (latest package ID after an upgrade), SUI_NETWORK (default testnet), EXTRA_COIN_TYPE (a second coin type the sender owns).
 */
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import type { Transaction } from '@mysten/sui/transactions';
import { normalizeStructTag, normalizeSuiAddress } from '@mysten/sui/utils';
import { EscrowCreated } from '../src/generated/safe_transfer_escrow/escrow.js';
import { safeTransferEscrow, type DepositInput } from '../src/index.js';
import { config } from 'dotenv';

config();

const SUI = '0x2::sui::SUI';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name}; see the header of examples/index.ts`);
  return value;
}

const network = (process.env.SUI_NETWORK ?? 'testnet') as 'mainnet' | 'testnet' | 'devnet';
const packageId = requireEnv('PACKAGE_ID');
const sender = Ed25519Keypair.fromSecretKey(requireEnv('SENDER_KEY'));
const recipient = Ed25519Keypair.fromSecretKey(requireEnv('RECIPIENT_KEY'));

const client = new SuiGrpcClient({
  network,
  baseUrl: `https://fullnode.${network}.sui.io:443`,
}).$extend(safeTransferEscrow({
  packageId,
  publishedAt: process.env.PUBLISHED_AT,
  indexId: requireEnv('INDEX_ID'),
}));
const escrow = client.safeTransferEscrow;

/** Signs, executes, waits for indexing, and returns the escrow ID if the transaction created one. */
async function execute(signer: Ed25519Keypair, transaction: Transaction) {
  const result = await client.signAndExecuteTransaction({
    signer,
    transaction,
    include: { events: true },
  });
  if (result.$kind === 'FailedTransaction') {
    throw new Error(`Transaction failed: ${result.FailedTransaction.status.error?.message}`);
  }
  await client.waitForTransaction({ digest: result.Transaction.digest });

  const createdType = `${normalizeSuiAddress(packageId)}::escrow::EscrowCreated`;
  const created = result.Transaction.events?.find(
    (event) => normalizeStructTag(event.eventType) === createdType,
  );

  return { digest: result.Transaction.digest, escrowId: created && EscrowCreated.parse(created.bcs).escrow_id };
}

/**
 * Coins can only be added while the escrow is being built: every entry in `coins` is one deposit,
 * and repeated coin types are merged by the contract. A sent escrow cannot be topped up.
 */
function coinsToLock(): DepositInput[] {
  const coins: DepositInput[] = [
    { coinType: SUI, amount: 10_000_000n }, // 0.01 SUI
    { coinType: SUI, amount: 5_000_000n }, // merged with the line above: 0.015 SUI total
  ];
  if (process.env.EXTRA_COIN_TYPE) {
    coins.push({ coinType: process.env.EXTRA_COIN_TYPE, amount: 1n });
  }

  return coins;
}

async function createEscrow(): Promise<string> {
  const { digest, escrowId } = await execute(
    sender,
    escrow.tx.createEscrow({
      sender: sender.toSuiAddress(),
      recipient: recipient.toSuiAddress(),
      coins: coinsToLock(),
    }),
  );
  if (!escrowId) throw new Error(`No EscrowCreated event in ${digest}`);
  console.log(`created escrow ${escrowId} (tx ${digest})`);

  return escrowId;
}

async function printPending(label: string, address: string, side: 'listSent' | 'listReceived') {
  const escrows = await escrow[side](address);
  console.log(`${label}: ${escrows.length} pending`);
  for (const { id, coins } of escrows) {
    console.log(`  ${id}`, coins.map((c) => `${c.amount} ${c.coinType}`).join(', '));
  }
}

// 1. Create an escrow holding several coins and read it back.
const refundId = await createEscrow();
console.log('contents:', await escrow.getEscrow(refundId));

// 2. Either side can find it on chain through the index.
await printPending('sent by sender', sender.toSuiAddress(), 'listSent');
await printPending('received by recipient', recipient.toSuiAddress(), 'listReceived');

// 3. Refund: only the sender can, at any time. Coins go back to the sender.
const refund = await execute(sender, escrow.tx.refund(refundId));
console.log(`refunded ${refundId} (tx ${refund.digest})`);

// 4. Create another and claim it: only the recipient can. Coins go to the recipient.
const claimId = await createEscrow();
const claim = await execute(recipient, escrow.tx.claim(claimId));
console.log(`claimed ${claimId} (tx ${claim.digest})`);

// 5. Both escrows were deleted on settlement, so nothing is pending.
await printPending('sent by sender', sender.toSuiAddress(), 'listSent');
await printPending('received by recipient', recipient.toSuiAddress(), 'listReceived');
