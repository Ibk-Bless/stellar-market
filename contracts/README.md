# StellarMarket Contracts

This directory contains Soroban smart contracts for:

- `escrow` (`stellar-market-escrow`)
- `reputation` (`stellar-market-reputation`)
- `dispute` (`stellar-market-dispute`)
- `integration-tests` (`stellar-market-integration-tests`)

## Prerequisites

- Rust toolchain (stable)
- wasm target:
  - `rustup target add wasm32-unknown-unknown`
- Stellar CLI installed and configured
- A funded testnet account identity in Stellar CLI

## Project Map

- `escrow/` - Escrow and milestone payment contract
- `reputation/` - Reputation and stake-weighted reviews
- `reputation_interface/` - Shared `ReputationVerifier` trait + `Badge` types for cross-contract reputation checks
- `dispute/` - Dispute voting and resolution
- `integration-tests/` - Cross-contract integration tests
- `scripts/` - Deployment scripts

## Build

From `contracts/`:

```bash
# Build all contracts for wasm
cargo build --release --target wasm32-unknown-unknown

# Build individual contracts
cargo build --release --target wasm32-unknown-unknown -p stellar-market-escrow
cargo build --release --target wasm32-unknown-unknown -p stellar-market-reputation
cargo build --release --target wasm32-unknown-unknown -p stellar-market-dispute
```

## Test

From `contracts/`:

```bash
# All tests in workspace
cargo test

# Per-contract tests
cargo test -p stellar-market-escrow
cargo test -p stellar-market-reputation
cargo test -p stellar-market-dispute

# Integration tests
cargo test -p stellar-market-integration-tests
```

See detailed integration test notes in `contracts/integration-tests/README.md`.

## Environment Setup

Create a local env file:

```bash
cp contracts/.env.example contracts/.env
```

Required variables:

- `STELLAR_NETWORK` - network name configured in Stellar CLI (for example `testnet`)
- `SOURCE_ACCOUNT` - CLI identity/account used for deployments and invokes
- `TOKEN_ADDRESS` - token contract address used in escrow/reputation flows

## Deploy Contracts

Do not run these scripts unless you intend to deploy.

```bash
bash contracts/scripts/deploy_escrow.sh
bash contracts/scripts/deploy_reputation.sh
bash contracts/scripts/deploy_dispute.sh
```

Each script:

1. Loads env from `contracts/.env` (if present)
2. Validates required variables
3. Builds the target wasm
4. Runs `stellar contract deploy`
5. Prints deployed contract ID

After deployment, record IDs in `contracts/ADDRESSES.md`.

## Invoke Examples (Testnet)

Replace placeholders like `<ESCROW_CONTRACT_ID>` before running.

### Escrow

```bash
# create_job(client, freelancer, token, milestones, job_deadline, auto_refund_after)
stellar contract invoke \
  --id <ESCROW_CONTRACT_ID> \
  --source-account "$SOURCE_ACCOUNT" \
  --network "$STELLAR_NETWORK" \
  -- \
  create_job \
  --client <CLIENT_ADDRESS> \
  --freelancer <FREELANCER_ADDRESS> \
  --token "$TOKEN_ADDRESS" \
  --milestones '[["Design",10000000,1735689600],["Build",20000000,1736294400]]' \
  --job_deadline 1736899200 \
  --auto_refund_after 1737504000

# get_job(job_id)
stellar contract invoke \
  --id <ESCROW_CONTRACT_ID> \
  --source-account "$SOURCE_ACCOUNT" \
  --network "$STELLAR_NETWORK" \
  -- \
  get_job \
  --job_id 1
```

### Reputation

