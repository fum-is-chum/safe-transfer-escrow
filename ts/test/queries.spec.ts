import { ObjectError } from '@mysten/sui/client';
import { describe, expect, it } from 'vitest';
import { getEscrow, listReceived, listSent } from '../src/queries.js';
import { toCoinType } from '../src/util.js';
import {
  FakeChain,
  CONFIG,
  RECIPIENT,
  SENDER,
  SUI_TYPE,
  SUI_TYPE_NAME,
  USDC_TYPE,
  USDC_TYPE_NAME,
  id,
} from './fixtures.js';

const config = CONFIG;

describe('toCoinType', () => {
  it('prefixes bare 64-digit addresses, including inside generics', () => {
    expect(toCoinType(SUI_TYPE_NAME)).toBe(SUI_TYPE);
    expect(toCoinType(`${'0'.repeat(63)}b::pool::Pool<${SUI_TYPE_NAME}, ${USDC_TYPE_NAME}>`)).toBe(
      `0x${'0'.repeat(63)}b::pool::Pool<${SUI_TYPE},${USDC_TYPE}>`,
    );
  });
});

describe('getEscrow', () => {
  it('returns parties and every coin amount from the escrow object, sorted by coin type', () => {
    const chain = new FakeChain();
    chain.addEscrow({
      id: id(1),
      bagId: id(0x11),
      coins: [
        { typeName: USDC_TYPE_NAME, amount: 500n },
        { typeName: SUI_TYPE_NAME, amount: 18_446_744_073_709_551_615n },
        { typeName: `${'0'.repeat(63)}c::eth::ETH`, amount: 7n },
      ],
    });

    return expect(getEscrow(chain.client(), config, id(1))).resolves.toEqual({
      id: id(1),
      sender: SENDER,
      recipient: RECIPIENT,
      coins: [
        { coinType: SUI_TYPE, amount: 18_446_744_073_709_551_615n },
        { coinType: USDC_TYPE, amount: 500n },
        { coinType: `0x${'0'.repeat(63)}c::eth::ETH`, amount: 7n },
      ],
    });
  });

  it('rejects an object that is not an Escrow of this package', async () => {
    const chain = new FakeChain();
    chain.addEscrow({ id: id(1), bagId: id(0x11), coins: [] });
    chain.objects.get(id(1))!.type = `${id(0xdead)}::escrow::Escrow`;

    await expect(getEscrow(chain.client(), config, id(1))).rejects.toThrow(/expected/);
  });
});

describe('listReceived / listSent', () => {
  function chainWithTwoEscrows() {
    const chain = new FakeChain();
    chain.addEscrow({ id: id(1), bagId: id(0x11), coins: [{ typeName: SUI_TYPE_NAME, amount: 1n }] });
    chain.addEscrow({ id: id(2), bagId: id(0x12), coins: [{ typeName: USDC_TYPE_NAME, amount: 2n }] });
    chain.setIndex({
      sent: { [SENDER]: [id(1), id(2)] },
      received: { [RECIPIENT]: [id(1), id(2)] },
    });
    return chain;
  }

  it('lists every pending escrow of a recipient, across table pages', async () => {
    const chain = chainWithTwoEscrows();
    chain.pageSize = 1;

    const escrows = await listReceived(chain.client(), config, RECIPIENT);

    expect(escrows.map((e) => e.id)).toEqual([id(1), id(2)]);
    expect(escrows.map((e) => e.coins)).toEqual([
      [{ coinType: SUI_TYPE, amount: 1n }],
      [{ coinType: USDC_TYPE, amount: 2n }],
    ]);
  });

  it('lists the sender side from its own table, not the received one', async () => {
    const escrows = await listSent(chainWithTwoEscrows().client(), config, SENDER);

    expect(escrows.map((e) => e.id)).toEqual([id(1), id(2)]);
  });

  it('returns an empty list for an address with no pending escrow', async () => {
    const chain = chainWithTwoEscrows();

    await expect(listReceived(chain.client(), config, id(0x999))).resolves.toEqual([]);
    // The sender has sent, but nothing is addressed to them.
    await expect(listReceived(chain.client(), config, SENDER)).resolves.toEqual([]);
  });

  it('reads at most `limit` escrows when asked', async () => {
    const chain = chainWithTwoEscrows();

    const escrows = await listReceived(chain.client(), config, RECIPIENT, { limit: 1 });

    expect(escrows).toHaveLength(1);
  });

  it('returns an empty list when nothing is pending on that side at all', async () => {
    const chain = new FakeChain();
    chain.setIndex({});

    await expect(listReceived(chain.client(), config, RECIPIENT)).resolves.toEqual([]);
    await expect(listSent(chain.client(), config, SENDER)).resolves.toEqual([]);
  });

  it('rejects an index object of another package', async () => {
    const chain = chainWithTwoEscrows();
    chain.objects.get(config.indexId)!.type = `${id(0xdead)}::escrow::EscrowIndex`;

    await expect(listReceived(chain.client(), config, RECIPIENT)).rejects.toThrow(/expected/);
  });

  it('skips an escrow that settled after the index was read', async () => {
    const chain = chainWithTwoEscrows();
    chain.objects.delete(id(1));

    const escrows = await listReceived(chain.client(), config, RECIPIENT);

    expect(escrows.map((e) => e.id)).toEqual([id(2)]);
  });

  it('does not hide errors other than a missing object', async () => {
    const chain = chainWithTwoEscrows();
    const client = chain.client();
    client.core.getObject = async () => {
      throw new ObjectError('unavailable', 'node down', { reason: 'unknown' });
    };

    await expect(listReceived(client, config, RECIPIENT)).rejects.toThrow('node down');
  });
});

