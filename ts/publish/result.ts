import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, networkType } from './elements.js';

/** What `publish-package` records; `upgrade-package` reads it and moves `publishedAt`. */
export interface PublishResult {
  /** Original (first published) package ID. Never changes. */
  packageId: string;
  /** Latest package ID: Move calls go here. Equal to `packageId` until the first upgrade. */
  publishedAt: string;
  upgradeCapId: string;
  indexId: string;
  adminCapId: string;
}

export const resultPath = path.join(REPO_ROOT, `publish-result.${networkType}.json`);

export const hasResult = () => existsSync(resultPath);

export function readResult(): PublishResult {
  if (!hasResult()) throw new Error(`${resultPath} not found; run pnpm publish-package first`);

  return JSON.parse(readFileSync(resultPath, 'utf8')) as PublishResult;
}

export function writeResult(result: PublishResult) {
  writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`);
}
