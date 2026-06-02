# Dispute contract error codes

| Code | Variant                  | Description                                                    |
| ---- | ------------------------ | -------------------------------------------------------------- |
| #1   | `DisputeNotFound`        | No dispute exists with the given ID                            |
| #2   | `Unauthorized`           | Caller is not permitted to perform this action                 |
| #3   | `AlreadyVoted`           | This address has already cast a vote on this dispute           |
| #4   | `VotingClosed`           | The voting window for this dispute has ended                   |
| #5   | `NotEnoughVotes`         | Insufficient votes have been cast to resolve the dispute       |
| #6   | `InvalidParty`           | The given address is not a party to this dispute               |
| #7   | `AlreadyResolved`        | This dispute has already been resolved                         |
| #8   | `InsufficientReputation` | Voter does not meet the minimum reputation threshold           |
| #9   | `NotInitialized`         | The contract has not been initialized                          |
| #10  | `ConflictOfInterest`     | Voter is a participant in the job under dispute                |
| #11  | `ContractPaused`         | The contract is currently paused; all mutations are blocked    |
| #12  | `NotAdmin`               | Caller is not a registered admin/signer                        |
| #13  | `DisputeCooldown`        | A dispute was raised too recently; cooldown period not elapsed |
| #14  | `VotingPeriodNotExpired` | Cannot resolve before the voting period has fully elapsed      |
| #15  | `DelegationNotFound`     | No active delegation exists for this voter                     |
| #16  | `AlreadyDelegated`       | This voter has already delegated their vote                    |
| #17  | `DelegateAlreadyVoted`   | The delegate for this voter has already voted                  |

# Escrow contract error codes

| Code | Variant                          | Description                                                                        |
| ---- | -------------------------------- | ---------------------------------------------------------------------------------- |
| #1   | `JobNotFound`                    | No job exists with the given ID                                                    |
| #2   | `Unauthorized`                   | Caller is not authorized to perform this action                                    |
| #3   | `InvalidStatus`                  | Job is not in a valid state for this operation (see state machine)                 |
| #4   | `MilestoneNotFound`              | No milestone exists with the given ID                                              |
| #5   | `InsufficientFunds`              | Insufficient funds available for this operation                                    |
| #6   | `AlreadyFunded`                  | Job has already been funded or top-up would exceed total                           |
| #7   | `InvalidDeadline`                | Deadline is in the past or invalid                                                 |
| #8   | `MilestoneDeadlineExceeded`      | Milestone deadline has passed                                                      |
| #9   | `HasPendingMilestone`            | Job has a pending milestone submission awaiting approval                           |
| #10  | `NoRefundDue`                    | No refund is available for this job                                                |
| #11  | `GracePeriodNotMet`              | Grace period after deadline has not elapsed                                        |
| #12  | `InvalidMilestoneIndex`          | Milestone index is out of bounds                                                   |
| #13  | `TokenNotAllowed`                | Payment token is not in the allowed tokens list                                    |
| #14  | `AlreadyInitialized`             | Contract has already been initialized                                              |
| #15  | `ContractPaused`                 | The contract is currently paused; all mutations are blocked                        |
| #16  | `NotAdmin`                       | Caller is not a registered admin/signer                                            |
| #17  | `RevisionProposalAlreadyExists`  | A revision proposal already exists for this job in Pending status                  |
| #18  | `RevisionProposalNotFound`       | No revision proposal exists for this job                                           |
| #19  | `NotAuthorizedForProposalAction` | Caller is not authorized to perform this action on the proposal                    |
| #20  | `ProposalNotPending`             | The proposal is not in Pending status and cannot be acted upon                     |
| #21  | `InsufficientTopUp`              | Insufficient funds to cover the increased total                                    |
| #22  | `ProposalTotalMismatch`          | The proposed new_total does not match the sum of milestone amounts                 |
| #23  | `EmptyMilestonesProposed`        | The proposed milestone list is empty                                               |
| #24  | `InvalidAmount`                  | The job's stored total_amount does not equal the sum of its milestone amounts      |
| #25  | `WorkInProgress`                 | A milestone is currently in progress or submitted; cancel is not allowed           |
| #26  | `DeadlineNotPassed`              | The job deadline has not yet passed; expiry cannot be triggered yet                |
| #27  | `InvalidThreshold`               | Threshold is 0, exceeds signer count, or a removal would drop below it             |
| #28  | `SignerNotFound`                 | The address is not a registered multi-sig signer                                   |
| #29  | `MultiSigAlreadyApproved`        | This signer has already approved the proposal                                      |
| #30  | `MultiSigAlreadyExecuted`        | The proposal has already been executed                                             |
| #31  | `MultiSigProposalNotFound`       | No multi-sig proposal exists with this ID                                          |
| #32  | `InvalidPartialAmount`           | Partial payment amount is invalid (must be > 0 and <= milestone remaining balance) |
| #33  | `EmptyMilestones`                | The milestone list is empty                                                        |
| #34  | `TooManyMilestones`              | The number of milestones exceeds the permitted limit                               |
| #35  | `InvalidFee`                     | The fee basis points exceed the maximum permitted limit                            |
| #36  | `ProposalTimeLockActive`         | Proposal execution is time-locked and cannot be executed yet                       |
| #37  | `ContractNotPaused`              | Emergency withdrawal requires the contract to be paused                            |
| #38  | `NoFundsToWithdraw`              | The job has no escrowed funds available to withdraw                                |
| #39  | `ProposalExpired`                | Proposal has expired                                                               |

