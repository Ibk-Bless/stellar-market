# Arbitrator Voting Mechanism Implementation

## Overview

Implemented a panel-based arbitrator voting system for dispute resolution with 5 randomly selected arbitrators requiring a 3/5 majority to resolve disputes.

## Changes Made

### 1. Data Structure Updates (`contracts/dispute/src/lib.rs`)

#### Added to `Dispute` struct:

- `assigned_arbitrators: Vec<Address>` - Stores the 5 randomly selected arbitrators per dispute

#### Added to `DataKey` enum:

- `ArbitratorPool` - Stores the pool of eligible arbitrators

### 2. Core Functions

#### Arbitrator Selection (`select_arbitrators`)

- Randomly selects up to 5 arbitrators from the pool
- Excludes conflicted parties (client, freelancer, and those with conflicts of interest)
- Uses pseudo-random selection based on ledger timestamp and dispute ID
- Ensures unique arbitrator selection

#### Updated `raise_dispute`

- Now automatically selects 5 arbitrators when creating a dispute
- Stores assigned arbitrators in the dispute struct
- Emits event with assigned arbitrators list

#### Updated `cast_vote`

- **Enforces arbitrator restriction**: Only assigned arbitrators can vote
- Implements vote deduplication (one vote per arbitrator)
- **Auto-resolution**: Automatically resolves dispute when 3 votes are cast for the same decision
- Emits `VoteCast` event
- Emits `DisputeResolved` event on auto-resolution

### 3. Arbitrator Pool Management

#### New Admin Functions:

- `add_arbitrator(admin, arbitrator)` - Add arbitrator to pool
- `remove_arbitrator(admin, arbitrator)` - Remove arbitrator from pool
- `get_arbitrator_pool()` - View current arbitrator pool
- `get_assigned_arbitrators(dispute_id)` - Get arbitrators assigned to a specific dispute

### 4. Events

#### New/Updated Events:

- `arb_added` - Emitted when arbitrator added to pool
- `arb_rmvd` - Emitted when arbitrator removed from pool
- `voted` (VoteCast) - Emitted when arbitrator casts vote
- `resolved` (DisputeResolved) - Emitted when dispute auto-resolves at majority

## Acceptance Criteria Met

✅ **Arbitrator list stored per dispute** - `assigned_arbitrators` field in Dispute struct

✅ **Vote deduplication** - `HasVoted` storage key prevents double voting

✅ **Auto-resolution at majority threshold** - Dispute resolves automatically when any decision reaches 3 votes

✅ **Tests for scenarios**:

- `test_unanimous_vote_5_0` - All 5 arbitrators vote the same way
- `test_split_vote_3_2_client_wins` - 3-2 split in favor of client
- `test_split_vote_3_2_freelancer_wins` - 3-2 split in favor of freelancer
- `test_auto_resolve_at_3_vote_majority` - Auto-resolution at 3 votes
- `test_arbitrator_cannot_vote_twice` - Vote deduplication
- `test_non_assigned_arbitrator_cannot_vote` - Only assigned arbitrators can vote

## Key Features

1. **Random Selection**: Arbitrators are pseudo-randomly selected using ledger timestamp
2. **Conflict Avoidance**: Automatically excludes parties with conflicts of interest
3. **Majority Rule**: 3 out of 5 votes triggers automatic resolution
4. **Admin Control**: Only admins can manage the arbitrator pool
5. **Event Transparency**: All actions emit events for tracking

## Usage Example

```rust
// Admin adds arbitrators to pool
client.add_arbitrator(&admin, &arbitrator1);
client.add_arbitrator(&admin, &arbitrator2);
// ... add more arbitrators

// Raise dispute - automatically selects 5 arbitrators
let dispute_id = client.raise_dispute(
    &job_id,
    &client_addr,
    &freelancer_addr,
    &initiator,
    &reason,
    &3u32,  // min_votes
    &None,
);

// Get assigned arbitrators
let assigned = client.get_assigned_arbitrators(&dispute_id);

// Arbitrators vote
client.cast_vote(&dispute_id, &assigned[0], &VoteChoice::Client, &reason);
client.cast_vote(&dispute_id, &assigned[1], &VoteChoice::Client, &reason);
client.cast_vote(&dispute_id, &assigned[2], &VoteChoice::Client, &reason);
// Auto-resolves at 3 votes for client

// Check result
let dispute = client.get_dispute(&dispute_id);
assert_eq!(dispute.status, DisputeStatus::ResolvedForClient);
```

## Testing

Run tests with:

```bash
cd contracts
cargo test --package stellar-market-dispute
```

## Notes

- Empty arbitrator pool results in no assigned arbitrators (dispute cannot be voted on)
- Minimum 5 arbitrators in pool recommended for proper operation
- Auto-resolution happens immediately when 3 votes reach majority
- Existing delegation and reputation features still work with assigned arbitrators
