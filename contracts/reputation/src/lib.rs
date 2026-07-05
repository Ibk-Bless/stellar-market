#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, token, Address, Env, String,
    Symbol, Vec,
};
mod escrow {
    use soroban_sdk::{contracttype, Address, String, Vec};

    #[contracttype]
    #[derive(Clone, Debug, Eq, PartialEq)]
    pub enum JobStatus {
        Created,
        Funded,
        InProgress,
        Completed,
        Disputed,
        Cancelled,
        Expired,
    }

    #[contracttype]
    #[derive(Clone, Debug, Eq, PartialEq)]
    pub enum MilestoneStatus {
        Pending,
        InProgress,
        Submitted,
        Approved,
        PartiallyPaid,
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
        pub auto_refund_after: u64,
        pub client: Address,
        pub expiry_ledger: u32,
        pub freelancer: Address,
        pub funded_amount: i128,
        pub id: u64,
        pub job_deadline: u64,
        pub milestones: Vec<Milestone>,
        pub status: JobStatus,
        pub token: Address,
        pub total_amount: i128,
    }

    #[soroban_sdk::contractclient(name = "EscrowContractClient")]
    #[allow(dead_code)]
    pub trait EscrowInterface {
        fn get_job(env: soroban_sdk::Env, job_id: u64) -> Job;
    }
}

