# Dispute History Page & Two-Step Deadline Extension Implementation

## Overview

This document describes two major features implemented for the StellarMarket platform:

1. **Dispute History Page** - Allows users to view their complete dispute history with filtering and sorting
2. **Two-Step Deadline Extension** - Solves the Soroban contract limitation where `extend_deadline` requires simultaneous auth from both parties

## Problem Statement

### Soroban Contract Limitation

The original `extend_deadline` contract function requires simultaneous authorization from both the client and freelancer in a single transaction. This is impossible to achieve in a web3 context where:

- Users sign transactions independently via their wallets
- There's no way to coordinate simultaneous signing
- Each party needs to approve independently

### Solution: Two-Step Approval Pattern

Instead of trying to get simultaneous signatures, we implement a two-step approval process:

1. **Step 1**: One party (client or freelancer) requests a deadline extension with a reason
2. **Step 2**: The other party approves or rejects the request
3. **Step 3**: Once both approve, the system prepares the on-chain transaction for signing
4. **Step 4**: The client (who controls the escrow) signs and broadcasts the transaction

This approach:

- ✅ Eliminates the need for simultaneous signing
- ✅ Provides transparency and audit trail
- ✅ Allows either party to initiate
- ✅ Requires explicit consent from both parties
- ✅ Maintains on-chain integrity

---

## Feature 1: Dispute History Page

### Frontend Implementation

**Location**: `/frontend/src/app/disputes/history/page.tsx`

#### Features

- **Filter Options**:
  - All Disputes: Shows all disputes user is involved in
  - I Initiated: Shows only disputes the user started
  - I'm Involved: Shows disputes where user is a participant but didn't initiate

- **Sorting**:
  - Most Recent: Newest disputes first
  - Oldest First: Chronological order

- **Display Information**:
  - Job title and dispute ID
  - Status badge (OPEN, IN_PROGRESS, RESOLVED)
  - Initiator and other party information
  - Creation and resolution dates
  - Dispute reason preview
  - Resolution outcome (if resolved)

- **Statistics**:
  - Count of open disputes
  - Count of in-progress disputes
  - Count of resolved disputes

#### Usage

```typescript
// Navigate to dispute history
/disputes/history

// Filter by initiated disputes
?filter=initiated

// Sort by oldest first
?sortBy=oldest
```

### Backend Implementation

**Location**: `/backend/src/services/dispute.service.ts`

#### New Method: `getUserDisputeHistory()`

```typescript
static async getUserDisputeHistory(
  userId: string,
  filter: "all" | "initiated" | "involved" = "all",
  sortBy: "recent" | "oldest" = "recent",
  pagination: { page: number; limit: number } = { page: 1, limit: 20 }
)
```

**Parameters**:

- `userId`: Current user's ID
- `filter`: Type of disputes to retrieve
- `sortBy`: Sort order
- `pagination`: Page and limit for results

**Returns**: Array of disputes with:

- All dispute details
- Job title
- Other party name and avatar
- Vote counts
- Timestamps

#### API Endpoint

**Route**: `GET /api/disputes/history`

**Query Parameters**:

```
?filter=all|initiated|involved
?sortBy=recent|oldest
?page=1
?limit=20
```

**Response**:

```json
[
  {
    "id": "dispute_123",
    "jobId": "job_456",
    "jobTitle": "Build React Dashboard",
    "status": "RESOLVED",
    "initiatorId": "user_789",
    "clientId": "user_111",
    "freelancerId": "user_222",
    "reason": "Milestone not completed to specification",
    "outcome": "Resolved in favor of client",
    "otherPartyName": "john_dev",
    "otherPartyAvatar": "https://...",
    "createdAt": "2026-05-20T10:30:00Z",
    "resolvedAt": "2026-05-25T14:15:00Z",
    "votes": [...]
  }
]
```

---

## Feature 2: Two-Step Deadline Extension

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                  Deadline Extension Flow                     │
└─────────────────────────────────────────────────────────────┘

