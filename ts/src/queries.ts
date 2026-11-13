import { bcs } from '@mysten/sui/bcs';
import { ObjectError, type ClientWithCoreApi, type SuiClientTypes } from '@mysten/sui/client';
import { deriveDynamicFieldID, normalizeStructTag, normalizeSuiAddress } from '@mysten/sui/utils';
import { Escrow, EscrowIndex } from './generated/safe_transfer_escrow/escrow.js';
import { Table } from './generated/safe_transfer_escrow/deps/sui/table.js';
import { toCoinType } from './util.js';

export interface SafeTransferEscrowConfig {
  /** Original (first published) package ID; also the type origin of `Escrow`. */
  packageId: string;
  /**
   * Latest published package ID, used for Move calls. Set it after an upgrade: once `migrate`
   * runs, calls to the original ID abort with a version error. Defaults to `packageId`.
   */
  publishedAt?: string;
  /** Object ID of the shared `EscrowIndex` created at publication; holds the version too. */
  indexId: string;
}

export interface ListOptions {
  /**
   * Read at most this many escrows. Order is arbitrary, so a cap can hide real escrows behind
   * unsolicited ones; leave unset to read them all.
   */
  limit?: number;
}

/** Package ID Move calls go to; `packageId` stays the type origin for checks and derivation. */
export function callPackage(config: SafeTransferEscrowConfig): string {
  return config.publishedAt ?? config.packageId;
}

export interface EscrowCoin {
  /** Normalized type tag (zero-padded addresses); compare with `normalizeStructTag`. */
  coinType: string;
  amount: bigint;
}

export interface EscrowInfo {
  id: string;
  sender: string;
  recipient: string;
  coins: EscrowCoin[];
}

/** `0x2::dynamic_field::Field<address, Table<ID, address>>`: one owner's pending escrows. */
const OwnerTableField = bcs.struct('Field', {
  id: bcs.Address,
  name: bcs.Address,
  value: Table,
});

/** Most object IDs sent to one `getObjects` call; larger lists are split and sent in parallel. */
const OBJECTS_PER_CALL = 50;

type ReadObject = Error | { objectId: string; type: string; content: Uint8Array };

/** Reads one escrow and its coin balances. Throws if the object is missing or not an `Escrow`. */
export async function getEscrow(
  client: ClientWithCoreApi,
  config: SafeTransferEscrowConfig,
  escrowId: string,
): Promise<EscrowInfo> {
  const [result] = await readEscrows(client, config, [escrowId]);
  if (result instanceof Error) throw result;

  return result;
}

/**
 * Reads escrows together, one `getObjects` call per 50. The coin list is stored on the escrow, so
 * no bag is read. Results line up with `escrowIds`; a failure is returned in place, not thrown,
 * so callers can skip escrows that settled meanwhile.
 */
async function readEscrows(
  client: ClientWithCoreApi,
  config: SafeTransferEscrowConfig,
  escrowIds: string[],
): Promise<(EscrowInfo | Error)[]> {
  const expectedType = `${normalizeSuiAddress(config.packageId)}::escrow::Escrow`;
  const objects = await getObjectsInBatches(client, escrowIds);

  return objects.map((object, i) => {
    if (object instanceof Error) return object;
    if (normalizeStructTag(object.type) !== expectedType) {
      return new Error(`Object ${escrowIds[i]} is ${object.type}, expected ${expectedType}`);
    }
    const escrow = Escrow.parse(object.content);

    return {
      id: object.objectId,
      sender: escrow.sender,
      recipient: escrow.recipient,
      coins: escrow.coins
        .map((coin) => ({
          coinType: toCoinType(coin.coin_type.name),
          amount: BigInt(coin.amount),
        }))
        .sort((a, b) => a.coinType.localeCompare(b.coinType)),
    };
  });
}

/** Pending escrows created by `address`. */
export function listSent(
  client: ClientWithCoreApi,
  config: SafeTransferEscrowConfig,
  address: string,
  options?: ListOptions,
): Promise<EscrowInfo[]> {
  return listPending(client, config, 'sent', address, options);
}

/** Pending escrows addressed to `address`. */
export function listReceived(
  client: ClientWithCoreApi,
  config: SafeTransferEscrowConfig,
  address: string,
  options?: ListOptions,
): Promise<EscrowInfo[]> {
  return listPending(client, config, 'received', address, options);
}

