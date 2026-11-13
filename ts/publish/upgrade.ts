/**
 * Upgrade test with @scallop-io/sui-package-kit: upgrades the package recorded in
 * `publish-result.<network>.json` to a bumped `VERSION`, shows that the new code stays dormant
 * until `migrate`, then migrates and shows that the old code is cut off.
 *
 *   pnpm upgrade-package
 *
 * Optional: NEW_VERSION (default: stored version + 1), SUI_NETWORK. The signer must hold the
 * UpgradeCap and AdminCap, which is the publisher. The package that was published must come from
 * the current source (struct layouts cannot change in an upgrade).
 *
 * The version is bumped in a temporary copy of the package, so the repo source stays untouched.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Transaction } from '@scallop-io/sui-kit';
import { EscrowIndex } from '../src/generated/safe_transfer_escrow/escrow.js';
import { REPO_ROOT, buildOptions, getSuiKit, packagePublisher } from './elements.js';
import { readResult, writeResult } from './result.js';

type UpgradeParams = Parameters<typeof packagePublisher.upgradePackage>[0];

const suiKit = getSuiKit();
const owner = suiKit.currentAddress;
const result = readResult();

async function storedVersion(): Promise<number> {
  const { object } = await suiKit.client.core.getObject({
    objectId: result.indexId,
    include: { content: true },
  });

  return Number(EscrowIndex.parse(object.content).version);
}

/** Copies the package without tests into a temp dir with `VERSION` rewritten. */
function copyWithVersion(version: number): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'escrow-upgrade-'));
  for (const file of ['Move.toml', 'Move.lock', 'Published.toml', 'sources']) {
    cpSync(path.join(REPO_ROOT, file), path.join(dir, file), { recursive: true });
  }
  const source = path.join(dir, 'sources/escrow.move');
  const original = readFileSync(source, 'utf8');
  const rewritten = original.replace(/const VERSION: u64 = \d+;/, `const VERSION: u64 = ${version};`);
  if (rewritten === original) throw new Error('Could not find `const VERSION: u64 = N;`');
  writeFileSync(source, rewritten);

  return dir;
}

/**
 * Dry-runs `new` + `send` of an empty draft through `pkg`. It always aborts: with `EEmptyEscrow`
 * (code 3) when `pkg` is the current version, with `EWrongVersion` (code 9) when it is not.
 */
async function tryGate(pkg: string): Promise<string> {
  const tx = new Transaction();
  const draft = tx.moveCall({ target: `${pkg}::escrow::new`, arguments: [tx.pure.address('0x1')] });
  tx.moveCall({ target: `${pkg}::escrow::send`, arguments: [draft, tx.object(result.indexId)] });
  tx.setSender(owner);
  const simulated = await suiKit.client.core.simulateTransaction({ transaction: tx });
  const { status } = simulated.Transaction ?? simulated.FailedTransaction;

  return status.success ? 'succeeds' : `aborts: ${status.error.message}`;
}

const oldVersion = await storedVersion();
const newVersion = Number(process.env.NEW_VERSION ?? oldVersion + 1);
const previous = result.publishedAt;
console.log(`stored version ${oldVersion}, upgrading to ${newVersion}`);

// 1. Upgrade: package-kit builds the copy, then authorize -> upgrade -> commit.
const dir = copyWithVersion(newVersion);
let upgraded;
try {
  upgraded = await packagePublisher.upgradePackage({
    packagePath: dir,
    oldPackageId: previous,
    upgradeCapId: result.upgradeCapId,
    // package-kit and sui-kit pin different 1.x copies of @mysten/sui; the client shape is the same.
    client: suiKit.client as unknown as UpgradeParams['client'],
    keyPair: suiKit.getKeypair(),
    options: buildOptions,
  });
} finally {
  rmSync(dir, { recursive: true, force: true });
}
if (!upgraded.packageId) throw new Error('Upgrade failed; see the response above');
const latest = upgraded.packageId;
await suiKit.client.core.waitForTransaction({ digest: upgraded.upgradeTxn.digest });

// 2. Before migrate the old code still runs and the new code refuses.
console.log(`before migrate: gate via old package ${await tryGate(previous)}`);
console.log(`before migrate: gate via new package ${await tryGate(latest)}`);

// 3. Migrate: the stored version moves to the new code's version.
const migrate = new Transaction();
migrate.moveCall({
  target: `${latest}::escrow::migrate`,
  arguments: [migrate.object(result.indexId), migrate.object(result.adminCapId)],
});
const migrateResult = await suiKit.signAndSendTxn(migrate);
const migrated = migrateResult.Transaction ?? migrateResult.FailedTransaction;
if (!migrated.status.success) throw new Error(`Migrate failed: ${migrated.status.error.message}`);
await suiKit.client.core.waitForTransaction({ digest: migrated.digest });
console.log(`migrated (tx ${migrated.digest}); stored version ${await storedVersion()}`);

// 4. After migrate the new code runs and the old code is cut off.
console.log(`after migrate: gate via old package ${await tryGate(previous)}`);
console.log(`after migrate: gate via new package ${await tryGate(latest)}`);

writeResult({ ...result, publishedAt: latest });
console.log(`\nPUBLISHED_AT=${latest}`);
console.log(`VITE_PUBLISHED_AT=${latest}`);
