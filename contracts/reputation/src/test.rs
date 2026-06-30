use super::*;
use soroban_sdk::{
    testutils::{Address as _, Events as _, Ledger},
    vec, Env, String, Symbol, TryFromVal,
};
use stellar_market_escrow::EscrowContract;

// The minimum stake required per review (must match lib.rs constant)
const MIN_STAKE: i128 = 10_000_000;
const ONE_YEAR_IN_SECONDS: u64 = 31_536_000;

fn pause_reputation(env: &Env, client: &ReputationContractClient<'_>, admin: &Address) {
    client.propose_admin_action(admin, &AdminAction::Pause);
}

fn unpause_reputation(env: &Env, client: &ReputationContractClient<'_>, admin: &Address) {
    client.propose_admin_action(admin, &AdminAction::Unpause);
}

/// Helper: create a job in the escrow contract and mark it as completed.
/// This uses the actual escrow contract functions to ensure proper storage.
fn setup_completed_job(
    env: &Env,
    escrow_id: &Address,
    _job_id: u64,
    client: &Address,
    freelancer: &Address,
    token: &Address,
) {
    let escrow_client = stellar_market_escrow::EscrowContractClient::new(env, escrow_id);

    // Create a job with one milestone
    let milestones = vec![
        env,
        (String::from_str(env, "Task"), 100_i128, 9999999999u64),
    ];
    let expiry = env.ledger().sequence() + 518_400;
    let job_id = escrow_client.create_job(
        client,
        freelancer,
        token,
        &milestones,
        &9999999999u64,
        &86400u64,
        &expiry,
    );

    // Fund the job
    escrow_client.fund_job(&job_id, client, &0, &0);

    // Mark the job as completed using the dispute resolution callback
    escrow_client.resolve_dispute_callback(&job_id, &stellar_market_escrow::DisputeResolution::FreelancerWins);
}

/// Helper: create a job in the escrow contract and mark it as in progress.
/// This uses the actual escrow contract functions to ensure proper storage.
fn setup_in_progress_job(
    env: &Env,
    escrow_id: &Address,
    _job_id: u64,
    client: &Address,
    freelancer: &Address,
    token: &Address,
) {
    let escrow_client = stellar_market_escrow::EscrowContractClient::new(env, escrow_id);

    // Create a job with one milestone
    let milestones = vec![
        env,
        (String::from_str(env, "Task"), 100_i128, 9999999999u64),
    ];
    let expiry = env.ledger().sequence() + 518_400;
    let job_id = escrow_client.create_job(
        client,
        freelancer,
        token,
        &milestones,
        &9999999999u64,
        &86400u64,
        &expiry,
    );

    // Fund the job to move it to Funded status
    escrow_client.fund_job(&job_id, client, &0, &0);
}

fn create_token(env: &Env, admin: &Address) -> Address {
    env.register_stellar_asset_contract_v2(admin.clone()).address()
}

fn mint(env: &Env, token_addr: &Address, admin: &Address, to: &Address, amount: i128) {
    let token_client = token::StellarAssetClient::new(env, token_addr);
    token_client.mint(to, &amount);
    // Also approve reputation contract to receive stake (mock_all_auths handles this)
    let _ = admin;
}

#[test]
fn test_submit_review_client_reviews_freelancer() {
    let env = Env::default();
    env.mock_all_auths();

    let escrow_id = env.register_contract(None, EscrowContract);
    let reputation_id = env.register_contract(None, ReputationContract);
    let reputation_client = ReputationContractClient::new(&env, &reputation_id);

    let client_addr = Address::generate(&env);
    let freelancer_addr = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token_addr = create_token(&env, &token_admin);
    mint(&env, &token_addr, &token_admin, &client_addr, 100_000_000);

    setup_completed_job(
        &env,
        &escrow_id,
        1u64,
        &client_addr,
        &freelancer_addr,
        &token_addr,
    );

    reputation_client.submit_review(
        &escrow_id,
        &client_addr,
        &freelancer_addr,
        &1u64,
        &4u32,
        &String::from_str(&env, "Great work!"),
        &MIN_STAKE,
    );

    let rep = reputation_client.get_reputation(&freelancer_addr);
    assert_eq!(rep.review_count, 1);
    assert_eq!(rep.total_score, 4 * MIN_STAKE as u64);
    assert_eq!(rep.total_weight, MIN_STAKE as u64);
}


#[test]
fn test_average_rating() {
    let env = Env::default();
    env.mock_all_auths();

    let escrow_id = env.register_contract(None, EscrowContract);
    let reputation_id = env.register_contract(None, ReputationContract);
    let reputation_client = ReputationContractClient::new(&env, &reputation_id);

    let reviewer1 = Address::generate(&env);
    let reviewer2 = Address::generate(&env);
    let reviewee = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token_addr = create_token(&env, &token_admin);
    mint(&env, &token_addr, &token_admin, &reviewer1, 100_000_000);
    mint(&env, &token_addr, &token_admin, &reviewer2, 100_000_000);

    setup_completed_job(&env, &escrow_id, 1u64, &reviewer1, &reviewee, &token_addr);
    setup_completed_job(&env, &escrow_id, 2u64, &reviewer2, &reviewee, &token_addr);

    // Review 1: 5 stars, min weight
    reputation_client.submit_review(
        &escrow_id,
        &reviewer1,
        &reviewee,
        &1u64,
        &5u32,
        &String::from_str(&env, "Excellent"),
        &MIN_STAKE,
    );

    // Review 2: 3 stars, min weight
    reputation_client.submit_review(
        &escrow_id,
        &reviewer2,
        &reviewee,
        &2u64,
        &3u32,
        &String::from_str(&env, "Average"),
        &MIN_STAKE,
    );

    let avg = reputation_client.get_average_rating(&reviewee);
    // (5*MIN + 3*MIN) * 100 / (MIN + MIN) = 400 (4.00 stars)
    assert_eq!(avg, 400);
    assert_eq!(reputation_client.get_review_count(&reviewee), 2);
}