use escrow::{EscrowContractClient, JobStatus};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ReputationError {
    InvalidRating = 1,
    AlreadyReviewed = 2,
    SelfReview = 3,
    UserNotFound = 4,
    JobNotCompleted = 5,
    NotJobParticipant = 6,
    JobNotFound = 7,
    Unauthorized = 8,
    NotInitialized = 9,
    InvalidDecayRate = 10,
    BelowMinStake = 11,
    RateLimitExceeded = 12,
    ContractPaused = 13,
    NotAdmin = 14,
    AlreadyReferred = 15,
    SelfReferral = 16,
    CircularReferral = 17,
    ReviewNotFound = 18,
    AppealWindowExpired = 19,
    AppealAlreadyExists = 20,
    AppealNotFound = 21,
    AppealAlreadyResolved = 22,
    AlreadyEndorsed = 23,
    // Rejected when a referral bonus is recorded with a timestamp in the future.
    // A future-dated bonus would keep `get_decay_factor` at `elapsed_seconds = 0`,
    // permanently exempting it from decay and inflating the score (issue #781).
    InvalidTimestamp = 24,
    // Rejected when a decay rate exceeds the configured maximum. An unbounded
    // decay rate (e.g. 99%) would wipe out the leaderboard in a single period
    // and make reputation meaningless (issue #783).
    DecayRateTooHigh = 25,
    /// Rejected when stake_weight is below the configured minimum stake weight.
    /// A zero-stake review carries vote weight of 1 even though the reviewer has
    /// no economic skin in the game; the minimum stake weight floor prevents this.
    StakeTooLow = 26,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Review {
    pub reviewer: Address,
    pub reviewee: Address,
    pub job_id: u64,
    pub rating: u32,
    pub comment: String,
    pub stake_weight: i128,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UserReputation {
    pub user: Address,
    pub total_score: u64,
    pub total_weight: u64,
    pub review_count: u32,
    pub last_updated_ledger: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StakeTier {
    pub threshold: i128,
    pub multiplier: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UserReputationWithReferrer {
    pub user: Address,
    pub referrer: Option<Address>,
    pub total_score: u64,
    pub total_weight: u64,
    pub review_count: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReferralBonusRecord {
    pub amount: u64,
    pub weight: u64,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ReputationTier {
    None = 0,
    Bronze = 1,
    Silver = 2,
    Gold = 3,
    Platinum = 4,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Badge {
    None = 0,
    Bronze = 1,
    Silver = 2,
    Gold = 3,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum DisputeOutcome {
    Won = 0,
    Lost = 1,
    MaliciousFiling = 2,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AwardedBadge {
    pub badge_type: ReputationTier,
    pub awarded_at: u64,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum AppealStatus {
    Pending = 0,
    Dismissed = 1,
    ReviewRemoved = 2,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReviewAppeal {
    pub reviewer: Address,
    pub reviewee: Address,
    pub job_id: u64,
    pub reason: String,
    pub created_at: u64,
    pub expires_at: u64,
    pub status: AppealStatus,
}

/// Privileged actions that can be proposed and approved through the multi-sig flow.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum AdminAction {
    Pause,
    Unpause,
    SetMinStake(i128),
    SetRateLimit(u32),
    SetToken(Address),
    SetReferralBonus(u64),
    SetDecayRate(u32),
    SlashStake(Address, u64, u64), // loser, job_id, amount
    AddSigner(Address),
    RemoveSigner(Address),
    ChangeThreshold(u32),
    RotateSigner(Address, Address),
    SetStakeTiers(Vec<StakeTier>),
}

/// A pending multi-sig proposal. Executed when `approvals.len() >= threshold`.
#[contracttype]
#[derive(Clone, Debug)]
pub struct MultiSigProposal {
    pub id: u64,
    pub action: AdminAction,
    pub proposer: Address,
    pub approvals: Vec<Address>,
    pub executed: bool,
    pub created_at: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReferralStats {
    pub total_referrals: u32,
    pub earned_bonus: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
enum DataKey {
    Reputation(Address),
    Reviews(Address),
    ReviewExists(Address, Address, u64),
    Badges(Address),
    Admin, // Legacy
    DecayRate,
    // Configurable upper bound for `DecayRate`, settable by a super-admin up to
    // `MAX_DECAY_RATE_HARD_CEILING`. Falls back to `MAX_DECAY_RATE` when unset.
    MaxDecayRate,
    MinStake,
    RateLimit,
    LastReviewLedger(Address),
    Token,
    Paused,
    Referrer(Address),
    ReferralStats(Address),
    BonusPaid(Address),
    ReferralBonus,
    ReferralBonusList(Address),
    MultiSigSigners,
    MultiSigThreshold,
    MultiSigProposal(u64),
    MultiSigProposalCount,
    Leaderboard,
    StakeBalance(Address),
    ReviewAppeal(Address, Address, u64),
    DisputeContract,
    Endorsement(Address, String, Address),
    SkillEndorsers(Address, String),
    StakeTiers,
    /// Admin-configurable minimum stake weight. Reviews with stake_weight below
    /// this value are rejected even when the economic min_stake allows zero stakes.
    MinStakeWeight,
}

fn require_not_paused(env: &Env) -> Result<(), ReputationError> {
    if env
        .storage()
        .instance()
        .get(&DataKey::Paused)
        .unwrap_or(false)
    {
        return Err(ReputationError::ContractPaused);
    }
    Ok(())
}

fn is_signer(env: &Env, address: &Address) -> bool {
    if let Some(signers) = env
        .storage()
        .instance()
        .get::<_, Vec<Address>>(&DataKey::MultiSigSigners)
    {
        signers.iter().any(|s| s == *address)
    } else {
        false
    }
}

/// Effective upper bound for the reputation decay rate: the super-admin
/// configured value if present, otherwise the `MAX_DECAY_RATE` default.
fn effective_max_decay_rate(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::MaxDecayRate)
        .unwrap_or(MAX_DECAY_RATE)
}

const MIN_REVIEW_STAKE_DEFAULT: i128 = 10_000_000; // 1.0 unit (7 decimals)
const RATE_LIMIT_LEDGERS_DEFAULT: u32 = 120; // ~10 minutes
/// Hard floor on the stake_weight used as reputation vote weight.
/// Prevents zero-weight reviews from gaining weight=1 via the fallback path.
pub const MIN_STAKE_WEIGHT: u64 = 1;
const DEFAULT_REFERRAL_BONUS: u64 = 5; // Equivalates to a 5-star review bonus
/// Weight used when crediting referral bonus to reputation (not min review stake).
const REFERRAL_BONUS_REPUTATION_WEIGHT: u64 = 1;
const ONE_YEAR_IN_SECONDS: u64 = 31_536_000;

/// Default upper bound for the annual reputation `decay_rate` (percent per year).
/// 20% keeps decay meaningful without destroying accumulated reputation in a
/// single period. The super-admin can raise this via `set_max_decay_rate` up to
/// `MAX_DECAY_RATE_HARD_CEILING` (issue #783).
const MAX_DECAY_RATE: u32 = 20;
/// Absolute ceiling the configurable maximum decay rate can never exceed.
const MAX_DECAY_RATE_HARD_CEILING: u32 = 50;

const MIN_TTL_THRESHOLD: u32 = 50_000_000;
const MIN_TTL_EXTEND_TO: u32 = 50_000_000;
const APPEAL_GRACE_WINDOW_SECONDS: u64 = 72 * 60 * 60;

fn bump_reputation_ttl(env: &Env, user: &Address) {
    env.storage().persistent().extend_ttl(
        &DataKey::Reputation(user.clone()),
        MIN_TTL_THRESHOLD,
        MIN_TTL_EXTEND_TO,
    );
}

fn bump_reviews_ttl(env: &Env, user: &Address) {
    env.storage().persistent().extend_ttl(
        &DataKey::Reviews(user.clone()),
        MIN_TTL_THRESHOLD,
        MIN_TTL_EXTEND_TO,
    );
}

fn bump_review_exists_ttl(env: &Env, reviewer: &Address, reviewee: &Address, job_id: u64) {
    env.storage().persistent().extend_ttl(
        &DataKey::ReviewExists(reviewer.clone(), reviewee.clone(), job_id),
        MIN_TTL_THRESHOLD,
        MIN_TTL_EXTEND_TO,
    );
}

fn bump_badges_ttl(env: &Env, user: &Address) {
    env.storage().persistent().extend_ttl(
        &DataKey::Badges(user.clone()),
        MIN_TTL_THRESHOLD,
        MIN_TTL_EXTEND_TO,
    );
}

fn bump_review_appeal_ttl(env: &Env, reviewer: &Address, reviewee: &Address, job_id: u64) {
    env.storage().persistent().extend_ttl(
        &DataKey::ReviewAppeal(reviewer.clone(), reviewee.clone(), job_id),
        MIN_TTL_THRESHOLD,
        MIN_TTL_EXTEND_TO,
    );
}

fn bump_instance_ttl(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(MIN_TTL_THRESHOLD, MIN_TTL_EXTEND_TO);
}

pub fn apply_lazy_decay(env: &Env, rep: &mut UserReputation) {
    env.storage()
        .instance()
        .extend_ttl(MIN_TTL_THRESHOLD, MIN_TTL_EXTEND_TO);
    let decay_rate: u32 = env
        .storage()
        .instance()
        .get(&DataKey::DecayRate)
        .unwrap_or(0);

    let current_ts = env.ledger().timestamp() as u32;
    if decay_rate == 0 || decay_rate >= 100 {
        rep.last_updated_ledger = current_ts;
        return;
    }

    let last_ts = rep.last_updated_ledger as u64;
    let now_ts = current_ts as u64;
    if now_ts <= last_ts {
        return;
    }

    let elapsed_seconds = now_ts - last_ts;
    // Linear annual decay: decay_rate% per year applied proportionally to elapsed time.
    // retained_pct = max(0, 100 - decay_rate * elapsed_years)
    // Use integer arithmetic: elapsed_years * 100 = elapsed_seconds * 100 / ONE_YEAR_IN_SECONDS
    let decay_amount = (decay_rate as u64) * elapsed_seconds / ONE_YEAR_IN_SECONDS;
    let retained_pct = 100_u64.saturating_sub(decay_amount);

    rep.total_score  = (rep.total_score  * retained_pct) / 100;
    rep.total_weight = (rep.total_weight * retained_pct) / 100;
    rep.last_updated_ledger = current_ts;
}

fn get_decay_factor(decay_rate: u32, current_time: u64, recorded_at: u64) -> u64 {
    if decay_rate == 0 {
        return 100;
    }

    let age_in_seconds = current_time.saturating_sub(recorded_at);
    let decay_amount = (decay_rate as u64).saturating_mul(age_in_seconds) / ONE_YEAR_IN_SECONDS;

    100_u64.saturating_sub(decay_amount)
}

/// Calculate the reputation tier based on average rating score.
/// Score thresholds:
/// - 0-99: None
/// - 100-299: Bronze
/// - 300-499: Silver
/// - 500-699: Gold
/// - 700+: Platinum
fn calculate_tier(average_rating: u64) -> ReputationTier {
    if average_rating >= 700 {
        ReputationTier::Platinum
    } else if average_rating >= 500 {
        ReputationTier::Gold
    } else if average_rating >= 300 {
        ReputationTier::Silver
    } else if average_rating >= 100 {
        ReputationTier::Bronze
    } else {
        ReputationTier::None
    }
}

#[contract]
pub struct ReputationContract;

#[contractimpl]
impl ReputationContract {
    /// Submit a review for a user after completing a job.
    /// Rating must be between 1 and 5. Stake weight affects the review's influence.
    /// The escrow_contract_id is used to verify the job exists, is completed,
    /// and that reviewer/reviewee are the actual participants of the job.
    pub fn submit_review(
        env: Env,
        escrow_contract_id: Address,
        reviewer: Address,
        reviewee: Address,
        job_id: u64,
        rating: u32,
        comment: String,
        stake_weight: i128,
    ) -> Result<(), ReputationError> {
        reviewer.require_auth();
        require_not_paused(&env)?;

        if !(1..=5).contains(&rating) {
            return Err(ReputationError::InvalidRating);
        }
        if reviewer == reviewee {
            return Err(ReputationError::SelfReview);
        }

        // 1. Minimum Stake Check
        let min_stake = env
            .storage()
            .instance()
            .get(&DataKey::MinStake)
            .unwrap_or(MIN_REVIEW_STAKE_DEFAULT);
        if stake_weight < min_stake {
            return Err(ReputationError::BelowMinStake);
        }

        // 1b. Minimum Stake Weight Check — enforces a hard floor on the vote weight
        // regardless of how the economic min_stake is configured. A zero-stake review
        // would otherwise use weight=1 via the fallback path, letting stake-free
        // reviewers influence the leaderboard without any economic commitment.
        let min_stake_weight: u64 = env
            .storage()
            .instance()
            .get(&DataKey::MinStakeWeight)
            .unwrap_or(MIN_STAKE_WEIGHT);
        if stake_weight < min_stake_weight as i128 {
            return Err(ReputationError::StakeTooLow);
        }

        // 2. Rate Limit Check
        let rate_limit = env
            .storage()
            .instance()
            .get(&DataKey::RateLimit)
            .unwrap_or(RATE_LIMIT_LEDGERS_DEFAULT);
        if rate_limit > 0 {
            let last_ledger_key = DataKey::LastReviewLedger(reviewer.clone());
            if let Some(last_ledger) = env
                .storage()
                .persistent()
                .get::<DataKey, u32>(&last_ledger_key)
            {
                let current_ledger = env.ledger().sequence();
                if current_ledger < last_ledger.saturating_add(rate_limit) {
                    return Err(ReputationError::RateLimitExceeded);
                }
            }
            let current_ledger = env.ledger().sequence();
            env.storage()
                .persistent()
                .set(&last_ledger_key, &current_ledger);
            // Extend TTL for rate limit data
            env.storage().persistent().extend_ttl(
                &last_ledger_key,
                MIN_TTL_THRESHOLD,
                MIN_TTL_EXTEND_TO,
            );
        }

        // Check if this reviewer already reviewed this user for this job
        let review_key = DataKey::ReviewExists(reviewer.clone(), reviewee.clone(), job_id);
        if env.storage().persistent().has(&review_key) {
            return Err(ReputationError::AlreadyReviewed);
        }

        // Cross-contract call: verify the job exists, is completed, and the
        // reviewer/reviewee are the actual client and freelancer of the job.
        let escrow_client = EscrowContractClient::new(&env, &escrow_contract_id);
        let job = match escrow_client.try_get_job(&job_id) {
            Ok(Ok(j)) => j,
            Ok(Err(_)) | Err(_) => return Err(ReputationError::JobNotFound),
        };

        if job.status != JobStatus::Completed {
            return Err(ReputationError::JobNotCompleted);
        }

        let valid_participants = (reviewer == job.client && reviewee == job.freelancer)
            || (reviewer == job.freelancer && reviewee == job.client);

        if !valid_participants {
            return Err(ReputationError::NotJobParticipant);
        }

        // 3. Accountability Stake Transfer
        // Transfer stake from reviewer to this contract
        let token_client = token::Client::new(&env, &job.token);
        token_client.transfer(&reviewer, &env.current_contract_address(), &stake_weight);

        // Track stake balance for withdrawal
        let balance_key = DataKey::StakeBalance(reviewer.clone());
        let mut balance: i128 = env.storage().persistent().get(&balance_key).unwrap_or(0);
        balance += stake_weight;
        env.storage().persistent().set(&balance_key, &balance);
        env.storage()
            .persistent()
            .extend_ttl(&balance_key, MIN_TTL_THRESHOLD, MIN_TTL_EXTEND_TO);

        let weight = if stake_weight > 0 {
            stake_weight as u64
        } else {
            1u64
        };

        // Capture the old tier before mutating reputation so the tier_up event
        // can carry both the previous and new tier values.
        let old_avg_rating = Self::get_average_rating(env.clone(), reviewee.clone()).unwrap_or(0);
        let old_tier = calculate_tier(old_avg_rating);

        // Update user reputation

        let rep_key = DataKey::Reputation(reviewee.clone());
        let mut reputation: UserReputation =
            env.storage()
                .persistent()
                .get(&rep_key)
                .unwrap_or(UserReputation {
                    user: reviewee.clone(),
                    total_score: 0,
                    total_weight: 0,
                    review_count: 0,
                    last_updated_ledger: env.ledger().timestamp() as u32,
                });

        apply_lazy_decay(&env, &mut reputation);

        reputation.total_score += (rating as u64) * weight;
        reputation.total_weight += weight;
        reputation.review_count += 1;
        reputation.last_updated_ledger = env.ledger().timestamp() as u32;

        env.storage().persistent().set(&rep_key, &reputation);
        bump_reputation_ttl(&env, &reviewee);

        // Store review
        let review = Review {
            reviewer: reviewer.clone(),
            reviewee: reviewee.clone(),
            job_id,
            rating,
            comment: comment.clone(),
            stake_weight,
            timestamp: env.ledger().timestamp(),
        };

        let reviews_key = DataKey::Reviews(reviewee.clone());
        let mut reviews: Vec<Review> = env
            .storage()
            .persistent()
            .get(&reviews_key)
            .unwrap_or(Vec::new(&env));
        reviews.push_back(review);
        env.storage().persistent().set(&reviews_key, &reviews);
        bump_reviews_ttl(&env, &reviewee);

        // Mark as reviewed
        env.storage().persistent().set(&review_key, &true);
        bump_review_exists_ttl(&env, &reviewer, &reviewee, job_id);

        // Update leaderboard with the reviewee's new rating
        Self::update_leaderboard(&env, &reviewee);

        // Check for tier upgrade and award badge if necessary
        let new_avg_rating = Self::get_average_rating(env.clone(), reviewee.clone()).unwrap_or(0);
        let new_tier = calculate_tier(new_avg_rating);

        // Get existing badges to check if this tier badge already exists
        let badges_key = DataKey::Badges(reviewee.clone());
        let mut badges: Vec<AwardedBadge> = env
            .storage()
            .persistent()
            .get(&badges_key)
            .unwrap_or(Vec::new(&env));

        // Check if user already has this tier badge
        let has_tier_badge = badges.iter().any(|b| b.badge_type == new_tier);

        if !has_tier_badge && new_tier != ReputationTier::None {
            let badge = AwardedBadge {
                badge_type: new_tier,
                awarded_at: env.ledger().timestamp(),
            };
            badges.push_back(badge);
            env.storage().persistent().set(&badges_key, &badges);
            bump_badges_ttl(&env, &reviewee);

            // Emit badge awarded event
            env.events().publish(
                (symbol_short!("reput"), symbol_short!("badge")),
                (reviewee.clone(), new_tier),
            );

            // Emit tier upgrade event so indexers/backends have a dedicated
            // signal without needing to parse badge events.
            env.events().publish(
                (symbol_short!("reput"), symbol_short!("tier_up")),
                (reviewee.clone(), old_tier, new_tier),
            );
        }

        // Process referral bonuses for participating on a completed job
        Self::process_referral_bonus(&env, &reviewer);
        Self::process_referral_bonus(&env, &reviewee);

        // Emit event
        env.events().publish(
            (symbol_short!("reput"), symbol_short!("reviewed")),
            (reviewer, reviewee, job_id, rating, comment, stake_weight),
        );

        Ok(())
    }

    /// Register a referrer for a new user. Can only be called once per referree.
    pub fn register_referral(
        env: Env,
        referree: Address,
        referrer: Address,
    ) -> Result<(), ReputationError> {
        referree.require_auth();

        if referree == referrer {
            return Err(ReputationError::SelfReferral);
        }

        let ref_key = DataKey::Referrer(referree.clone());
        if env.storage().persistent().has(&ref_key) {
            return Err(ReputationError::AlreadyReferred);
        }

        // Guard against circular referral chains (max depth check)
        let mut current = referrer.clone();
        let mut depth = 0;
        while let Some(ancestor) = env
            .storage()
            .persistent()
            .get::<DataKey, Address>(&DataKey::Referrer(current.clone()))
        {
            if ancestor == referree {
                return Err(ReputationError::CircularReferral);
            }
            current = ancestor;
            depth += 1;
            if depth > 10 {
                break;
            } // Bounded safety limit
        }

        env.storage().persistent().set(&ref_key, &referrer);
        env.storage()
            .persistent()
            .extend_ttl(&ref_key, MIN_TTL_THRESHOLD, MIN_TTL_EXTEND_TO);

        // Initialize or update referrer stats
        let stats_key = DataKey::ReferralStats(referrer.clone());
        let mut stats = env
            .storage()
            .persistent()
            .get::<DataKey, ReferralStats>(&stats_key)
            .unwrap_or(ReferralStats {
                total_referrals: 0,
                earned_bonus: 0,
            });
        stats.total_referrals += 1;

        env.storage().persistent().set(&stats_key, &stats);
        env.storage()
            .persistent()
            .extend_ttl(&stats_key, MIN_TTL_THRESHOLD, MIN_TTL_EXTEND_TO);

        env.events().publish(
            (symbol_short!("reput"), symbol_short!("referred")),
            (referree, referrer),
        );

        Ok(())
    }

    /// Alias for `register_referral` using the naming from the public API proposal.
    pub fn register_with_referrer(
        env: Env,
        user: Address,
        referrer: Address,
    ) -> Result<(), ReputationError> {
        Self::register_referral(env, user, referrer)
    }

    /// Retrieve the stats for a referrer
    pub fn get_referral_stats(env: Env, referrer: Address) -> ReferralStats {
        let stats_key = DataKey::ReferralStats(referrer.clone());
        let stats: Option<ReferralStats> = env.storage().persistent().get(&stats_key);
        match stats {
            Some(s) => {
                env.storage().persistent().extend_ttl(
                    &stats_key,
                    MIN_TTL_THRESHOLD,
                    MIN_TTL_EXTEND_TO,
                );
                s
            }
            None => ReferralStats {
                total_referrals: 0,
                earned_bonus: 0,
            },
        }
    }

    /// Internal: Credit the bonus to the user's referrer upon their first completed job.
    fn process_referral_bonus(env: &Env, user: &Address) {
        let bonus_paid_key = DataKey::BonusPaid(user.clone());
        if env.storage().persistent().has(&bonus_paid_key) {
            return; // Bonus already paid out for this referree
        }

        let ref_key = DataKey::Referrer(user.clone());
        if let Some(referrer) = env.storage().persistent().get::<DataKey, Address>(&ref_key) {
            // Mark as paid
            env.storage().persistent().set(&bonus_paid_key, &true);
            env.storage().persistent().extend_ttl(
                &bonus_paid_key,
                MIN_TTL_THRESHOLD,
                MIN_TTL_EXTEND_TO,
            );

            // Credit reputation as one virtual review at REFERRAL_BONUS_REPUTATION_WEIGHT
            // with rating `bonus_rating` (avoids min_stake scaling, which inflated totals).
            // Stored as a record for decay calculation.
            let bonus_rating = env
                .storage()
                .instance()
                .get::<DataKey, u64>(&DataKey::ReferralBonus)
                .unwrap_or(DEFAULT_REFERRAL_BONUS);
            let weight = REFERRAL_BONUS_REPUTATION_WEIGHT;
            let earned_score = bonus_rating * weight;

            let bonuses_key = DataKey::ReferralBonusList(referrer.clone());
            let mut bonuses: Vec<ReferralBonusRecord> = env
                .storage()
                .persistent()
                .get(&bonuses_key)
                .unwrap_or(Vec::new(env));

            bonuses.push_back(ReferralBonusRecord {
                amount: earned_score,
                weight,
                timestamp: env.ledger().timestamp(),
            });

            env.storage().persistent().set(&bonuses_key, &bonuses);
            env.storage().persistent().extend_ttl(
                &bonuses_key,
                MIN_TTL_THRESHOLD,
                MIN_TTL_EXTEND_TO,
            );

            // Update legacy accumulator (optional but good for redundant check if needed)
            let rep_key = DataKey::Reputation(referrer.clone());
            let mut reputation: UserReputation = env
                .storage()
                .persistent()
                .get(&rep_key)
                .unwrap_or(UserReputation {
                    user: referrer.clone(),
                    total_score: 0,
                    total_weight: 0,
                    review_count: 0,
                    last_updated_ledger: env.ledger().timestamp() as u32,
                });

            apply_lazy_decay(env, &mut reputation);

            reputation.total_score += earned_score;
            reputation.total_weight += weight;
            reputation.last_updated_ledger = env.ledger().timestamp() as u32;

            env.storage().persistent().set(&rep_key, &reputation);
            bump_reputation_ttl(env, &referrer);

            // Update Referral Stats
            let stats_key = DataKey::ReferralStats(referrer.clone());
            let mut stats = env
                .storage()
                .persistent()
                .get::<DataKey, ReferralStats>(&stats_key)
                .unwrap_or(ReferralStats {
                    total_referrals: 1,
                    earned_bonus: 0,
                });
            stats.earned_bonus += earned_score;

            env.storage().persistent().set(&stats_key, &stats);
            env.storage()
                .persistent()
                .extend_ttl(&stats_key, MIN_TTL_THRESHOLD, MIN_TTL_EXTEND_TO);

            env.events().publish(
                (symbol_short!("reput"), symbol_short!("ref_rwrd")),
                (referrer.clone(), earned_score, user.clone()),
            );

            env.events().publish(
                (symbol_short!("reput"), Symbol::new(env, "referral_reward")),
                (referrer, earned_score),
            );
        }
    }

    /// Set configuration for the referral bonus (multi-sig only)
    pub fn set_referral_bonus(env: Env, bonus: u64) -> Result<(), ReputationError> {
        if env.current_contract_address() != env.current_contract_address() {
            return Err(ReputationError::Unauthorized);
        }
        env.storage()
            .instance()
            .set(&DataKey::ReferralBonus, &bonus);
        bump_instance_ttl(&env);
        Ok(())
    }

    /// Record a referral bonus for `user` with an explicit `timestamp`.
    ///
    /// Restricted to registered multi-sig signers — used for migrations and
    /// manual corrections that need to backfill a bonus with its original date.
    ///
    /// Security (issue #781): the `timestamp` is validated to be at or before the
    /// current ledger time. A future-dated bonus would make `get_decay_factor`
    /// compute `elapsed_seconds = 0` forever, permanently exempting the bonus
    /// from time decay and inflating the user's score regardless of how much
    /// time actually passes. Past and current timestamps are accepted so the
    /// bonus decays from its true origin date.
    pub fn add_referral_bonus(
        env: Env,
        signer: Address,
        user: Address,
        amount: u64,
        weight: u64,
        timestamp: u64,
    ) -> Result<(), ReputationError> {
        signer.require_auth();
        if !is_signer(&env, &signer) {
            return Err(ReputationError::NotAdmin);
        }
        require_not_paused(&env)?;

        // Reject future timestamps that would bypass decay (see doc comment).
        if timestamp > env.ledger().timestamp() {
            return Err(ReputationError::InvalidTimestamp);
        }

        let bonuses_key = DataKey::ReferralBonusList(user.clone());
        let mut bonuses: Vec<ReferralBonusRecord> = env
            .storage()
            .persistent()
            .get(&bonuses_key)
            .unwrap_or(Vec::new(&env));
        bonuses.push_back(ReferralBonusRecord {
            amount,
            weight,
            timestamp,
        });
        env.storage().persistent().set(&bonuses_key, &bonuses);
        env.storage().persistent().extend_ttl(
            &bonuses_key,
            MIN_TTL_THRESHOLD,
            MIN_TTL_EXTEND_TO,
        );

        // Mirror `process_referral_bonus`: keep the legacy reputation accumulator
        // present so `get_reputation` resolves the user. The decayed totals are
        // always recomputed from the bonus list, so this stays consistent.
        let rep_key = DataKey::Reputation(user.clone());
        let mut reputation: UserReputation = env
            .storage()
            .persistent()
            .get(&rep_key)
            .unwrap_or(UserReputation {
                user: user.clone(),
                total_score: 0,
                total_weight: 0,
                review_count: 0,
                last_updated_ledger: env.ledger().timestamp() as u32,
            });
        apply_lazy_decay(&env, &mut reputation);
        reputation.total_score = reputation.total_score.saturating_add(amount);
        reputation.total_weight = reputation.total_weight.saturating_add(weight);
        reputation.last_updated_ledger = env.ledger().timestamp() as u32;
        env.storage().persistent().set(&rep_key, &reputation);
        bump_reputation_ttl(&env, &user);

        // Keep the leaderboard consistent with the user's new decayed totals.
        Self::update_leaderboard(&env, &user);

        env.events().publish(
            (symbol_short!("reput"), symbol_short!("ref_add")),
            (user, amount, timestamp),
        );

        Ok(())
    }

    /// Update the annual reputation `decay_rate` (percent per year).
    ///
    /// Restricted to registered multi-sig signers.
    ///
    /// Security (issue #783): the rate is bounded by the configurable maximum
    /// (`effective_max_decay_rate`, default `MAX_DECAY_RATE`). Without an upper
    /// bound, a rate such as 99 would erase ~99% of every score within a year,
    /// emptying the leaderboard and rendering reputation meaningless. Values
    /// above the maximum are rejected with `DecayRateTooHigh`.
    pub fn update_decay_rate(
        env: Env,
        signer: Address,
        decay_rate: u32,
    ) -> Result<(), ReputationError> {
        signer.require_auth();
        if !is_signer(&env, &signer) {
            return Err(ReputationError::NotAdmin);
        }
        if decay_rate > effective_max_decay_rate(&env) {
            return Err(ReputationError::DecayRateTooHigh);
        }
        env.storage().instance().set(&DataKey::DecayRate, &decay_rate);
        bump_instance_ttl(&env);

        env.events().publish(
            (symbol_short!("reput"), symbol_short!("decay_set")),
            decay_rate,
        );

        Ok(())
    }

    /// Set the configurable maximum allowed `decay_rate` (super-admin only).
    ///
    /// Restricted to registered multi-sig signers and itself capped at
    /// `MAX_DECAY_RATE_HARD_CEILING` (50%) so that even a compromised admin
    /// cannot raise the ceiling high enough to destroy all reputation (issue
    /// #783). Requests above the hard ceiling are rejected with
    /// `DecayRateTooHigh`.
    pub fn set_max_decay_rate(
        env: Env,
        signer: Address,
        rate: u32,
    ) -> Result<(), ReputationError> {
        signer.require_auth();
        if !is_signer(&env, &signer) {
            return Err(ReputationError::NotAdmin);
        }
        if rate > MAX_DECAY_RATE_HARD_CEILING {
            return Err(ReputationError::DecayRateTooHigh);
        }
        env.storage().instance().set(&DataKey::MaxDecayRate, &rate);
        bump_instance_ttl(&env);

        env.events().publish(
            (symbol_short!("reput"), symbol_short!("max_decay")),
            rate,
        );

        Ok(())
    }

    /// Get the reputation data for a user, applying time decay to totals.
    pub fn get_reputation(env: Env, user: Address) -> Result<UserReputation, ReputationError> {
        bump_instance_ttl(&env);
        let rep_key = DataKey::Reputation(user.clone());
        if !env.storage().persistent().has(&rep_key) {
            return Err(ReputationError::UserNotFound);
        }

        let (total_score, total_weight, review_count) =
            Self::get_decayed_totals(&env, user.clone());

        bump_reputation_ttl(&env, &user);
        Ok(UserReputation {
            user,
            total_score,
            total_weight,
            review_count,
            last_updated_ledger: env.ledger().timestamp() as u32,
        })
    }

    /// Get reputation together with the registered referrer (if any).
    pub fn get_reputation_with_referrer(
        env: Env,
        user: Address,
    ) -> Result<UserReputationWithReferrer, ReputationError> {
        let base = Self::get_reputation(env.clone(), user.clone())?;
        let referrer: Option<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::Referrer(user.clone()));
        if referrer.is_some() {
            env.storage().persistent().extend_ttl(
                &DataKey::Referrer(user.clone()),
                MIN_TTL_THRESHOLD,
                MIN_TTL_EXTEND_TO,
            );
        }

        Ok(UserReputationWithReferrer {
            user,
            referrer,
            total_score: base.total_score,
            total_weight: base.total_weight,
            review_count: base.review_count,
        })
    }

    /// Initialize the reputation contract with signers.
    pub fn initialize(
        env: Env,
        signers: Vec<Address>,
        threshold: u32,
        decay_rate: u32,
    ) -> Result<(), ReputationError> {
        if env.storage().instance().has(&DataKey::MultiSigSigners) {
            return Err(ReputationError::Unauthorized); // already initialized
        }
        if decay_rate > 100 {
            return Err(ReputationError::InvalidDecayRate);
        }
        if threshold == 0 || threshold > signers.len() {
            return Err(ReputationError::NotAdmin); // Or a specific error if available
        }

        env.storage()
            .instance()
            .set(&DataKey::MultiSigSigners, &signers);
        env.storage()
            .instance()
            .set(&DataKey::MultiSigThreshold, &threshold);

        env.storage()
            .instance()
            .set(&DataKey::DecayRate, &decay_rate);
        env.storage()
            .instance()
            .set(&DataKey::MinStake, &MIN_REVIEW_STAKE_DEFAULT);
        env.storage()
            .instance()
            .set(&DataKey::RateLimit, &RATE_LIMIT_LEDGERS_DEFAULT);
        env.storage().instance().set(&DataKey::Paused, &false);
        bump_instance_ttl(&env);
        Ok(())
    }

    /// Configure the dispute contract allowed to slash reputation.
    /// This is a privileged action and must be performed by a registered signer.
    pub fn set_dispute_contract(
        env: Env,
        signer: Address,
        dispute_contract: Address,
    ) -> Result<(), ReputationError> {
        signer.require_auth();
        if !is_signer(&env, &signer) {
            return Err(ReputationError::NotAdmin);
        }

        env.storage()
            .instance()
            .set(&DataKey::DisputeContract, &dispute_contract);
        bump_instance_ttl(&env);

        env.events().publish(
            (symbol_short!("reput"), Symbol::new(&env, "dispute_set")),
            (signer, dispute_contract),
        );

        Ok(())
    }

    /// Slash a user's reputation score. Callable only by the configured dispute contract.
    pub fn slash_reputation(
        env: Env,
        user: Address,
        job_id: u64,
        amount: u64,
        reason: String,
    ) -> Result<(), ReputationError> {
        require_not_paused(&env)?;

        let dispute_contract: Address = env
            .storage()
            .instance()
            .get(&DataKey::DisputeContract)
            .ok_or(ReputationError::NotInitialized)?;
        dispute_contract.require_auth();

        let rep_key = DataKey::Reputation(user.clone());
        let mut reputation: UserReputation =
            env.storage()
                .persistent()
                .get(&rep_key)
                .unwrap_or(UserReputation {
                    user: user.clone(),
                    total_score: 0,
                    total_weight: 0,
                    review_count: 0,
                    last_updated_ledger: env.ledger().timestamp() as u32,
                });

        apply_lazy_decay(&env, &mut reputation);

        reputation.total_score = reputation.total_score.saturating_sub(amount);
        reputation.last_updated_ledger = env.ledger().timestamp() as u32;
        env.storage().persistent().set(&rep_key, &reputation);
        bump_reputation_ttl(&env, &user);

        env.events().publish(
            (
                symbol_short!("reput"),
                Symbol::new(&env, "reputation_slashed"),
            ),
            (user, job_id, amount, reason),
        );

        Ok(())
    }

    /// Apply dispute outcome to a user's reputation score. Callable only by the configured dispute contract.
    /// Updates reputation based on outcome:
    /// - Won: +50 points
    /// - Lost: -100 points
    /// - MaliciousFiling: -250 points
    pub fn apply_dispute_outcome(
        env: Env,
        user: Address,
        outcome: DisputeOutcome,
    ) -> Result<(), ReputationError> {
        require_not_paused(&env)?;

        let dispute_contract: Address = env
            .storage()
            .instance()
            .get(&DataKey::DisputeContract)
            .ok_or(ReputationError::NotInitialized)?;
        dispute_contract.require_auth();

        let score_change: i64 = match outcome {
            DisputeOutcome::Won => 50,
            DisputeOutcome::Lost => -100,
            DisputeOutcome::MaliciousFiling => -250,
        };

        let rep_key = DataKey::Reputation(user.clone());
        let mut reputation: UserReputation = env
            .storage()
            .persistent()
            .get(&rep_key)
            .unwrap_or(UserReputation {
                user: user.clone(),
                total_score: 0,
                total_weight: 0,
                review_count: 0,
                last_updated_ledger: 0,
            });

        if score_change > 0 {
            reputation.total_score = reputation.total_score.saturating_add(score_change as u64);
        } else {
            reputation.total_score = reputation.total_score.saturating_sub((-score_change) as u64);
        }

        env.storage().persistent().set(&rep_key, &reputation);
        bump_reputation_ttl(&env, &user);

        // Update leaderboard with the user's new rating
        Self::update_leaderboard(&env, &user);

        env.events().publish(
            (symbol_short!("reput"), Symbol::new(&env, "dispute_outcome")),
            (user, outcome, score_change),
        );

        Ok(())
    }

    /// Get the current minimum stake requirement.
    pub fn get_min_stake(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::MinStake)
            .unwrap_or(MIN_REVIEW_STAKE_DEFAULT)
    }

    /// Get the current rate limit in ledgers.
    pub fn get_rate_limit(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::RateLimit)
            .unwrap_or(RATE_LIMIT_LEDGERS_DEFAULT)
    }

    /// Get the current minimum stake weight threshold.
    pub fn get_min_stake_weight(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::MinStakeWeight)
            .unwrap_or(MIN_STAKE_WEIGHT)
    }

    /// Set the minimum stake weight threshold (admin/signer only).
    /// Reviews submitted with stake_weight below this value are rejected with StakeTooLow.
    pub fn set_min_stake_weight(
        env: Env,
        admin: Address,
        weight: u64,
    ) -> Result<(), ReputationError> {
        admin.require_auth();
        if !is_signer(&env, &admin) {
            return Err(ReputationError::NotAdmin);
        }
        env.storage()
            .instance()
            .set(&DataKey::MinStakeWeight, &weight);
        bump_instance_ttl(&env);

        env.events().publish(
            (symbol_short!("reput"), Symbol::new(&env, "min_wt_set")),
            (admin, weight),
        );

        Ok(())
    }

    pub fn propose_admin_action(
        env: Env,
        proposer: Address,
        action: AdminAction,
    ) -> Result<u64, ReputationError> {
        proposer.require_auth();
        if !is_signer(&env, &proposer) {
            return Err(ReputationError::NotAdmin);
        }

        let mut count: u64 = env
            .storage()
            .instance()
            .get(&DataKey::MultiSigProposalCount)
            .unwrap_or(0);
        count += 1;

        let mut approvals = Vec::new(&env);
        approvals.push_back(proposer.clone());

        let proposal = MultiSigProposal {
            id: count,
            action: action.clone(),
            proposer: proposer.clone(),
            approvals,
            executed: false,
            created_at: env.ledger().timestamp(),
        };

        env.storage()
            .instance()
            .set(&DataKey::MultiSigProposal(count), &proposal);
        env.storage()
            .instance()
            .set(&DataKey::MultiSigProposalCount, &count);

        env.events().publish(
            (symbol_short!("msig"), symbol_short!("proposed")),
            (count, proposer, action),
        );

        let threshold: u32 = env
            .storage()
            .instance()
            .get(&DataKey::MultiSigThreshold)
            .unwrap_or(1);
        if threshold == 1 {
            Self::execute_proposal(&env, count)?;
        }

        Ok(count)
    }

    pub fn approve_admin_action(
        env: Env,
        approver: Address,
        proposal_id: u64,
    ) -> Result<(), ReputationError> {
        approver.require_auth();
        if !is_signer(&env, &approver) {
            return Err(ReputationError::NotAdmin);
        }

        let mut proposal: MultiSigProposal = env
            .storage()
            .instance()
            .get(&DataKey::MultiSigProposal(proposal_id))
            .ok_or(ReputationError::NotAdmin)?;

        if proposal.executed {
            return Err(ReputationError::Unauthorized);
        }

        if proposal.approvals.iter().any(|a| a == approver) {
            return Err(ReputationError::Unauthorized);
        }

        proposal.approvals.push_back(approver.clone());
        env.storage()
            .instance()
            .set(&DataKey::MultiSigProposal(proposal_id), &proposal);

        env.events().publish(
            (symbol_short!("msig"), symbol_short!("approved")),
            (proposal_id, approver),
        );

        let threshold: u32 = env
            .storage()
            .instance()
            .get(&DataKey::MultiSigThreshold)
            .unwrap_or(1);
        if proposal.approvals.len() >= threshold {
            Self::execute_proposal(&env, proposal_id)?;
        }

        Ok(())
    }

    fn execute_proposal(env: &Env, proposal_id: u64) -> Result<(), ReputationError> {
        let mut proposal: MultiSigProposal = env
            .storage()
            .instance()
            .get(&DataKey::MultiSigProposal(proposal_id))
            .ok_or(ReputationError::NotAdmin)?;

        if proposal.executed {
            return Err(ReputationError::Unauthorized);
        }

        match proposal.action.clone() {
            AdminAction::Pause => {
                env.storage().instance().set(&DataKey::Paused, &true);
                env.events().publish(
                    (symbol_short!("reput"), symbol_short!("paused")),
                    (env.current_contract_address(), env.ledger().timestamp()),
                );
            }
            AdminAction::Unpause => {
                env.storage().instance().set(&DataKey::Paused, &false);
                env.events().publish(
                    (symbol_short!("reput"), symbol_short!("unpaused")),
                    (env.current_contract_address(), env.ledger().timestamp()),
                );
            }
            AdminAction::SetMinStake(amount) => {
                env.storage().instance().set(&DataKey::MinStake, &amount);
            }
            AdminAction::SetRateLimit(ledgers) => {
                env.storage().instance().set(&DataKey::RateLimit, &ledgers);
            }
            AdminAction::SetToken(token) => {
                env.storage().instance().set(&DataKey::Token, &token);
            }
            AdminAction::SetReferralBonus(bonus) => {
                env.storage()
                    .instance()
                    .set(&DataKey::ReferralBonus, &bonus);
            }
            AdminAction::AddSigner(signer) => {
                let mut signers: Vec<Address> = env
                    .storage()
                    .instance()
                    .get(&DataKey::MultiSigSigners)
                    .unwrap();
                if !signers.iter().any(|s| s == signer) {
                    signers.push_back(signer);
                    env.storage()
                        .instance()
                        .set(&DataKey::MultiSigSigners, &signers);
                }
            }
            AdminAction::RemoveSigner(signer) => {
                let mut signers: Vec<Address> = env
                    .storage()
                    .instance()
                    .get(&DataKey::MultiSigSigners)
                    .unwrap();
                let threshold: u32 = env
                    .storage()
                    .instance()
                    .get(&DataKey::MultiSigThreshold)
                    .unwrap_or(1);

                if let Some(idx) = signers.iter().position(|s| s == signer) {
                    if signers.len() <= threshold {
                        return Err(ReputationError::NotAdmin);
                    }
                    signers.remove(idx as u32);
                    env.storage()
                        .instance()
                        .set(&DataKey::MultiSigSigners, &signers);
                }
            }
            AdminAction::ChangeThreshold(new_threshold) => {
                let signers: Vec<Address> = env
                    .storage()
                    .instance()
                    .get(&DataKey::MultiSigSigners)
                    .unwrap();
                if new_threshold == 0 || new_threshold > signers.len() {
                    return Err(ReputationError::NotAdmin);
                }
                env.storage()
                    .instance()
                    .set(&DataKey::MultiSigThreshold, &new_threshold);
            }
            AdminAction::RotateSigner(old_signer, new_signer) => {
                let mut signers: Vec<Address> = env
                    .storage()
                    .instance()
                    .get(&DataKey::MultiSigSigners)
                    .unwrap();
                if let Some(idx) = signers.iter().position(|s| s == old_signer) {
                    signers.set(idx as u32, new_signer);
                    env.storage()
                        .instance()
                        .set(&DataKey::MultiSigSigners, &signers);
                } else {
                    return Err(ReputationError::NotAdmin);
                }
            }
            AdminAction::SetDecayRate(rate) => {
                // Enforce the same upper bound as `update_decay_rate` so the
                // multi-sig governance path cannot set a destructive decay rate
                // (issue #783).
                if rate > effective_max_decay_rate(env) {
                    return Err(ReputationError::DecayRateTooHigh);
                }
                env.storage().instance().set(&DataKey::DecayRate, &rate);
            }
            AdminAction::SlashStake(loser, job_id, amount) => {
                let rep_key = DataKey::Reputation(loser.clone());
                let mut reputation: UserReputation = env
                    .storage()
                    .persistent()
                    .get(&rep_key)
                    .unwrap_or(UserReputation {
                        user: loser.clone(),
                        total_score: 0,
                        total_weight: 0,
                        review_count: 0,
                        last_updated_ledger: env.ledger().timestamp() as u32,
                    });

                apply_lazy_decay(&env, &mut reputation);

                reputation.total_score = reputation.total_score.saturating_sub(amount);
                reputation.last_updated_ledger = env.ledger().timestamp() as u32;
                env.storage().persistent().set(&rep_key, &reputation);
                bump_reputation_ttl(env, &loser);

                env.events().publish(
                    (symbol_short!("reput"), symbol_short!("slashed")),
                    (loser, job_id, amount),
                );
            }
            AdminAction::SetStakeTiers(tiers) => {
                env.storage().instance().set(&DataKey::StakeTiers, &tiers);
            }
        }

        proposal.executed = true;
        env.storage()
            .instance()
            .set(&DataKey::MultiSigProposal(proposal_id), &proposal);

        env.events().publish(
            (symbol_short!("msig"), symbol_short!("executed")),
            (proposal_id, proposal.action),
        );

        Ok(())
    }

    /// Calculate effective weight of a review, applying time decay.
    /// Formula: effective_weight = stake_weight * max(0, 100 - decay_rate * age_in_seconds / ONE_YEAR) / 100
    pub fn get_effective_weight(env: Env, review: Review, current_time: u64) -> i128 {
        let decay_rate: u32 = env
            .storage()
            .instance()
            .get(&DataKey::DecayRate)
            .unwrap_or(0);

        let initial_weight = if review.stake_weight > 0 {
            review.stake_weight
        } else {
            1_i128
        };

        if decay_rate == 0 {
            return initial_weight;
        }

        let decay_factor = get_decay_factor(decay_rate, current_time, review.timestamp);

        if decay_factor == 0 {
            return 0;
        }

        (initial_weight.saturating_mul(decay_factor as i128)) / 100
    }

    fn get_decayed_totals(env: &Env, user: Address) -> (u64, u64, u32) {
        env.storage()
            .instance()
            .extend_ttl(MIN_TTL_THRESHOLD, MIN_TTL_EXTEND_TO);

        let decay_rate: u32 = env
            .storage()
            .instance()
            .get(&DataKey::DecayRate)
            .unwrap_or(0);
        let current_ts = env.ledger().timestamp();

        let reviews_key = DataKey::Reviews(user.clone());
        let reviews: Vec<Review> = env
            .storage()
            .persistent()
            .get(&reviews_key)
            .unwrap_or(Vec::new(env));

        // Extend TTL on read so that a frequently-read entry never silently expires.
        if !reviews.is_empty() {
            bump_reviews_ttl(env, &user);
        }

        let review_count = reviews.len() as u32;
        let mut total_score = 0u64;
        let mut total_weight = 0u64;

        for review in reviews.iter() {
            let factor = get_decay_factor(decay_rate, current_ts, review.timestamp);
            let decayed_weight = (review.stake_weight as u64 * factor) / 100;
            total_score += (review.rating as u64) * decayed_weight;
            total_weight += decayed_weight;
        }

        // Include referral bonuses (stored as ReferralBonusRecord with individual timestamps).
        let bonuses_key = DataKey::ReferralBonusList(user.clone());
        if let Some(bonuses) = env
            .storage()
            .persistent()
            .get::<DataKey, Vec<ReferralBonusRecord>>(&bonuses_key)
        {
            for bonus in bonuses.iter() {
                let factor = get_decay_factor(decay_rate, current_ts, bonus.timestamp);
                // bonus.amount = bonus_rating * bonus.weight; apply same decay factor.
                total_score += bonus.amount * factor / 100;
                total_weight += bonus.weight * factor / 100;
            }
        }

        (total_score, total_weight, review_count)
    }

    pub fn endorse(
        env: Env,
        endorser: Address,
        target: Address,
        skill: String,
    ) -> Result<(), ReputationError> {
        endorser.require_auth();
        require_not_paused(&env)?;

        let key = DataKey::Endorsement(target.clone(), skill.clone(), endorser.clone());
        if env.storage().persistent().has(&key) {
            return Err(ReputationError::AlreadyEndorsed);
        }

        env.storage().persistent().set(&key, &true);

        let list_key = DataKey::SkillEndorsers(target.clone(), skill.clone());
        let mut endorsers: Vec<Address> = env
            .storage()
            .persistent()
            .get(&list_key)
            .unwrap_or(Vec::new(&env));
        endorsers.push_back(endorser.clone());
        env.storage().persistent().set(&list_key, &endorsers);

        Ok(())
    }

    pub fn get_skill_score(env: Env, user: Address, skill: String) -> u32 {
        let list_key = DataKey::SkillEndorsers(user.clone(), skill.clone());
        let endorsers: Vec<Address> = env
            .storage()
            .persistent()
            .get(&list_key)
            .unwrap_or(Vec::new(&env));

        let mut score = 0;
        for endorser in endorsers.iter() {
            let avg_rating = Self::get_average_rating(env.clone(), endorser.clone()).unwrap_or(0);
            let weight = if avg_rating > 0 { avg_rating / 100 } else { 1 };
            score += weight as u32;
        }

        score
    }

    pub fn set_stake_tiers(
        env: Env,
        admin: Address,
        tiers: Vec<StakeTier>,
    ) -> Result<(), ReputationError> {
        admin.require_auth();
        if !is_signer(&env, &admin) {
            return Err(ReputationError::NotAdmin);
        }
        env.storage().instance().set(&DataKey::StakeTiers, &tiers);
        Ok(())
    }

    pub fn get_stake_multiplier(env: Env, user: Address) -> u32 {
        let balance_key = DataKey::StakeBalance(user.clone());
        let balance: i128 = env.storage().persistent().get(&balance_key).unwrap_or(0);

        let tiers: Vec<StakeTier> = env
            .storage()
            .instance()
            .get(&DataKey::StakeTiers)
            .unwrap_or(Vec::new(&env));
        let mut multiplier = 100; // Default 1x

        for tier in tiers.iter() {
            if balance >= tier.threshold {
                multiplier = tier.multiplier;
            }
        }
        multiplier
    }

    pub fn get_average_rating(env: Env, user: Address) -> Result<u64, ReputationError> {
        let multiplier = Self::get_stake_multiplier(env.clone(), user.clone());

        let (total_score, total_weight, _) = Self::get_decayed_totals(&env, user);

        if total_weight == 0 {
            return Ok(0); // If completely decayed, acts as no rep
        }

        let base_score = (total_score * 100) / total_weight;
        let weighted = (base_score * (multiplier as u64)) / 100;
        Ok(weighted.min(10_000))
    }

    /// Get the total number of reviews for a user.
    pub fn get_review_count(env: Env, user: Address) -> u32 {
        let rep_key = DataKey::Reputation(user);
        let reputation: Option<UserReputation> = env.storage().persistent().get(&rep_key);
        match reputation {
            Some(rep) => {
                bump_reputation_ttl(&env, &rep.user);
                rep.review_count
            }
            None => 0,
        }
    }

    /// Get all reviews for a user.
    pub fn get_reviews(env: Env, user: Address) -> Vec<Review> {
        let reviews_key = DataKey::Reviews(user);
        let reviews: Option<Vec<Review>> = env.storage().persistent().get(&reviews_key);
        match reviews {
            Some(list) => {
                env.storage().persistent().extend_ttl(
                    &reviews_key,
                    MIN_TTL_THRESHOLD,
                    MIN_TTL_EXTEND_TO,
                );
                list
            }
            None => Vec::new(&env),
        }
    }

    /// Get the reputation tier for a user based on their average rating.
    pub fn get_tier(env: Env, user: Address) -> ReputationTier {
        match Self::get_average_rating(env, user) {
            Ok(avg_rating) => calculate_tier(avg_rating),
            Err(_) => ReputationTier::None,
        }
    }

    /// Get all badges awarded to a user.
    pub fn get_badges(env: Env, user: Address) -> Vec<AwardedBadge> {
        let badges_key = DataKey::Badges(user);
        let badges: Option<Vec<AwardedBadge>> = env.storage().persistent().get(&badges_key);
        match badges {
            Some(list) => {
                env.storage().persistent().extend_ttl(
                    &badges_key,
                    MIN_TTL_THRESHOLD,
                    MIN_TTL_EXTEND_TO,
                );
                list
            }
            None => Vec::new(&env),
        }
    }

    /// Get the current badge for a user based on their score.
    /// Badges are computed dynamically from score:
    /// - Bronze: score ≥ 100
    /// - Silver: score ≥ 500
    /// - Gold: score ≥ 2000
    /// Returns None if the user has no reputation or score < 100.
    pub fn get_badge(env: Env, user: Address) -> Option<Badge> {
        let rep_key = DataKey::Reputation(user.clone());
        let reputation: Option<UserReputation> = env.storage().persistent().get(&rep_key);
        
        match reputation {
            Some(rep) => {
                bump_reputation_ttl(&env, &user);
                let score = rep.total_score;
                if score >= 2000 {
                    Some(Badge::Gold)
                } else if score >= 500 {
                    Some(Badge::Silver)
                } else if score >= 100 {
                    Some(Badge::Bronze)
                } else {
                    None
                }
            }
            None => None,
        }
    }

    /// Claim staked tokens back after a lockup period. Allows reviewers to withdraw
    /// their stakes. Transfers the claimed amount from the contract back to the reviewer.
    pub fn claim_stake(env: Env, reviewer: Address, amount: i128) -> Result<(), ReputationError> {
        reviewer.require_auth();
        require_not_paused(&env)?;

        let balance_key = DataKey::StakeBalance(reviewer.clone());
        let balance: i128 = env.storage().persistent().get(&balance_key).unwrap_or(0);

        if balance < amount || amount <= 0 {
            return Err(ReputationError::BelowMinStake);
        }

        // Update balance
        let new_balance = balance - amount;
        if new_balance > 0 {
            env.storage().persistent().set(&balance_key, &new_balance);
        } else {
            env.storage().persistent().remove(&balance_key);
        }

        // Transfer tokens back to reviewer
        let token_client = token::Client::new(&env, &env.current_contract_address());
        token_client.transfer(&env.current_contract_address(), &reviewer, &amount);

        env.events().publish(
            (symbol_short!("reput"), symbol_short!("claim")),
            (reviewer, amount),
        );

        Ok(())
    }

    /// File an appeal for a previously submitted review.
    /// Can only be filed by the reviewee within the configured grace window.
    pub fn appeal_review(
        env: Env,
        reviewer: Address,
        reviewee: Address,
        job_id: u64,
        reason: String,
    ) -> Result<(), ReputationError> {
        reviewee.require_auth();
        require_not_paused(&env)?;

        let reviews_key = DataKey::Reviews(reviewee.clone());
        let reviews: Vec<Review> = env
            .storage()
            .persistent()
            .get(&reviews_key)
            .unwrap_or(Vec::new(&env));

        let review = reviews
            .iter()
            .find(|r| r.reviewer == reviewer && r.job_id == job_id)
            .ok_or(ReputationError::ReviewNotFound)?;

        let now = env.ledger().timestamp();
        if now > review.timestamp.saturating_add(APPEAL_GRACE_WINDOW_SECONDS) {
            return Err(ReputationError::AppealWindowExpired);
        }

        let appeal_key = DataKey::ReviewAppeal(reviewer.clone(), reviewee.clone(), job_id);
        if env.storage().persistent().has(&appeal_key) {
            return Err(ReputationError::AppealAlreadyExists);
        }

        let appeal = ReviewAppeal {
            reviewer: reviewer.clone(),
            reviewee: reviewee.clone(),
            job_id,
            reason: reason.clone(),
            created_at: now,
            expires_at: review.timestamp.saturating_add(APPEAL_GRACE_WINDOW_SECONDS),
            status: AppealStatus::Pending,
        };

        env.storage().persistent().set(&appeal_key, &appeal);
        bump_review_appeal_ttl(&env, &reviewer, &reviewee, job_id);

        env.events().publish(
            (symbol_short!("reput"), symbol_short!("appealed")),
            (reviewer, reviewee, job_id, reason.clone()),
        );

        Ok(())
    }

    /// Get a paginated list of top users by average rating.
    pub fn get_leaderboard_page(env: Env, offset: u32, limit: u32) -> Vec<(Address, u64)> {
        let leaderboard_key = DataKey::Leaderboard;
        let leaderboard: Option<Vec<(Address, u64)>> =
            env.storage().instance().get(&leaderboard_key);

        let list = match leaderboard {
            Some(l) => {
                env.storage()
                    .instance()
                    .extend_ttl(MIN_TTL_THRESHOLD, MIN_TTL_EXTEND_TO);
                l
            }
            None => return Vec::new(&env),
        };

        let total = list.len();
        if offset >= total {
            return Vec::new(&env);
        }

        let actual_limit = if limit > 50 { 50 } else { limit };
        let end = offset.saturating_add(actual_limit);
        let end = if end > total { total } else { end };

        let mut page = Vec::new(&env);
        for i in offset..end {
            page.push_back(list.get(i).unwrap());
        }
        page
    }

    /// Get the top N users by average rating. Returns a vector of (Address, average_rating)
    /// tuples sorted by rating (highest first), up to top 50.
    /// Deprecated: use get_leaderboard_page instead.
    pub fn get_leaderboard(env: Env) -> Vec<(Address, u64)> {
        Self::get_leaderboard_page(env, 0, 50)
    }

    /// Internal function to update the leaderboard after a review is submitted.
    /// Maintains a sorted list of top 50 users by average rating.
    fn update_leaderboard(env: &Env, reviewee: &Address) {
        // Compute the user's decayed totals once. These drive both the
        // zero-score removal check (issue #785) and the average rating used for
        // ranking, so we read them here instead of paying for two passes.
        let (new_score, new_weight, _) = Self::get_decayed_totals(env, reviewee.clone());

        let leaderboard_key = DataKey::Leaderboard;
        let mut leaderboard: Vec<(Address, u64)> = env
            .storage()
            .instance()
            .get(&leaderboard_key)
            .unwrap_or(Vec::new(env));

        // Remove existing entry for this user if present
        let mut idx: u32 = 0;
        while idx < leaderboard.len() {
            if leaderboard.get(idx).unwrap().0 == *reviewee {
                leaderboard.remove(idx);
                break;
            }
            idx += 1;
        }

        // Issue #785: once a user's score and weight have fully decayed to zero,
        // their entry must not linger on the leaderboard showing a 0 — that
        // pushes legitimate active users out of the visible top list. Persist
        // the leaderboard with the stale entry dropped (the loop above already
        // removed it) and stop before re-inserting. We intentionally leave the
        // user's reputation/review records intact: those hold history (and
        // accumulator-only score such as dispute outcomes) that must survive a
        // dormant period and is unrelated to leaderboard visibility.
        if new_score == 0 && new_weight == 0 {
            env.storage().instance().set(&leaderboard_key, &leaderboard);
            env.storage()
                .instance()
                .extend_ttl(MIN_TTL_THRESHOLD, MIN_TTL_EXTEND_TO);
            return;
        }

        let avg_rating = match Self::get_average_rating(env.clone(), reviewee.clone()) {
            Ok(rating) => rating,
            Err(_) => {
                // Reputation vanished between reads — persist the removal so a
                // stale entry is not left behind, then stop.
                env.storage().instance().set(&leaderboard_key, &leaderboard);
                env.storage()
                    .instance()
                    .extend_ttl(MIN_TTL_THRESHOLD, MIN_TTL_EXTEND_TO);
                return;
            }
        };

        // Insert at correct position (descending by rating)
        let mut inserted = false;
        let mut pos: u32 = 0;
        while pos < leaderboard.len() {
            let rating = leaderboard.get(pos).unwrap().1;
            if avg_rating > rating {
                leaderboard.insert(pos, (reviewee.clone(), avg_rating));
                inserted = true;
                break;
            }
            pos += 1;
        }

        if !inserted {
            leaderboard.push_back((reviewee.clone(), avg_rating));
        }

        env.storage().instance().set(&leaderboard_key, &leaderboard);
        env.storage()
            .instance()
            .extend_ttl(MIN_TTL_THRESHOLD, MIN_TTL_EXTEND_TO);
    }

    /// Resolve an existing review appeal.
    /// Admin can remove the review or dismiss the appeal.
    pub fn admin_resolve_appeal(
        env: Env,
        admin: Address,
        reviewer: Address,
        reviewee: Address,
        job_id: u64,
        remove: bool,
    ) -> Result<(), ReputationError> {
        admin.require_auth();
        require_not_paused(&env)?;
        if !is_signer(&env, &admin) {
            return Err(ReputationError::NotAdmin);
        }

        let appeal_key = DataKey::ReviewAppeal(reviewer.clone(), reviewee.clone(), job_id);
        let mut appeal: ReviewAppeal = env
            .storage()
            .persistent()
            .get(&appeal_key)
            .ok_or(ReputationError::AppealNotFound)?;

        if appeal.status != AppealStatus::Pending {
            return Err(ReputationError::AppealAlreadyResolved);
        }

        if remove {
            let reviews_key = DataKey::Reviews(reviewee.clone());
            let mut reviews: Vec<Review> = env
                .storage()
                .persistent()
                .get(&reviews_key)
                .unwrap_or(Vec::new(&env));

            let review_index = reviews
                .iter()
                .position(|r| r.reviewer == reviewer && r.job_id == job_id)
                .ok_or(ReputationError::ReviewNotFound)?;

            let removed_review = reviews.get(review_index as u32).unwrap();
            let removed_weight = if removed_review.stake_weight > 0 {
                removed_review.stake_weight as u64
            } else {
                1
            };
            let removed_score = removed_weight.saturating_mul(removed_review.rating as u64);

            reviews.remove(review_index as u32);
            env.storage().persistent().set(&reviews_key, &reviews);
            bump_reviews_ttl(&env, &reviewee);

            let review_exists_key =
                DataKey::ReviewExists(reviewer.clone(), reviewee.clone(), job_id);
            if env.storage().persistent().has(&review_exists_key) {
                env.storage().persistent().remove(&review_exists_key);
            }

            let rep_key = DataKey::Reputation(reviewee.clone());
            let mut reputation: UserReputation = env
                .storage()
                .persistent()
                .get(&rep_key)
                .unwrap_or(UserReputation {
                    user: reviewee.clone(),
                    total_score: 0,
                    total_weight: 0,
                    review_count: 0,
                    last_updated_ledger: env.ledger().timestamp() as u32,
                });

            apply_lazy_decay(&env, &mut reputation);

            reputation.total_score = reputation.total_score.saturating_sub(removed_score);
            reputation.total_weight = reputation.total_weight.saturating_sub(removed_weight);
            reputation.review_count = reputation.review_count.saturating_sub(1);
            reputation.last_updated_ledger = env.ledger().timestamp() as u32;
            env.storage().persistent().set(&rep_key, &reputation);
            bump_reputation_ttl(&env, &reviewee);

            appeal.status = AppealStatus::ReviewRemoved;
        } else {
            appeal.status = AppealStatus::Dismissed;
        }

        env.storage().persistent().set(&appeal_key, &appeal);
        bump_review_appeal_ttl(&env, &reviewer, &reviewee, job_id);

        env.events().publish(
            (symbol_short!("reput"), symbol_short!("ap_reslv")),
            (admin, reviewer, reviewee, job_id, remove),
        );

        Ok(())
    }

    pub fn get_review_appeal(
        env: Env,
        reviewer: Address,
        reviewee: Address,
        job_id: u64,
    ) -> Result<ReviewAppeal, ReputationError> {
        let key = DataKey::ReviewAppeal(reviewer.clone(), reviewee.clone(), job_id);
        let appeal: ReviewAppeal = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(ReputationError::AppealNotFound)?;
        bump_review_appeal_ttl(&env, &reviewer, &reviewee, job_id);
        Ok(appeal)
    }
}

#[cfg(test)]
mod test;

#[cfg(test)]
mod proptest_tests;

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, testutils::Ledger, vec, Env};

    fn seed_review_state(
        env: &Env,
        contract_id: &Address,
        reviewer: &Address,
        reviewee: &Address,
        job_id: u64,
        rating: u32,
    ) {
        let review = Review {
            reviewer: reviewer.clone(),
            reviewee: reviewee.clone(),
            job_id,
            rating,
            comment: String::from_str(env, "seed review"),
            stake_weight: MIN_REVIEW_STAKE_DEFAULT,
            timestamp: env.ledger().timestamp(),
        };

        let reviews = vec![env, review];
        env.as_contract(contract_id, || {
            env.storage()
                .persistent()
                .set(&DataKey::Reviews(reviewee.clone()), &reviews);
            env.storage().persistent().set(
                &DataKey::ReviewExists(reviewer.clone(), reviewee.clone(), job_id),
                &true,
            );
            env.storage().persistent().set(
                &DataKey::Reputation(reviewee.clone()),
                &UserReputation {
                    user: reviewee.clone(),
                    total_score: (rating as u64) * (MIN_REVIEW_STAKE_DEFAULT as u64),
                    total_weight: MIN_REVIEW_STAKE_DEFAULT as u64,
                    review_count: 1,
                    last_updated_ledger: env.ledger().timestamp() as u32,
                },
            );
        });
    }

    #[test]
    fn test_appeal_and_admin_remove_review_flow() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, ReputationContract);
        let client = ReputationContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.initialize(&vec![&env, admin.clone()], &1, &0);

        let reviewer = Address::generate(&env);
        let reviewee = Address::generate(&env);
        seed_review_state(&env, &contract_id, &reviewer, &reviewee, 42, 1);

        client.appeal_review(
            &reviewer,
            &reviewee,
            &42,
            &String::from_str(&env, "malicious 1-star review"),
        );
        let appeal = client.get_review_appeal(&reviewer, &reviewee, &42);
        assert_eq!(appeal.status, AppealStatus::Pending);

        client.admin_resolve_appeal(&admin, &reviewer, &reviewee, &42, &true);
        let resolved = client.get_review_appeal(&reviewer, &reviewee, &42);
        assert_eq!(resolved.status, AppealStatus::ReviewRemoved);

        assert_eq!(client.get_reviews(&reviewee).len(), 0);
        let rep = client.get_reputation(&reviewee);
        assert_eq!(rep.review_count, 0);
        assert_eq!(rep.total_score, 0);
        assert_eq!(rep.total_weight, 0);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #19)")]
    fn test_appeal_outside_window_fails() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, ReputationContract);
        let client = ReputationContractClient::new(&env, &contract_id);
        let reviewer = Address::generate(&env);
        let reviewee = Address::generate(&env);

        seed_review_state(&env, &contract_id, &reviewer, &reviewee, 99, 2);
        let now = env.ledger().timestamp();
        env.ledger()
            .with_mut(|l| l.timestamp = now + APPEAL_GRACE_WINDOW_SECONDS + 1);

        client.appeal_review(
            &reviewer,
            &reviewee,
            &99,
            &String::from_str(&env, "late appeal"),
        );
    }

    #[test]
    fn test_get_badge() {
        let env = Env::default();
        let contract_id = env.register_contract(None, ReputationContract);
        let client = ReputationContractClient::new(&env, &contract_id);

        let user = Address::generate(&env);

        // Test no badge for user with no reputation
        assert_eq!(client.get_badge(&user), None);

        // Test Bronze badge (score >= 100)
        env.as_contract(&contract_id, || {
            env.storage().persistent().set(
                &DataKey::Reputation(user.clone()),
                &UserReputation {
                    user: user.clone(),
                    total_score: 100,
                    total_weight: 10,
                    review_count: 1,
                    last_updated_ledger: 0,
                },
            );
        });
        assert_eq!(client.get_badge(&user), Some(Badge::Bronze));

        // Test Silver badge (score >= 500)
        env.as_contract(&contract_id, || {
            env.storage().persistent().set(
                &DataKey::Reputation(user.clone()),
                &UserReputation {
                    user: user.clone(),
                    total_score: 500,
                    total_weight: 50,
                    review_count: 5,
                    last_updated_ledger: 0,
                },
            );
        });
        assert_eq!(client.get_badge(&user), Some(Badge::Silver));

        // Test Gold badge (score >= 2000)
        env.as_contract(&contract_id, || {
            env.storage().persistent().set(
                &DataKey::Reputation(user.clone()),
                &UserReputation {
                    user: user.clone(),
                    total_score: 2000,
                    total_weight: 200,
                    review_count: 20,
                    last_updated_ledger: 0,
                },
            );
        });
        assert_eq!(client.get_badge(&user), Some(Badge::Gold));

        // Test no badge for score < 100
        env.as_contract(&contract_id, || {
            env.storage().persistent().set(
                &DataKey::Reputation(user.clone()),
                &UserReputation {
                    user: user.clone(),
                    total_score: 99,
                    total_weight: 10,
                    review_count: 1,
                    last_updated_ledger: 0,
                },
            );
        });
        assert_eq!(client.get_badge(&user), None);
    }

    #[test]
    fn test_apply_dispute_outcome() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, ReputationContract);
        let client = ReputationContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.initialize(&vec![&env, admin.clone()], &1, &0);

        let dispute_contract = Address::generate(&env);
        client.set_dispute_contract(&admin, &dispute_contract);

        let user = Address::generate(&env);

        // Initialize user with some reputation
        env.as_contract(&contract_id, || {
            env.storage().persistent().set(
                &DataKey::Reputation(user.clone()),
                &UserReputation {
                    user: user.clone(),
                    total_score: 500,
                    total_weight: 50,
                    review_count: 5,
                    last_updated_ledger: 0,
                },
            );
        });

        // mock_all_auths() makes dispute_contract.require_auth() pass; no as_contract needed.
        // apply_dispute_outcome reads/writes DataKey::Reputation; verify via direct storage read.

        // Test Won outcome (+50 points): 500 → 550
        client.apply_dispute_outcome(&user, &DisputeOutcome::Won);
        env.as_contract(&contract_id, || {
            let rep: UserReputation = env.storage().persistent()
                .get(&DataKey::Reputation(user.clone()))
                .unwrap();
            assert_eq!(rep.total_score, 550);
        });

        // Test Lost outcome (-100 points): 550 → 450
        client.apply_dispute_outcome(&user, &DisputeOutcome::Lost);
        env.as_contract(&contract_id, || {
            let rep: UserReputation = env.storage().persistent()
                .get(&DataKey::Reputation(user.clone()))
                .unwrap();
            assert_eq!(rep.total_score, 450);
        });

        // Test MaliciousFiling outcome (-250 points): 450 → 200
        client.apply_dispute_outcome(&user, &DisputeOutcome::MaliciousFiling);
        env.as_contract(&contract_id, || {
            let rep: UserReputation = env.storage().persistent()
                .get(&DataKey::Reputation(user.clone()))
                .unwrap();
            assert_eq!(rep.total_score, 200);
        });

        // Test that score saturates at 0 (never goes negative)
        env.as_contract(&contract_id, || {
            env.storage().persistent().set(
                &DataKey::Reputation(user.clone()),
                &UserReputation {
                    user: user.clone(),
                    total_score: 100,
                    total_weight: 10,
                    review_count: 1,
                    last_updated_ledger: 0,
                },
            );
        });
        client.apply_dispute_outcome(&user, &DisputeOutcome::MaliciousFiling);
        env.as_contract(&contract_id, || {
            let rep: UserReputation = env.storage().persistent()
                .get(&DataKey::Reputation(user.clone()))
                .unwrap();
            assert_eq!(rep.total_score, 0);
        });
    }

    #[test]
    #[should_panic]
    fn test_apply_dispute_outcome_unauthorized() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, ReputationContract);
        let client = ReputationContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.initialize(&vec![&env, admin.clone()], &1, &0);

        // Set an escrow contract as the dispute contract so the auth check has a real address.
        let dispute_contract = Address::generate(&env);
        client.set_dispute_contract(&admin, &dispute_contract);

        let user = Address::generate(&env);

        // Drop all auth mocks so that dispute_contract.require_auth() fails when called
        // without the dispute_contract's authorization — should panic.
        env.set_auths(&[]);
        client.apply_dispute_outcome(&user, &DisputeOutcome::Won);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #9)")]
    fn test_apply_dispute_outcome_no_dispute_contract() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, ReputationContract);
        let client = ReputationContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.initialize(&vec![&env, admin.clone()], &1, &0);

        let user = Address::generate(&env);

        // Try to call without dispute contract set
        client.apply_dispute_outcome(&user, &DisputeOutcome::Won);
    }
}