1. REQUEST PHASE
   ├─ User (Client or Freelancer) requests extension
   ├─ Provides new deadline and reason
   ├─ Status: PENDING
   └─ Other party notified

2. APPROVAL PHASE
   ├─ Other party reviews request
   ├─ Can approve or reject
   ├─ If approved: Status → APPROVED_BY_CLIENT or APPROVED_BY_FREELANCER
   ├─ If rejected: Status → REJECTED
   └─ Requester notified

3. DUAL APPROVAL PHASE
   ├─ When both parties approve
   ├─ Status: APPROVED_BY_BOTH
   ├─ System prepares on-chain transaction
   └─ XDR ready for signing

4. ON-CHAIN EXECUTION
   ├─ Client signs transaction via Freighter
   ├─ Transaction broadcast to Soroban
   ├─ Milestone deadline updated on-chain
   ├─ Status: COMPLETED
   └─ Both parties notified
```

### Database Schema

#### New Enum: `DeadlineExtensionStatus`

```prisma
enum DeadlineExtensionStatus {
  PENDING                    // Initial state
  APPROVED_BY_CLIENT         // Client approved
  APPROVED_BY_FREELANCER     // Freelancer approved
  APPROVED_BY_BOTH           // Both approved, ready for on-chain
  REJECTED                   // One party rejected
  EXPIRED                    // Request expired (future use)
}
```

#### New Model: `DeadlineExtensionRequest`

```prisma
model DeadlineExtensionRequest {
  id                    String
  milestoneId           String
  jobId                 String
  requestedById         String
  newDeadline           DateTime
  reason                String
  status                DeadlineExtensionStatus
  clientApprovedAt      DateTime?
  freelancerApprovedAt  DateTime?
  rejectedBy            String?
  rejectionReason       String?
  onChainTxHash         String?
  createdAt             DateTime
  updatedAt             DateTime

  // Relations
  milestone             Milestone
  job                   Job
  requestedBy           User
  rejectedByUser        User?
}
```

### Backend Service

**Location**: `/backend/src/services/deadline-extension.service.ts`

#### Key Methods

##### 1. Request Extension

```typescript
static async requestExtension(
  milestoneId: string,
  jobId: string,
  requestedById: string,
  newDeadline: Date,
  reason: string
)
```

**Validations**:

- Milestone exists and belongs to job
- User is job participant (client or freelancer)
- New deadline is in the future
- No pending extension request exists

**Side Effects**:

- Creates `DeadlineExtensionRequest` record
- Notifies other party
- Status: `PENDING`

##### 2. Approve Extension

```typescript
static async approveExtension(
  extensionRequestId: string,
  approverId: string
)
```

**Validations**:

- Request exists and is PENDING
- Approver is job participant
- Approver is not the requester

**Logic**:

- Records approval timestamp (clientApprovedAt or freelancerApprovedAt)
- Updates status based on approval state:
  - If first approval: `APPROVED_BY_CLIENT` or `APPROVED_BY_FREELANCER`
  - If second approval: `APPROVED_BY_BOTH`
- If both approved: Calls `executeExtensionOnChain()`

**Side Effects**:

- Notifies other party of approval
- Prepares on-chain transaction if both approved

##### 3. Reject Extension

```typescript
static async rejectExtension(
  extensionRequestId: string,
  rejectedById: string,
  rejectionReason: string
)
```

**Validations**:

- Request exists and is PENDING
- Rejector is job participant

**Side Effects**:

- Sets status to `REJECTED`
- Records rejection reason
- Notifies requester

##### 4. Execute On-Chain

```typescript
static async executeExtensionOnChain(
  extensionRequest: any
)
```

**Process**:

1. Builds XDR using `ContractService.buildExtendDeadlineTx()`
2. Returns XDR for frontend to sign
3. Marks request as ready for signing

##### 5. Confirm Transaction

```typescript
static async confirmExtensionTransaction(
  extensionRequestId: string,
  txHash: string
)
```

**Process**:

1. Updates milestone deadline in database
2. Records transaction hash
3. Notifies both parties

### API Routes

**Location**: `/backend/src/routes/deadline-extension.routes.ts`

#### Endpoints

##### POST `/api/deadline-extensions/request`

Request a deadline extension.

**Request Body**:

```json
{
  "milestoneId": "milestone_123",
  "jobId": "job_456",
  "newDeadline": "2026-06-15T18:00:00Z",
  "reason": "Encountered unexpected technical challenges that require additional time"
}
```

**Response** (201):

```json
{
  "id": "ext_789",
  "milestoneId": "milestone_123",
  "jobId": "job_456",
  "requestedById": "user_111",
  "newDeadline": "2026-06-15T18:00:00Z",
  "reason": "Encountered unexpected technical challenges...",
  "status": "PENDING",
  "createdAt": "2026-05-28T10:00:00Z"
}
```

##### POST `/api/deadline-extensions/:id/approve`

Approve a deadline extension request.

**Response**:

```json
{
  "id": "ext_789",
  "status": "APPROVED_BY_CLIENT",
  "clientApprovedAt": "2026-05-28T11:30:00Z"
}
```

##### POST `/api/deadline-extensions/:id/reject`

Reject a deadline extension request.

**Request Body**:

```json
{
  "rejectionReason": "The timeline is already too tight"
}
```

**Response**:

```json
{
  "id": "ext_789",
  "status": "REJECTED",
  "rejectedBy": "user_222",
  "rejectionReason": "The timeline is already too tight"
}
```

##### POST `/api/deadline-extensions/:id/confirm-tx`

Confirm the on-chain transaction.

**Request Body**:

```json
{
  "txHash": "abc123def456..."
}
```

**Response**:

```json
{
  "id": "ext_789",
  "status": "APPROVED_BY_BOTH",
  "onChainTxHash": "abc123def456...",
  "milestone": {
    "id": "milestone_123",
    "contractDeadline": "2026-06-15T18:00:00Z"
  }
}
```

##### GET `/api/deadline-extensions/job/:jobId`

Get all extension requests for a job.

**Response**:

```json
[
  {
    "id": "ext_789",
    "milestone": { "id": "...", "title": "..." },
    "requestedBy": { "id": "...", "username": "..." },
    "status": "PENDING",
    "newDeadline": "2026-06-15T18:00:00Z"
  }
]
```

##### GET `/api/deadline-extensions/pending`

Get pending extension requests for the current user.

**Response**: Same as above, filtered to user's jobs

### Frontend Components

#### 1. DeadlineExtensionModal

**Location**: `/frontend/src/components/DeadlineExtensionModal.tsx`

Modal for requesting a deadline extension.

**Props**:

```typescript
{
  milestone: Milestone
  jobId: string
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
}
```

**Features**:

- Date picker for new deadline
- Minimum deadline validation (24 hours from current)
- Reason textarea with character count
- Error handling and validation
- Loading state during submission

**Usage**:

```tsx
const [isOpen, setIsOpen] = useState(false);