describe('RPC calls', () => {
  /** Wraps the fake client and counts calls per `client.core` method. */
  function counted(chain: FakeChain) {
    const client = chain.client();
    const calls: Record<string, number> = {};
    for (const name of ['getObject', 'getObjects', 'listDynamicFields'] as const) {
      const original = client.core[name].bind(client.core) as (options: unknown) => Promise<unknown>;
      (client.core as unknown as Record<string, unknown>)[name] = (options: unknown) => {
        calls[name] = (calls[name] ?? 0) + 1;
        return original(options);
      };
    }

    return { client, calls };
  }

  function chainWithEscrows(count: number) {
    const chain = new FakeChain();
    const ids = Array.from({ length: count }, (_, i) => id(i + 1));
    ids.forEach((escrowId, i) =>
      chain.addEscrow({
        id: escrowId,
        bagId: id(0x100 + i),
        coins: [
          { typeName: SUI_TYPE_NAME, amount: 1n },
          { typeName: USDC_TYPE_NAME, amount: 2n },
        ],
      }),
    );
    chain.setIndex({ received: { [RECIPIENT]: ids } });
    chain.pageSize = 100;

    return chain;
  }

  it('reads all escrows in one call, however many there are', async () => {
    const { client, calls } = counted(chainWithEscrows(5));

    const escrows = await listReceived(client, config, RECIPIENT);

    expect(escrows).toHaveLength(5);
    // getObject: owner entry + index (first call only). getObjects: all escrows together.
    // listDynamicFields: the owner's table. No bag is read.
    expect(calls).toEqual({ getObject: 2, getObjects: 1, listDynamicFields: 1 });
  });

  it('reads the index only once per client', async () => {
    const { client, calls } = counted(chainWithEscrows(1));

    await listReceived(client, config, RECIPIENT);
    await listSent(client, config, SENDER);

    // Index once, plus one owner entry per list.
    expect(calls.getObject).toBe(3);
  });

  it('splits more than 50 escrows over several calls', async () => {
    const { client, calls } = counted(chainWithEscrows(120));

    const escrows = await listReceived(client, config, RECIPIENT);

    expect(escrows).toHaveLength(120);
    expect(calls.getObjects).toBe(3);
  });

  it('does not cache a failed index read', async () => {
    const chain = chainWithEscrows(1);
    const client = chain.client();
    const original = client.core.getObject.bind(client.core);
    let failures = 1;
    client.core.getObject = (async (options: Parameters<typeof original>[0]) => {
      if (failures-- > 0) throw new Error('node down');
      return original(options);
    }) as typeof client.core.getObject;

    await expect(listReceived(client, config, RECIPIENT)).rejects.toThrow('node down');
    await expect(listReceived(client, config, RECIPIENT)).resolves.toHaveLength(1);
  });
});
