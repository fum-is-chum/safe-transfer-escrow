/**
 * Publishes the package with @scallop-io/sui-package-kit and records the IDs in
 * `publish-result.<network>.json` at the repo root.
 *
 *   pnpm publish-package               # publish; refuses if the result file exists
 *   pnpm publish-package -- --enforce  # publish again and overwrite the result file
 *   pnpm publish-package -- --build-only  # compile only; needs no key and sends nothing
 *
 * Reads PUBLISHER_KEY and optional SUI_NETWORK (default testnet) from ts/examples/.env or the shell.
 */
import { REPO_ROOT, buildOptions, getSuiKit, networkType, packagePublisher } from './elements.js';
import { parsePublishResult } from './publish-result-parser.js';
import { hasResult, resultPath, writeResult } from './result.js';

const buildOnly = process.argv.includes('--build-only');
const enforce = process.argv.includes('--enforce');

if (buildOnly) {
  const { modules, dependencies } = packagePublisher.buildPackage(REPO_ROOT, buildOptions);
  console.log(`built ${modules.length} module(s); dependencies ${dependencies.join(', ')}`);
  process.exit(0);
}

if (hasResult() && !enforce) {
  console.log(`Already published on ${networkType} (${resultPath}); pass --enforce to publish again`);
  process.exit(0);
}

const suiKit = getSuiKit();
console.log(`publishing to ${networkType} as ${suiKit.currentAddress}`);
const res = await packagePublisher.publishPackage(REPO_ROOT, suiKit, buildOptions);
if (!res.packageId) throw new Error('Publish failed; see the response above');

const result = {
  packageId: res.packageId,
  publishedAt: res.packageId,
  upgradeCapId: res.upgradeCapId,
  ...parsePublishResult(res),
};
writeResult(result);

console.log(`\nwrote ${resultPath}\n`);
console.log(`PACKAGE_ID=${result.packageId}`);
console.log(`INDEX_ID=${result.indexId}`);
console.log(`VITE_PACKAGE_ID=${result.packageId}`);
console.log(`VITE_INDEX_ID=${result.indexId}`);