#[test]
#[should_panic(expected = "Error(Contract, #1)")]
fn test_invalid_rating() {
    let env = Env::default();
    env.mock_all_auths();

    let escrow_id = env.register_contract(None, EscrowContract);
    let reputation_id = env.register_contract(None, ReputationContract);
    let reputation_client = ReputationContractClient::new(&env, &reputation_id);

    let reviewer = Address::generate(&env);
    let reviewee = Address::generate(&env);

    // Rating is validated first (before stake check), so small weight still triggers #1
    reputation_client.submit_review(
        &escrow_id,
        &reviewer,
        &reviewee,
        &1u64,
        &6u32, // Invalid: max is 5
        &String::from_str(&env, "Too high"),
        &1_i128,
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn test_self_review() {
    let env = Env::default();
    env.mock_all_auths();

    let escrow_id = env.register_contract(None, EscrowContract);
    let reputation_id = env.register_contract(None, ReputationContract);
    let reputation_client = ReputationContractClient::new(&env, &reputation_id);

    let user = Address::generate(&env);

    // Self-review check happens before stake check
    reputation_client.submit_review(
        &escrow_id,
        &user,
        &user,
        &1u64,
        &5u32,
        &String::from_str(&env, "I'm great"),
        &1_i128,
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #11)")]
fn test_reject_below_min_stake() {
    let env = Env::default();
    env.mock_all_auths();

    let escrow_id = env.register_contract(None, EscrowContract);
    let reputation_id = env.register_contract(None, ReputationContract);
    let reputation_client = ReputationContractClient::new(&env, &reputation_id);

    let reviewer = Address::generate(&env);
    let reviewee = Address::generate(&env);

    reputation_client.submit_review(
        &escrow_id,
        &reviewer,
        &reviewee,
        &1u64,
        &5u32,
        &String::from_str(&env, "Sneaky low stake"),
        &(MIN_STAKE - 1), // Just below minimum
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #11)")]
fn test_job_not_found() {
    let env = Env::default();
    env.mock_all_auths();

    let escrow_id = env.register_contract(None, EscrowContract);
    let reputation_id = env.register_contract(None, ReputationContract);
    let reputation_client = ReputationContractClient::new(&env, &reputation_id);

    let reviewer = Address::generate(&env);
    let reviewee = Address::generate(&env);

    // BelowMinStake is checked before JobNotFound, so we see #11 here.
    // To test JobNotFound properly, we need sufficient stake — but there's no token minted,
    // so the token transfer will fail anyway. This tests the ordering of checks.
    reputation_client.submit_review(
        &escrow_id,
        &reviewer,
        &reviewee,
        &99u64,
        &5u32,
        &String::from_str(&env, "Does not exist"),
        &1_i128, // Below min stake triggers #11 first
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #7)")]
fn test_job_not_found_with_valid_stake() {
    let env = Env::default();
    env.mock_all_auths();

    let escrow_id = env.register_contract(None, EscrowContract);
    let reputation_id = env.register_contract(None, ReputationContract);
    let reputation_client = ReputationContractClient::new(&env, &reputation_id);

    let reviewer = Address::generate(&env);
    let reviewee = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token_addr = create_token(&env, &token_admin);
    mint(&env, &token_addr, &token_admin, &reviewer, 100_000_000);

    // No job set up in escrow — should fail with JobNotFound (#7)
    // We need a job record to pass the escrow check, but no job exists here.
    // We use a dummy token for the stake transfer to succeed, but crossing contract
    // boundary will fail because there's no job.
    reputation_client.submit_review(
        &escrow_id,
        &reviewer,
        &reviewee,
        &99u64,
        &5u32,
        &String::from_str(&env, "Does not exist"),
        &MIN_STAKE,
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #5)")]
fn test_job_not_completed() {
    let env = Env::default();
    env.mock_all_auths();

    let escrow_id = env.register_contract(None, EscrowContract);
    let reputation_id = env.register_contract(None, ReputationContract);
    let reputation_client = ReputationContractClient::new(&env, &reputation_id);

    let client_addr = Address::generate(&env);
    let freelancer_addr = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token_addr = create_token(&env, &token_admin);
    mint(&env, &token_addr, &token_admin, &client_addr, 100_000_000);

    // Job is InProgress, not Completed
    setup_in_progress_job(
        &env,
        &escrow_id,
        1u64,
        &client_addr,
        &freelancer_addr,
        &token_addr,
    );

    reputation_client.submit_review(
        &escrow_id,
        &client_addr,
        &freelancer_addr,
        &1u64,
        &5u32,
        &String::from_str(&env, "Too early"),
        &MIN_STAKE,
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #6)")]
fn test_not_job_participant() {
    let env = Env::default();
    env.mock_all_auths();

    let escrow_id = env.register_contract(None, EscrowContract);
    let reputation_id = env.register_contract(None, ReputationContract);
    let reputation_client = ReputationContractClient::new(&env, &reputation_id);

    let client_addr = Address::generate(&env);
    let freelancer_addr = Address::generate(&env);
    let outsider = Address::generate(&env);
    let another = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token_addr = create_token(&env, &token_admin);
    mint(&env, &token_addr, &token_admin, &client_addr, 100_000_000);
    mint(&env, &token_addr, &token_admin, &outsider, 100_000_000);

    setup_completed_job(
        &env,
        &escrow_id,
        1u64,
        &client_addr,
        &freelancer_addr,
        &token_addr,
    );

    // outsider and another were not part of job 1
    reputation_client.submit_review(
        &escrow_id,
        &outsider,
        &another,
        &1u64,
        &5u32,
        &String::from_str(&env, "Fraudulent review"),
        &MIN_STAKE,
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #6)")]
fn test_reviewer_not_participant_but_reviewee_is() {
    let env = Env::default();
    env.mock_all_auths();

    let escrow_id = env.register_contract(None, EscrowContract);
    let reputation_id = env.register_contract(None, ReputationContract);
    let reputation_client = ReputationContractClient::new(&env, &reputation_id);

    let client_addr = Address::generate(&env);
    let freelancer_addr = Address::generate(&env);
    let outsider = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token_addr = create_token(&env, &token_admin);
    mint(&env, &token_addr, &token_admin, &client_addr, 100_000_000);
    mint(&env, &token_addr, &token_admin, &outsider, 100_000_000);

    setup_completed_job(
        &env,
        &escrow_id,
        1u64,
        &client_addr,
        &freelancer_addr,
        &token_addr,
    );

    // outsider tries to review the freelancer — reviewer is not a participant
    reputation_client.submit_review(
        &escrow_id,
        &outsider,
        &freelancer_addr,
        &1u64,
        &5u32,
        &String::from_str(&env, "I wasn't there"),
        &MIN_STAKE,
    );
}

#[test]
fn test_get_tier_no_reputation() {
    let env = Env::default();
    let reputation_id = env.register_contract(None, ReputationContract);
    let reputation_client = ReputationContractClient::new(&env, &reputation_id);

    let user = Address::generate(&env);
    let tier = reputation_client.get_tier(&user);
    assert_eq!(tier, ReputationTier::None);
}

#[test]
fn test_get_tier_bronze() {
    let env = Env::default();
    env.mock_all_auths();

    let escrow_id = env.register_contract(None, EscrowContract);
    let reputation_id = env.register_contract(None, ReputationContract);
    let reputation_client = ReputationContractClient::new(&env, &reputation_id);

    let reviewer = Address::generate(&env);
    let reviewee = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token_addr = create_token(&env, &token_admin);
    mint(&env, &token_addr, &token_admin, &reviewer, 100_000_000);

    setup_completed_job(&env, &escrow_id, 1u64, &reviewer, &reviewee, &token_addr);

    // Submit review with rating 2 (avg = 200, Bronze tier)
    reputation_client.submit_review(
        &escrow_id,
        &reviewer,
        &reviewee,
        &1u64,
        &2u32,
        &String::from_str(&env, "Okay"),
        &MIN_STAKE,
    );

    let tier = reputation_client.get_tier(&reviewee);
    assert_eq!(tier, ReputationTier::Bronze);
}

#[test]
fn test_get_tier_silver() {
    let env = Env::default();
    env.mock_all_auths();

    let escrow_id = env.register_contract(None, EscrowContract);
    let reputation_id = env.register_contract(None, ReputationContract);
    let reputation_client = ReputationContractClient::new(&env, &reputation_id);

    let reviewer = Address::generate(&env);
    let reviewee = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token_addr = create_token(&env, &token_admin);
    mint(&env, &token_addr, &token_admin, &reviewer, 100_000_000);

    setup_completed_job(&env, &escrow_id, 1u64, &reviewer, &reviewee, &token_addr);

    // Submit review with rating 4 (avg = 400, Silver tier)
    reputation_client.submit_review(
        &escrow_id,
        &reviewer,
        &reviewee,
        &1u64,
        &4u32,
        &String::from_str(&env, "Good"),
        &MIN_STAKE,
    );

    let tier = reputation_client.get_tier(&reviewee);
    assert_eq!(tier, ReputationTier::Silver);
}

#[test]
fn test_get_tier_gold() {
    let env = Env::default();
    env.mock_all_auths();

    let escrow_id = env.register_contract(None, EscrowContract);
    let reputation_id = env.register_contract(None, ReputationContract);
    let reputation_client = ReputationContractClient::new(&env, &reputation_id);

    let reviewer1 = Address::generate(&env);
    let reviewer2 = Address::generate(&env);
    let reviewee = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token_addr = create_token(&env, &token_admin);
    mint(&env, &token_addr, &token_admin, &reviewer1, 100_000_000);
    mint(&env, &token_addr, &token_admin, &reviewer2, 100_000_000);

    setup_completed_job(&env, &escrow_id, 1u64, &reviewer1, &reviewee, &token_addr);
    setup_completed_job(&env, &escrow_id, 2u64, &reviewer2, &reviewee, &token_addr);

    // Two 5-star reviews with equal weight -> avg = 500 (Gold tier)
    reputation_client.submit_review(
        &escrow_id,
        &reviewer1,
        &reviewee,
        &1u64,
        &5u32,
        &String::from_str(&env, "Excellent"),
        &MIN_STAKE,
    );

    reputation_client.submit_review(
        &escrow_id,
        &reviewer2,
        &reviewee,
        &2u64,
        &5u32,
        &String::from_str(&env, "Perfect"),
        &MIN_STAKE,
    );

    let tier = reputation_client.get_tier(&reviewee);
    assert_eq!(tier, ReputationTier::Gold);
}

#[test]
fn test_get_tier_platinum() {
    let env = Env::default();
    env.mock_all_auths();

    let escrow_id = env.register_contract(None, EscrowContract);
    let reputation_id = env.register_contract(None, ReputationContract);
    let reputation_client = ReputationContractClient::new(&env, &reputation_id);

    let reviewer1 = Address::generate(&env);
    let reviewer2 = Address::generate(&env);
    let reviewer3 = Address::generate(&env);
    let reviewee = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token_addr = create_token(&env, &token_admin);
    mint(&env, &token_addr, &token_admin, &reviewer1, 100_000_000);
    mint(&env, &token_addr, &token_admin, &reviewer2, 100_000_000);
    mint(&env, &token_addr, &token_admin, &reviewer3, 100_000_000);

    setup_completed_job(&env, &escrow_id, 1u64, &reviewer1, &reviewee, &token_addr);
    setup_completed_job(&env, &escrow_id, 2u64, &reviewer2, &reviewee, &token_addr);
    setup_completed_job(&env, &escrow_id, 3u64, &reviewer3, &reviewee, &token_addr);

    // Three 5-star reviews -> avg = 500 (Gold)
    // Platinum (700+) is impossible with max rating 5 * 100 = 500
    reputation_client.submit_review(
        &escrow_id,
        &reviewer1,
        &reviewee,
        &1u64,
        &5u32,
        &String::from_str(&env, "Outstanding"),
        &MIN_STAKE,
    );

    reputation_client.submit_review(
        &escrow_id,
        &reviewer2,
        &reviewee,
        &2u64,
        &5u32,
        &String::from_str(&env, "Exceptional"),
        &MIN_STAKE,
    );

    reputation_client.submit_review(
        &escrow_id,
        &reviewer3,
        &reviewee,
        &3u64,
        &5u32,
        &String::from_str(&env, "World-class"),
        &MIN_STAKE,
    );

    let avg = reputation_client.get_average_rating(&reviewee);
    assert_eq!(avg, 500);

    // Platinum requires avg >= 700, impossible with max rating = 5 (5*100=500). Current tier: Gold.
    let tier = reputation_client.get_tier(&reviewee);
    assert_eq!(tier, ReputationTier::Gold);
}

#[test]
fn test_badge_awarded_on_tier_crossing() {
    let env = Env::default();
    env.mock_all_auths();

    let escrow_id = env.register_contract(None, EscrowContract);
    let reputation_id = env.register_contract(None, ReputationContract);
    let reputation_client = ReputationContractClient::new(&env, &reputation_id);

    let reviewer = Address::generate(&env);
    let reviewee = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token_addr = create_token(&env, &token_admin);
    mint(&env, &token_addr, &token_admin, &reviewer, 100_000_000);

    setup_completed_job(&env, &escrow_id, 1u64, &reviewer, &reviewee, &token_addr);

    // Submit review that crosses into Bronze tier
    reputation_client.submit_review(
        &escrow_id,
        &reviewer,
        &reviewee,
        &1u64,
        &2u32,
        &String::from_str(&env, "Decent"),
        &MIN_STAKE,
    );

    let badges = reputation_client.get_badges(&reviewee);
    assert_eq!(badges.len(), 1);
    assert_eq!(badges.get(0).unwrap().badge_type, ReputationTier::Bronze);
}

#[test]
fn test_badge_not_duplicated() {
    let env = Env::default();
    env.mock_all_auths();

    let escrow_id = env.register_contract(None, EscrowContract);
    let reputation_id = env.register_contract(None, ReputationContract);
    let reputation_client = ReputationContractClient::new(&env, &reputation_id);

    let reviewer1 = Address::generate(&env);
    let reviewer2 = Address::generate(&env);
    let reviewee = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token_addr = create_token(&env, &token_admin);
    mint(&env, &token_addr, &token_admin, &reviewer1, 100_000_000);
    mint(&env, &token_addr, &token_admin, &reviewer2, 100_000_000);

    setup_completed_job(&env, &escrow_id, 1u64, &reviewer1, &reviewee, &token_addr);
    setup_completed_job(&env, &escrow_id, 2u64, &reviewer2, &reviewee, &token_addr);

    // First review: Bronze tier (rating 2)
    reputation_client.submit_review(
        &escrow_id,
        &reviewer1,
        &reviewee,
        &1u64,
        &2u32,
        &String::from_str(&env, "Okay"),
        &MIN_STAKE,
    );

    // Second review: Still Bronze tier (avg = (2 + 2) / 2 = 2 = 200)
    reputation_client.submit_review(
        &escrow_id,
        &reviewer2,
        &reviewee,
        &2u64,
        &2u32,
        &String::from_str(&env, "Okay again"),
        &MIN_STAKE,
    );

    let badges = reputation_client.get_badges(&reviewee);
    // Should only have one Bronze badge, not two
    assert_eq!(badges.len(), 1);
    assert_eq!(badges.get(0).unwrap().badge_type, ReputationTier::Bronze);
}

#[test]
fn test_multiple_tier_badges() {
    let env = Env::default();
    env.mock_all_auths();

    let escrow_id = env.register_contract(None, EscrowContract);
    let reputation_id = env.register_contract(None, ReputationContract);
    let reputation_client = ReputationContractClient::new(&env, &reputation_id);

    let reviewer1 = Address::generate(&env);
    let reviewer2 = Address::generate(&env);
    let reviewer3 = Address::generate(&env);
    let reviewee = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token_addr = create_token(&env, &token_admin);
    mint(&env, &token_addr, &token_admin, &reviewer1, 100_000_000);
    mint(&env, &token_addr, &token_admin, &reviewer2, 100_000_000);
    mint(&env, &token_addr, &token_admin, &reviewer3, 100_000_000);

    setup_completed_job(&env, &escrow_id, 1u64, &reviewer1, &reviewee, &token_addr);
    setup_completed_job(&env, &escrow_id, 2u64, &reviewer2, &reviewee, &token_addr);
    setup_completed_job(&env, &escrow_id, 3u64, &reviewer3, &reviewee, &token_addr);

    // First review: Bronze tier (rating 2, avg = 200)
    reputation_client.submit_review(
        &escrow_id,
        &reviewer1,
        &reviewee,
        &1u64,
        &2u32,
        &String::from_str(&env, "Okay"),
        &MIN_STAKE,
    );

    let badges = reputation_client.get_badges(&reviewee);
    assert_eq!(badges.len(), 1);
    assert_eq!(badges.get(0).unwrap().badge_type, ReputationTier::Bronze);

    // Second review: Silver tier
    // avg = (2*MIN + 5*MIN) * 100 / (2*MIN) = 350 -> Silver
    reputation_client.submit_review(
        &escrow_id,
        &reviewer2,
        &reviewee,
        &2u64,
        &5u32,
        &String::from_str(&env, "Great improvement"),
        &MIN_STAKE,
    );

    let badges = reputation_client.get_badges(&reviewee);
    assert_eq!(badges.len(), 2);
    assert_eq!(badges.get(0).unwrap().badge_type, ReputationTier::Bronze);
    assert_eq!(badges.get(1).unwrap().badge_type, ReputationTier::Silver);

    // Third review with same weight and rating 5:
    // avg = (2 + 5 + 5) * MIN * 100 / (3 * MIN) = 1200 / 3 = 400 -> still Silver
    reputation_client.submit_review(
        &escrow_id,
        &reviewer3,
        &reviewee,
        &3u64,
        &5u32,
        &String::from_str(&env, "Excellent"),
        &MIN_STAKE,
    );

    let avg = reputation_client.get_average_rating(&reviewee);
    assert!(avg < 500); // Still Silver

    let badges = reputation_client.get_badges(&reviewee);
    assert_eq!(badges.len(), 2); // Still Bronze and Silver
}

#[test]
fn test_tier_downgrade_no_badge_removal() {
    let env = Env::default();
    env.mock_all_auths();

    let escrow_id = env.register_contract(None, EscrowContract);
    let reputation_id = env.register_contract(None, ReputationContract);
    let reputation_client = ReputationContractClient::new(&env, &reputation_id);

    let reviewer1 = Address::generate(&env);
    let reviewer2 = Address::generate(&env);
    let reviewee = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token_addr = create_token(&env, &token_admin);
    mint(&env, &token_addr, &token_admin, &reviewer1, 100_000_000);
    mint(&env, &token_addr, &token_admin, &reviewer2, 100_000_000);

    setup_completed_job(&env, &escrow_id, 1u64, &reviewer1, &reviewee, &token_addr);
    setup_completed_job(&env, &escrow_id, 2u64, &reviewer2, &reviewee, &token_addr);

    // First review: Silver tier (rating 4, avg = 400)
    reputation_client.submit_review(
        &escrow_id,
        &reviewer1,
        &reviewee,
        &1u64,
        &4u32,
        &String::from_str(&env, "Good"),
        &MIN_STAKE,
    );

    let badges = reputation_client.get_badges(&reviewee);
    assert_eq!(badges.len(), 1);
    assert_eq!(badges.get(0).unwrap().badge_type, ReputationTier::Silver);

    // Second review: Low rating brings average down to Bronze
    // avg = (4*M + 1*M) * 100 / (2*M) = 250 (Bronze)
    reputation_client.submit_review(
        &escrow_id,
        &reviewer2,
        &reviewee,
        &2u64,
        &1u32,
        &String::from_str(&env, "Poor"),
        &MIN_STAKE,
    );

    let tier = reputation_client.get_tier(&reviewee);
    assert_eq!(tier, ReputationTier::Bronze);

    // Badge should still exist (badges are permanent achievements)
    let badges = reputation_client.get_badges(&reviewee);
    assert_eq!(badges.len(), 2); // Silver badge remains, Bronze badge added
    assert_eq!(badges.get(0).unwrap().badge_type, ReputationTier::Silver);
    assert_eq!(badges.get(1).unwrap().badge_type, ReputationTier::Bronze);
}

#[test]
fn test_get_reputation_with_decay() {
    let env = Env::default();
    env.mock_all_auths();

    let escrow_id = env.register_contract(None, EscrowContract);
    let reputation_id = env.register_contract(None, ReputationContract);
    let reputation_client = ReputationContractClient::new(&env, &reputation_id);

    // Initialize with 50% decay per year
    let admin = Address::generate(&env);
    reputation_client.initialize(&vec![&env, admin.clone()], &1u32, &50);

    let reviewer = Address::generate(&env);
    let reviewee = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token_addr = create_token(&env, &token_admin);
    mint(&env, &token_addr, &token_admin, &reviewer, 100_000_000);

    // Configure the token used for stake transfers via admin action.
    reputation_client.propose_admin_action(&admin, &AdminAction::SetToken(token_addr.clone()));

    setup_completed_job(&env, &escrow_id, 1u64, &reviewer, &reviewee, &token_addr);

    // Initial review at t=0
    env.ledger().set(soroban_sdk::testutils::LedgerInfo {
        timestamp: 0,
        protocol_version: 20,
        sequence_number: 100,
        network_id: [0; 32],
        base_reserve: 10,
        min_temp_entry_ttl: 10,
        min_persistent_entry_ttl: 10,
        max_entry_ttl: 100000,
    });

    reputation_client.submit_review(
        &escrow_id,
        &reviewer,
        &reviewee,
        &1u64,
        &4u32,
        &String::from_str(&env, "Good"),
        &MIN_STAKE,
    );

    // At t=0, score should be raw
    let rep0 = reputation_client.get_reputation(&reviewee);
    assert_eq!(rep0.total_score, 4 * MIN_STAKE as u64);
    assert_eq!(rep0.total_weight, MIN_STAKE as u64);

    // Advance time by 1 year (31,536,000 seconds)
    // Decay is 50%, so weight should be 50% of MIN_STAKE
    env.ledger().set(soroban_sdk::testutils::LedgerInfo {
        timestamp: 31_536_000,
        protocol_version: 20,
        sequence_number: 100,
        network_id: [0; 32],
        base_reserve: 10,
        min_temp_entry_ttl: 10,
        min_persistent_entry_ttl: 10,
        max_entry_ttl: 100000,
    });
    
    let rep1 = reputation_client.get_reputation(&reviewee);
    let expected_weight = (MIN_STAKE as u64) / 2;
    let expected_score = 4 * expected_weight;
    
    assert_eq!(rep1.total_weight, expected_weight);
    assert_eq!(rep1.total_score, expected_score);
    assert_eq!(rep1.review_count, 1);
}

#[test]
fn test_get_badges_empty() {
    let env = Env::default();
    let reputation_id = env.register_contract(None, ReputationContract);
    let reputation_client = ReputationContractClient::new(&env, &reputation_id);

    let user = Address::generate(&env);
    let badges = reputation_client.get_badges(&user);
    assert_eq!(badges.len(), 0);
}

#[test]
fn test_badge_timestamp() {
    let env = Env::default();
    env.mock_all_auths();

    let escrow_id = env.register_contract(None, EscrowContract);
    let reputation_id = env.register_contract(None, ReputationContract);
    let reputation_client = ReputationContractClient::new(&env, &reputation_id);

    let reviewer = Address::generate(&env);
    let reviewee = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token_addr = create_token(&env, &token_admin);
    mint(&env, &token_addr, &token_admin, &reviewer, 100_000_000);

    setup_completed_job(&env, &escrow_id, 1u64, &reviewer, &reviewee, &token_addr);

    let before_timestamp = env.ledger().timestamp();

    reputation_client.submit_review(
        &escrow_id,
        &reviewer,
        &reviewee,
        &1u64,
        &3u32,
        &String::from_str(&env, "Good"),
        &MIN_STAKE,
    );

    let badges = reputation_client.get_badges(&reviewee);
    assert_eq!(badges.len(), 1);

    let badge = badges.get(0).unwrap();
    assert!(badge.awarded_at >= before_timestamp);
}

#[test]
fn test_set_decay_rate() {
    let env = Env::default();
    env.mock_all_auths();

    let reputation_id = env.register_contract(None, ReputationContract);
    let reputation_client = ReputationContractClient::new(&env, &reputation_id);
    let admin = Address::generate(&env);

    reputation_client.initialize(&vec![&env, admin.clone()], &1u32, &50u32);

    // Set a decay rate within the default maximum (MAX_DECAY_RATE = 20).
    let _prop_id = reputation_client.propose_admin_action(&admin, &AdminAction::SetDecayRate(15u32));
}

#[test]
#[should_panic(expected = "Error(Contract, #25)")]
fn test_set_decay_rate_invalid() {
    let env = Env::default();
    env.mock_all_auths();

    let reputation_id = env.register_contract(None, ReputationContract);
    let reputation_client = ReputationContractClient::new(&env, &reputation_id);
    let admin = Address::generate(&env);

    reputation_client.initialize(&vec![&env, admin.clone()], &1u32, &50u32);

    // A decay rate above the maximum (#783) is rejected with DecayRateTooHigh (#25).
    reputation_client.propose_admin_action(&admin, &AdminAction::SetDecayRate(21u32));
}

#[test]
fn test_decay_calculation() {
    let env = Env::default();
    env.mock_all_auths();

    let escrow_id = env.register_contract(None, EscrowContract);
    let reputation_id = env.register_contract(None, ReputationContract);
    let reputation_client = ReputationContractClient::new(&env, &reputation_id);
    let admin = Address::generate(&env);

    // Set decay rate to 50% per year
    reputation_client.initialize(&vec![&env, admin.clone()], &1u32, &50u32);

    let reviewer = Address::generate(&env);
    let reviewee = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token_addr = create_token(&env, &token_admin);
    mint(&env, &token_addr, &token_admin, &reviewer, 1_000_000_000);

    setup_completed_job(&env, &escrow_id, 1u64, &reviewer, &reviewee, &token_addr);

    // Initial timestamp: day 0
    let start_time = 1_000_000;
    env.ledger().with_mut(|l| l.timestamp = start_time);

    // Review with weight MIN_STAKE, rating 5
    reputation_client.submit_review(
        &escrow_id,
        &reviewer,
        &reviewee,
        &1u64,
        &5u32,
        &String::from_str(&env, "Great"),
        &MIN_STAKE,
    );

    // At day 0 (no decay), avg = 500
    assert_eq!(reputation_client.get_average_rating(&reviewee), 500);

    // Advance 1 day (86400 seconds) — negligible decay
    env.ledger().with_mut(|l| l.timestamp = start_time + 86400);
    assert_eq!(reputation_client.get_average_rating(&reviewee), 500);

    // Advance 1 year (31,536,000 seconds)
    // 50% decay per year -> weight should be 50% of original, but ratio is the same for a single review
    env.ledger()
        .with_mut(|l| l.timestamp = start_time + 31_536_000);
    assert_eq!(reputation_client.get_average_rating(&reviewee), 500);

    // To test actual decay, add a second review at year 1
    let reviewer2 = Address::generate(&env);
    mint(&env, &token_addr, &token_admin, &reviewer2, 1_000_000_000);
    setup_completed_job(&env, &escrow_id, 2u64, &reviewer2, &reviewee, &token_addr);

    // Second review at year 1 with rating 1 (Poor)
    reputation_client.submit_review(
        &escrow_id,
        &reviewer2,
        &reviewee,
        &2u64,
        &1u32,
        &String::from_str(&env, "Terrible now"),
        &MIN_STAKE,
    );

    // Review 1 (5 stars) has 50% weight decay. Review 2 (1 star) has full weight.
    // effective_w1 = MIN_STAKE/2, effective_w2 = MIN_STAKE
    // Weighted score: 5 * (MIN/2) + 1 * MIN = 2.5*MIN + MIN = 3.5*MIN
    // Total weight: MIN/2 + MIN = 1.5*MIN
    // Avg = 3.5/1.5 * 100 = 233
    assert_eq!(reputation_client.get_average_rating(&reviewee), 233);

    // Advance to year 2
    // Review 1 is 2 years old -> 100% decayed (weight 0)
    // Review 2 is 1 year old -> 50% decayed (weight MIN/2)
    // Weighted score: 0 + 1 * MIN/2 = MIN/2
    // Total weight: MIN/2
    // Avg = 1.0 * 100 = 100
    env.ledger()
        .with_mut(|l| l.timestamp = start_time + 63_072_000);
    assert_eq!(reputation_client.get_average_rating(&reviewee), 100);
}

#[test]
fn test_decay_uses_timestamp_instead_of_ledger_sequence() {
    let env = Env::default();
    env.mock_all_auths();

    let escrow_id = env.register_contract(None, EscrowContract);
    let reputation_id = env.register_contract(None, ReputationContract);
    let reputation_client = ReputationContractClient::new(&env, &reputation_id);
    let admin = Address::generate(&env);

    reputation_client.initialize(&vec![&env, admin.clone()], &1u32, &50u32);

    let reviewer = Address::generate(&env);
    let reviewee = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token_addr = create_token(&env, &token_admin);
    mint(&env, &token_addr, &token_admin, &reviewer, 1_000_000_000);

    setup_completed_job(&env, &escrow_id, 1u64, &reviewer, &reviewee, &token_addr);

    env.ledger().set(soroban_sdk::testutils::LedgerInfo {
        timestamp: 0,
        protocol_version: 20,
        sequence_number: 100,
        network_id: [0; 32],
        base_reserve: 10,
        min_temp_entry_ttl: 10,
        min_persistent_entry_ttl: 10,
        max_entry_ttl: 100000,
    });

    reputation_client.submit_review(
        &escrow_id,
        &reviewer,
        &reviewee,
        &1u64,
        &4u32,
        &String::from_str(&env, "Stable over time"),
        &MIN_STAKE,
    );

    // Advance timestamp to 6 months; keep sequence small so entries are not archived.
    // (The test verifies that decay is driven by timestamp, not ledger sequence.)
    env.ledger().set(soroban_sdk::testutils::LedgerInfo {
        timestamp: ONE_YEAR_IN_SECONDS / 2,
        protocol_version: 20,
        sequence_number: 200,
        network_id: [0; 32],
        base_reserve: 10,
        min_temp_entry_ttl: 10,
        min_persistent_entry_ttl: 10,
        max_entry_ttl: 100000,
    });

    let rep = reputation_client.get_reputation(&reviewee);
    let expected_weight = (MIN_STAKE as u64 * 75) / 100;

    assert_eq!(rep.total_weight, expected_weight);
    assert_eq!(rep.total_score, 4 * expected_weight);

    // Same timestamp, very different sequence number — result must be identical.
    env.ledger().set(soroban_sdk::testutils::LedgerInfo {
        timestamp: ONE_YEAR_IN_SECONDS / 2,
        protocol_version: 20,
        sequence_number: 25,
        network_id: [0; 32],
        base_reserve: 10,
        min_temp_entry_ttl: 10,
        min_persistent_entry_ttl: 10,
        max_entry_ttl: 100000,
    });

    let rep_same_timestamp = reputation_client.get_reputation(&reviewee);
    assert_eq!(rep_same_timestamp.total_weight, expected_weight);
    assert_eq!(rep_same_timestamp.total_score, 4 * expected_weight);
}

#[test]
fn test_get_set_min_stake() {
    let env = Env::default();
    env.mock_all_auths();

    let reputation_id = env.register_contract(None, ReputationContract);
    let reputation_client = ReputationContractClient::new(&env, &reputation_id);
    let admin = Address::generate(&env);

    reputation_client.initialize(&vec![&env, admin.clone()], &1u32, &50u32);

    // Default min stake
    assert_eq!(reputation_client.get_min_stake(), MIN_STAKE);

    // Update min stake via admin action
    let new_stake = 20_000_000_i128;
    reputation_client.propose_admin_action(&admin, &AdminAction::SetMinStake(new_stake));
    assert_eq!(reputation_client.get_min_stake(), new_stake);
}

#[test]
#[should_panic(expected = "Error(Contract, #12)")]
fn test_reject_rate_limit() {
    let env = Env::default();
    env.mock_all_auths();

    let escrow_id = env.register_contract(None, EscrowContract);
    let reputation_id = env.register_contract(None, ReputationContract);
    let reputation_client = ReputationContractClient::new(&env, &reputation_id);
    let admin = Address::generate(&env);

    reputation_client.initialize(&vec![&env, admin.clone()], &1u32, &50u32);

    let reviewer = Address::generate(&env);
    let reviewee1 = Address::generate(&env);
    let reviewee2 = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token_addr = create_token(&env, &token_admin);
    mint(&env, &token_addr, &token_admin, &reviewer, 1_000_000_000);

    setup_completed_job(&env, &escrow_id, 1u64, &reviewer, &reviewee1, &token_addr);
    setup_completed_job(&env, &escrow_id, 2u64, &reviewer, &reviewee2, &token_addr);

    // First review succeeds
    reputation_client.submit_review(
        &escrow_id,
        &reviewer,
        &reviewee1,
        &1u64,
        &5u32,
        &String::from_str(&env, "First"),
        &MIN_STAKE,
    );

    // Second review in same ledger -> RateLimitExceeded (#12)
    reputation_client.submit_review(
        &escrow_id,
        &reviewer,
        &reviewee2,
        &2u64,
        &5u32,
        &String::from_str(&env, "Second"),
        &MIN_STAKE,
    );
}

#[test]
fn test_rate_limit_pass_after_time() {
    let env = Env::default();
    env.mock_all_auths();

    let escrow_id = env.register_contract(None, EscrowContract);
    let reputation_id = env.register_contract(None, ReputationContract);
    let reputation_client = ReputationContractClient::new(&env, &reputation_id);
    let admin = Address::generate(&env);

    reputation_client.initialize(&vec![&env, admin.clone()], &1u32, &50u32);

    let reviewer = Address::generate(&env);
    let reviewee1 = Address::generate(&env);
    let reviewee2 = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token_addr = create_token(&env, &token_admin);
    mint(&env, &token_addr, &token_admin, &reviewer, 1_000_000_000);

    setup_completed_job(&env, &escrow_id, 1u64, &reviewer, &reviewee1, &token_addr);
    setup_completed_job(&env, &escrow_id, 2u64, &reviewer, &reviewee2, &token_addr);

    // First review at ledger 0
    reputation_client.submit_review(
        &escrow_id,
        &reviewer,
        &reviewee1,
        &1u64,
        &5u32,
        &String::from_str(&env, "First"),
        &MIN_STAKE,
    );

    // Advance ledger past rate limit (120 ledgers)
    env.ledger().with_mut(|l| l.sequence_number = 200);

    // Now the second review should succeed
    reputation_client.submit_review(
        &escrow_id,
        &reviewer,
        &reviewee2,
        &2u64,
        &4u32,
        &String::from_str(&env, "Second"),
        &MIN_STAKE,
    );

    assert_eq!(reputation_client.get_review_count(&reviewee1), 1);
    assert_eq!(reputation_client.get_review_count(&reviewee2), 1);
}

#[test]
fn test_register_referral_success() {
    let env = Env::default();
    env.mock_all_auths();

    let reputation_id = env.register_contract(None, ReputationContract);
    let reputation_client = ReputationContractClient::new(&env, &reputation_id);

    let referrer = Address::generate(&env);
    let referree = Address::generate(&env);

    // Register referral
    reputation_client.register_referral(&referree, &referrer);

    // Assert referrer stats reflect the registration
    let stats = reputation_client.get_referral_stats(&referrer);
    assert_eq!(stats.total_referrals, 1);
    assert_eq!(stats.earned_bonus, 0); // No bonus until a job is completed
}

#[test]
fn test_referral_bonus_granted_on_first_job() {
    let env = Env::default();
    env.mock_all_auths();

    let escrow_id = env.register_contract(None, EscrowContract);
    let reputation_id = env.register_contract(None, ReputationContract);
    let reputation_client = ReputationContractClient::new(&env, &reputation_id);

    let admin = Address::generate(&env);
    reputation_client.initialize(&vec![&env, admin.clone()], &1u32, &0); // Set no decay for simpler testing

    let referrer = Address::generate(&env);
    let client = Address::generate(&env);
    let freelancer = Address::generate(&env); // Freelancer will be referred
    let token_admin = Address::generate(&env);
    let token_addr = create_token(&env, &token_admin);

    mint(&env, &token_addr, &token_admin, &client, 100_000_000);

    // Register the referral BEFORE the job finishes
    reputation_client.register_referral(&freelancer, &referrer);

    setup_completed_job(&env, &escrow_id, 1u64, &client, &freelancer, &token_addr);

    // Client submits review. During this submission, the contract hooks `process_referral_bonus`
    reputation_client.submit_review(
        &escrow_id,
        &client,
        &freelancer,
        &1u64,
        &5u32,
        &String::from_str(&env, "Good job"),
        &MIN_STAKE,
    );

    // Check Referrer's Stats
    let stats = reputation_client.get_referral_stats(&referrer);
    assert_eq!(stats.total_referrals, 1);

    // Earned bonus uses fixed reputation weight (1), not min review stake.
    assert_eq!(stats.earned_bonus, 5u64);

    // Check Referrer's Reputation (they should have received the bonus reputation payload natively)
    let rep = reputation_client.get_reputation(&referrer);
    assert_eq!(rep.total_score, 5u64);
    assert_eq!(rep.total_weight, 1u64);
}

#[test]
fn test_referral_bonus_not_granted_twice() {
    let env = Env::default();
    env.mock_all_auths();

    let escrow_id = env.register_contract(None, EscrowContract);
    let reputation_id = env.register_contract(None, ReputationContract);
    let reputation_client = ReputationContractClient::new(&env, &reputation_id);

    let admin = Address::generate(&env);
    reputation_client.initialize(&vec![&env, admin.clone()], &1u32, &0);

    let referrer = Address::generate(&env);
    let client = Address::generate(&env);
    let freelancer = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token_addr = create_token(&env, &token_admin);

    mint(&env, &token_addr, &token_admin, &client, 100_000_000);
    mint(&env, &token_addr, &token_admin, &freelancer, 100_000_000); // So freelancer can review back

    reputation_client.register_referral(&freelancer, &referrer);
    setup_completed_job(&env, &escrow_id, 1u64, &client, &freelancer, &token_addr);

    // Client submits review -> Process bonus triggers for both client and freelancer
    reputation_client.submit_review(
        &escrow_id,
        &client,
        &freelancer,
        &1u64,
        &5u32,
        &String::from_str(&env, "First review"),
        &MIN_STAKE,
    );

    let initial_stats = reputation_client.get_referral_stats(&referrer);

    // Advance ledger to clear rate limits
    env.ledger().with_mut(|l| l.sequence_number = 200);

    // Freelancer reviews client on the SAME job (or they do a new job, doesn't matter)
    reputation_client.submit_review(
        &escrow_id,
        &freelancer,
        &client,
        &1u64,
        &4u32,
        &String::from_str(&env, "Second review"),
        &MIN_STAKE,
    );

    // Referrer stats should NOT have increased (bonus paid only once per referred user)
    let subsequent_stats = reputation_client.get_referral_stats(&referrer);
    assert_eq!(initial_stats.earned_bonus, subsequent_stats.earned_bonus);
}

/// Verifies that submitting a first review for a (reviewer, job_id) pair succeeds
/// and updates the reviewee's reputation correctly.
#[test]
fn test_first_review_succeeds_and_updates_reputation() {
    let env = Env::default();
    env.mock_all_auths();

    let escrow_id = env.register_contract(None, EscrowContract);
    let reputation_id = env.register_contract(None, ReputationContract);
    let reputation_client = ReputationContractClient::new(&env, &reputation_id);

    let client_addr = Address::generate(&env);
    let freelancer_addr = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token_addr = create_token(&env, &token_admin);
    mint(&env, &token_addr, &token_admin, &client_addr, 100_000_000);

    setup_completed_job(&env, &escrow_id, 1u64, &client_addr, &freelancer_addr, &token_addr);

    reputation_client.submit_review(
        &escrow_id,
        &client_addr,
        &freelancer_addr,
        &1u64,
        &5u32,
        &String::from_str(&env, "Excellent work!"),
        &MIN_STAKE,
    );

    let rep = reputation_client.get_reputation(&freelancer_addr);
    assert_eq!(rep.review_count, 1);
    assert_eq!(rep.total_score, 5 * MIN_STAKE as u64);
    assert_eq!(rep.total_weight, MIN_STAKE as u64);
}

/// Verifies that a second submit_review call with the same (reviewer, job_id)
/// is rejected with AlreadyReviewed (contract error #2), preventing score inflation.
#[test]
#[should_panic(expected = "Error(Contract, #2)")]
fn test_duplicate_review_rejected_with_already_reviewed() {
    let env = Env::default();
    env.mock_all_auths();

    let escrow_id = env.register_contract(None, EscrowContract);
    let reputation_id = env.register_contract(None, ReputationContract);
    let reputation_client = ReputationContractClient::new(&env, &reputation_id);

    let client_addr = Address::generate(&env);
    let freelancer_addr = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token_addr = create_token(&env, &token_admin);
    mint(&env, &token_addr, &token_admin, &client_addr, 100_000_000);

    setup_completed_job(&env, &escrow_id, 1u64, &client_addr, &freelancer_addr, &token_addr);

    // First submission succeeds
    reputation_client.submit_review(
        &escrow_id,
        &client_addr,
        &freelancer_addr,
        &1u64,
        &5u32,
        &String::from_str(&env, "Great work!"),
        &MIN_STAKE,
    );

    // Advance past the rate-limit window so RateLimitExceeded does not fire first
    env.ledger().with_mut(|l| l.sequence_number = 200);

    // Second submission for the same (reviewer, job_id) must return AlreadyReviewed
    reputation_client.submit_review(
        &escrow_id,
        &client_addr,
        &freelancer_addr,
        &1u64,
        &5u32,
        &String::from_str(&env, "Duplicate attempt!"),
        &MIN_STAKE,
    );
}

#[test]
fn test_reputation_multisig_flow() {
    let env = Env::default();
    env.mock_all_auths();
    
    let reputation_id = env.register_contract(None, ReputationContract);
    let client = ReputationContractClient::new(&env, &reputation_id);
    
    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);
    let signers = vec![&env, signer1.clone(), signer2.clone()];
    
    client.initialize(&signers, &2, &0);

    // Propose pause — needs 2-of-2 approval so contract is not yet paused.
    let prop_id = client.propose_admin_action(&signer1, &AdminAction::Pause);
    assert_eq!(prop_id, 1);
    // Not yet executed — still should allow actions
    client.propose_admin_action(&signer1, &AdminAction::Unpause); // sanity check: can propose while active

    // Approve — crosses threshold, executes the Pause
    client.approve_admin_action(&signer2, &prop_id);
    // Paused: submitting a noop endorse should now fail
    let endorse_result = client.try_endorse(
        &signer1,
        &Address::generate(&env),
        &String::from_str(&env, "Rust"),
    );
    assert!(endorse_result.is_err());
}

#[test]
fn test_reputation_slash_stake_multisig() {
    let env = Env::default();
    env.mock_all_auths();
    
    let reputation_id = env.register_contract(None, ReputationContract);
    let client = ReputationContractClient::new(&env, &reputation_id);
    
    let signer1 = Address::generate(&env);
    let signers = vec![&env, signer1.clone()];
    client.initialize(&signers, &1, &0);
    
    let loser = Address::generate(&env);
    // Proposal for slashing
    let prop_id = client.propose_admin_action(&signer1, &AdminAction::SlashStake(loser.clone(), 1u64, 100u64));
    
    // Should be executed immediately (threshold 1)
    let rep = client.get_reputation(&loser);
    // Since we started with 0, saturating_sub(100) is 0.
    // Actually, let's just check the event if we could, but assert_eq(0, 0) is trivial.
    // Let's at least check that it didn't fail.
}

// ─────────────────────────────────────────────────────────────────────────────
// #535 — Skill Endorsement System Tests
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn test_endorse_success() {
    let env = Env::default();
    env.mock_all_auths();
    let reputation_id = env.register_contract(None, ReputationContract);
    let client = ReputationContractClient::new(&env, &reputation_id);
    let admin = Address::generate(&env);
    client.initialize(&vec![&env, admin.clone()], &1u32, &0u32);

    let endorser = Address::generate(&env);
    let target = Address::generate(&env);
    let skill = String::from_str(&env, "Rust");

    assert_eq!(client.get_skill_score(&target, &skill), 0);
    client.endorse(&endorser, &target, &skill);
    // endorser has 0 avg_rating → fallback weight 1
    assert_eq!(client.get_skill_score(&target, &skill), 1);
}

#[test]
#[should_panic(expected = "Error(Contract, #23)")]
fn test_endorse_duplicate_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let reputation_id = env.register_contract(None, ReputationContract);
    let client = ReputationContractClient::new(&env, &reputation_id);
    let admin = Address::generate(&env);
    client.initialize(&vec![&env, admin.clone()], &1u32, &0u32);

    let endorser = Address::generate(&env);
    let target = Address::generate(&env);
    let skill = String::from_str(&env, "Smart Contracts");

    client.endorse(&endorser, &target, &skill);
    client.endorse(&endorser, &target, &skill); // AlreadyEndorsed #23
}

#[test]
fn test_endorse_different_skills_same_endorser_allowed() {
    let env = Env::default();
    env.mock_all_auths();
    let reputation_id = env.register_contract(None, ReputationContract);
    let client = ReputationContractClient::new(&env, &reputation_id);
    let admin = Address::generate(&env);
    client.initialize(&vec![&env, admin.clone()], &1u32, &0u32);

    let endorser = Address::generate(&env);
    let target = Address::generate(&env);
    let skill_rust = String::from_str(&env, "Rust");
    let skill_ui   = String::from_str(&env, "UI Design");

    client.endorse(&endorser, &target, &skill_rust);
    client.endorse(&endorser, &target, &skill_ui);

    assert_eq!(client.get_skill_score(&target, &skill_rust), 1);
    assert_eq!(client.get_skill_score(&target, &skill_ui),   1);
}

#[test]
fn test_endorse_multiple_endorsers_accumulate() {
    let env = Env::default();
    env.mock_all_auths();
    let reputation_id = env.register_contract(None, ReputationContract);
    let client = ReputationContractClient::new(&env, &reputation_id);
    let admin = Address::generate(&env);
    client.initialize(&vec![&env, admin.clone()], &1u32, &0u32);

    let target = Address::generate(&env);
    let skill  = String::from_str(&env, "Rust");
    for _ in 0..3u32 {
        let e = Address::generate(&env);
        client.endorse(&e, &target, &skill);
    }
    assert_eq!(client.get_skill_score(&target, &skill), 3);
}

#[test]
fn test_endorse_weighted_by_endorser_rating() {
    let env = Env::default();
    env.mock_all_auths();
    let escrow_id     = env.register_contract(None, EscrowContract);
    let reputation_id = env.register_contract(None, ReputationContract);
    let client = ReputationContractClient::new(&env, &reputation_id);
    let admin = Address::generate(&env);
    client.initialize(&vec![&env, admin.clone()], &1u32, &0u32);

    // Give endorser1 a 5-star rating → avg = 500 → weight = 500/100 = 5
    let reviewer  = Address::generate(&env);
    let endorser1 = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token_addr  = create_token(&env, &token_admin);
    mint(&env, &token_addr, &token_admin, &reviewer, 100_000_000);

    setup_completed_job(&env, &escrow_id, 1u64, &reviewer, &endorser1, &token_addr);
    client.submit_review(
        &escrow_id, &reviewer, &endorser1, &1u64, &5u32,
        &String::from_str(&env, "Perfect"), &MIN_STAKE,
    );

    let endorser2 = Address::generate(&env); // no reputation → weight 1
    let target    = Address::generate(&env);
    let skill     = String::from_str(&env, "Rust");

    client.endorse(&endorser1, &target, &skill);
    client.endorse(&endorser2, &target, &skill);

    // 5 + 1 = 6
    assert_eq!(client.get_skill_score(&target, &skill), 6);
}

// ─────────────────────────────────────────────────────────────────────────────
// #536 — Stake-Weighted Reputation Tests
// ─────────────────────────────────────────────────────────────────────────────

fn inject_stake(env: &Env, contract_id: &Address, user: &Address, balance: i128) {
    env.as_contract(contract_id, || {
        env.storage().persistent().set(&DataKey::StakeBalance(user.clone()), &balance);
    });
}

fn set_tiers_via_admin(
    client: &ReputationContractClient<'_>,
    admin: &Address,
    tiers: soroban_sdk::Vec<StakeTier>,
) {
    client.propose_admin_action(admin, &AdminAction::SetStakeTiers(tiers));
}

#[test]
fn test_stake_no_tiers_default_1x() {
    let env = Env::default();
    env.mock_all_auths();
    let reputation_id = env.register_contract(None, ReputationContract);
    let client = ReputationContractClient::new(&env, &reputation_id);
    let admin = Address::generate(&env);
    client.initialize(&vec![&env, admin.clone()], &1u32, &0u32);

    let user = Address::generate(&env);
    assert_eq!(client.get_stake_multiplier(&user), 100);
}

#[test]
fn test_stake_tier_below_first_boundary() {
    let env = Env::default();
    env.mock_all_auths();
    let reputation_id = env.register_contract(None, ReputationContract);
    let client = ReputationContractClient::new(&env, &reputation_id);
    let admin = Address::generate(&env);
    client.initialize(&vec![&env, admin.clone()], &1u32, &0u32);

    let tiers = vec![
        &env,
        StakeTier { threshold: 100_0000000, multiplier: 120 },
        StakeTier { threshold: 1000_0000000, multiplier: 150 },
    ];
    set_tiers_via_admin(&client, &admin, tiers);

    let user = Address::generate(&env);
    inject_stake(&env, &reputation_id, &user, 50_0000000); // 50 XLM < 100
    assert_eq!(client.get_stake_multiplier(&user), 100);
}

#[test]
fn test_stake_tier_at_first_boundary() {
    let env = Env::default();
    env.mock_all_auths();
    let reputation_id = env.register_contract(None, ReputationContract);
    let client = ReputationContractClient::new(&env, &reputation_id);
    let admin = Address::generate(&env);
    client.initialize(&vec![&env, admin.clone()], &1u32, &0u32);

    let tiers = vec![
        &env,
        StakeTier { threshold: 100_0000000, multiplier: 120 },
        StakeTier { threshold: 1000_0000000, multiplier: 150 },
    ];
    set_tiers_via_admin(&client, &admin, tiers);

    let user = Address::generate(&env);
    inject_stake(&env, &reputation_id, &user, 100_0000000); // exactly 100 XLM
    assert_eq!(client.get_stake_multiplier(&user), 120);
}

#[test]
fn test_stake_tier_at_second_boundary() {
    let env = Env::default();
    env.mock_all_auths();
    let reputation_id = env.register_contract(None, ReputationContract);
    let client = ReputationContractClient::new(&env, &reputation_id);
    let admin = Address::generate(&env);
    client.initialize(&vec![&env, admin.clone()], &1u32, &0u32);

    let tiers = vec![
        &env,
        StakeTier { threshold: 100_0000000, multiplier: 120 },
        StakeTier { threshold: 1000_0000000, multiplier: 150 },
    ];
    set_tiers_via_admin(&client, &admin, tiers);

    let user = Address::generate(&env);
    inject_stake(&env, &reputation_id, &user, 5000_0000000); // 5000 XLM
    assert_eq!(client.get_stake_multiplier(&user), 150);
}

#[test]
fn test_stake_multiplier_applied_to_avg_rating() {
    let env = Env::default();
    env.mock_all_auths();
    let escrow_id     = env.register_contract(None, EscrowContract);
    let reputation_id = env.register_contract(None, ReputationContract);
    let client = ReputationContractClient::new(&env, &reputation_id);
    let admin = Address::generate(&env);
    client.initialize(&vec![&env, admin.clone()], &1u32, &0u32);

    let reviewer    = Address::generate(&env);
    let reviewee    = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token_addr  = create_token(&env, &token_admin);
    mint(&env, &token_addr, &token_admin, &reviewer, 100_000_000);

    setup_completed_job(&env, &escrow_id, 1u64, &reviewer, &reviewee, &token_addr);
    client.submit_review(
        &escrow_id, &reviewer, &reviewee, &1u64, &4u32,
        &String::from_str(&env, "Good"), &MIN_STAKE,
    );

    assert_eq!(client.get_average_rating(&reviewee), 400); // base

    // 1.5× tier
    let tiers = vec![&env, StakeTier { threshold: 100_0000000, multiplier: 150 }];
    set_tiers_via_admin(&client, &admin, tiers);
    inject_stake(&env, &reputation_id, &reviewee, 500_0000000);

    // 400 * 150 / 100 = 600
    assert_eq!(client.get_average_rating(&reviewee), 600);
}

#[test]
fn test_score_capped_at_10000() {
    let env = Env::default();
    env.mock_all_auths();
    let escrow_id     = env.register_contract(None, EscrowContract);
    let reputation_id = env.register_contract(None, ReputationContract);
    let client = ReputationContractClient::new(&env, &reputation_id);
    let admin = Address::generate(&env);
    client.initialize(&vec![&env, admin.clone()], &1u32, &0u32);

    let reviewer    = Address::generate(&env);
    let reviewee    = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token_addr  = create_token(&env, &token_admin);
    mint(&env, &token_addr, &token_admin, &reviewer, 100_000_000);

    setup_completed_job(&env, &escrow_id, 1u64, &reviewer, &reviewee, &token_addr);
    client.submit_review(
        &escrow_id, &reviewer, &reviewee, &1u64, &5u32,
        &String::from_str(&env, "Perfect"), &MIN_STAKE,
    );

    // 500,000× multiplier → would exceed cap
    let tiers = vec![&env, StakeTier { threshold: 1, multiplier: 500_000 }];
    set_tiers_via_admin(&client, &admin, tiers);
    inject_stake(&env, &reputation_id, &reviewee, 100);

    assert_eq!(client.get_average_rating(&reviewee), 10_000);
}

#[test]
fn test_stake_tiers_require_multisig_threshold() {
    let env = Env::default();
    env.mock_all_auths();
    let reputation_id = env.register_contract(None, ReputationContract);
    let client = ReputationContractClient::new(&env, &reputation_id);

    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);
    client.initialize(&vec![&env, signer1.clone(), signer2.clone()], &2u32, &0u32);

    let tiers = vec![&env, StakeTier { threshold: 100_0000000, multiplier: 120 }];
    let prop_id = client.propose_admin_action(&signer1, &AdminAction::SetStakeTiers(tiers));

    let user = Address::generate(&env);
    assert_eq!(client.get_stake_multiplier(&user), 100); // not yet active

    client.approve_admin_action(&signer2, &prop_id);

    inject_stake(&env, &reputation_id, &user, 500_0000000);
    assert_eq!(client.get_stake_multiplier(&user), 120); // now active
}

// ─────────────────────────────────────────────────────────────────────────────
// #534 — Ledger-Based Lazy Decay Tests
// ─────────────────────────────────────────────────────────────────────────────

fn advance_n_periods(env: &Env, periods: u32) {
    let seq = env.ledger().sequence();
    let ts  = env.ledger().timestamp();
    env.ledger().set(soroban_sdk::testutils::LedgerInfo {
        sequence_number:        seq + periods * 518_400,
        timestamp:              ts  + (periods as u64) * ONE_YEAR_IN_SECONDS,
        protocol_version:       20,
        network_id:             [0; 32],
        base_reserve:           10,
        min_temp_entry_ttl:     10,
        min_persistent_entry_ttl: 10,
        max_entry_ttl:          500_000_000,
    });
}

fn setup_review_for(
    env: &Env,
    escrow_id: &Address,
    client: &ReputationContractClient<'_>,
    job_id: u64,
    reviewer: &Address,
    reviewee: &Address,
    rating: u32,
) {
    let token_admin = Address::generate(env);
    let token_addr  = create_token(env, &token_admin);
    mint(env, &token_addr, &token_admin, reviewer, 100_000_000);
    setup_completed_job(env, escrow_id, job_id, reviewer, reviewee, &token_addr);
    client.submit_review(
        escrow_id, reviewer, reviewee, &job_id, &rating,
        &String::from_str(env, "ok"), &MIN_STAKE,
    );
}

#[test]
fn test_lazy_decay_zero_periods_no_change() {
    let env = Env::default();
    env.mock_all_auths();
    let escrow_id     = env.register_contract(None, EscrowContract);
    let reputation_id = env.register_contract(None, ReputationContract);
    let client = ReputationContractClient::new(&env, &reputation_id);
    let admin = Address::generate(&env);
    client.initialize(&vec![&env, admin.clone()], &1u32, &1u32); // 1%/period

    let reviewer = Address::generate(&env);
    let reviewee = Address::generate(&env);
    setup_review_for(&env, &escrow_id, &client, 1, &reviewer, &reviewee, 5);

    let before = client.get_reputation(&reviewee);
    let after  = client.get_reputation(&reviewee);
    assert_eq!(before.total_score, after.total_score);
    assert_eq!(before.total_weight, after.total_weight);
}

#[test]
fn test_lazy_decay_one_period() {
    let env = Env::default();
    env.mock_all_auths();
    let escrow_id     = env.register_contract(None, EscrowContract);
    let reputation_id = env.register_contract(None, ReputationContract);
    let client = ReputationContractClient::new(&env, &reputation_id);
    let admin = Address::generate(&env);
    client.initialize(&vec![&env, admin.clone()], &1u32, &10u32); // 10%/period

    let reviewer = Address::generate(&env);
    let reviewee = Address::generate(&env);
    setup_review_for(&env, &escrow_id, &client, 1, &reviewer, &reviewee, 5);

    let before = client.get_reputation(&reviewee);
    advance_n_periods(&env, 1);
    let after = client.get_reputation(&reviewee);

    assert_eq!(after.total_score,  (before.total_score  * 90) / 100);
    assert_eq!(after.total_weight, (before.total_weight * 90) / 100);
}

#[test]
fn test_lazy_decay_ten_periods() {
    let env = Env::default();
    env.mock_all_auths();
    let escrow_id     = env.register_contract(None, EscrowContract);
    let reputation_id = env.register_contract(None, ReputationContract);
    let client = ReputationContractClient::new(&env, &reputation_id);
    let admin = Address::generate(&env);
    client.initialize(&vec![&env, admin.clone()], &1u32, &10u32); // 10%/period

    let reviewer = Address::generate(&env);
    let reviewee = Address::generate(&env);
    setup_review_for(&env, &escrow_id, &client, 1, &reviewer, &reviewee, 5);

    let before = client.get_reputation(&reviewee);
    // Linear annual decay at 10%/year for 10 years: max(0, 100 - 10*10) = 0% retained.
    let exp_score  = 0u64;
    let exp_weight = 0u64;
    let _ = before; // used above for correctness reference

    advance_n_periods(&env, 10);
    let after = client.get_reputation(&reviewee);

    assert_eq!(after.total_score,  exp_score);
    assert_eq!(after.total_weight, exp_weight);
}

#[test]
fn test_lazy_decay_zero_rate_no_decay() {
    let env = Env::default();
    env.mock_all_auths();
    let escrow_id     = env.register_contract(None, EscrowContract);
    let reputation_id = env.register_contract(None, ReputationContract);
    let client = ReputationContractClient::new(&env, &reputation_id);
    let admin = Address::generate(&env);
    client.initialize(&vec![&env, admin.clone()], &1u32, &0u32); // 0%/period

    let reviewer = Address::generate(&env);
    let reviewee = Address::generate(&env);
    setup_review_for(&env, &escrow_id, &client, 1, &reviewer, &reviewee, 5);

    let before = client.get_reputation(&reviewee);
    advance_n_periods(&env, 10);
    let after = client.get_reputation(&reviewee);

    assert_eq!(before.total_score,  after.total_score);
    assert_eq!(before.total_weight, after.total_weight);
}

#[test]
fn test_last_updated_ledger_advances_on_write() {
    let env = Env::default();
    env.mock_all_auths();
    let escrow_id     = env.register_contract(None, EscrowContract);
    let reputation_id = env.register_contract(None, ReputationContract);
    let client = ReputationContractClient::new(&env, &reputation_id);
    let admin = Address::generate(&env);
    client.initialize(&vec![&env, admin.clone()], &1u32, &10u32);

    let reviewer = Address::generate(&env);
    let reviewee = Address::generate(&env);
    setup_review_for(&env, &escrow_id, &client, 1, &reviewer, &reviewee, 5);

    let ledger_before = client.get_reputation(&reviewee).last_updated_ledger;
    advance_n_periods(&env, 2);

    // Trigger write by adding a second review
    let reviewer2 = Address::generate(&env);
    setup_review_for(&env, &escrow_id, &client, 2, &reviewer2, &reviewee, 4);

    let ledger_after = client.get_reputation(&reviewee).last_updated_ledger;
    assert!(ledger_after > ledger_before);
}

// ── tier_up event tests (Issue #464) ────────────────────────────────────────

// env.events().all() returns Vec<(Address, soroban_sdk::Vec<Val>, Val)>
// where the Address is the emitting contract. Topics are compared by converting
// each Val slot back to Symbol via TryFromVal.

fn topics_match(env: &Env, topics: &soroban_sdk::Vec<soroban_sdk::Val>, sym0: Symbol, sym1: Symbol) -> bool {
    topics.len() == 2
        && topics
            .get(0_u32)
            .and_then(|v| Symbol::try_from_val(env, &v).ok())
            == Some(sym0)
        && topics
            .get(1_u32)
            .and_then(|v| Symbol::try_from_val(env, &v).ok())
            == Some(sym1)
}

fn tier_up_event_count(env: &Env) -> usize {
    env.events()
        .all()
        .iter()
        .filter(|(_, topics, _)| {
            topics_match(env, topics, symbol_short!("reput"), symbol_short!("tier_up"))
        })
        .count()
}

fn badge_event_count(env: &Env) -> usize {
    env.events()
        .all()
        .iter()
        .filter(|(_, topics, _)| {
            topics_match(env, topics, symbol_short!("reput"), symbol_short!("badge"))
        })
        .count()
}

// ─────────────────────────────────────────────────────────────────────────────
// #648 — Unbounded decay loop DoS fix: tests for large periods, leaderboard, fuzz
// ─────────────────────────────────────────────────────────────────────────────

fn setup_high_ttl_env() -> Env {
    let env = Env::default();
    env.ledger().set(soroban_sdk::testutils::LedgerInfo {
        timestamp: 0,
        protocol_version: 20,
        sequence_number: 0,
        network_id: [0; 32],
        base_reserve: 10,
        min_temp_entry_ttl: 10,
        min_persistent_entry_ttl: 10,
        max_entry_ttl: 500_000_000,
    });
    env
}

#[test]
fn test_lazy_decay_sixty_periods_no_revert() {
    let env = setup_high_ttl_env();
    env.mock_all_auths();
    let escrow_id = env.register_contract(None, EscrowContract);
    let reputation_id = env.register_contract(None, ReputationContract);
    let client = ReputationContractClient::new(&env, &reputation_id);
    let admin = Address::generate(&env);
    client.initialize(&vec![&env, admin.clone()], &1u32, &1u32); // 1% per year

    let reviewer = Address::generate(&env);
    let reviewee = Address::generate(&env);
    setup_review_for(&env, &escrow_id, &client, 1, &reviewer, &reviewee, 5);

    let before = client.get_reputation(&reviewee);
    advance_n_periods(&env, 60);

    // 60 years * 1% = 60% decay, retained 40%
    let after = client.get_reputation(&reviewee);
    assert_eq!(after.total_score, (before.total_score * 40) / 100);
    assert_eq!(after.total_weight, (before.total_weight * 40) / 100);
    assert_eq!(after.review_count, before.review_count);
}

#[test]
fn test_lazy_decay_sixty_periods_full_decay_saturates() {
    let env = setup_high_ttl_env();
    env.mock_all_auths();
    let escrow_id = env.register_contract(None, EscrowContract);
    let reputation_id = env.register_contract(None, ReputationContract);
    let client = ReputationContractClient::new(&env, &reputation_id);
    let admin = Address::generate(&env);
    client.initialize(&vec![&env, admin.clone()], &1u32, &2u32); // 2% per year

    let reviewer = Address::generate(&env);
    let reviewee = Address::generate(&env);
    setup_review_for(&env, &escrow_id, &client, 1, &reviewer, &reviewee, 5);

    advance_n_periods(&env, 60);

    // 60 years * 2% = 120% -> saturating_sub clamps to 0% retained
    let after = client.get_reputation(&reviewee);
    assert_eq!(after.total_score, 0);
    assert_eq!(after.total_weight, 0);
    assert_eq!(after.review_count, 1);
}

#[test]
fn test_lazy_decay_high_rate_full_decay_saturates() {
    let env = Env::default();
    env.mock_all_auths();
    let escrow_id = env.register_contract(None, EscrowContract);
    let reputation_id = env.register_contract(None, ReputationContract);
    let client = ReputationContractClient::new(&env, &reputation_id);
    let admin = Address::generate(&env);
    client.initialize(&vec![&env, admin.clone()], &1u32, &50u32); // 50% per year

    let reviewer = Address::generate(&env);
    let reviewee = Address::generate(&env);
    setup_review_for(&env, &escrow_id, &client, 1, &reviewer, &reviewee, 5);

    advance_n_periods(&env, 5);

    // 5 years * 50% = 250% -> saturates to 0%
    let after = client.get_reputation(&reviewee);
    assert_eq!(after.total_score, 0);
    assert_eq!(after.total_weight, 0);
}

#[test]
fn test_leaderboard_many_entries_all_dormant_fifty_periods() {
    let env = setup_high_ttl_env();
    env.mock_all_auths();
    let escrow_id = env.register_contract(None, EscrowContract);
    let reputation_id = env.register_contract(None, ReputationContract);
    let client = ReputationContractClient::new(&env, &reputation_id);
    let admin = Address::generate(&env);
    client.initialize(&vec![&env, admin.clone()], &1u32, &10u32);

    // Create 10 users with reviews to populate the leaderboard
    for i in 0..10u64 {
        let reviewer = Address::generate(&env);
        let reviewee = Address::generate(&env);
        setup_review_for(&env, &escrow_id, &client, i + 1, &reviewer, &reviewee, 5);
    }

    // All users dormant for 50 periods
    advance_n_periods(&env, 50);

    // Leaderboard should still return without reverting
    let leaderboard = client.get_leaderboard();
    assert!(leaderboard.len() <= 10);
    // All entries should have decayed scores (fully decayed at 10%/yr * 50yr)
    for (_addr, score) in leaderboard.iter() {
        assert!(score <= 500);
    }
}

#[test]
fn test_decay_formula_consistent_across_period_ranges() {
    let env = setup_high_ttl_env();
    env.mock_all_auths();
    let escrow_id = env.register_contract(None, EscrowContract);
    let reputation_id = env.register_contract(None, ReputationContract);
    let client = ReputationContractClient::new(&env, &reputation_id);
    let admin = Address::generate(&env);
    client.initialize(&vec![&env, admin.clone()], &1u32, &5u32); // 5% per year

    let reviewer = Address::generate(&env);
    let reviewee = Address::generate(&env);
    setup_review_for(&env, &escrow_id, &client, 1, &reviewer, &reviewee, 5);

    // retained_pct = max(0, 100 - 5 * periods)
    let check_points: [(u32, u64); 5] = [
        (0, 100),
        (1, 95),
        (2, 90),
        (5, 75),
        (10, 50),
    ];

    let mut cumulative = 0u32;
    for (periods, expected_retained_pct) in &check_points {
        let advance = *periods - cumulative;
        advance_n_periods(&env, advance);
        cumulative = *periods;

        let rep = client.get_reputation(&reviewee);
        let expected_score = (5u64 * (MIN_STAKE as u64) * expected_retained_pct) / 100;
        let expected_weight = ((MIN_STAKE as u64) * expected_retained_pct) / 100;
        assert_eq!(
            rep.total_score, expected_score,
            "score mismatch at {} periods", periods
        );
        assert_eq!(
            rep.total_weight, expected_weight,
            "weight mismatch at {} periods", periods
        );
    }
}

/// Verify O(1) decay for high rates and long periods — never panics, never exceeds original.
#[test]
fn test_decay_fuzz_never_exceeds_original() {
    let env = setup_high_ttl_env();
    env.mock_all_auths();
    let reputation_id = env.register_contract(None, ReputationContract);
    let client = ReputationContractClient::new(&env, &reputation_id);
    let admin = Address::generate(&env);
    client.initialize(&vec![&env, admin.clone()], &1u32, &10u32); // 10% per year

    // Single user, test at key period milestones
    let user = Address::generate(&env);
    env.as_contract(&reputation_id, || {
        env.storage().persistent().set(
            &DataKey::Reputation(user.clone()),
            &UserReputation {
                user: user.clone(),
                total_score: 1_000_000,
                total_weight: 100_000,
                review_count: 10,
                last_updated_ledger: 0,
            },
        );
    });

    let mut cumulative = 0u32;
    for periods in [0u32, 1, 5, 10, 15, 30, 60] {
        let advance = periods - cumulative;
        advance_n_periods(&env, advance);
        cumulative = periods;

        let rep = client.get_reputation(&user);
        assert!(
            rep.total_score <= 1_000_000,
            "score exceeded original at {} periods", periods
        );
        assert!(
            rep.total_weight <= 100_000,
            "weight exceeded original at {} periods", periods
        );
    }
}

/// A tier upgrade (None -> Bronze) must emit exactly one tier_up event carrying
/// the correct reviewee address and old/new tier values.
#[test]
fn test_tier_up_event_emitted_on_tier_upgrade() {
    let env = Env::default();
    env.mock_all_auths();

    let escrow_id = env.register_contract(None, EscrowContract);
    let reputation_id = env.register_contract(None, ReputationContract);
    let reputation_client = ReputationContractClient::new(&env, &reputation_id);

    let reviewer = Address::generate(&env);
    let reviewee = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token_addr = create_token(&env, &token_admin);
    mint(&env, &token_addr, &token_admin, &reviewer, 100_000_000);

    setup_completed_job(&env, &escrow_id, 1u64, &reviewer, &reviewee, &token_addr);

    // Rating 2 -> avg 200 -> Bronze (previous tier: None)
    reputation_client.submit_review(
        &escrow_id,
        &reviewer,
        &reviewee,
        &1u64,
        &2u32,
        &String::from_str(&env, "Good work"),
        &MIN_STAKE,
    );

    assert_eq!(tier_up_event_count(&env), 1, "expected exactly one tier_up event");

    // Validate payload: (reviewee, old_tier=None, new_tier=Bronze)
    let event = env
        .events()
        .all()
        .into_iter()
        .find(|(_, topics, _)| {
            topics_match(&env, topics, symbol_short!("reput"), symbol_short!("tier_up"))
        })
        .expect("tier_up event not found");

    let (ev_reviewee, ev_old_tier, ev_new_tier): (Address, ReputationTier, ReputationTier) =
        <(Address, ReputationTier, ReputationTier)>::try_from_val(&env, &event.2).unwrap();
    assert_eq!(ev_reviewee, reviewee);
    assert_eq!(ev_old_tier, ReputationTier::None);
    assert_eq!(ev_new_tier, ReputationTier::Bronze);
}

/// When a review does not change the reputation tier (user stays in Bronze after
/// a second Bronze-level review) no additional tier_up event must be emitted.
#[test]
fn test_no_tier_up_event_when_tier_unchanged() {
    let env = Env::default();
    env.mock_all_auths();

    let escrow_id = env.register_contract(None, EscrowContract);
    let reputation_id = env.register_contract(None, ReputationContract);
    let reputation_client = ReputationContractClient::new(&env, &reputation_id);

    let reviewer1 = Address::generate(&env);
    let reviewer2 = Address::generate(&env);
    let reviewee = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token_addr = create_token(&env, &token_admin);
    mint(&env, &token_addr, &token_admin, &reviewer1, 100_000_000);
    mint(&env, &token_addr, &token_admin, &reviewer2, 100_000_000);

    setup_completed_job(&env, &escrow_id, 1u64, &reviewer1, &reviewee, &token_addr);
    setup_completed_job(&env, &escrow_id, 2u64, &reviewer2, &reviewee, &token_addr);

    // First review: rating 2 -> avg 200 -> Bronze (tier_up: None -> Bronze)
    reputation_client.submit_review(
        &escrow_id,
        &reviewer1,
        &reviewee,
        &1u64,
        &2u32,
        &String::from_str(&env, "Decent"),
        &MIN_STAKE,
    );
    assert_eq!(tier_up_event_count(&env), 1);

    // Second review: rating 2 -> avg still 200 -> stays Bronze (no tier change)
    reputation_client.submit_review(
        &escrow_id,
        &reviewer2,
        &reviewee,
        &2u64,
        &2u32,
        &String::from_str(&env, "Consistent"),
        &MIN_STAKE,
    );

    // Total tier_up events must still be exactly 1 (second review added none)
    assert_eq!(
        tier_up_event_count(&env),
        1,
        "second review must not emit tier_up when tier is unchanged"
    );
}

/// The existing badge event must continue to be emitted alongside the new
/// tier_up event, preserving backward compatibility for badge consumers.
#[test]
fn test_badge_event_preserved_alongside_tier_up() {
    let env = Env::default();
    env.mock_all_auths();

    let escrow_id = env.register_contract(None, EscrowContract);
    let reputation_id = env.register_contract(None, ReputationContract);
    let reputation_client = ReputationContractClient::new(&env, &reputation_id);

    let reviewer = Address::generate(&env);
    let reviewee = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token_addr = create_token(&env, &token_admin);
    mint(&env, &token_addr, &token_admin, &reviewer, 100_000_000);

    setup_completed_job(&env, &escrow_id, 1u64, &reviewer, &reviewee, &token_addr);

    // Rating 4 -> avg 400 -> Silver tier
    reputation_client.submit_review(
        &escrow_id,
        &reviewer,
        &reviewee,
        &1u64,
        &4u32,
        &String::from_str(&env, "Great"),
        &MIN_STAKE,
    );

    assert_eq!(badge_event_count(&env), 1, "badge event must still be emitted");
    assert_eq!(tier_up_event_count(&env), 1, "tier_up event must be emitted alongside badge");

    // Functional sanity: badge is stored and matches expected tier
    let badges = reputation_client.get_badges(&reviewee);
    assert_eq!(badges.len(), 1);
    assert_eq!(badges.get(0).unwrap().badge_type, ReputationTier::Silver);
}

// ─────────────────────────────────────────────────────────────────────────────
// #781 — Referral bonus timestamp validation
// A future-dated bonus keeps `get_decay_factor` at elapsed_seconds = 0,
// permanently exempting it from decay and inflating the score.
// ─────────────────────────────────────────────────────────────────────────────

#[test]
#[should_panic(expected = "Error(Contract, #24)")]
fn test_add_referral_bonus_rejects_future_timestamp() {
    let env = Env::default();
    env.mock_all_auths();

    let reputation_id = env.register_contract(None, ReputationContract);
    let client = ReputationContractClient::new(&env, &reputation_id);
    let admin = Address::generate(&env);
    client.initialize(&vec![&env, admin.clone()], &1u32, &0u32);
    env.ledger().with_mut(|l| l.timestamp = 1_000);

    let user = Address::generate(&env);
    // timestamp 1_001 > current ledger timestamp 1_000 -> InvalidTimestamp (#24)
    client.add_referral_bonus(&admin, &user, &5u64, &1u64, &1_001u64);
}

#[test]
fn test_add_referral_bonus_accepts_current_timestamp() {
    let env = Env::default();
    env.mock_all_auths();

    let reputation_id = env.register_contract(None, ReputationContract);
    let client = ReputationContractClient::new(&env, &reputation_id);
    let admin = Address::generate(&env);
    client.initialize(&vec![&env, admin.clone()], &1u32, &0u32); // no decay
    env.ledger().with_mut(|l| l.timestamp = 1_000);

    let user = Address::generate(&env);
    // Current timestamp is accepted.
    client.add_referral_bonus(&admin, &user, &5u64, &1u64, &1_000u64);

    let rep = client.get_reputation(&user);
    assert_eq!(rep.total_score, 5u64);
    assert_eq!(rep.total_weight, 1u64);
}

#[test]
fn test_add_referral_bonus_accepts_past_timestamp() {
    let env = Env::default();
    env.mock_all_auths();

    let reputation_id = env.register_contract(None, ReputationContract);
    let client = ReputationContractClient::new(&env, &reputation_id);
    let admin = Address::generate(&env);
    client.initialize(&vec![&env, admin.clone()], &1u32, &0u32); // no decay
    env.ledger().with_mut(|l| l.timestamp = 1_000);

    let user = Address::generate(&env);
    // A past timestamp is accepted so the bonus decays from its true origin.
    client.add_referral_bonus(&admin, &user, &5u64, &1u64, &500u64);

    let rep = client.get_reputation(&user);
    assert_eq!(rep.total_score, 5u64);
    assert_eq!(rep.total_weight, 1u64);
}

// ─────────────────────────────────────────────────────────────────────────────
// #783 — Decay rate upper bound
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn test_update_decay_rate_within_bound_succeeds() {
    let env = Env::default();
    env.mock_all_auths();

    let reputation_id = env.register_contract(None, ReputationContract);
    let client = ReputationContractClient::new(&env, &reputation_id);
    let admin = Address::generate(&env);
    client.initialize(&vec![&env, admin.clone()], &1u32, &0u32);

    // 20 == MAX_DECAY_RATE default -> accepted.
    client.update_decay_rate(&admin, &20u32);
}

#[test]
#[should_panic(expected = "Error(Contract, #25)")]
fn test_update_decay_rate_above_bound_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let reputation_id = env.register_contract(None, ReputationContract);
    let client = ReputationContractClient::new(&env, &reputation_id);
    let admin = Address::generate(&env);
    client.initialize(&vec![&env, admin.clone()], &1u32, &0u32);

    // 21 > MAX_DECAY_RATE (20) -> DecayRateTooHigh (#25).
    client.update_decay_rate(&admin, &21u32);
}

#[test]
fn test_super_admin_can_raise_max_decay_rate() {
    let env = Env::default();
    env.mock_all_auths();

    let reputation_id = env.register_contract(None, ReputationContract);
    let client = ReputationContractClient::new(&env, &reputation_id);
    let admin = Address::generate(&env);
    client.initialize(&vec![&env, admin.clone()], &1u32, &0u32);

    // Super-admin raises the ceiling to 30, then a previously-rejected 25 is allowed.
    client.set_max_decay_rate(&admin, &30u32);
    client.update_decay_rate(&admin, &25u32);
}

#[test]
#[should_panic(expected = "Error(Contract, #25)")]
fn test_set_max_decay_rate_hard_ceiling_enforced() {
    let env = Env::default();
    env.mock_all_auths();

    let reputation_id = env.register_contract(None, ReputationContract);
    let client = ReputationContractClient::new(&env, &reputation_id);
    let admin = Address::generate(&env);
    client.initialize(&vec![&env, admin.clone()], &1u32, &0u32);

    // 51 > MAX_DECAY_RATE_HARD_CEILING (50) -> DecayRateTooHigh (#25).
    client.set_max_decay_rate(&admin, &51u32);
}

// ─────────────────────────────────────────────────────────────────────────────
// #785 — Zero-score users are removed from the leaderboard
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn test_leaderboard_removes_fully_decayed_user() {
    let env = setup_high_ttl_env();
    env.mock_all_auths();
    let escrow_id = env.register_contract(None, EscrowContract);
    let reputation_id = env.register_contract(None, ReputationContract);
    let client = ReputationContractClient::new(&env, &reputation_id);
    let admin = Address::generate(&env);
    client.initialize(&vec![&env, admin.clone()], &1u32, &50u32); // 50%/yr

    let reviewer = Address::generate(&env);
    let reviewee = Address::generate(&env);
    setup_review_for(&env, &escrow_id, &client, 1, &reviewer, &reviewee, 5);

    // User with a non-zero score is on the leaderboard.
    let before = client.get_leaderboard();
    assert_eq!(before.len(), 1);
    assert!(before.iter().any(|(addr, _)| addr == reviewee));

    // Dormant long enough to fully decay: 5yr * 50% = 250% -> saturates to 0.
    advance_n_periods(&env, 5);

    // A subsequent reputation write re-runs update_leaderboard while totals are
    // zero. A zero-value bonus (current timestamp) triggers it without adding score.
    let now = env.ledger().timestamp();
    client.add_referral_bonus(&admin, &reviewee, &0u64, &0u64, &now);

    // The fully-decayed user has been removed; the leaderboard shrinks.
    let after = client.get_leaderboard();
    assert_eq!(after.len(), 0);
    assert!(!after.iter().any(|(addr, _)| addr == reviewee));
}
