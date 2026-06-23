# Multi-Token Escrow — Exchange-Rate Parity (DEX TWAP Oracle)

Adds an on-chain exchange-rate parity check to escrow funding so a multi-token
deposit is validated to be worth the agreed job value at deposit time. Closes #659.

## Why

The escrow contract accepts multiple funding tokens but never validated that the
deposited amount was worth the agreed job value. A client could fund a USD-priced
job with a token whose value later dropped, under-paying the freelancer with no
on-chain recourse. The agreed value lived only in PostgreSQL.

## Contract (`contracts/escrow/src/lib.rs`)

- `fund_job` gains two parameters: `agreed_value_stroops: i128` and
  `max_slippage_bps: u32`. When `agreed_value_stroops > 0`, the contract queries
  the configured price oracle for a TWAP of the job token (quoted in XLM stroops),
  computes `deposited_value = amount * twap_price / PRICE_SCALE` with overflow-safe
  arithmetic, and rejects with `EscrowError::InsufficientValue` if the value falls
  below `agreed_value * (10000 - max_slippage_bps) / 10000`.
- `agreed_value_stroops = 0` bypasses the oracle entirely (native-XLM jobs and the
  legacy migration path), so existing escrows continue to function.
- New errors: `InsufficientValue` (41), `OracleUnavailable` (42), `ValueOverflow`
  (43). Oracle unavailability uses `try_invoke_contract` and returns
  `OracleUnavailable` rather than panicking; a TWAP with fewer than
  `MIN_TWAP_SAMPLES` (10) samples or a non-positive price is treated as unavailable.
- A `RateSnapshot { twap_price, samples, agreed_value_stroops, deposited_value,
  max_slippage_bps, ledger }` is persisted per job for audit and exposed via
  `get_rate_snapshot`.
- `set_price_oracle` / `get_price_oracle` (admin) configure the oracle. The oracle
  must expose `twap(token: Address, quote: Address, sample_ledgers: u32) -> (i128, u32)`.

### Tests

- `test.rs`: exact value match, 1 bps under tolerance (passes), 1 bps over
  tolerance (rejected with `InsufficientValue`), boundary value, XLM-only bypass,
  oracle-not-configured and too-few-samples (`OracleUnavailable`). A `MockOracle`
  contract provides a configurable TWAP.
- `fuzz.rs`: `fuzz_deposited_value_never_overflows` drives random wide `amount` /
  `twap_price` pairs and asserts the value computation never wraps i128 — it
  either returns the exact checked result or `ValueOverflow`.

## Backend

- `ContractService.buildFundJobTx` now passes `agreed_value_stroops` and
  `max_slippage_bps`. `simulateFundJob` pre-flights the parity check so failures
  surface as structured errors before the user signs. `getRateSnapshot` reads the
  stored snapshot.
- `POST /escrow/init-fund` derives `agreed_value_stroops` from the job budget
  (`bypassOracle` opts out), returns `422 InsufficientValue` / `503 OracleUnavailable`
  on a failed pre-flight, and echoes the agreed value + slippage to the client.
- `GET /escrow/:jobId/rate-snapshot` returns the stored TWAP snapshot for UI display.

## Frontend

- `DepositRateInfo` shows the agreed value, TWAP rate, equivalent deposit value,
  and slippage tolerance on the funding confirmation modal, and warns when the
  live rate has drifted more than 1% from the quoted snapshot.
- The job detail funding flow passes the rate context into the confirmation modal
  and surfaces the structured `InsufficientValue` / `OracleUnavailable` errors.

## Migration note

Jobs funded before this change (or with `agreed_value_stroops = 0`) have no
`RateSnapshot`; `get_rate_snapshot` returns `None` and the API responds 404 for
those, while all existing escrow operations remain unaffected.
