export const NETWORKS = ['mainnet', 'testnet', 'devnet'] as const;
export type Network = (typeof NETWORKS)[number];

export interface AppConfig {
  packageId: string;
  indexId: string;
  /** Latest package ID after an upgrade; Move calls go here. */
  publishedAt?: string;
  network: Network;
}

export type ConfigResult = { ok: true; config: AppConfig } | { ok: false; problems: string[] };

const OBJECT_ID = /^0x[0-9a-fA-F]{1,64}$/;

/** Validates the `VITE_*` variables. Returns every problem so the page can list them all. */
export function readConfig(env: Record<string, string | undefined>): ConfigResult {
  const problems: string[] = [];
  const packageId = env.VITE_PACKAGE_ID?.trim();
  const indexId = env.VITE_INDEX_ID?.trim();
  const publishedAt = env.VITE_PUBLISHED_AT?.trim() || undefined;
  const network = (env.VITE_NETWORK?.trim() || 'testnet') as Network;

  if (!packageId) problems.push('VITE_PACKAGE_ID is not set');
  else if (!OBJECT_ID.test(packageId)) problems.push('VITE_PACKAGE_ID is not a 0x… object ID');
  if (!indexId) problems.push('VITE_INDEX_ID is not set');
  else if (!OBJECT_ID.test(indexId)) problems.push('VITE_INDEX_ID is not a 0x… object ID');
  if (publishedAt && !OBJECT_ID.test(publishedAt)) {
    problems.push('VITE_PUBLISHED_AT is not a 0x… object ID');
  }
  if (!NETWORKS.includes(network)) {
    problems.push(`VITE_NETWORK must be one of ${NETWORKS.join(', ')}`);
  }

  if (problems.length > 0 || !packageId || !indexId) return { ok: false, problems };

  return { ok: true, config: { packageId, indexId, ...(publishedAt ? { publishedAt } : {}), network } };
}
