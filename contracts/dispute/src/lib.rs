#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, vec, Address, Env, IntoVal,
    String, Symbol, Vec,
};

// Import reputation contract types for cross-contract calls
mod reputation {
    use soroban_sdk::{contracttype, Address};

    #[contracttype]
    #[derive(Clone, Debug, Eq, PartialEq)]
    pub struct UserReputation {
        pub user: Address,
        pub total_score: u64,
        pub total_weight: u64,
        pub review_count: u32,
    }
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum DisputeError {
    DisputeNotFound = 1,
    Unauthorized = 2,
    AlreadyVoted = 3,
    VotingClosed = 4,
    NotEnoughVotes = 5,
    InvalidParty = 6,
    AlreadyResolved = 7,
    InsufficientReputation = 8,
    NotInitialized = 9,
    ConflictOfInterest = 10,
    ContractPaused = 11,
    NotAdmin = 12,
    DisputeCooldown = 13,
    VotingPeriodNotExpired = 14,
    DelegationNotFound = 15,
    AlreadyDelegated = 16,
    DelegateAlreadyVoted = 17,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DisputeStatus {
    Open,
    Voting,
    ResolvedForClient,
    ResolvedForFreelancer,
    RefundedBoth,
    RefundSplit(u32),
    Escalated,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum TieBreakMethod {
    FavorFreelancer,
    FavorClient,
    Escalate,
    RefundBoth,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DisputeResolution {
    ClientWins,
    FreelancerWins,
    RefundBoth,
    RefundSplit(u32),
    Escalate,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum VoteChoice {
    Client,
    Freelancer,
    RefundSplit(u32),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Vote {
    pub voter: Address,
    pub choice: VoteChoice,
    pub reason: String,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Dispute {
    pub id: u64,
    pub job_id: u64,
    pub client: Address,
    pub freelancer: Address,
    pub initiator: Address,
    pub reason: String,
    pub status: DisputeStatus,
    pub votes_for_client: u32,
    pub votes_for_freelancer: u32,
    pub votes_for_refund_split: u32,
    pub refund_split_sum: u64,
    pub min_votes: u32,
    pub tie_break_method: TieBreakMethod,
    pub created_at: u64,
    pub voting_deadline: u64,
    pub excluded_voters: Vec<Address>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
enum DataKey {
    Dispute(u64),
    DisputeCount,
    Votes(u64),
    LastDisputeClosedAt(u64),
    HasVoted(u64, Address),
    ReputationContract,
    MinVoterReputation,
    Admin,
    EscrowContract,
    Paused,
    SlashAmount,
    ReputationSlashBps,
    JobDispute(u64),
    JobDisputes(u64),
    /// Maps (owner, job_id) → delegate address. Lets the owner look up who they delegated to.
    VoteDelegation(Address, u64),
    /// Maps (delegate, job_id) → owner address. Used in cast_vote to resolve the owner.
    DelegationOwner(Address, u64),
}

fn require_not_paused(env: &Env) -> Result<(), DisputeError> {
    if env
        .storage()
        .instance()
        .get(&DataKey::Paused)
        .unwrap_or(false)
    {
        return Err(DisputeError::ContractPaused);
    }
    Ok(())
}

fn require_admin(env: &Env, admin: &Address) -> Result<(), DisputeError> {
    let stored_admin: Address = env
        .storage()
        .instance()
        .get(&DataKey::Admin)
        .ok_or(DisputeError::NotInitialized)?;

    if admin != &stored_admin {
        return Err(DisputeError::NotAdmin);
    }
    Ok(())
}

const MIN_VOTER_REPUTATION: u32 = 300;

/// Default reputation points slashed from the losing party after a resolved dispute.
const DEFAULT_SLASH_AMOUNT: u64 = 50;
const DEFAULT_REPUTATION_SLASH_BPS: u32 = 500; // 5%
const DISPUTE_COOLDOWN_SECS: u64 = 86_400;
const VOTING_PERIOD_SECS: u64 = 604_800; // 7 days

/// Maximum number of jobs to look back for conflict detection to avoid instruction limits.
const MAX_CONFLICT_LOOKBACK: u64 = 100;

const MIN_TTL_THRESHOLD: u32 = 1_000;
const MIN_TTL_EXTEND_TO: u32 = 10_000;

fn bump_dispute_ttl(env: &Env, dispute_id: u64) {
    env.storage().persistent().extend_ttl(
        &DataKey::Dispute(dispute_id),
        MIN_TTL_THRESHOLD,
        MIN_TTL_EXTEND_TO,
    );
}

fn bump_votes_ttl(env: &Env, dispute_id: u64) {
    env.storage().persistent().extend_ttl(
        &DataKey::Votes(dispute_id),
        MIN_TTL_THRESHOLD,
        MIN_TTL_EXTEND_TO,
    );
}

fn bump_last_dispute_closed_ttl(env: &Env, job_id: u64) {
    env.storage().persistent().extend_ttl(
        &DataKey::LastDisputeClosedAt(job_id),
        MIN_TTL_THRESHOLD,
        MIN_TTL_EXTEND_TO,
    );
}

fn bump_has_voted_ttl(env: &Env, dispute_id: u64, voter: &Address) {
    env.storage().persistent().extend_ttl(
        &DataKey::HasVoted(dispute_id, voter.clone()),
        MIN_TTL_THRESHOLD,
        MIN_TTL_EXTEND_TO,
    );
}

fn bump_dispute_count_ttl(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(MIN_TTL_THRESHOLD, MIN_TTL_EXTEND_TO);
}

fn bump_job_dispute_ttl(env: &Env, job_id: u64) {
    env.storage().persistent().extend_ttl(
        &DataKey::JobDispute(job_id),
        MIN_TTL_THRESHOLD,
        MIN_TTL_EXTEND_TO,
    );
}

fn bump_job_disputes_ttl(env: &Env, job_id: u64) {
    env.storage().persistent().extend_ttl(
        &DataKey::JobDisputes(job_id),
        MIN_TTL_THRESHOLD,
        MIN_TTL_EXTEND_TO,
    );
}

fn bump_vote_delegation_ttl(env: &Env, owner: &Address, job_id: u64) {
    env.storage().persistent().extend_ttl(
        &DataKey::VoteDelegation(owner.clone(), job_id),
        MIN_TTL_THRESHOLD,
        MIN_TTL_EXTEND_TO,
    );
}

fn bump_delegation_owner_ttl(env: &Env, delegate: &Address, job_id: u64) {
    env.storage().persistent().extend_ttl(
        &DataKey::DelegationOwner(delegate.clone(), job_id),
        MIN_TTL_THRESHOLD,
        MIN_TTL_EXTEND_TO,
    );
}

// Import Job struct from escrow for cross-contract calls
mod escrow {
    use soroban_sdk::{contracttype, Address, String, Vec};

    #[contracttype]
    #[derive(Clone, Debug, Eq, PartialEq)]
    pub enum JobStatus {
        Created,
        Funded,
        InProgress,
        Completed,
        Cancelled,
        Disputed,
    }

    #[contracttype]
    #[derive(Clone, Debug, Eq, PartialEq)]
    pub enum MilestoneStatus {
        Pending,
        Submitted,
        Approved,
        Rejected,
    }

    #[contracttype]
    #[derive(Clone, Debug, Eq, PartialEq)]
    pub struct Milestone {
        pub id: u32,
        pub description: String,
        pub amount: i128,
        pub status: MilestoneStatus,
        pub deadline: u64,
    }

    #[contracttype]
    #[derive(Clone, Debug, Eq, PartialEq)]
    pub struct Job {
        pub id: u64,
        pub client: Address,
        pub freelancer: Address,
        pub token: Address,
        pub total_amount: i128,
        pub status: JobStatus,
        pub milestones: Vec<Milestone>,
        pub job_deadline: u64,
        pub auto_refund_after: u64,
    }
}

/// Detect conflicts of interest by querying job history from escrow contract.
/// Returns a deduplicated list of addresses that have worked with either disputing party.
fn detect_conflicts(
    env: &Env,
    escrow_contract: &Address,
    client: &Address,
    freelancer: &Address,
) -> Vec<Address> {
    let mut conflicts = Vec::<Address>::new(env);

    // Query job count from escrow
    let job_count_result = env.try_invoke_contract::<u64, soroban_sdk::Error>(
        escrow_contract,
        &Symbol::new(env, "get_job_count"),
        vec![env],
    );

    let job_count = match job_count_result {
        Ok(Ok(count)) => count,
        _ => return conflicts, // Return empty if query fails
    };

    if job_count == 0 {
        return conflicts;
    }

    // Determine starting job_id for lookback
    let start_id = if job_count > MAX_CONFLICT_LOOKBACK {
        job_count - MAX_CONFLICT_LOOKBACK + 1
    } else {
        1
    };

    // Iterate through recent jobs
    for job_id in start_id..=job_count {
        let job_result = env.try_invoke_contract::<escrow::Job, soroban_sdk::Error>(
            escrow_contract,
            &Symbol::new(env, "get_job"),
            vec![env, job_id.into_val(env)],
        );

        let job = match job_result {
            Ok(Ok(j)) => j,
            _ => continue, // Skip failed queries
        };

        // Check if job involves dispute client
        if &job.client == client || &job.freelancer == client {
            // Add the other party if not already in conflicts and not the dispute freelancer
            if &job.client != client
                && &job.client != freelancer
                && !conflicts.contains(&job.client)
            {
                conflicts.push_back(job.client.clone());
            }
            if &job.freelancer != client
                && &job.freelancer != freelancer
                && !conflicts.contains(&job.freelancer)
            {
                conflicts.push_back(job.freelancer.clone());
            }
        }

        // Check if job involves dispute freelancer
        if &job.client == freelancer || &job.freelancer == freelancer {
            // Add the other party if not already in conflicts and not the dispute client
            if &job.client != freelancer
                && &job.client != client
                && !conflicts.contains(&job.client)
            {
                conflicts.push_back(job.client.clone());
            }
            if &job.freelancer != freelancer
                && &job.freelancer != client
                && !conflicts.contains(&job.freelancer)
            {
                conflicts.push_back(job.freelancer.clone());
            }
        }
    }

    conflicts
}

#[contract]
pub struct DisputeContract;

#[contractimpl]
impl DisputeContract {
    /// Initialize the dispute contract with reputation contract address and admin.
    pub fn initialize(
        env: Env,
        admin: Address,
        reputation_contract: Address,
        min_voter_reputation: u32,
        escrow_contract: Address,
    ) -> Result<(), DisputeError> {
        admin.require_auth();

        // Check if already initialized
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(DisputeError::Unauthorized);
        }

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::ReputationContract, &reputation_contract);
        env.storage()
            .instance()
            .set(&DataKey::MinVoterReputation, &min_voter_reputation);
        env.storage()
            .instance()
            .set(&DataKey::EscrowContract, &escrow_contract);
        env.storage().instance().set(&DataKey::Paused, &false);
        env.storage()
            .instance()
            .set(&DataKey::SlashAmount, &DEFAULT_SLASH_AMOUNT);
        env.storage()
            .instance()
            .set(&DataKey::ReputationSlashBps, &DEFAULT_REPUTATION_SLASH_BPS);

        bump_dispute_count_ttl(&env);

        // Emit event
        env.events().publish(
            (symbol_short!("dispute"), symbol_short!("init")),
            (admin, reputation_contract, min_voter_reputation),
        );

        Ok(())
    }

    /// Pause the contract (admin only).
    pub fn pause(env: Env, admin: Address) -> Result<(), DisputeError> {
        admin.require_auth();
        require_admin(&env, &admin)?;

        env.storage().instance().set(&DataKey::Paused, &true);
        bump_dispute_count_ttl(&env);

        // Emit event
        env.events().publish(
            (symbol_short!("dispute"), symbol_short!("paused")),
            (admin, env.ledger().timestamp()),
        );

        Ok(())
    }

    /// Unpause the contract (admin only).
    pub fn unpause(env: Env, admin: Address) -> Result<(), DisputeError> {
        admin.require_auth();
        require_admin(&env, &admin)?;

        env.storage().instance().set(&DataKey::Paused, &false);
        bump_dispute_count_ttl(&env);

        // Emit event
        env.events().publish(
            (symbol_short!("dispute"), symbol_short!("unpaused")),
            (admin, env.ledger().timestamp()),
        );

        Ok(())
    }

    /// Set the minimum voter reputation threshold (admin only).
    pub fn set_min_voter_reputation(
        env: Env,
        admin: Address,
        min_reputation: u32,
    ) -> Result<(), DisputeError> {
        admin.require_auth();
        require_not_paused(&env)?;

        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(DisputeError::NotInitialized)?;

        if admin != stored_admin {
            return Err(DisputeError::Unauthorized);
        }

        env.storage()
            .instance()
            .set(&DataKey::MinVoterReputation, &min_reputation);
        bump_dispute_count_ttl(&env);

        // Emit event
        env.events().publish(
            (symbol_short!("dispute"), symbol_short!("minrep")),
            (admin, min_reputation),
        );

        Ok(())
    }

    /// Check if an address is eligible to vote based on reputation.
    pub fn is_eligible_voter(env: Env, voter: Address) -> Result<bool, DisputeError> {
        let reputation_contract: Address = env
            .storage()
            .instance()
            .get(&DataKey::ReputationContract)
            .ok_or(DisputeError::NotInitialized)?;

        let min_reputation: u32 = env
            .storage()
            .instance()
            .get(&DataKey::MinVoterReputation)
            .unwrap_or(MIN_VOTER_REPUTATION);

        // Call reputation contract to get voter's reputation
        let reputation_result = env
            .try_invoke_contract::<reputation::UserReputation, soroban_sdk::Error>(
                &reputation_contract,
                &Symbol::new(&env, "get_reputation"),
                vec![&env, voter.into_val(&env)],
            );

        match reputation_result {
            Ok(Ok(rep)) => {
                // Use total_score as the reputation metric
                Ok(rep.total_score >= min_reputation as u64)
            }
            _ => Ok(false), // User not found or error = not eligible
        }
    }

    /// Raise a dispute on a job. Either the client or freelancer can initiate.
    #[allow(clippy::too_many_arguments)]
    pub fn raise_dispute(
        env: Env,
        job_id: u64,
        client: Address,
        freelancer: Address,
        initiator: Address,
        reason: String,
        min_votes: u32,
        tie_break_method: Option<TieBreakMethod>,
    ) -> Result<u64, DisputeError> {
        initiator.require_auth();
        require_not_paused(&env)?;

        if initiator != client && initiator != freelancer {
            return Err(DisputeError::InvalidParty);
        }

        if let Some(last_closed_at) = env
            .storage()
            .persistent()
            .get::<DataKey, u64>(&DataKey::LastDisputeClosedAt(job_id))
        {
            let now = env.ledger().timestamp();
            if now <= last_closed_at.saturating_add(DISPUTE_COOLDOWN_SECS) {
                return Err(DisputeError::DisputeCooldown);
            }
            bump_last_dispute_closed_ttl(&env, job_id);
        }

        let mut count: u64 = env
            .storage()
            .instance()
            .get(&DataKey::DisputeCount)
            .unwrap_or(0);
        count += 1;

        // Detect conflicts of interest by querying escrow contract
        let excluded_voters = if let Some(escrow_contract) = env
            .storage()
            .instance()
            .get::<DataKey, Address>(&DataKey::EscrowContract)
        {
            detect_conflicts(&env, &escrow_contract, &client, &freelancer)
        } else {
            Vec::<Address>::new(&env)
        };

        let dispute = Dispute {
            id: count,
            job_id,
            client: client.clone(),
            freelancer: freelancer.clone(),
            initiator: initiator.clone(),
            reason,
            status: DisputeStatus::Open,
            votes_for_client: 0,
            votes_for_freelancer: 0,
            votes_for_refund_split: 0,
            refund_split_sum: 0,
            min_votes: if min_votes < 3 { 3 } else { min_votes },
            tie_break_method: tie_break_method.unwrap_or(TieBreakMethod::RefundBoth),
            created_at: env.ledger().timestamp(),
            voting_deadline: env.ledger().timestamp().saturating_add(VOTING_PERIOD_SECS),
            excluded_voters,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Dispute(count), &dispute);
        env.storage().instance().set(&DataKey::DisputeCount, &count);
        bump_dispute_ttl(&env, count);
        bump_dispute_count_ttl(&env);
        env.storage()
            .persistent()
            .set(&DataKey::Votes(count), &Vec::<Vote>::new(&env));
        bump_votes_ttl(&env, count);

        // Maintain job → dispute_id mapping so callers can look up a dispute by job_id
        env.storage()
            .persistent()
            .set(&DataKey::JobDispute(job_id), &count);
        bump_job_dispute_ttl(&env, job_id);

        // Maintain job → dispute_ids list so callers can fetch historical disputes.
        let list_key = DataKey::JobDisputes(job_id);
        let mut dispute_ids: Vec<u64> = env
            .storage()
            .persistent()
            .get(&list_key)
            .unwrap_or(Vec::new(&env));
        dispute_ids.push_back(count);
        env.storage().persistent().set(&list_key, &dispute_ids);
        bump_job_disputes_ttl(&env, job_id);

        // Emit event
        env.events().publish(
            (symbol_short!("dispute"), symbol_short!("raised")),
            (count, job_id, initiator, client, freelancer),
        );

        Ok(count)
    }

    /// Cast a vote on a dispute. Voters cannot be the client or freelancer.
    /// If the reputation system is initialized, voters must meet the minimum
    /// reputation threshold. When no reputation contract is configured, voting
    /// proceeds without a reputation check to allow graceful degradation.
    pub fn cast_vote(
        env: Env,
        dispute_id: u64,
        voter: Address,
        choice: VoteChoice,
        reason: String,
    ) -> Result<(), DisputeError> {
        voter.require_auth();
        require_not_paused(&env)?;

        let mut dispute: Dispute = env
            .storage()
            .persistent()
            .get(&DataKey::Dispute(dispute_id))
            .ok_or(DisputeError::DisputeNotFound)?;
        bump_dispute_ttl(&env, dispute_id);

        if dispute.status != DisputeStatus::Open && dispute.status != DisputeStatus::Voting {
            return Err(DisputeError::VotingClosed);
        }

        // Parties involved cannot vote
        if voter == dispute.client || voter == dispute.freelancer {
            return Err(DisputeError::ConflictOfInterest);
        }

        // Check if voter is excluded due to conflict of interest
        if dispute.excluded_voters.contains(&voter) {
            return Err(DisputeError::ConflictOfInterest);
        }

        // Resolve delegation: if the voter is acting as a delegate for this job's dispute,
        // look up the stake owner so eligibility and double-vote checks use the owner.
        let delegation_owner: Option<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::DelegationOwner(voter.clone(), dispute.job_id));

        let stake_owner = delegation_owner.as_ref().unwrap_or(&voter);

        // Check voter reputation eligibility against the stake owner (owner if delegated).
        if env.storage().instance().has(&DataKey::ReputationContract) {
            let is_eligible = Self::is_eligible_voter(env.clone(), stake_owner.clone())?;
            if !is_eligible {
                return Err(DisputeError::InsufficientReputation);
            }
        }

        // Prevent double-vote: check both the physical voter and the stake owner.
        let voted_key = DataKey::HasVoted(dispute_id, voter.clone());
        if env.storage().persistent().has(&voted_key) {
            return Err(DisputeError::AlreadyVoted);
        }
        if delegation_owner.is_some() {
            let owner_voted_key = DataKey::HasVoted(dispute_id, stake_owner.clone());
            if env.storage().persistent().has(&owner_voted_key) {
                return Err(DisputeError::AlreadyVoted);
            }
        }

        // Record vote
        let vote = Vote {
            voter: voter.clone(),
            choice: choice.clone(),
            reason,
            timestamp: env.ledger().timestamp(),
        };

        let mut votes: Vec<Vote> = env
            .storage()
            .persistent()
            .get(&DataKey::Votes(dispute_id))
            .unwrap_or(Vec::new(&env));
        votes.push_back(vote);
        env.storage()
            .persistent()
            .set(&DataKey::Votes(dispute_id), &votes);
        bump_votes_ttl(&env, dispute_id);

        match choice {
            VoteChoice::Client => dispute.votes_for_client += 1,
            VoteChoice::Freelancer => dispute.votes_for_freelancer += 1,
            VoteChoice::RefundSplit(pct_client) => {
                if pct_client > 100 {
                    return Err(DisputeError::Unauthorized);
                }
                dispute.votes_for_refund_split += 1;
                dispute.refund_split_sum =
                    dispute.refund_split_sum.saturating_add(pct_client as u64);
            }
        }

        dispute.status = DisputeStatus::Voting;
        env.storage()
            .persistent()
            .set(&DataKey::Dispute(dispute_id), &dispute);
        env.storage().persistent().set(&voted_key, &true);
        bump_dispute_ttl(&env, dispute_id);
        bump_has_voted_ttl(&env, dispute_id, &voter);

        // When voting via delegation, also mark the owner as having voted so they
        // cannot vote again directly and the delegation cannot be reused.
        if let Some(ref owner) = delegation_owner {
            let owner_voted_key = DataKey::HasVoted(dispute_id, owner.clone());
            env.storage().persistent().set(&owner_voted_key, &true);
            bump_has_voted_ttl(&env, dispute_id, owner);
        }

        // Emit event
        env.events().publish(
            (symbol_short!("dispute"), symbol_short!("voted")),
            (dispute_id, voter, choice, dispute.job_id, dispute.client, dispute.freelancer),
        );

        Ok(())
    }

    /// Add a voter to the exclusion list for a dispute (only during Open status).
    /// Can only be called by the client or freelancer involved in the dispute.
    pub fn add_excluded_voter(
        env: Env,
        dispute_id: u64,
        caller: Address,
        voter: Address,
    ) -> Result<(), DisputeError> {
        caller.require_auth();
        require_not_paused(&env)?;

        let mut dispute: Dispute = env
            .storage()
            .persistent()
            .get(&DataKey::Dispute(dispute_id))
            .ok_or(DisputeError::DisputeNotFound)?;
        bump_dispute_ttl(&env, dispute_id);

        // Verify caller is either client or freelancer
        if caller != dispute.client && caller != dispute.freelancer {
            return Err(DisputeError::Unauthorized);
        }

        // Check dispute status is Open
        if dispute.status != DisputeStatus::Open {
            return Err(DisputeError::VotingClosed);
        }

        // Add voter to excluded list if not already present
        if !dispute.excluded_voters.contains(&voter) {
            dispute.excluded_voters.push_back(voter.clone());
        }

        // Store updated dispute
        env.storage()
            .persistent()
            .set(&DataKey::Dispute(dispute_id), &dispute);
        bump_dispute_ttl(&env, dispute_id);

        // Emit event
        env.events().publish(
            (symbol_short!("dispute"), symbol_short!("excluded")),
            (dispute_id, voter, dispute.job_id, dispute.client, dispute.freelancer),
        );

        Ok(())
    }

    pub fn resolve_dispute(
        env: Env,
        dispute_id: u64,
    ) -> Result<DisputeStatus, DisputeError> {
        require_not_paused(&env)?;

        let mut dispute: Dispute = env
            .storage()
            .persistent()
            .get(&DataKey::Dispute(dispute_id))
            .ok_or(DisputeError::DisputeNotFound)?;
        bump_dispute_ttl(&env, dispute_id);

        let escrow_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::EscrowContract)
            .ok_or(DisputeError::NotInitialized)?;

        internal_resolve(&env, dispute_id, &mut dispute, &escrow_addr, false)
    }

    /// Force resolution of a dispute after the voting deadline has passed,
    /// even if the minimum number of votes has not been reached.
    pub fn force_resolve_timeout(
        env: Env,
        dispute_id: u64,
    ) -> Result<DisputeStatus, DisputeError> {
        require_not_paused(&env)?;

        let mut dispute: Dispute = env
            .storage()
            .persistent()
            .get(&DataKey::Dispute(dispute_id))
            .ok_or(DisputeError::DisputeNotFound)?;
        bump_dispute_ttl(&env, dispute_id);

        // Retrieve the trusted escrow contract address from storage
        let escrow_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::EscrowContract)
            .ok_or(DisputeError::NotInitialized)?;

        if env.ledger().timestamp() < dispute.voting_deadline {
            return Err(DisputeError::VotingPeriodNotExpired);
        }

        internal_resolve(&env, dispute_id, &mut dispute, &escrow_addr, true)
    }

    /// Get dispute details.
    pub fn get_dispute(env: Env, dispute_id: u64) -> Result<Dispute, DisputeError> {
        let dispute: Dispute = env
            .storage()
            .persistent()
            .get(&DataKey::Dispute(dispute_id))
            .ok_or(DisputeError::DisputeNotFound)?;
        bump_dispute_ttl(&env, dispute_id);
        Ok(dispute)
    }

    /// Look up the dispute associated with a given job ID.
    /// Returns `None` when no dispute has ever been raised for the job.
    /// When multiple disputes existed (e.g. after a cooldown period), this
    /// returns the most recent one because `raise_dispute` always overwrites
    /// the `JobDispute` mapping with the latest dispute ID.
    pub fn get_dispute_by_job(env: Env, job_id: u64) -> Option<Dispute> {
        let dispute_id: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::JobDispute(job_id))?;
        bump_job_dispute_ttl(&env, job_id);

        let dispute: Dispute = env
            .storage()
            .persistent()
            .get(&DataKey::Dispute(dispute_id))?;
        bump_dispute_ttl(&env, dispute_id);

        Some(dispute)
    }

    /// Look up all historical disputes associated with a job.
    /// Returns an empty vec when no disputes have ever been raised.
    pub fn get_disputes_for_job(env: Env, job_id: u64) -> Vec<Dispute> {
        let ids: Vec<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::JobDisputes(job_id))
            .unwrap_or(Vec::new(&env));
        bump_job_disputes_ttl(&env, job_id);

        let mut disputes = Vec::<Dispute>::new(&env);
        for id in ids.iter() {
            if let Some(dispute) = env
                .storage()
                .persistent()
                .get::<DataKey, Dispute>(&DataKey::Dispute(id))
            {
                bump_dispute_ttl(&env, id);
                disputes.push_back(dispute);
            }
        }

        disputes
    }

    /// Get all votes for a dispute.
    pub fn get_votes(env: Env, dispute_id: u64) -> Vec<Vote> {
        env.storage()
            .persistent()
            .get(&DataKey::Votes(dispute_id))
            .unwrap_or(Vec::new(&env))
    }

    /// Get all arbitrators (voters) who have voted on a dispute.
    pub fn get_arbitrators(env: Env, dispute_id: u64) -> Vec<Address> {
        let votes: Vec<Vote> = env
            .storage()
            .persistent()
            .get(&DataKey::Votes(dispute_id))
            .unwrap_or(Vec::<Vote>::new(&env));
        
        let mut arbitrators: Vec<Address> = Vec::new(&env);
        for vote in votes.iter() {
            if !arbitrators.contains(&vote.voter) {
                arbitrators.push_back(vote.voter.clone());
            }
        }
        arbitrators
    }

    /// Get total dispute count.
    pub fn get_dispute_count(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::DisputeCount)
            .unwrap_or(0)
    }

