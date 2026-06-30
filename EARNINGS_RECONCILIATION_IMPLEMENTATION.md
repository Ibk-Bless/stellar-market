# Freelancer Earnings — Reconciliation & Tax-Period Export

Extends the freelancer earnings dashboard (#603, #477) with time-series
decomposition, on-chain reconciliation against the Stellar ledger, and a
tax-period CSV export. Closes #672.

## Why

The earnings page previously read from PostgreSQL only. With on-chain
settlement, the ground truth is the Stellar ledger — not the database. This work
lets freelancers verify that platform records match what actually settled and
produces an export usable for tax filings.

## Backend

### `GET /api/freelancers/earnings` (extended)

Now accepts optional `from`/`to` ISO dates and additionally returns:

- `weeklyEarnings` — sparse weekly buckets (`DATE_TRUNC('week', ...)`); the
  frontend fills zero-value gaps.
- `categoryBreakdown` — earnings grouped by each job's `category` tag (derived,
  not hardcoded) with per-category percentage.
- `range` — the resolved `{ from, to }` window.

### `GET /api/freelancers/earnings/reconcile?from=<ISO>&to=<ISO>`

Fetches inbound payments to the freelancer's wallet from Horizon for the window
and matches each to a DB earnings record by transaction hash or by the `jobId`
carried in the transaction memo. Returns `matched`, `onChainOnly`, and `dbOnly`
buckets plus a summary. `onChainOnly` entries indicate a DB sync failure and are
logged as warnings; each carries a Horizon transaction URL. Returns `502` if
Horizon is unreachable.

### `GET /api/freelancers/earnings/export?from=<ISO>&to=<ISO>&format=csv`

Streams a CSV with `date, job_title, client_name, amount_xlm, amount_usd,
tx_hash, reconciliation_status`. USD equivalents use `XLM_USD_RATE` when set.
Reconciliation status is computed best-effort against Horizon; if Horizon is
unreachable rows are marked `unverified` and the export still succeeds.

Horizon access is encapsulated in
`src/services/earnings-reconciliation.service.ts`.

## Frontend

`src/app/dashboard/earnings-page.tsx`:

- **Time-series chart** — Recharts `ComposedChart` with weekly bars and a 30-day
  (4-week) trailing moving-average line. Gap-filling and the moving average live
  in `earnings/earnings-utils.ts` (unit-tested); the moving average uses a
  partial window for the first three weeks.
- **Category breakdown** — horizontal bars derived from job category tags.
- **Reconciliation panel** — matched-vs-unmatched summary with a warning banner
  and "View unmatched" links to Horizon when on-chain payments are missing from
  the DB.
- **Date-range picker** — applies to the chart, category breakdown, and
  reconciliation simultaneously.
- **CSV export** — downloads via the new endpoint as a Blob URL (no page reload).

## Tests

- `backend/src/routes/__tests__/freelancer.earnings.test.ts` — reconciliation
  bucket classification, memo-based matching, Horizon-failure handling, range
  validation, role gating, and CSV export shape/escaping.
- `frontend/src/app/dashboard/earnings/__tests__/earnings-utils.test.ts` —
  zero-gap filling and partial-window moving average.
