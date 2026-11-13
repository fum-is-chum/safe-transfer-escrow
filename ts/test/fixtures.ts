import { bcs } from '@mysten/sui/bcs';
import { ObjectError, type ClientWithCoreApi } from '@mysten/sui/client';
import { normalizeStructTag, normalizeSuiAddress } from '@mysten/sui/utils';
import { Escrow, EscrowIndex } from '../src/generated/safe_transfer_escrow/escrow.js';
import { deriveDynamicFieldID } from '@mysten/sui/utils';

export const PACKAGE_ID = id(0xaaa);
export const INDEX_ID = id(0xbbb);
export const SENDER = id(0x51);
export const RECIPIENT = id(0x52);
export const CONFIG = { packageId: PACKAGE_ID, indexId: INDEX_ID };

/** Move `TypeName` strings: 64 hex digits, no `0x`. */
export const SUI_TYPE_NAME = `${'0'.repeat(63)}2::sui::SUI`;
export const USDC_TYPE_NAME = `${'0'.repeat(63)}a::usdc::USDC`;
/** Coin types come back normalized (zero-padded addresses). */
export const SUI_TYPE = normalizeStructTag('0x2::sui::SUI');
export const USDC_TYPE = `0x${'0'.repeat(63)}a::usdc::USDC`;

export function id(n: number): string {
  return normalizeSuiAddress(`0x${n.toString(16)}`);
}

const OwnerField = bcs.struct('Field', {
  id: bcs.Address,
  name: bcs.Address,
  value: bcs.struct('Table', { id: bcs.Address, size: bcs.u64() }),
});

interface FakeEntry {
  fieldId: string;
  name: { type: string; bcs: Uint8Array };
}

/** In-memory stand-in for the subset of `client.core` the SDK reads. */
export class FakeChain {
  objects = new Map<string, { type: string; content: Uint8Array }>();
  fields = new Map<string, FakeEntry[]>();
  pageSize = 2;
  private tables = 0;

  /** Adds an `Escrow` listing the given coins (keyed by Move type name string). */
  addEscrow(opts: {
    id: string;
    sender?: string;
    recipient?: string;
    bagId: string;
    coins: { typeName: string; amount: bigint }[];
  }) {
    this.objects.set(opts.id, {
      type: `${PACKAGE_ID}::escrow::Escrow`,
      content: Escrow.serialize({
        id: opts.id,
        sender: opts.sender ?? SENDER,
        recipient: opts.recipient ?? RECIPIENT,
        balances: { id: opts.bagId, size: String(opts.coins.length) },
        coins: opts.coins.map((coin) => ({
          coin_type: { name: coin.typeName },
          amount: coin.amount,
        })),
      }).toBytes(),
    });
  }

  /**
   * Sets the `EscrowIndex`: each owner with pending escrows gets a table (a dynamic field of the
   * side's table) listing those escrow IDs.
   */
  setIndex(entries: { sent?: Record<string, string[]>; received?: Record<string, string[]> }) {
    const sent = entries.sent ?? {};
    const received = entries.received ?? {};
    const sentTableId = id(0x2000);
    const receivedTableId = id(0x2001);

    this.objects.set(INDEX_ID, {
      type: `${PACKAGE_ID}::escrow::EscrowIndex`,
      content: EscrowIndex.serialize({
        id: INDEX_ID,
        version: 1,
        by_sender: { id: sentTableId, size: String(Object.keys(sent).length) },
        by_recipient: { id: receivedTableId, size: String(Object.keys(received).length) },
      }).toBytes(),
    });
    for (const [sideTableId, side] of [
      [sentTableId, sent],
      [receivedTableId, received],
    ] as const) {
      for (const [owner, escrowIds] of Object.entries(side)) {
        const ownerTableId = id(this.tables++ + 0x1000);
        this.objects.set(
          deriveDynamicFieldID(sideTableId, 'address', bcs.Address.serialize(owner).toBytes()),
          {
            type: '0x2::dynamic_field::Field',
            content: OwnerField.serialize({
              id: ownerTableId,
              name: owner,
              value: { id: ownerTableId, size: String(escrowIds.length) },
            }).toBytes(),
          },
        );
        for (const escrowId of escrowIds) {
          this.pushField(ownerTableId, {
            fieldId: id(parseInt(ownerTableId, 16) * 1000 + parseInt(escrowId, 16)),
            name: { type: '0x2::object::ID', bcs: bcs.Address.serialize(escrowId).toBytes() },
          });
        }
      }
    }
  }

  private pushField(parentId: string, entry: FakeEntry) {
    this.fields.set(parentId, [...(this.fields.get(parentId) ?? []), entry]);
  }

  client(): ClientWithCoreApi {
    const notFound = (objectId: string) =>
      new ObjectError('notFound', `Object ${objectId} not found`, { reason: 'notFound', objectId });
    const read = (objectId: string) => {
      const object = this.objects.get(objectId);
      if (!object) throw notFound(objectId);
      return { objectId, ...object };
    };

    return {
      core: {
        getObject: async ({ objectId }: { objectId: string }) => ({ object: read(objectId) }),
        getObjects: async ({ objectIds }: { objectIds: string[] }) => ({
          objects: objectIds.map((objectId) => {
            try {
              return read(objectId);
            } catch (error) {
              return error as Error;
            }
          }),
        }),
        listDynamicFields: async ({
          parentId,
          cursor,
        }: {
          parentId: string;
          cursor?: string | null;
        }) => {
          const all = this.fields.get(parentId) ?? [];
          const start = cursor ? Number(cursor) : 0;
          const end = start + this.pageSize;
          return {
            dynamicFields: all.slice(start, end),
            hasNextPage: end < all.length,
            cursor: end < all.length ? String(end) : null,
          };
        },
      },
    } as unknown as ClientWithCoreApi;
  }
}