    /// Delegate vote rights for a specific job's dispute to another address.
    /// The owner retains token ownership; only the right to cast the vote is transferred.
    /// The delegation is scoped to a single job so the delegate cannot vote on other jobs.
    pub fn delegate_vote(
        env: Env,
        owner: Address,
        delegate: Address,
        job_id: u64,
    ) -> Result<(), DisputeError> {
        owner.require_auth();
        require_not_paused(&env)?;

        if owner == delegate {
            return Err(DisputeError::InvalidParty);
        }

        // Reject if the owner already set up a delegation for this job.
        let del_key = DataKey::VoteDelegation(owner.clone(), job_id);
        if env.storage().persistent().has(&del_key) {
            return Err(DisputeError::AlreadyDelegated);
        }

        // If a dispute already exists for this job, ensure voting is still open and
        // the delegate hasn't voted yet.
        if let Some(dispute_id) = env
            .storage()
            .persistent()
            .get::<DataKey, u64>(&DataKey::JobDispute(job_id))
        {
            if let Some(dispute) = env
                .storage()
                .persistent()
                .get::<DataKey, Dispute>(&DataKey::Dispute(dispute_id))
            {
                if dispute.status != DisputeStatus::Open
                    && dispute.status != DisputeStatus::Voting
                {
                    return Err(DisputeError::VotingClosed);
                }

                // Reject if the delegate already cast a vote on this dispute.
                let voted_key = DataKey::HasVoted(dispute_id, delegate.clone());
                if env.storage().persistent().has(&voted_key) {
                    return Err(DisputeError::DelegateAlreadyVoted);
                }

                // Reject if the owner already voted directly.
                let owner_voted_key = DataKey::HasVoted(dispute_id, owner.clone());
                if env.storage().persistent().has(&owner_voted_key) {
                    return Err(DisputeError::AlreadyVoted);
                }
            }
        }

        env.storage().persistent().set(&del_key, &delegate);
        bump_vote_delegation_ttl(&env, &owner, job_id);

        let owner_key = DataKey::DelegationOwner(delegate.clone(), job_id);
        env.storage().persistent().set(&owner_key, &owner);
        bump_delegation_owner_ttl(&env, &delegate, job_id);

        env.events().publish(
            (symbol_short!("dispute"), symbol_short!("delegated")),
            (owner, delegate, job_id),
        );

        Ok(())
    }

