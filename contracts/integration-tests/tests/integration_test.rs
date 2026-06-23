#![cfg(test)]

//! Cross-Contract Integration Tests
//!
//! This test suite verifies end-to-end workflows across the Escrow, Dispute, and Reputation contracts.
//! It simulates realistic scenarios including:
//! - Job creation, funding, milestone completion, and payment
//! - Dispute raising, voting, and resolution with fund redistribution
//! - Reputation reviews after job completion
//! - Multi-contract interactions and state consistency

use soroban_sdk::{
    testutils::Address as _,
    token::{StellarAssetClient, TokenClient},
    vec, Address, Env, String, Vec,
};

use stellar_market_dispute::{DisputeContract, DisputeContractClient, DisputeStatus, VoteChoice};
use stellar_market_escrow::{EscrowContract, EscrowContractClient, JobStatus, MilestoneStatus};
use stellar_market_reputation::{AdminAction, ReputationContract, ReputationContractClient};

// Mock reputation contract that always returns high reputation for any user.
// Used in dispute integration tests so that randomly-generated voter addresses
// pass the eligibility check without needing real reputation records.
mod mock_reputation {
    use soroban_sdk::{contract, contractimpl, contracttype, Address, Env};

    #[contracttype]
    #[derive(Clone, Debug, Eq, PartialEq)]
    pub struct UserReputation {
        pub user: Address,
        pub total_score: u64,
        pub total_weight: u64,
        pub review_count: u32,
    }

    #[contract]
    pub struct MockReputationContract;

    #[contractimpl]
    impl MockReputationContract {
        pub fn get_reputation(
            _env: Env,
            user: Address,
        ) -> Result<UserReputation, soroban_sdk::Error> {
            Ok(UserReputation {
                user,
                total_score: 500,
                total_weight: 10,
                review_count: 5,
            })
        }
    }
}

/// A future timestamp safely beyond the default ledger time in tests (0).
const DEADLINE: u64 = 9_999_999_999;
/// Auto-refund window starts after the job deadline.
const AUTO_REFUND: u64 = DEADLINE + 1_000_000;

/// Test helper to create a token contract and mint tokens to an address
fn create_token_contract<'a>(env: &Env, admin: &Address) -> (Address, TokenClient<'a>) {
    let token_address = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let token = TokenClient::new(env, &token_address);
    (token_address, token)
}

/// Test helper to mint tokens to a user
fn mint_tokens(env: &Env, token: &Address, _admin: &Address, to: &Address, amount: i128) {
    let token_admin_client = StellarAssetClient::new(env, token);
    token_admin_client.mint(to, &amount);
}