```bash
# initialize(admin, decay_rate)
stellar contract invoke \
  --id <REPUTATION_CONTRACT_ID> \
  --source-account "$SOURCE_ACCOUNT" \
  --network "$STELLAR_NETWORK" \
  -- \
  initialize \
  --admin <ADMIN_ADDRESS> \
  --decay_rate 5

# submit_review(escrow_contract_id, reviewer, reviewee, job_id, rating, comment, stake_weight)
stellar contract invoke \
  --id <REPUTATION_CONTRACT_ID> \
  --source-account "$SOURCE_ACCOUNT" \
  --network "$STELLAR_NETWORK" \
  -- \
  submit_review \
  --escrow_contract_id <ESCROW_CONTRACT_ID> \
  --reviewer <REVIEWER_ADDRESS> \
  --reviewee <REVIEWEE_ADDRESS> \
  --job_id 1 \
  --rating 5 \
  --comment "great work" \
  --stake_weight 10000000

# get_average_rating(user)
stellar contract invoke \
  --id <REPUTATION_CONTRACT_ID> \
  --source-account "$SOURCE_ACCOUNT" \
  --network "$STELLAR_NETWORK" \
  -- \
  get_average_rating \
  --user <USER_ADDRESS>
```

### Dispute

```bash
# initialize(admin, reputation_contract, min_voter_reputation, escrow_contract)
stellar contract invoke \
  --id <DISPUTE_CONTRACT_ID> \
  --source-account "$SOURCE_ACCOUNT" \
  --network "$STELLAR_NETWORK" \
  -- \
  initialize \
  --admin <ADMIN_ADDRESS> \
  --reputation_contract <REPUTATION_CONTRACT_ID> \
  --min_voter_reputation 300 \
  --escrow_contract <ESCROW_CONTRACT_ID>

# raise_dispute(job_id, client, freelancer, initiator, reason, min_votes, tie_break_method)
stellar contract invoke \
  --id <DISPUTE_CONTRACT_ID> \
  --source-account "$SOURCE_ACCOUNT" \
  --network "$STELLAR_NETWORK" \
  -- \
  raise_dispute \
  --job_id 1 \
  --client <CLIENT_ADDRESS> \
  --freelancer <FREELANCER_ADDRESS> \
  --initiator <INITIATOR_ADDRESS> \
  --reason "milestone quality issue" \
  --min_votes 3 \
  --tie_break_method "Escalate"

# cast_vote(dispute_id, voter, choice, reason)
stellar contract invoke \
  --id <DISPUTE_CONTRACT_ID> \
  --source-account "$SOURCE_ACCOUNT" \
  --network "$STELLAR_NETWORK" \
  -- \
  cast_vote \
  --dispute_id 1 \
  --voter <VOTER_ADDRESS> \
  --choice "Freelancer" \
  --reason "evidence supports delivery"

# resolve_dispute(dispute_id)
stellar contract invoke \
  --id <DISPUTE_CONTRACT_ID> \
  --source-account "$SOURCE_ACCOUNT" \
  --network "$STELLAR_NETWORK" \
  -- \
  resolve_dispute \
  --dispute_id 1
```

## Cross-contract reputation interface

`reputation_interface/` exposes a shared `ReputationVerifier` trait so contracts
like escrow and dispute can gate actions on a user's reputation without
duplicating reputation logic:

```rust
use stellar_market_reputation_interface::{Badge, ReputationVerifier};

fn require_min_score<V: ReputationVerifier>(
    verifier: &V,
    env: &Env,
    user: Address,
    min: u32,
) -> bool {
    verifier.get_score(env, user.clone()) >= min
        && verifier.has_badge(env, user, Badge::Silver)
}
```

An on-chain implementor typically wraps the reputation contract's generated
client and forwards each call cross-contract; tests can substitute a mock
implementor (see `reputation_interface/src/lib.rs`). Build/test it with:

```bash
cargo test -p stellar-market-reputation-interface
```

## Troubleshooting

- wasm target missing:
  - `rustup target add wasm32-unknown-unknown`
- missing env variables:
  - ensure `contracts/.env` exists and includes all required keys
- unknown network/account:
  - verify Stellar CLI network and identity config
- missing deployed IDs:
  - update `contracts/ADDRESSES.md` after deployments