## Escrow State Machine

The escrow contract enforces a strict state machine to prevent invalid transitions:

### States

- **Created**: Job created but not funded
- **Funded**: Escrow funded, ready for work
- **InProgress**: Work has begun (at least one milestone submitted)
- **Completed**: All milestones approved (terminal state)
- **Disputed**: Dispute raised (only dispute resolution can change state)
- **Cancelled**: Job cancelled or refunded (terminal state)
- **Expired**: Job deadline passed (terminal state)

### Valid Transitions

| From State | To State   | Trigger Function              |
| ---------- | ---------- | ----------------------------- |
| Created    | Funded     | `fund_job`                    |
| Funded     | InProgress | `submit_milestone`            |
| Funded     | Cancelled  | `cancel_job`                  |
| Funded     | Expired    | `expire_job`                  |
| InProgress | Completed  | `approve_milestone` (all)     |
| InProgress | Disputed   | External dispute contract     |
| InProgress | Cancelled  | `cancel_job` (no active work) |
| InProgress | Expired    | `expire_job`                  |
| Disputed   | Completed  | `resolve_dispute_callback`    |
| Disputed   | Cancelled  | `resolve_dispute_callback`    |

### Terminal States

Once a job reaches **Completed**, **Cancelled**, or **Expired** state, it cannot transition to any other state. All mutation operations will fail with `InvalidStatus` error (#3).

# Reputation contract error codes

| Code | Variant                     | Description                                                                 |
| ---- | --------------------------- | --------------------------------------------------------------------------- |
| #1   | `InvalidRating`             | Rating must be between 1 and 5                                              |
| #2   | `AlreadyReviewed`           | Reviewer has already submitted a review for this job/reviewee               |
| #3   | `SelfReview`                | A user cannot review themselves                                             |
| #4   | `JobNotFound`               | No escrow job exists with the given ID                                      |
| #5   | `JobNotCompleted`           | Job must be in Completed status before a review can be submitted            |
| #6   | `NotJobParticipant`         | Reviewer or reviewee is not a participant in the referenced job             |
| #7   | `BelowMinStake`             | Stake weight is below the configured minimum                                |
| #8   | `ContractPaused`            | The contract is currently paused; all mutations are blocked                 |
| #9   | `NotAdmin`                  | Caller is not a registered admin/signer                                     |
| #10  | `InvalidDecayRate`          | Decay rate must be between 0 and 100                                        |
| #11  | `Unauthorized`              | General authorization failure                                               |
| #12  | `RateLimitExceeded`         | Reviewer has submitted a review too recently; rate limit window not elapsed |
| #13  | `ReferralAlreadyRegistered` | This address already has a referrer registered                              |
| #14  | `SelfReferral`              | A user cannot refer themselves                                              |
| #15  | `ReviewNotFound`            | No review matching the given criteria was found                             |
| #16  | `AppealWindowExpired`       | The appeal window for this review has closed                                |
| #17  | `AppealThresholdNotMet`     | Insufficient stake to meet the appeal threshold                             |
| #18  | `ReviewAlreadyAppealed`     | This review has already been appealed                                       |
| #19  | `NotReviewParticipant`      | Caller is not a participant in the review being appealed                    |
| #20  | `AppealAlreadyExists`       | An appeal for this review already exists                                    |
| #21  | `AppealNotFound`            | No appeal found matching the given criteria                                 |
| #22  | `AppealAlreadyResolved`     | This appeal has already been resolved                                       |
| #23  | `AlreadyEndorsed`           | This endorser has already endorsed the target for this skill                |

## Stability guarantee

Error code numbers are **stable across contract upgrades**. New error variants are always appended with the next available integer; existing codes are never renumbered or removed.