#[test]
fn test_happy_path_job_completion_with_reputation() {
    let env = Env::default();
    env.mock_all_auths();

    // Register contracts
    let escrow_id = env.register_contract(None, EscrowContract);
    let escrow_client = EscrowContractClient::new(&env, &escrow_id);

    let reputation_id = env.register_contract(None, ReputationContract);
    let reputation_client = ReputationContractClient::new(&env, &reputation_id);

    // Create participants
    let client = Address::generate(&env);
    let freelancer = Address::generate(&env);
    let admin = Address::generate(&env);

    // Create and fund token
    let (token_address, token) = create_token_contract(&env, &admin);
    mint_tokens(&env, &token_address, &admin, &client, 100_000_000);
    mint_tokens(&env, &token_address, &admin, &freelancer, 100_000_000);

    // Initialize reputation contract with multi-sig
    let signers = Vec::from_array(&env, [admin.clone()]);
    reputation_client.initialize(&signers, &1, &50);
    reputation_client.propose_admin_action(&admin, &AdminAction::SetToken(token_address.clone()));

    // Step 1: Create job with milestones
    let milestones = vec![
        &env,
        (String::from_str(&env, "Design phase"), 1_000_i128, DEADLINE),
        (
            String::from_str(&env, "Development phase"),
            2_000_i128,
            DEADLINE,
        ),
        (
            String::from_str(&env, "Testing phase"),
            1_500_i128,
            DEADLINE,
        ),
    ];

    let job_id = escrow_client.create_job(
        &client,
        &freelancer,
        &token_address,
        &milestones,
        &DEADLINE,
        &AUTO_REFUND,
        &518_400u32,
    );
    assert_eq!(job_id, 1);

    let job = escrow_client.get_job(&job_id);
    assert_eq!(job.status, JobStatus::Created);
    assert_eq!(job.total_amount, 4_500);
    assert_eq!(job.milestones.len(), 3);

    // Step 2: Client funds the escrow
    escrow_client.fund_job(&job_id, &client, &0, &0);

    let job = escrow_client.get_job(&job_id);
    assert_eq!(job.status, JobStatus::Funded);
    assert_eq!(token.balance(&escrow_id), 4_500);
    assert_eq!(token.balance(&client), 99_995_500); // 100M - 4,500

    // Step 3: Freelancer submits and client approves milestone 1
    escrow_client.submit_milestone(&job_id, &0, &freelancer);
    let job = escrow_client.get_job(&job_id);
    assert_eq!(job.status, JobStatus::InProgress);
    assert_eq!(
        job.milestones.get(0).unwrap().status,
        MilestoneStatus::Submitted
    );

    escrow_client.approve_milestone(&job_id, &0, &client);
    let job = escrow_client.get_job(&job_id);
    assert_eq!(
        job.milestones.get(0).unwrap().status,
        MilestoneStatus::Approved
    );
    assert_eq!(token.balance(&freelancer), 100_001_000);
    assert_eq!(token.balance(&escrow_id), 3_500);

    // Step 4: Complete remaining milestones
    escrow_client.submit_milestone(&job_id, &1, &freelancer);
    escrow_client.approve_milestone(&job_id, &1, &client);
    assert_eq!(token.balance(&freelancer), 100_003_000);

    escrow_client.submit_milestone(&job_id, &2, &freelancer);
    escrow_client.approve_milestone(&job_id, &2, &client);

    let job = escrow_client.get_job(&job_id);
    assert_eq!(job.status, JobStatus::Completed);
    assert_eq!(token.balance(&freelancer), 100_004_500);
    assert_eq!(token.balance(&escrow_id), 0);

    // Step 5: Submit reputation reviews
    reputation_client.submit_review(
        &escrow_id,
        &client,
        &freelancer,
        &job_id,
        &5,
        &String::from_str(&env, "Excellent work, delivered on time!"),
        &10_000_000_i128,
    );

    reputation_client.submit_review(
        &escrow_id,
        &freelancer,
        &client,
        &job_id,
        &5,
        &String::from_str(&env, "Great client, clear requirements!"),
        &10_000_000_i128,
    );

    // Verify reputation scores
    let freelancer_rep = reputation_client.get_reputation(&freelancer);
    assert_eq!(freelancer_rep.review_count, 1);
    assert_eq!(freelancer_rep.total_score, 50_000_000); // 5 * 10M
    assert_eq!(reputation_client.get_average_rating(&freelancer), 500); // 5.00

    let client_rep = reputation_client.get_reputation(&client);
    assert_eq!(client_rep.review_count, 1);
    assert_eq!(client_rep.total_score, 50_000_000);
    assert_eq!(reputation_client.get_average_rating(&client), 500);
}

