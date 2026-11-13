import type { PackagePublishResult } from '@scallop-io/sui-package-kit';
import { normalizeSuiAddress } from '@mysten/sui/utils';

/** Picks the objects `init` creates out of the publish transaction. */
export function parsePublishResult(res: PackagePublishResult) {
  const found = { indexId: '', adminCapId: '' };
  const wanted: Record<string, keyof typeof found> = {
    EscrowIndex: 'indexId',
    AdminCap: 'adminCapId',
  };

  for (const { type, objectId } of res.created) {
    const [pkg, module, name] = type.split('::');
    if (!pkg || module !== 'escrow' || !name) continue;
    if (normalizeSuiAddress(pkg) !== normalizeSuiAddress(res.packageId)) continue;
    if (name in wanted) found[wanted[name]] = objectId;
  }

  const missing = Object.entries(found).filter(([, id]) => !id).map(([key]) => key);
  if (missing.length > 0) throw new Error(`Publish created no object for: ${missing.join(', ')}`);

  return found;
}