async function listPending(
  client: ClientWithCoreApi,
  config: SafeTransferEscrowConfig,
  side: 'sent' | 'received',
  address: string,
  { limit }: ListOptions = {},
): Promise<EscrowInfo[]> {
  const tableId = await getOwnerTableId(client, config, side, address);
  if (tableId === null) return [];

  const entries = await listAllDynamicFields(client, tableId, limit);
  const results = await readEscrows(
    client,
    config,
    entries.map((entry) => bcs.Address.parse(entry.name.bcs)),
  );

  // An escrow can settle between listing the index and reading it; skip those.
  return results.filter((result): result is EscrowInfo => {
    if (result instanceof ObjectError) return false;
    if (result instanceof Error) throw result;
    return true;
  });
}

/** Side table IDs per client and index. They never change, so each is read once per client. */
const sideTables = new WeakMap<object, Map<string, Promise<Record<Side, string>>>>();

type Side = 'sent' | 'received';

function getSideTables(client: ClientWithCoreApi, config: SafeTransferEscrowConfig) {
  const cache = sideTables.get(client) ?? new Map<string, Promise<Record<Side, string>>>();
  sideTables.set(client, cache);

  const key = normalizeSuiAddress(config.indexId);
  let tables = cache.get(key);
  if (!tables) {
    tables = readSideTables(client, config);
    cache.set(key, tables);
    // A failed read must not stay cached.
    tables.catch(() => cache.delete(key));
  }

  return tables;
}

async function readSideTables(
  client: ClientWithCoreApi,
  config: SafeTransferEscrowConfig,
): Promise<Record<Side, string>> {
  const { object } = await client.core.getObject({
    objectId: config.indexId,
    include: { content: true },
  });
  const expectedType = `${normalizeSuiAddress(config.packageId)}::escrow::EscrowIndex`;
  if (normalizeStructTag(object.type) !== expectedType) {
    throw new Error(`Object ${object.objectId} is ${object.type}, expected ${expectedType}`);
  }
  const index = EscrowIndex.parse(object.content);

  return { sent: index.by_sender.id, received: index.by_recipient.id };
}

/**
 * The ID of `owner`'s table of pending escrows on one side of the index, or `null` when the owner
 * has none (the contract drops the table with its last entry). One `getObject` call once the
 * index has been read: the field ID is computed from the owner address, not searched for.
 */
async function getOwnerTableId(
  client: ClientWithCoreApi,
  config: SafeTransferEscrowConfig,
  side: Side,
  owner: string,
): Promise<string | null> {
  const tables = await getSideTables(client, config);

  try {
    const { object: field } = await client.core.getObject({
      objectId: deriveDynamicFieldID(
        tables[side],
        'address',
        bcs.Address.serialize(normalizeSuiAddress(owner)).toBytes(),
      ),
      include: { content: true },
    });
    return OwnerTableField.parse(field.content).value.id;
  } catch (error) {
    if (error instanceof ObjectError && error.reason === 'notFound') return null;
    throw error;
  }
}

async function getObjectsInBatches(
  client: ClientWithCoreApi,
  objectIds: string[],
): Promise<ReadObject[]> {
  const batches: string[][] = [];
  for (let i = 0; i < objectIds.length; i += OBJECTS_PER_CALL) {
    batches.push(objectIds.slice(i, i + OBJECTS_PER_CALL));
  }
  const responses = await Promise.all(
    batches.map((batch) => client.core.getObjects({ objectIds: batch, include: { content: true } })),
  );

  return responses.flatMap((response) => response.objects);
}

async function listAllDynamicFields(
  client: ClientWithCoreApi,
  parentId: string,
  limit?: number,
): Promise<SuiClientTypes.DynamicFieldEntry[]> {
  const fields: SuiClientTypes.DynamicFieldEntry[] = [];
  let cursor: string | null = null;
  do {
    const page: SuiClientTypes.ListDynamicFieldsResponse = await client.core.listDynamicFields({
      parentId,
      cursor,
    });
    fields.push(...page.dynamicFields);
    cursor = page.hasNextPage ? page.cursor : null;
  } while (cursor !== null && (limit === undefined || fields.length < limit));

  return limit === undefined ? fields : fields.slice(0, limit);
}