#[test]
#[ignore]
fn test_dispute_resolved_for_freelancer() {
    let env = Env::default();
    env.mock_all_auths();

    // Register contracts
    let escrow_id = env.register_contract(None, EscrowContract);
    let escrow_client = EscrowContractClient::new(&env, &escrow_id);

    let dispute_contract_id = env.register_contract(None, DisputeContract);
    let dispute_client = DisputeContractClient::new(&env, &dispute_contract_id);

    let mock_rep_id = env.register_contract(None, mock_reputation::MockReputationContract);

    // Create participants
    let client = Address::generate(&env);
    let freelancer = Address::generate(&env);
    let admin = Address::generate(&env);

    // Create and fund token
    let (token_address, token) = create_token_contract(&env, &admin);
    mint_tokens(&env, &token_address, &admin, &client, 100_000_000);
    mint_tokens(&env, &token_address, &admin, &freelancer, 100_000_000);

    // Initialize dispute contract with mock reputation
    dispute_client.initialize(&admin, &mock_rep_id, &0, &escrow_id);

    // Create and fund job
    let milestones = vec![
        &env,
        (
            String::from_str(&env, "Complete project"),
            3_000_i128,
            DEADLINE,
        ),
    ];

    let job_id = escrow_client.create_job(
        &client,
        &freelancer,
        &token_address,
        &milestones,
        &DEADLINE,
        &AUTO_REFUND,
        &518_400u32,
    );
    escrow_client.fund_job(&job_id, &client, &0, &0);

    // Freelancer submits work
    escrow_client.submit_milestone(&job_id, &0, &freelancer);

    let job = escrow_client.get_job(&job_id);
    assert_eq!(job.status, JobStatus::InProgress);

    // Client raises a dispute instead of approving
    let dispute_id_val = dispute_client.raise_dispute(
        &job_id,
        &client,
        &freelancer,
        &client,
        &String::from_str(&env, "Work quality is not acceptable"),
        &3,
        &None,
    );

    let dispute = dispute_client.get_dispute(&dispute_id_val);
    assert_eq!(dispute.status, DisputeStatus::Open);
    assert_eq!(dispute.job_id, job_id);

    // Three independent voters cast votes (majority for freelancer)
    let voter1 = Address::generate(&env);
    let voter2 = Address::generate(&env);
    let voter3 = Address::generate(&env);

    dispute_client.cast_vote(
        &dispute_id_val,
        &voter1,
        &VoteChoice::Freelancer,
        &String::from_str(&env, "Work looks good to me"),
    );

    dispute_client.cast_vote(
        &dispute_id_val,
        &voter2,
        &VoteChoice::Freelancer,
        &String::from_str(&env, "Freelancer delivered as promised"),
    );

    dispute_client.cast_vote(
        &dispute_id_val,
        &voter3,
        &VoteChoice::Client,
        &String::from_str(&env, "Some issues with quality"),
    );

    let dispute = dispute_client.get_dispute(&dispute_id_val);
    assert_eq!(dispute.votes_for_freelancer, 2);
    assert_eq!(dispute.votes_for_client, 1);

    // Resolution is final in reputation-based voting (no appeals)
    let result = dispute_client.resolve_dispute(&dispute_id_val);
    assert_eq!(result, DisputeStatus::ResolvedForFreelancer);

    // Funds are transferred immediately to freelancer
    assert_eq!(token.balance(&freelancer), 100_003_000);
    assert_eq!(token.balance(&escrow_id), 0);

    // Job is completed
    let job = escrow_client.get_job(&job_id);
    assert_eq!(job.status, JobStatus::Completed);
}

#[test]
#[ignore]
fn test_dispute_resolved_for_client() {
    let env = Env::default();
    env.mock_all_auths();

    // Register contracts
    let escrow_id = env.register_contract(None, EscrowContract);
    let escrow_client = EscrowContractClient::new(&env, &escrow_id);

    let dispute_contract_id = env.register_contract(None, DisputeContract);
    let dispute_client = DisputeContractClient::new(&env, &dispute_contract_id);

    let mock_rep_id = env.register_contract(None, mock_reputation::MockReputationContract);

    // Create participants
    let client = Address::generate(&env);
    let freelancer = Address::generate(&env);
    let admin = Address::generate(&env);

    // Create and fund token
    let (token_address, token) = create_token_contract(&env, &admin);
    mint_tokens(&env, &token_address, &admin, &client, 100_000_000);
    mint_tokens(&env, &token_address, &admin, &freelancer, 100_000_000);

    // Initialize dispute contract with mock reputation
    dispute_client.initialize(&admin, &mock_rep_id, &0, &escrow_id);

    // Create job with multiple milestones
    let milestones = vec![
        &env,
        (String::from_str(&env, "Milestone 1"), 1_000_i128, DEADLINE),
        (String::from_str(&env, "Milestone 2"), 2_000_i128, DEADLINE),
    ];

    let job_id = escrow_client.create_job(
        &client,
        &freelancer,
        &token_address,
        &milestones,
        &DEADLINE,
        &AUTO_REFUND,
        &518_400u32,
    );
    escrow_client.fund_job(&job_id, &client, &0, &0);

    // Approve first milestone
    escrow_client.submit_milestone(&job_id, &0, &freelancer);
    escrow_client.approve_milestone(&job_id, &0, &client);
    assert_eq!(token.balance(&freelancer), 100_001_000);

    // Freelancer submits second milestone, but client disputes
    escrow_client.submit_milestone(&job_id, &1, &freelancer);

    let dispute_id_val = dispute_client.raise_dispute(
        &job_id,
        &client,
        &freelancer,
        &client,
        &String::from_str(&env, "Second milestone not delivered properly"),
        &3,
        &None,
    );

    // Voters side with client
    let voter1 = Address::generate(&env);
    let voter2 = Address::generate(&env);
    let voter3 = Address::generate(&env);

    dispute_client.cast_vote(
        &dispute_id_val,
        &voter1,
        &VoteChoice::Client,
        &String::from_str(&env, "Work incomplete"),
    );

    dispute_client.cast_vote(
        &dispute_id_val,
        &voter2,
        &VoteChoice::Client,
        &String::from_str(&env, "Client is right"),
    );

    dispute_client.cast_vote(
        &dispute_id_val,
        &voter3,
        &VoteChoice::Freelancer,
        &String::from_str(&env, "Looks ok to me"),
    );

    // First resolution — not final yet (max_appeals=2, appeal_count=0).
    // Resolution is final in reputation-based voting (no appeals)
    let result = dispute_client.resolve_dispute(&dispute_id_val);
    assert_eq!(result, DisputeStatus::ResolvedForClient);

    // Funds are refunded to client immediately
    assert_eq!(token.balance(&client), 99_999_000); // 100M - 3000 (funded) + 2000 (refund)
    assert_eq!(token.balance(&freelancer), 100_001_000); // Only first milestone was paid
    assert_eq!(token.balance(&escrow_id), 0); // All funds distributed

    // Job is cancelled
    let job = escrow_client.get_job(&job_id);
    assert_eq!(job.status, JobStatus::Cancelled);
}