    /// Revoke a previously granted vote delegation for a job, provided the delegate
    /// has not yet cast a vote on the associated dispute.
    pub fn revoke_delegation(
        env: Env,
        owner: Address,
        job_id: u64,
    ) -> Result<(), DisputeError> {
        owner.require_auth();
        require_not_paused(&env)?;

        let del_key = DataKey::VoteDelegation(owner.clone(), job_id);
        let delegate: Address = env
            .storage()
            .persistent()
            .get(&del_key)
            .ok_or(DisputeError::DelegationNotFound)?;

        // Block revocation once the delegate has already voted.
        if let Some(dispute_id) = env
            .storage()
            .persistent()
            .get::<DataKey, u64>(&DataKey::JobDispute(job_id))
        {
            let voted_key = DataKey::HasVoted(dispute_id, delegate.clone());
            if env.storage().persistent().has(&voted_key) {
                return Err(DisputeError::DelegateAlreadyVoted);
            }
        }

        env.storage().persistent().remove(&del_key);

        let owner_key = DataKey::DelegationOwner(delegate.clone(), job_id);
        env.storage().persistent().remove(&owner_key);

        env.events().publish(
            (symbol_short!("dispute"), symbol_short!("del_revkd")),
            (owner, delegate, job_id),
        );

        Ok(())
    }

