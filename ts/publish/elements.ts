import path from 'node:path';
import { SuiKit, type NetworkType } from '@scallop-io/sui-kit';
import { SuiPackagePublisher } from '@scallop-io/sui-package-kit';
import { config } from 'dotenv';

// Same file the examples use. Keys stay out of the shell history and the repo.
config({ path: path.join(import.meta.dirname, '../examples/.env') });

export const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
export const networkType = (process.env.SUI_NETWORK ?? 'testnet') as NetworkType;

/**
 * Not all options of package-kit's all-in-one publisher can be used: it always passes
 * `--skip-fetch-latest-git-deps`, which Sui CLI 1.68 no longer accepts. The lower-level
 * `SuiPackagePublisher` takes the flag as an option, so it stays off here.
 */
export const buildOptions = {
  gasBudget: 10 ** 9,
  withUnpublishedDependencies: false,
  skipFetchLatestGitDeps: false,
};

export const packagePublisher = new SuiPackagePublisher();

/** Needs `PUBLISHER_KEY`, so it is created on use: `--build-only` runs without a key. */
export function getSuiKit(): SuiKit {
  const secretKey = process.env.PUBLISHER_KEY;
  if (!secretKey) throw new Error('Set PUBLISHER_KEY in ts/examples/.env or the shell');

  return new SuiKit({ secretKey, networkType });
}