#[test]
fn test_full_workflow_with_partial_completion_and_cancellation() {
    let env = Env::default();
    env.mock_all_auths();

    // Register contracts
    let escrow_id = env.register_contract(None, EscrowContract);
    let escrow_client = EscrowContractClient::new(&env, &escrow_id);

    // Create participants
    let client = Address::generate(&env);
    let freelancer = Address::generate(&env);
    let admin = Address::generate(&env);

    // Create and fund token
    let (token_address, token) = create_token_contract(&env, &admin);
    mint_tokens(&env, &token_address, &admin, &client, 100_000_000);
    mint_tokens(&env, &token_address, &admin, &freelancer, 100_000_000);

    // Create job with 3 milestones
    let milestones = vec![
        &env,
        (String::from_str(&env, "Phase 1"), 1_000_i128, DEADLINE),
        (String::from_str(&env, "Phase 2"), 1_500_i128, DEADLINE),
        (String::from_str(&env, "Phase 3"), 2_000_i128, DEADLINE),
    ];

    let job_id = escrow_client.create_job(
        &client,
        &freelancer,
        &token_address,
        &milestones,
        &DEADLINE,
        &AUTO_REFUND,
        &518_400u32,
    );
    escrow_client.fund_job(&job_id, &client, &0, &0);

    // Complete first milestone
    escrow_client.submit_milestone(&job_id, &0, &freelancer);
    escrow_client.approve_milestone(&job_id, &0, &client);
    assert_eq!(token.balance(&freelancer), 100_001_000);

    // Client cancels job (refunds remaining 3500)
    escrow_client.cancel_job(&job_id, &client);

    let job = escrow_client.get_job(&job_id);
    assert_eq!(job.status, JobStatus::Cancelled);

    // Verify fund distribution
    assert_eq!(token.balance(&client), 99_999_000); // 100M - 1000 (paid to freelancer)
    assert_eq!(token.balance(&freelancer), 100_001_000);
    assert_eq!(token.balance(&escrow_id), 0);
}

#[test]
fn test_multiple_jobs_with_reputation_accumulation() {
    let env = Env::default();
    env.mock_all_auths();

    // Register contracts
    let escrow_id = env.register_contract(None, EscrowContract);
    let escrow_client = EscrowContractClient::new(&env, &escrow_id);

    let reputation_id = env.register_contract(None, ReputationContract);
    let reputation_client = ReputationContractClient::new(&env, &reputation_id);

    // Create participants
    let client1 = Address::generate(&env);
    let client2 = Address::generate(&env);
    let freelancer = Address::generate(&env);
    let admin = Address::generate(&env);

    // Create and fund token
    let (token_address, token) = create_token_contract(&env, &admin);
    mint_tokens(&env, &token_address, &admin, &client1, 100_000_000);
    mint_tokens(&env, &token_address, &admin, &client2, 100_000_000);
    mint_tokens(&env, &token_address, &admin, &freelancer, 100_000_000);

    // Initialize reputation contract with multi-sig
    let signers = Vec::from_array(&env, [admin.clone()]);
    reputation_client.initialize(&signers, &1, &50);
    reputation_client.propose_admin_action(&admin, &AdminAction::SetToken(token_address.clone()));

    // Job 1: Client1 -> Freelancer
    let milestones1 = vec![
        &env,
        (String::from_str(&env, "Job 1 work"), 2_000_i128, DEADLINE),
    ];
    let job_id1 = escrow_client.create_job(
        &client1,
        &freelancer,
        &token_address,
        &milestones1,
        &DEADLINE,
        &AUTO_REFUND,
        &518_400u32,
    );
    escrow_client.fund_job(&job_id1, &client1, &0, &0);
    escrow_client.submit_milestone(&job_id1, &0, &freelancer);
    escrow_client.approve_milestone(&job_id1, &0, &client1);

    // Job 2: Client2 -> Freelancer
    let milestones2 = vec![
        &env,
        (String::from_str(&env, "Job 2 work"), 3_000_i128, DEADLINE),
    ];
    let job_id2 = escrow_client.create_job(
        &client2,
        &freelancer,
        &token_address,
        &milestones2,
        &DEADLINE,
        &AUTO_REFUND,
        &518_400u32,
    );
    escrow_client.fund_job(&job_id2, &client2, &0, &0);
    escrow_client.submit_milestone(&job_id2, &0, &freelancer);
    escrow_client.approve_milestone(&job_id2, &0, &client2);

    // Both clients review the freelancer
    reputation_client.submit_review(
        &escrow_id,
        &client1,
        &freelancer,
        &job_id1,
        &5,
        &String::from_str(&env, "Perfect!"),
        &10_000_000_i128,
    );

    reputation_client.submit_review(
        &escrow_id,
        &client2,
        &freelancer,
        &job_id2,
        &4,
        &String::from_str(&env, "Very good"),
        &10_000_000_i128,
    );

    // Verify accumulated reputation
    let rep = reputation_client.get_reputation(&freelancer);
    assert_eq!(rep.review_count, 2);
    assert_eq!(rep.total_score, 90_000_000); // (5*10M) + (4*10M)
    assert_eq!(rep.total_weight, 20_000_000);
    assert_eq!(reputation_client.get_average_rating(&freelancer), 450); // 4.50 stars

    // Verify freelancer received all payments
    assert_eq!(token.balance(&freelancer), 100_005_000); // 100M + 5,000 (payments)
}