<DeadlineExtensionModal
  milestone={milestone}
  jobId={jobId}
  isOpen={isOpen}
  onClose={() => setIsOpen(false)}
  onSuccess={() => {
    // Refresh data
    fetchMilestones();
  }}
/>;
```

#### 2. DeadlineExtensionApprovalCard

**Location**: `/frontend/src/components/DeadlineExtensionApprovalCard.tsx`

Card for reviewing and approving/rejecting extension requests.

**Props**:

```typescript
{
  extensionRequest: ExtensionRequest
  userRole: "client" | "freelancer"
  onApprove: () => void
  onReject: () => void
}
```

**Features**:

- Displays request details and reason
- Shows new deadline
- Displays approval status for both parties
- Approve/Reject buttons
- Rejection reason form
- Real-time status updates

**Usage**:

```tsx
{
  pendingRequests.map((request) => (
    <DeadlineExtensionApprovalCard
      key={request.id}
      extensionRequest={request}
      userRole={userRole}
      onApprove={() => fetchRequests()}
      onReject={() => fetchRequests()}
    />
  ));
}
```

### Integration with Existing Features

#### Milestone Timeline

Add extension request button to milestone timeline:

```tsx
<button
  onClick={() => setExtensionModalOpen(true)}
  className="text-stellar-blue hover:underline text-sm"