    /// Return the current delegate for an owner / job pair, if one exists.
    pub fn get_delegation(env: Env, owner: Address, job_id: u64) -> Option<Address> {
        let del_key = DataKey::VoteDelegation(owner.clone(), job_id);
        let delegate: Option<Address> = env.storage().persistent().get(&del_key);
        if delegate.is_some() {
            bump_vote_delegation_ttl(&env, &owner, job_id);
        }
        delegate
    }

    /// Check if a voter is excluded from voting on a specific dispute.
    pub fn is_excluded_voter(env: Env, dispute_id: u64, voter: Address) -> bool {
        let dispute_result: Option<Dispute> = env
            .storage()
            .persistent()
            .get(&DataKey::Dispute(dispute_id));

        match dispute_result {
            Some(dispute) => dispute.excluded_voters.contains(&voter),
            None => false,
        }
    }
}

fn internal_resolve(
    env: &Env,
    dispute_id: u64,
    dispute: &mut Dispute,
    escrow_addr: &Address,
    force: bool,
) -> Result<DisputeStatus, DisputeError> {
    if dispute.status == DisputeStatus::ResolvedForClient
        || dispute.status == DisputeStatus::ResolvedForFreelancer
        || dispute.status == DisputeStatus::RefundedBoth
        || matches!(dispute.status, DisputeStatus::RefundSplit(_))
        || dispute.status == DisputeStatus::Escalated
    {
        return Err(DisputeError::AlreadyResolved);
    }

    let total_votes =
        dispute.votes_for_client + dispute.votes_for_freelancer + dispute.votes_for_refund_split;
    if !force && total_votes < dispute.min_votes {
        return Err(DisputeError::NotEnoughVotes);
    }

    if dispute.votes_for_client > dispute.votes_for_freelancer
        && dispute.votes_for_client > dispute.votes_for_refund_split
    {
        dispute.status = DisputeStatus::ResolvedForClient;
    } else if dispute.votes_for_freelancer > dispute.votes_for_client
        && dispute.votes_for_freelancer > dispute.votes_for_refund_split
    {
        dispute.status = DisputeStatus::ResolvedForFreelancer;
    } else if dispute.votes_for_refund_split > dispute.votes_for_client
        && dispute.votes_for_refund_split > dispute.votes_for_freelancer
    {
        let avg = dispute.refund_split_sum / dispute.votes_for_refund_split as u64;
        dispute.status = DisputeStatus::RefundSplit(avg as u32);
    } else {
        // Tie-break logic (applies if votes are tied OR if total_votes is 0 in force mode)
        match dispute.tie_break_method {
            TieBreakMethod::FavorClient => dispute.status = DisputeStatus::ResolvedForClient,
            TieBreakMethod::FavorFreelancer => {
                dispute.status = DisputeStatus::ResolvedForFreelancer
            }
            TieBreakMethod::RefundBoth => dispute.status = DisputeStatus::RefundedBoth,
            TieBreakMethod::Escalate => dispute.status = DisputeStatus::Escalated,
        }
    }

    let resolution = match dispute.status {
        DisputeStatus::ResolvedForClient => DisputeResolution::ClientWins,
        DisputeStatus::ResolvedForFreelancer => DisputeResolution::FreelancerWins,
        DisputeStatus::RefundedBoth => DisputeResolution::RefundBoth,
        DisputeStatus::RefundSplit(pct) => DisputeResolution::RefundSplit(pct),
        _ => DisputeResolution::Escalate,
    };

    // Only invoke the escrow callback if the dispute has a concrete resolution.
    if resolution != DisputeResolution::Escalate {
        env.invoke_contract::<()>(
            escrow_addr,
            &Symbol::new(env, "resolve_dispute_callback"),
            vec![
                env,
                dispute.job_id.into_val(env),
                resolution.into_val(env),
            ],
        );

        // Slash the losing party's reputation score.
        if let Some(reputation_contract) = env
            .storage()
            .instance()
            .get::<DataKey, Address>(&DataKey::ReputationContract)
        {
            let loser = match resolution {
                DisputeResolution::ClientWins => dispute.freelancer.clone(),
                DisputeResolution::FreelancerWins => dispute.client.clone(),
                DisputeResolution::RefundBoth => dispute.initiator.clone(),
                DisputeResolution::RefundSplit(_) => dispute.initiator.clone(),
                DisputeResolution::Escalate => unreachable!(),
            };

            let slash_bps: u32 = env
                .storage()
                .instance()
                .get(&DataKey::ReputationSlashBps)
                .unwrap_or(DEFAULT_REPUTATION_SLASH_BPS);

            let current_score = env
                .try_invoke_contract::<reputation::UserReputation, soroban_sdk::Error>(
                    &reputation_contract,
                    &Symbol::new(env, "get_reputation"),
                    vec![env, loser.clone().into_val(env)],
                )
                .ok()
                .and_then(|r| r.ok())
                .map(|r| r.total_score)
                .unwrap_or(0);

            let mut slash_amount: u64 = (current_score.saturating_mul(slash_bps as u64)) / 10_000;
            if slash_amount == 0 && current_score > 0 {
                slash_amount = 1;
            }

            let reason = String::from_str(env, "dispute_lost");

            let _ = env.try_invoke_contract::<(), soroban_sdk::Error>(
                &reputation_contract,
                &Symbol::new(env, "slash_reputation"),
                vec![
                    env,
                    loser.clone().into_val(env),
                    dispute.job_id.into_val(env),
                    slash_amount.into_val(env),
                    reason.into_val(env),
                ],
            );

            let client = dispute.client.clone();
            let freelancer = dispute.freelancer.clone();
            env.events().publish(
                (symbol_short!("dispute"), Symbol::new(env, "reput_slashed")),
                (dispute.job_id, loser, slash_amount),
            );
        }
    }

    env.storage()
        .persistent()
        .set(&DataKey::LastDisputeClosedAt(dispute.job_id), &env.ledger().timestamp());
    bump_last_dispute_closed_ttl(env, dispute.job_id);

    env.storage()
        .persistent()
        .set(&DataKey::Dispute(dispute_id), &*dispute);
    bump_dispute_ttl(env, dispute_id);

    let client = dispute.client.clone();
    let freelancer = dispute.freelancer.clone();
    env.events().publish(
        (symbol_short!("dispute"), symbol_short!("resolved")),
        (dispute_id, dispute.status.clone(), dispute.job_id, client, freelancer, resolution),
    );

    Ok(dispute.status.clone())
}

#[cfg(test)]
mod test;