#[test]
#[ignore]
fn test_dispute_with_all_milestones_approved() {
    let env = Env::default();
    env.mock_all_auths();

    let escrow_id = env.register_contract(None, EscrowContract);
    let escrow_client = EscrowContractClient::new(&env, &escrow_id);

    let dispute_contract_id = env.register_contract(None, DisputeContract);
    let dispute_client = DisputeContractClient::new(&env, &dispute_contract_id);

    let mock_rep_id = env.register_contract(None, mock_reputation::MockReputationContract);

    let client = Address::generate(&env);
    let freelancer = Address::generate(&env);
    let admin = Address::generate(&env);

    let (token_address, token) = create_token_contract(&env, &admin);
    mint_tokens(&env, &token_address, &admin, &client, 10_000);

    // Initialize dispute contract with mock reputation
    dispute_client.initialize(&admin, &mock_rep_id, &0, &escrow_id);

    let milestones = vec![&env, (String::from_str(&env, "Work"), 2_000_i128, DEADLINE)];

    let job_id = escrow_client.create_job(
        &client,
        &freelancer,
        &token_address,
        &milestones,
        &DEADLINE,
        &AUTO_REFUND,
        &518_400u32,
    );
    escrow_client.fund_job(&job_id, &client, &0, &0);

    // Submit milestone but don't approve yet - raise dispute first
    escrow_client.submit_milestone(&job_id, &0, &freelancer);

    // Raise dispute before approval
    let dispute_id_val = dispute_client.raise_dispute(
        &job_id,
        &client,
        &freelancer,
        &client,
        &String::from_str(&env, "Quality issue"),
        &3,
        &None,
    );

    // Vote and resolve for freelancer (so they get the funds)
    let voter1 = Address::generate(&env);
    let voter2 = Address::generate(&env);
    let voter3 = Address::generate(&env);

    dispute_client.cast_vote(
        &dispute_id_val,
        &voter1,
        &VoteChoice::Freelancer,
        &String::from_str(&env, "Vote 1"),
    );
    dispute_client.cast_vote(
        &dispute_id_val,
        &voter2,
        &VoteChoice::Freelancer,
        &String::from_str(&env, "Vote 2"),
    );
    dispute_client.cast_vote(
        &dispute_id_val,
        &voter3,
        &VoteChoice::Client,
        &String::from_str(&env, "Vote 3"),
    );

    // Resolution is final in reputation-based voting (no appeals)
    let result = dispute_client.resolve_dispute(&dispute_id_val);
    assert_eq!(result, DisputeStatus::ResolvedForFreelancer);

    // Funds are transferred immediately to freelancer
    let job = escrow_client.get_job(&job_id);
    assert_eq!(job.status, JobStatus::Completed);
    assert_eq!(token.balance(&freelancer), 2_000);
    assert_eq!(token.balance(&escrow_id), 0);
}