>
  Request Extension
</button>
```

#### Job Detail Page

Display pending extension requests:

```tsx
{
  pendingExtensions.length > 0 && (
    <div className="mt-6">
      <h3 className="text-lg font-semibold mb-4">Pending Extension Requests</h3>
      {pendingExtensions.map((ext) => (
        <DeadlineExtensionApprovalCard
          key={ext.id}
          extensionRequest={ext}
          userRole={userRole}
          onApprove={handleApprove}
          onReject={handleReject}
        />
      ))}
    </div>
  );
}
```

#### Notifications

Users receive notifications for:

- Extension request received
- Extension approved by other party
- Extension rejected with reason
- Deadline successfully extended on-chain

---

## Database Migration

**Location**: `/backend/prisma/migrations/20260528000000_add_deadline_extension_request/migration.sql`

Run migration:

```bash
npx prisma migrate deploy
```

---

## Testing

### Test Cases

#### Request Extension

```typescript
test("should create extension request", async () => {
  const request = await DeadlineExtensionService.requestExtension(
    milestoneId,
    jobId,
    clientId,
    new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    "Need more time for testing",
  );

  expect(request.status).toBe("PENDING");
  expect(request.requestedById).toBe(clientId);
});
```

#### Approve Extension

```typescript
test("should approve extension and update status", async () => {
  const approved = await DeadlineExtensionService.approveExtension(
    extensionRequestId,
    freelancerId,
  );

  expect(approved.status).toBe("APPROVED_BY_FREELANCER");
  expect(approved.freelancerApprovedAt).toBeDefined();
});
```

#### Dual Approval

```typescript
test("should execute on-chain when both approve", async () => {
  // First approval
  await DeadlineExtensionService.approveExtension(id, clientId);

  // Second approval
  const result = await DeadlineExtensionService.approveExtension(
    id,
    freelancerId,
  );

  expect(result.status).toBe("APPROVED_BY_BOTH");
  expect(result.xdr).toBeDefined();
});
```

---

## Security Considerations

1. **Authorization**: Only job participants can request/approve extensions
2. **Self-Approval Prevention**: Requester cannot approve their own request
3. **Immutability**: Once rejected, request cannot be re-approved
4. **Audit Trail**: All approvals timestamped and recorded
5. **On-Chain Verification**: Transaction hash verified before updating database

---

## Future Enhancements

1. **Automatic Expiry**: Extension requests expire after 7 days
2. **Extension Limits**: Limit number of extensions per milestone
3. **Escalation**: If rejected, allow escalation to dispute resolution
4. **Batch Extensions**: Extend multiple milestones at once
5. **Analytics**: Track extension patterns and reasons

---

## Troubleshooting

### Extension Request Not Appearing

**Check**:

1. User is job participant (client or freelancer)
2. Milestone exists and belongs to job
3. No pending request already exists
4. Notifications are enabled

### Approval Not Working

**Check**:

1. User is not the requester
2. Request status is PENDING
3. User is job participant
4. No database errors in logs

### On-Chain Transaction Failed

**Check**:

1. Both parties approved
2. Client has sufficient balance
3. Soroban RPC is accessible
4. Contract ID is correct

---

## References

- [Soroban Contract Documentation](https://developers.stellar.org/docs/learn/soroban)
- [Freighter Wallet API](https://github.com/stellar/freighter-api)
- [Prisma Documentation](https://www.prisma.io/docs/)
