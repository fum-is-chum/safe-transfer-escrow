import { useMutation } from '@tanstack/react-query';
import { normalizeSuiAddress } from '@mysten/sui/utils';
import { useRef, useState, type FormEvent } from 'react';
import type { DepositInput, SafeTransferEscrowClient } from '../../src/index.js';
import type { Network } from './config';
import type { AccountKit } from './dapp-kit';
import { formatUnits, parseUnits } from './format';
import { useCoinOptions, type CoinOption } from './useCoins';
import { useExecute } from './useExecute';

interface CoinRow {
  key: number;
  /** Empty until the user picks one. */
  coinType: string;
  /** Normal decimal units, e.g. `1.5`. */
  amount: string;
}

interface CreateEscrowFormProps {
  sender: string;
  otherAddress: string | undefined;
  sdk: SafeTransferEscrowClient;
  dAppKit: AccountKit;
  network: Network;
}

function optionLabel(option: CoinOption): string {
  const balance = formatUnits(option.balance, option.decimals);

  return `${option.symbol} · balance ${balance}${option.hasMetadata ? '' : ' (no metadata, base units)'}`;
}

export function CreateEscrowForm({
  sender,
  otherAddress,
  sdk,
  dAppKit,
  network,
}: CreateEscrowFormProps) {
  const nextKey = useRef(1);
  const [recipient, setRecipient] = useState('');
  const [rows, setRows] = useState<CoinRow[]>([{ key: 0, coinType: '', amount: '' }]);
  const [validation, setValidation] = useState<string | null>(null);
  const coins = useCoinOptions(dAppKit, network, sender);
  const options = coins.data ?? [];
  const execute = useExecute(dAppKit);
  const create = useMutation({
    mutationFn: async (deposits: DepositInput[]) => {
      return execute(
        sdk.tx.createEscrow({ sender, recipient: recipient.trim(), coins: deposits }),
      );
    },
    // Only after the transaction succeeded, so a failed attempt keeps the user's input.
    onSuccess: () => {
      setRecipient('');
      setRows([{ key: nextKey.current++, coinType: '', amount: '' }]);
      setValidation(null);
    },
  });

  function updateRow(key: number, patch: Partial<CoinRow>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  /** Each coin type can be picked once; the contract would merge duplicates anyway. */
  function availableFor(row: CoinRow): CoinOption[] {
    const taken = new Set(rows.filter((r) => r.key !== row.key).map((r) => r.coinType));

    return options.filter((option) => !taken.has(option.coinType));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    setValidation(null);

    const address = recipient.trim();
    if (!/^0x[0-9a-fA-F]{1,64}$/.test(address) || BigInt(normalizeSuiAddress(address)) === 0n) {
      setValidation('Recipient must be a non-zero 0x… address.');
      return;
    }
    if (normalizeSuiAddress(address) === normalizeSuiAddress(sender)) {
      setValidation('Recipient must differ from your own address.');
      return;
    }

    const deposits: DepositInput[] = [];
    for (const row of rows) {
      const option = options.find((o) => o.coinType === row.coinType);
      if (!option) {
        setValidation('Pick a coin for every row.');
        return;
      }
      const amount = parseUnits(row.amount, option.decimals);
      if (amount === null) {
        setValidation(
          `${option.symbol}: enter a positive amount with at most ${option.decimals} decimals.`,
        );
        return;
      }
      if (amount > option.balance) {
        setValidation(`${option.symbol}: amount exceeds your balance.`);
        return;
      }
      deposits.push({ coinType: option.coinType, amount });
    }

    create.mutate(deposits);
  }

  return (
    <form className="create" onSubmit={submit}>
      <h3>Create escrow</h3>
      <label>
        Recipient
        <input
          value={recipient}
          onChange={(event) => setRecipient(event.target.value)}
          placeholder="0x…"
          spellCheck={false}
        />
      </label>
      {otherAddress ? (
        <button type="button" onClick={() => setRecipient(otherAddress)}>
          Use other account
        </button>
      ) : null}
      {coins.isPending ? <p className="muted">Loading coins…</p> : null}
      {coins.error ? (
        <p className="error" role="alert">
          {coins.error.message}
        </p>
      ) : null}
      {coins.data?.length === 0 ? <p className="muted">This account holds no coins.</p> : null}
      {rows.map((row) => {
        const selected = options.find((option) => option.coinType === row.coinType);

        return (
          <div className="coin-row" key={row.key}>
            <select
              aria-label="Coin"
              value={row.coinType}
              onChange={(event) => updateRow(row.key, { coinType: event.target.value })}
            >
              <option value="" disabled>
                Select coin…
              </option>
              {availableFor(row).map((option) => (
                <option key={option.coinType} value={option.coinType}>
                  {optionLabel(option)}
                </option>
              ))}
            </select>
            <input
              aria-label="Amount"
              value={row.amount}
              onChange={(event) => updateRow(row.key, { amount: event.target.value })}
              placeholder={selected ? `amount in ${selected.symbol}` : 'amount'}
              inputMode="decimal"
              spellCheck={false}
            />
            {rows.length > 1 ? (
              <button
                type="button"
                onClick={() => setRows((current) => current.filter((r) => r.key !== row.key))}
              >
                Remove
              </button>
            ) : null}
          </div>
        );
      })}
      <button
        type="button"
        disabled={rows.length >= options.length}
        onClick={() =>
          setRows((current) => [...current, { key: nextKey.current++, coinType: '', amount: '' }])
        }
      >
        Add coin
      </button>
      <button type="submit" disabled={create.isPending || options.length === 0}>
        {create.isPending ? 'Waiting…' : 'Create escrow'}
      </button>
      {validation ? (
        <p className="error" role="alert">
          {validation}
        </p>
      ) : null}
      {create.error ? (
        <p className="error" role="alert">
          {create.error.message}
        </p>
      ) : null}
      {create.isSuccess ? <p className="muted">Created (tx {create.data}).</p> : null}
    </form>
  );
}
