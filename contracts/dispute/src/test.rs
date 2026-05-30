#![cfg(test)]

use super::*;
use soroban_sdk::{
    contract,
    contractimpl,
    testutils::{Address as _, Events, Ledger},
    Env,
    String,
};

#[contract]
pub struct DummyEscrow;

#[contractimpl]
impl DummyEscrow {
    pub fn resolve_dispute_callback(_env: Env, _job_id: u64, _resolution: DisputeResolution) {}
}

// Mock reputation contract for testing
#[contract]
pub struct MockReputationContract;

#[contractimpl]
impl MockReputationContract {
    pub fn get_reputation(
        _env: Env,
        user: Address,
    ) -> Result<reputation::UserReputation, soroban_sdk::Error> {
        // Mock: Return high reputation for all users in tests
        // In real tests, you would use more sophisticated mocking
        Ok(reputation::UserReputation {
            user: user.clone(),
            total_score: 500,
            total_weight: 10,
            review_count: 5,
        })
    }

    pub fn slash_stake(
        _env: Env,
        _caller: Address,
        _loser: Address,
        _job_id: u64,
        _amount: u64,
    ) -> Result<(), soroban_sdk::Error> {
        Ok(())
    }
}

#[test]
fn test_initialize_contract() {
    let env = Env::default();
    env.mock_all_auths();

    let dispute_contract_id = env.register_contract(None, DisputeContract);
    let client = DisputeContractClient::new(&env, &dispute_contract_id);

    let reputation_contract_id = env.register_contract(None, MockReputationContract);
    let escrow_contract_id = env.register_contract(None, DummyEscrow);
    let admin = Address::generate(&env);

    client.initialize(&admin, &reputation_contract_id, &300, &escrow_contract_id);

    // Verify initialization by checking if we can set min reputation
    client.set_min_voter_reputation(&admin, &400);
}

#[test]
#[should_panic(expected = "Error(Contract, #2)")]
fn test_initialize_twice_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let dispute_contract_id = env.register_contract(None, DisputeContract);
    let client = DisputeContractClient::new(&env, &dispute_contract_id);

    let reputation_contract_id = env.register_contract(None, MockReputationContract);
    let escrow_contract_id = env.register_contract(None, DummyEscrow);
    let admin = Address::generate(&env);

    client.initialize(&admin, &reputation_contract_id, &300, &escrow_contract_id);
    // Try to initialize again - should fail
    client.initialize(&admin, &reputation_contract_id, &300, &escrow_contract_id);
}

#[test]
fn test_set_min_voter_reputation() {
    let env = Env::default();
    env.mock_all_auths();

    let dispute_contract_id = env.register_contract(None, DisputeContract);
    let client = DisputeContractClient::new(&env, &dispute_contract_id);

    let reputation_contract_id = env.register_contract(None, MockReputationContract);
    let escrow_contract_id = env.register_contract(None, DummyEscrow);
    let admin = Address::generate(&env);

    client.initialize(&admin, &reputation_contract_id, &300, &escrow_contract_id);
    client.set_min_voter_reputation(&admin, &500);
}

#[test]
#[should_panic(expected = "Error(Contract, #2)")]
fn test_set_min_voter_reputation_non_admin_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let dispute_contract_id = env.register_contract(None, DisputeContract);
    let client = DisputeContractClient::new(&env, &dispute_contract_id);

    let reputation_contract_id = env.register_contract(None, MockReputationContract);
    let escrow_contract_id = env.register_contract(None, DummyEscrow);
    let admin = Address::generate(&env);
    let non_admin = Address::generate(&env);

    client.initialize(&admin, &reputation_contract_id, &300, &escrow_contract_id);
    // Non-admin tries to set min reputation - should fail
    client.set_min_voter_reputation(&non_admin, &500);
}

#[test]
fn test_is_eligible_voter_high_reputation() {
    let env = Env::default();
    env.mock_all_auths();

    let dispute_contract_id = env.register_contract(None, DisputeContract);
    let client = DisputeContractClient::new(&env, &dispute_contract_id);

    let reputation_contract_id = env.register_contract(None, MockReputationContract);
    let escrow_contract_id = env.register_contract(None, DummyEscrow);
    let admin = Address::generate(&env);

    client.initialize(&admin, &reputation_contract_id, &300, &escrow_contract_id);

    let voter = Address::generate(&env);

    let is_eligible = client.is_eligible_voter(&voter);
    // Mock returns high reputation for all users
    assert_eq!(is_eligible, true);
}

#[test]
fn test_vote_with_reputation_check() {
    let env = Env::default();
    env.mock_all_auths();

    let dispute_contract_id = env.register_contract(None, DisputeContract);
    let client = DisputeContractClient::new(&env, &dispute_contract_id);

    let reputation_contract_id = env.register_contract(None, MockReputationContract);
    let escrow_contract_id = env.register_contract(None, DummyEscrow);
    let admin = Address::generate(&env);

    client.initialize(&admin, &reputation_contract_id, &300, &escrow_contract_id);

    let user_client = Address::generate(&env);
    let freelancer = Address::generate(&env);

    let dispute_id = client.raise_dispute(
        &1u64,
        &user_client,
        &freelancer,
        &user_client,
        &String::from_str(&env, "Issue"),
        &3u32,
        &None,
    );

    // Vote with reputation check - should succeed with mock
    let voter = Address::generate(&env);

    client.cast_vote(
        &dispute_id,
        &voter,
        &VoteChoice::Client,
        &String::from_str(&env, "Vote"),
    );

    let dispute = client.get_dispute(&dispute_id);
    assert_eq!(dispute.votes_for_client, 1);
}

#[test]
fn test_raise_dispute() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, DisputeContract);
    let client = DisputeContractClient::new(&env, &contract_id);

    let user_client = Address::generate(&env);
    let freelancer = Address::generate(&env);

    let dispute_id = client.raise_dispute(
        &1u64,
        &user_client,
        &freelancer,
        &user_client,
        &String::from_str(&env, "Work not delivered"),
        &3u32,
        &None,
    );

    assert_eq!(dispute_id, 1);

    let dispute = client.get_dispute(&dispute_id);
    assert_eq!(dispute.job_id, 1);
    assert_eq!(dispute.status, DisputeStatus::Open);
    assert_eq!(dispute.min_votes, 3);
}

#[test]
fn test_vote_and_resolve() {
    let env = Env::default();
    env.mock_all_auths();

    let dispute_contract_id = env.register_contract(None, DisputeContract);
    let client = DisputeContractClient::new(&env, &dispute_contract_id);

    let escrow_contract_id = env.register_contract(None, DummyEscrow);
    let reputation_contract_id = env.register_contract(None, MockReputationContract);
    let admin = Address::generate(&env);

    let user_client = Address::generate(&env);
    let freelancer = Address::generate(&env);

    client.initialize(&admin, &reputation_contract_id, &300, &escrow_contract_id);
    let voter1 = Address::generate(&env);
    let voter2 = Address::generate(&env);
    let voter3 = Address::generate(&env);

    let dispute_id = client.raise_dispute(
        &1u64,
        &user_client,
        &freelancer,
        &freelancer,
        &String::from_str(&env, "Payment not released"),
        &3u32,
        &None,
    );

    client.cast_vote(
        &dispute_id,
        &voter1,
        &VoteChoice::Freelancer,
        &String::from_str(&env, "Work was done"),
    );
    client.cast_vote(
        &dispute_id,
        &voter2,
        &VoteChoice::Freelancer,
        &String::from_str(&env, "Agree with freelancer"),
    );
    client.cast_vote(
        &dispute_id,
        &voter3,
        &VoteChoice::Client,
        &String::from_str(&env, "Incomplete work"),
    );

    let result = client.resolve_dispute(&dispute_id);
    assert_eq!(result, DisputeStatus::ResolvedForFreelancer);
}

#[test]
#[should_panic(expected = "Error(Contract, #5)")]
fn test_resolve_without_enough_votes() {
    let env = Env::default();
    env.mock_all_auths();

    let dispute_contract_id = env.register_contract(None, DisputeContract);
    let client = DisputeContractClient::new(&env, &dispute_contract_id);

    let escrow_contract_id = env.register_contract(None, DummyEscrow);
    let reputation_contract_id = env.register_contract(None, MockReputationContract);
    let admin = Address::generate(&env);

    let user_client = Address::generate(&env);
    let freelancer = Address::generate(&env);

    client.initialize(&admin, &reputation_contract_id, &300, &escrow_contract_id);

    let dispute_id = client.raise_dispute(
        &1u64,
        &user_client,
        &freelancer,
        &user_client,
        &String::from_str(&env, "Issue"),
        &3u32,
        &None,
    );

    let voter = Address::generate(&env);
    client.cast_vote(
        &dispute_id,
        &voter,
        &VoteChoice::Client,
        &String::from_str(&env, "Reason"),
    );

    client.resolve_dispute(&dispute_id);
}

#[test]
fn test_tie_break_favor_client() {
    let env = Env::default();
    env.mock_all_auths();

    let dispute_contract_id = env.register_contract(None, DisputeContract);
    let client = DisputeContractClient::new(&env, &dispute_contract_id);
    let escrow_contract_id = env.register_contract(None, DummyEscrow);
    let reputation_contract_id = env.register_contract(None, MockReputationContract);
    let admin = Address::generate(&env);

    let user_client = Address::generate(&env);
    let freelancer = Address::generate(&env);

    client.initialize(&admin, &reputation_contract_id, &300, &escrow_contract_id);
    let voter1 = Address::generate(&env);
    let voter2 = Address::generate(&env);
    let voter3 = Address::generate(&env);
    let voter4 = Address::generate(&env);

    let dispute_id = client.raise_dispute(
        &1u64,
        &user_client,
        &freelancer,
        &user_client,
        &String::from_str(&env, "Issue"),
        &4u32, // min_votes set to 4
        &Some(TieBreakMethod::FavorClient),
    );

    client.cast_vote(
        &dispute_id,
        &voter1,
        &VoteChoice::Client,
        &String::from_str(&env, "C1"),
    );
    client.cast_vote(
        &dispute_id,
        &voter2,
        &VoteChoice::Freelancer,
        &String::from_str(&env, "F1"),
    );
    client.cast_vote(
        &dispute_id,
        &voter3,
        &VoteChoice::Client,
        &String::from_str(&env, "C2"),
    );
    client.cast_vote(
        &dispute_id,
        &voter4,
        &VoteChoice::Freelancer,
        &String::from_str(&env, "F2"),
    );

    let status = client.resolve_dispute(&dispute_id);
    assert_eq!(status, DisputeStatus::ResolvedForClient);
}

#[test]
fn test_tie_break_favor_freelancer() {
    let env = Env::default();
    env.mock_all_auths();

    let dispute_contract_id = env.register_contract(None, DisputeContract);
    let client = DisputeContractClient::new(&env, &dispute_contract_id);
    let escrow_contract_id = env.register_contract(None, DummyEscrow);
    let reputation_contract_id = env.register_contract(None, MockReputationContract);
    let admin = Address::generate(&env);

    let user_client = Address::generate(&env);
    let freelancer = Address::generate(&env);

    client.initialize(&admin, &reputation_contract_id, &300, &escrow_contract_id);
    let voter1 = Address::generate(&env);
    let voter2 = Address::generate(&env);
    let voter3 = Address::generate(&env);
    let voter4 = Address::generate(&env);

    let dispute_id = client.raise_dispute(
        &1u64,
        &user_client,
        &freelancer,
        &user_client,
        &String::from_str(&env, "Issue"),
        &4u32,
        &Some(TieBreakMethod::FavorFreelancer),
    );

    client.cast_vote(
        &dispute_id,
        &voter1,
        &VoteChoice::Client,
        &String::from_str(&env, "C1"),
    );
    client.cast_vote(
        &dispute_id,
        &voter2,
        &VoteChoice::Freelancer,
        &String::from_str(&env, "F1"),
    );
    client.cast_vote(
        &dispute_id,
        &voter3,
        &VoteChoice::Client,
        &String::from_str(&env, "C2"),
    );
    client.cast_vote(
        &dispute_id,
        &voter4,
        &VoteChoice::Freelancer,
        &String::from_str(&env, "F2"),
    );

    let status = client.resolve_dispute(&dispute_id);
    assert_eq!(status, DisputeStatus::ResolvedForFreelancer);
}

#[test]
fn test_tie_break_refund_both() {
    let env = Env::default();
    env.mock_all_auths();

    let dispute_contract_id = env.register_contract(None, DisputeContract);
    let client = DisputeContractClient::new(&env, &dispute_contract_id);
    let escrow_contract_id = env.register_contract(None, DummyEscrow);
    let reputation_contract_id = env.register_contract(None, MockReputationContract);
    let admin = Address::generate(&env);

    let user_client = Address::generate(&env);
    let freelancer = Address::generate(&env);

    client.initialize(&admin, &reputation_contract_id, &300, &escrow_contract_id);
    let voter1 = Address::generate(&env);
    let voter2 = Address::generate(&env);
    let voter3 = Address::generate(&env);
    let voter4 = Address::generate(&env);

    let dispute_id = client.raise_dispute(
        &1u64,
        &user_client,
        &freelancer,
        &user_client,
        &String::from_str(&env, "Issue"),
        &4u32,
        &Some(TieBreakMethod::RefundBoth),
    );

    client.cast_vote(
        &dispute_id,
        &voter1,
        &VoteChoice::Client,
        &String::from_str(&env, "C1"),
    );
    client.cast_vote(
        &dispute_id,
        &voter2,
        &VoteChoice::Freelancer,
        &String::from_str(&env, "F1"),
    );
    client.cast_vote(
        &dispute_id,
        &voter3,
        &VoteChoice::Client,
        &String::from_str(&env, "C2"),
    );
    client.cast_vote(
        &dispute_id,
        &voter4,
        &VoteChoice::Freelancer,
        &String::from_str(&env, "F2"),
    );

    let status = client.resolve_dispute(&dispute_id);
    assert_eq!(status, DisputeStatus::RefundedBoth);
}

#[test]
fn test_tie_break_escalate() {
    let env = Env::default();
    env.mock_all_auths();

    let dispute_contract_id = env.register_contract(None, DisputeContract);
    let client = DisputeContractClient::new(&env, &dispute_contract_id);
    let escrow_contract_id = env.register_contract(None, DummyEscrow);
    let reputation_contract_id = env.register_contract(None, MockReputationContract);
    let admin = Address::generate(&env);

    let user_client = Address::generate(&env);
    let freelancer = Address::generate(&env);

    client.initialize(&admin, &reputation_contract_id, &300, &escrow_contract_id);
    let voter1 = Address::generate(&env);
    let voter2 = Address::generate(&env);
    let voter3 = Address::generate(&env);
    let voter4 = Address::generate(&env);

    let dispute_id = client.raise_dispute(
        &1u64,
        &user_client,
        &freelancer,
        &user_client,
        &String::from_str(&env, "Issue"),
        &4u32,
        &Some(TieBreakMethod::Escalate),
    );

    client.cast_vote(
        &dispute_id,
        &voter1,
        &VoteChoice::Client,
        &String::from_str(&env, "C1"),
    );
    client.cast_vote(
        &dispute_id,
        &voter2,
        &VoteChoice::Freelancer,
        &String::from_str(&env, "F1"),
    );
    client.cast_vote(
        &dispute_id,
        &voter3,
        &VoteChoice::Client,
        &String::from_str(&env, "C2"),
    );
    client.cast_vote(
        &dispute_id,
        &voter4,
        &VoteChoice::Freelancer,
        &String::from_str(&env, "F2"),
    );

    let status = client.resolve_dispute(&dispute_id);
    assert_eq!(status, DisputeStatus::Escalated);
}

#[test]
fn test_tie_break_default_refund_both() {
    let env = Env::default();
    env.mock_all_auths();

    let dispute_contract_id = env.register_contract(None, DisputeContract);
    let client = DisputeContractClient::new(&env, &dispute_contract_id);
    let escrow_contract_id = env.register_contract(None, DummyEscrow);
    let reputation_contract_id = env.register_contract(None, MockReputationContract);
    let admin = Address::generate(&env);

    let user_client = Address::generate(&env);
    let freelancer = Address::generate(&env);

    client.initialize(&admin, &reputation_contract_id, &300, &escrow_contract_id);
    let voter1 = Address::generate(&env);
    let voter2 = Address::generate(&env);
    let voter3 = Address::generate(&env);
    let voter4 = Address::generate(&env);

    let dispute_id = client.raise_dispute(
        &1u64,
        &user_client,
        &freelancer,
        &user_client,
        &String::from_str(&env, "Issue"),
        &4u32,
        &None, // Should default to RefundBoth
    );

    client.cast_vote(
        &dispute_id,
        &voter1,
        &VoteChoice::Client,
        &String::from_str(&env, "C1"),
    );
    client.cast_vote(
        &dispute_id,
        &voter2,
        &VoteChoice::Freelancer,
        &String::from_str(&env, "F1"),
    );
    client.cast_vote(
        &dispute_id,
        &voter3,
        &VoteChoice::Client,
        &String::from_str(&env, "C2"),
    );
    client.cast_vote(
        &dispute_id,
        &voter4,
        &VoteChoice::Freelancer,
        &String::from_str(&env, "F2"),
    );

    let status = client.resolve_dispute(&dispute_id);
    assert_eq!(status, DisputeStatus::RefundedBoth);
}

// ── Graceful degradation without reputation system ────────────────────────────

#[test]
fn test_vote_without_reputation_contract() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, DisputeContract);
    let client = DisputeContractClient::new(&env, &contract_id);

    let user_client = Address::generate(&env);
    let freelancer = Address::generate(&env);

    // Raise a dispute WITHOUT calling initialize (no reputation contract)
    let dispute_id = client.raise_dispute(
        &1u64,
        &user_client,
        &freelancer,
        &user_client,
        &String::from_str(&env, "Issue"),
        &3u32,
        &None,
    );

    // Voting should succeed — reputation check is skipped when not configured
    let voter = Address::generate(&env);
    client.cast_vote(
        &dispute_id,
        &voter,
        &VoteChoice::Client,
        &String::from_str(&env, "Reason"),
    );

    let dispute = client.get_dispute(&dispute_id);
    assert_eq!(dispute.votes_for_client, 1);
}

// ── Pause mechanism tests ─────────────────────────────────────────────────────

#[test]
fn test_pause_and_unpause() {
    let env = Env::default();
    env.mock_all_auths();

    let dispute_contract_id = env.register_contract(None, DisputeContract);
    let client = DisputeContractClient::new(&env, &dispute_contract_id);

    let reputation_contract_id = env.register_contract(None, MockReputationContract);
    let escrow_contract_id = env.register_contract(None, DummyEscrow);
    let admin = Address::generate(&env);

    client.initialize(&admin, &reputation_contract_id, &300, &escrow_contract_id);

    // Create a dispute first
    let user_client = Address::generate(&env);
    let freelancer = Address::generate(&env);

    let dispute_id = client.raise_dispute(
        &1u64,
        &user_client,
        &freelancer,
        &user_client,
        &String::from_str(&env, "Issue"),
        &3u32,
        &None,
    );
    assert_eq!(dispute_id, 1);

    // Pause the contract
    client.pause(&admin);

    // Unpause the contract
    client.unpause(&admin);

    // Now raising another dispute should work
    let dispute_id2 = client.raise_dispute(
        &2u64,
        &user_client,
        &freelancer,
        &user_client,
        &String::from_str(&env, "Issue 2"),
        &3u32,
        &None,
    );
    assert_eq!(dispute_id2, 2);
}

#[test]
#[should_panic(expected = "Error(Contract, #12)")] // NotAdmin
fn test_pause_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();

    let dispute_contract_id = env.register_contract(None, DisputeContract);
    let client = DisputeContractClient::new(&env, &dispute_contract_id);

    let reputation_contract_id = env.register_contract(None, MockReputationContract);
    let escrow_contract_id = env.register_contract(None, DummyEscrow);
    let admin = Address::generate(&env);
    let non_admin = Address::generate(&env);

    client.initialize(&admin, &reputation_contract_id, &300, &escrow_contract_id);

    // Try to pause with non-admin address
    client.pause(&non_admin);
}

#[test]
#[should_panic(expected = "Error(Contract, #11)")] // ContractPaused
fn test_raise_dispute_when_paused() {
    let env = Env::default();
    env.mock_all_auths();

    let dispute_contract_id = env.register_contract(None, DisputeContract);
    let client = DisputeContractClient::new(&env, &dispute_contract_id);

    let reputation_contract_id = env.register_contract(None, MockReputationContract);
    let escrow_contract_id = env.register_contract(None, DummyEscrow);
    let admin = Address::generate(&env);

    client.initialize(&admin, &reputation_contract_id, &300, &escrow_contract_id);
    client.pause(&admin);

    let user_client = Address::generate(&env);
    let freelancer = Address::generate(&env);

    client.raise_dispute(
        &1u64,
        &user_client,
        &freelancer,
        &user_client,
        &String::from_str(&env, "Issue"),
        &3u32,
        &None,
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #11)")] // ContractPaused
fn test_cast_vote_when_paused() {
    let env = Env::default();
    env.mock_all_auths();

    let dispute_contract_id = env.register_contract(None, DisputeContract);
    let client = DisputeContractClient::new(&env, &dispute_contract_id);

    let reputation_contract_id = env.register_contract(None, MockReputationContract);
    let escrow_contract_id = env.register_contract(None, DummyEscrow);
    let admin = Address::generate(&env);

    client.initialize(&admin, &reputation_contract_id, &300, &escrow_contract_id);

    let user_client = Address::generate(&env);
    let freelancer = Address::generate(&env);

    let dispute_id = client.raise_dispute(
        &1u64,
        &user_client,
        &freelancer,
        &user_client,
        &String::from_str(&env, "Issue"),
        &3u32,
        &None,
    );

    client.pause(&admin);

    let voter = Address::generate(&env);
    client.cast_vote(
        &dispute_id,
        &voter,
        &VoteChoice::Client,
        &String::from_str(&env, "Vote"),
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #11)")] // ContractPaused
fn test_resolve_dispute_when_paused() {
    let env = Env::default();
    env.mock_all_auths();

    let dispute_contract_id = env.register_contract(None, DisputeContract);
    let client = DisputeContractClient::new(&env, &dispute_contract_id);

    let reputation_contract_id = env.register_contract(None, MockReputationContract);
    let escrow_contract_id = env.register_contract(None, DummyEscrow);
    let admin = Address::generate(&env);

    client.initialize(&admin, &reputation_contract_id, &300, &escrow_contract_id);

    let user_client = Address::generate(&env);
    let freelancer = Address::generate(&env);

    let dispute_id = client.raise_dispute(
        &1u64,
        &user_client,
        &freelancer,
        &user_client,
        &String::from_str(&env, "Issue"),
        &3u32,
        &None,
    );

    // Add some votes
    let voter1 = Address::generate(&env);
    let voter2 = Address::generate(&env);
    let voter3 = Address::generate(&env);

    client.cast_vote(
        &dispute_id,
        &voter1,
        &VoteChoice::Client,
        &String::from_str(&env, "Vote 1"),
    );
    client.cast_vote(
        &dispute_id,
        &voter2,
        &VoteChoice::Freelancer,
        &String::from_str(&env, "Vote 2"),
    );
    client.cast_vote(
        &dispute_id,
        &voter3,
        &VoteChoice::Client,
        &String::from_str(&env, "Vote 3"),
    );

    client.pause(&admin);

    client.resolve_dispute(&dispute_id);
}

#[test]
fn test_read_only_functions_when_paused() {
    let env = Env::default();
    env.mock_all_auths();

    let dispute_contract_id = env.register_contract(None, DisputeContract);
    let client = DisputeContractClient::new(&env, &dispute_contract_id);

    let reputation_contract_id = env.register_contract(None, MockReputationContract);
    let escrow_contract_id = env.register_contract(None, DummyEscrow);
    let admin = Address::generate(&env);

    client.initialize(&admin, &reputation_contract_id, &300, &escrow_contract_id);

    let user_client = Address::generate(&env);
    let freelancer = Address::generate(&env);

    let dispute_id = client.raise_dispute(
        &1u64,
        &user_client,
        &freelancer,
        &user_client,
        &String::from_str(&env, "Issue"),
        &3u32,
        &None,
    );

    client.pause(&admin);

    // Read-only functions should still work when paused
    let dispute = client.get_dispute(&dispute_id);
    assert_eq!(dispute.id, dispute_id);

    let count = client.get_dispute_count();
    assert_eq!(count, 1);

    let votes = client.get_votes(&dispute_id);
    assert_eq!(votes.len(), 0);

    let is_excluded = client.is_excluded_voter(&dispute_id, &Address::generate(&env));
    assert_eq!(is_excluded, false);
}

// ── Stake slashing tests (issue #221) ────────────────────────────────────────

fn setup_dispute_with_votes(
    env: &Env,
    client_votes: u32,
    freelancer_votes: u32,
) -> (
    DisputeContractClient,
    Address, // dispute contract id
    Address, // escrow contract id
    Address, // user_client
    Address, // freelancer
    u64,     // dispute_id
) {
    let dispute_contract_id = env.register_contract(None, DisputeContract);
    let client = DisputeContractClient::new(env, &dispute_contract_id);

    let escrow_contract_id = env.register_contract(None, DummyEscrow);
    let reputation_contract_id = env.register_contract(None, MockReputationContract);
    let admin = Address::generate(env);

    let user_client = Address::generate(env);
    let freelancer = Address::generate(env);

    client.initialize(&admin, &reputation_contract_id, &300, &escrow_contract_id);

    let dispute_id = client.raise_dispute(
        &1u64,
        &user_client,
        &freelancer,
        &user_client,
        &String::from_str(env, "Dispute"),
        &3u32,
        &None,
    );

    for _i in 0..client_votes {
        let voter = Address::generate(env);
        client.cast_vote(
            &dispute_id,
            &voter,
            &VoteChoice::Client,
            &String::from_str(env, "For client"),
        );
    }
    for _i in 0..freelancer_votes {
        let voter = Address::generate(env);
        client.cast_vote(
            &dispute_id,
            &voter,
            &VoteChoice::Freelancer,
            &String::from_str(env, "For freelancer"),
        );
    }

    (client, dispute_contract_id, escrow_contract_id, user_client, freelancer, dispute_id)
}

#[test]
fn test_client_wins_freelancer_stake_slashed() {
    let env = Env::default();
    env.mock_all_auths();

    // 3 votes for client, 0 for freelancer → client wins → freelancer is loser
    let (client, _, _escrow_id, _user_client, _freelancer, dispute_id) =
        setup_dispute_with_votes(&env, 3, 0);

    let status = client.resolve_dispute(&dispute_id);
    assert_eq!(status, DisputeStatus::ResolvedForClient);

    // Verify StakeSlashed event was emitted — it is the last event
    let events = env.events().all();
    let last_event = events.last().expect("At least one event should be emitted");
    let topic1: Symbol = last_event.1.get(1).unwrap().into_val(&env);
    // The last event is "resolved"; the stk_slashed event is second-to-last
    // Find the stk_slashed event
    let slash_event = events.iter().find(|(_, topics, _)| {
        if topics.len() >= 2 {
            let t1: Symbol = topics.get(1).unwrap().into_val(&env);
            return t1 == Symbol::new(&env, "reput_slashed");
        }
        false
    });
    let _ = last_event;
    let _ = topic1;
    assert!(slash_event.is_some(), "StakeSlashed event should be emitted when client wins");
}

#[test]
fn test_freelancer_wins_client_stake_slashed() {
    let env = Env::default();
    env.mock_all_auths();

    // 0 votes for client, 3 for freelancer → freelancer wins → client is loser
    let (client, _, _escrow_id, _user_client, _freelancer, dispute_id) =
        setup_dispute_with_votes(&env, 0, 3);

    let status = client.resolve_dispute(&dispute_id);
    assert_eq!(status, DisputeStatus::ResolvedForFreelancer);

    let events = env.events().all();
    let slash_event = events.iter().find(|(_, topics, _)| {
        if topics.len() >= 2 {
            let t1: Symbol = topics.get(1).unwrap().into_val(&env);
            return t1 == Symbol::new(&env, "reput_slashed");
        }
        false
    });
    assert!(slash_event.is_some(), "StakeSlashed event should be emitted when freelancer wins");
}

#[test]
fn test_no_slash_on_escalated_dispute() {
    let env = Env::default();
    env.mock_all_auths();

    let dispute_contract_id = env.register_contract(None, DisputeContract);
    let client = DisputeContractClient::new(&env, &dispute_contract_id);
    let escrow_contract_id = env.register_contract(None, DummyEscrow);
    let reputation_contract_id = env.register_contract(None, MockReputationContract);
    let admin = Address::generate(&env);
    let user_client = Address::generate(&env);
    let freelancer = Address::generate(&env);

    client.initialize(&admin, &reputation_contract_id, &300, &escrow_contract_id);

    let dispute_id = client.raise_dispute(
        &1u64,
        &user_client,
        &freelancer,
        &user_client,
        &String::from_str(&env, "Issue"),
        &4u32,
        &Some(TieBreakMethod::Escalate),
    );

    // Tie vote → escalate
    let voter1 = Address::generate(&env);
    let voter2 = Address::generate(&env);
    let voter3 = Address::generate(&env);
    let voter4 = Address::generate(&env);
    client.cast_vote(&dispute_id, &voter1, &VoteChoice::Client, &String::from_str(&env, "C"));
    client.cast_vote(&dispute_id, &voter2, &VoteChoice::Freelancer, &String::from_str(&env, "F"));
    client.cast_vote(&dispute_id, &voter3, &VoteChoice::Client, &String::from_str(&env, "C"));
    client.cast_vote(&dispute_id, &voter4, &VoteChoice::Freelancer, &String::from_str(&env, "F"));

    let status = client.resolve_dispute(&dispute_id);
    assert_eq!(status, DisputeStatus::Escalated);

    // No StakeSlashed event should be emitted for escalated disputes
    let events = env.events().all();
    let has_slash = events.iter().any(|(_, topics, _)| {
        if topics.len() >= 2 {
            let t1: Symbol = topics.get(1).unwrap().into_val(&env);
            return t1 == Symbol::new(&env, "stk_slashed");
        }
        false
    });
    assert!(!has_slash, "StakeSlashed event should NOT be emitted for escalated disputes");
}

#[test]
#[should_panic(expected = "Error(Contract, #13)")] // DisputeCooldown
fn test_raise_dispute_blocked_by_job_cooldown() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.timestamp = 1000);

    let dispute_contract_id = env.register_contract(None, DisputeContract);
    let client = DisputeContractClient::new(&env, &dispute_contract_id);
    let escrow_contract_id = env.register_contract(None, DummyEscrow);
    let reputation_contract_id = env.register_contract(None, MockReputationContract);
    let admin = Address::generate(&env);

    let user_client = Address::generate(&env);
    let freelancer = Address::generate(&env);

    client.initialize(&admin, &reputation_contract_id, &300, &escrow_contract_id);

    let dispute_id = client.raise_dispute(
        &7u64,
        &user_client,
        &freelancer,
        &user_client,
        &String::from_str(&env, "Initial dispute"),
        &3u32,
        &None,
    );

    let voter1 = Address::generate(&env);
    let voter2 = Address::generate(&env);
    let voter3 = Address::generate(&env);

    client.cast_vote(
        &dispute_id,
        &voter1,
        &VoteChoice::Client,
        &String::from_str(&env, "V1"),
    );
    client.cast_vote(
        &dispute_id,
        &voter2,
        &VoteChoice::Client,
        &String::from_str(&env, "V2"),
    );
    client.cast_vote(
        &dispute_id,
        &voter3,
        &VoteChoice::Freelancer,
        &String::from_str(&env, "V3"),
    );

    let _ = client.resolve_dispute(&dispute_id);

    // Re-opening the same job dispute immediately must fail.
    client.raise_dispute(
        &7u64,
        &user_client,
        &freelancer,
        &user_client,
        &String::from_str(&env, "Retry too soon"),
        &3u32,
        &None,
    );
}

#[test]
fn test_raise_dispute_allowed_after_cooldown() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.timestamp = 1000);

    let dispute_contract_id = env.register_contract(None, DisputeContract);
    let client = DisputeContractClient::new(&env, &dispute_contract_id);
    let escrow_contract_id = env.register_contract(None, DummyEscrow);
    let reputation_contract_id = env.register_contract(None, MockReputationContract);
    let admin = Address::generate(&env);

    let user_client = Address::generate(&env);
    let freelancer = Address::generate(&env);

    client.initialize(&admin, &reputation_contract_id, &300, &escrow_contract_id);

    let first_dispute_id = client.raise_dispute(
        &9u64,
        &user_client,
        &freelancer,
        &user_client,
        &String::from_str(&env, "Initial dispute"),
        &3u32,
        &None,
    );

    let voter1 = Address::generate(&env);
    let voter2 = Address::generate(&env);
    let voter3 = Address::generate(&env);

    client.cast_vote(
        &first_dispute_id,
        &voter1,
        &VoteChoice::Client,
        &String::from_str(&env, "V1"),
    );
    client.cast_vote(
        &first_dispute_id,
        &voter2,
        &VoteChoice::Client,
        &String::from_str(&env, "V2"),
    );
    client.cast_vote(
        &first_dispute_id,
        &voter3,
        &VoteChoice::Freelancer,
        &String::from_str(&env, "V3"),
    );

    let _ = client.resolve_dispute(&first_dispute_id);

    // Cooldown is 86_400 seconds.
    env.ledger().with_mut(|l| l.timestamp = 1000 + 86_401);

    let second_dispute_id = client.raise_dispute(
        &9u64,
        &user_client,
        &freelancer,
        &freelancer,
        &String::from_str(&env, "Retry after cooldown"),
        &3u32,
        &None,
    );

    assert_eq!(second_dispute_id, 2);
}

#[test]
#[should_panic(expected = "Error(Contract, #14)")] // VotingPeriodNotExpired
fn test_force_resolve_timeout_not_expired_fails() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.timestamp = 1000);

    let dispute_contract_id = env.register_contract(None, DisputeContract);
    let client = DisputeContractClient::new(&env, &dispute_contract_id);
    let escrow_contract_id = env.register_contract(None, DummyEscrow);
    let reputation_contract_id = env.register_contract(None, MockReputationContract);
    let admin = Address::generate(&env);

    client.initialize(&admin, &reputation_contract_id, &300, &escrow_contract_id);

    let user_client = Address::generate(&env);
    let freelancer = Address::generate(&env);

    let dispute_id = client.raise_dispute(
        &1u64,
        &user_client,
        &freelancer,
        &user_client,
        &String::from_str(&env, "Issue"),
        &10u32,
        &None,
    );

    // Try to force resolve before deadline (Deadline is 1000 + 604_800 = 605_800)
    env.ledger().with_mut(|l| l.timestamp = 600_000);
    client.force_resolve_timeout(&dispute_id);
}

#[test]
fn test_force_resolve_timeout_expired_success() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.timestamp = 1000);

    let dispute_contract_id = env.register_contract(None, DisputeContract);
    let client = DisputeContractClient::new(&env, &dispute_contract_id);
    let escrow_contract_id = env.register_contract(None, DummyEscrow);
    let reputation_contract_id = env.register_contract(None, MockReputationContract);
    let admin = Address::generate(&env);

    client.initialize(&admin, &reputation_contract_id, &300, &escrow_contract_id);

    let user_client = Address::generate(&env);
    let freelancer = Address::generate(&env);

    let dispute_id = client.raise_dispute(
        &1u64,
        &user_client,
        &freelancer,
        &user_client,
        &String::from_str(&env, "Issue"),
        &10u32,
        &None,
    );

    // 1 vote for freelancer
    let voter = Address::generate(&env);
    client.cast_vote(
        &dispute_id,
        &voter,
        &VoteChoice::Freelancer,
        &String::from_str(&env, "Reason"),
    );

    // Advance past deadline (1000 + 604_800 = 605_800)
    env.ledger().with_mut(|l| l.timestamp = 605_801);

    let status = client.force_resolve_timeout(&dispute_id);
    assert_eq!(status, DisputeStatus::ResolvedForFreelancer);
}

#[test]
fn test_force_resolve_timeout_tie_break_success() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.timestamp = 1000);

    let dispute_contract_id = env.register_contract(None, DisputeContract);
    let client = DisputeContractClient::new(&env, &dispute_contract_id);
    let escrow_contract_id = env.register_contract(None, DummyEscrow);
    let reputation_contract_id = env.register_contract(None, MockReputationContract);
    let admin = Address::generate(&env);

    client.initialize(&admin, &reputation_contract_id, &300, &escrow_contract_id);

    let user_client = Address::generate(&env);
    let freelancer = Address::generate(&env);

    let dispute_id = client.raise_dispute(
        &1u64,
        &user_client,
        &freelancer,
        &user_client,
        &String::from_str(&env, "Issue"),
        &10u32,
        &Some(TieBreakMethod::FavorClient),
    );

    // Advance past deadline
    env.ledger().with_mut(|l| l.timestamp = 605_801);

    let status = client.force_resolve_timeout(&dispute_id);
    assert_eq!(status, DisputeStatus::ResolvedForClient);
}

// ── Vote delegation tests (#479) ──────────────────────────────────────────────

fn setup_initialized_dispute_contract(
    env: &Env,
) -> (DisputeContractClient, Address, Address, Address) {
    let dispute_contract_id = env.register_contract(None, DisputeContract);
    let client = DisputeContractClient::new(env, &dispute_contract_id);
    let escrow_contract_id = env.register_contract(None, DummyEscrow);
    let reputation_contract_id = env.register_contract(None, MockReputationContract);
    let admin = Address::generate(env);
    client.initialize(&admin, &reputation_contract_id, &300, &escrow_contract_id);
    (client, dispute_contract_id, escrow_contract_id, admin)
}

#[test]
fn test_delegate_vote_stored_and_readable() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _dispute_id, _escrow_id, _admin) = setup_initialized_dispute_contract(&env);

    let owner = Address::generate(&env);
    let delegate = Address::generate(&env);

    client.delegate_vote(&owner, &delegate, &42u64);

    let stored = client.get_delegation(&owner, &42u64);
    assert_eq!(stored, Some(delegate));
}

#[test]
fn test_delegate_can_cast_vote_on_behalf_of_owner() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _dispute_id, _escrow_id, _admin) = setup_initialized_dispute_contract(&env);

    let job_client = Address::generate(&env);
    let freelancer = Address::generate(&env);
    let owner = Address::generate(&env);
    let delegate = Address::generate(&env);

    let dispute_id = client.raise_dispute(
        &1u64,
        &job_client,
        &freelancer,
        &job_client,
        &String::from_str(&env, "Issue"),
        &1u32,
        &None,
    );

    // Owner delegates their vote rights for job 1 to delegate.
    client.delegate_vote(&owner, &delegate, &1u64);

    // Delegate casts the vote — should succeed and count for the dispute.
    client.cast_vote(
        &dispute_id,
        &delegate,
        &VoteChoice::Client,
        &String::from_str(&env, "Voting on behalf of owner"),
    );

    let dispute = client.get_dispute(&dispute_id);
    assert_eq!(dispute.votes_for_client, 1);
}

#[test]
fn test_revoke_delegation_removes_entry() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _dispute_id, _escrow_id, _admin) = setup_initialized_dispute_contract(&env);

    let owner = Address::generate(&env);
    let delegate = Address::generate(&env);

    client.delegate_vote(&owner, &delegate, &10u64);
    assert!(client.get_delegation(&owner, &10u64).is_some());

    client.revoke_delegation(&owner, &10u64);
    assert!(client.get_delegation(&owner, &10u64).is_none());
}

#[test]
#[should_panic(expected = "Error(Contract, #3)")] // AlreadyVoted
fn test_owner_cannot_vote_directly_after_delegate_voted() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _dispute_id, _escrow_id, _admin) = setup_initialized_dispute_contract(&env);

    let job_client = Address::generate(&env);
    let freelancer = Address::generate(&env);
    let owner = Address::generate(&env);
    let delegate = Address::generate(&env);

    let dispute_id = client.raise_dispute(
        &1u64,
        &job_client,
        &freelancer,
        &job_client,
        &String::from_str(&env, "Issue"),
        &1u32,
        &None,
    );

    client.delegate_vote(&owner, &delegate, &1u64);

    // Delegate votes first.
    client.cast_vote(
        &dispute_id,
        &delegate,
        &VoteChoice::Freelancer,
        &String::from_str(&env, "Delegate vote"),
    );

    // Owner tries to vote directly — must fail with AlreadyVoted.
    client.cast_vote(
        &dispute_id,
        &owner,
        &VoteChoice::Client,
        &String::from_str(&env, "Direct vote after delegate"),
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #3)")] // AlreadyVoted
fn test_delegate_cannot_vote_if_owner_voted_directly() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _dispute_id, _escrow_id, _admin) = setup_initialized_dispute_contract(&env);

    let job_client = Address::generate(&env);
    let freelancer = Address::generate(&env);
    let owner = Address::generate(&env);
    let delegate = Address::generate(&env);

    let dispute_id = client.raise_dispute(
        &1u64,
        &job_client,
        &freelancer,
        &job_client,
        &String::from_str(&env, "Issue"),
        &1u32,
        &None,
    );

    // Owner votes directly first.
    client.cast_vote(
        &dispute_id,
        &owner,
        &VoteChoice::Client,
        &String::from_str(&env, "Direct owner vote"),
    );

    // Owner tries to set up a delegation after already voting — must fail.
    client.delegate_vote(&owner, &delegate, &1u64);
}

#[test]
#[should_panic(expected = "Error(Contract, #17)")] // DelegateAlreadyVoted
fn test_revoke_fails_after_delegate_voted() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _dispute_id, _escrow_id, _admin) = setup_initialized_dispute_contract(&env);

    let job_client = Address::generate(&env);
    let freelancer = Address::generate(&env);
    let owner = Address::generate(&env);
    let delegate = Address::generate(&env);

    let dispute_id = client.raise_dispute(
        &1u64,
        &job_client,
        &freelancer,
        &job_client,
        &String::from_str(&env, "Issue"),
        &1u32,
        &None,
    );

    client.delegate_vote(&owner, &delegate, &1u64);

    client.cast_vote(
        &dispute_id,
        &delegate,
        &VoteChoice::Freelancer,
        &String::from_str(&env, "Delegate vote"),
    );

    // Attempting to revoke after vote is cast must fail.
    client.revoke_delegation(&owner, &1u64);
}

#[test]
#[should_panic(expected = "Error(Contract, #16)")] // AlreadyDelegated
fn test_double_delegation_for_same_job_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _dispute_id, _escrow_id, _admin) = setup_initialized_dispute_contract(&env);

    let owner = Address::generate(&env);
    let delegate_a = Address::generate(&env);
    let delegate_b = Address::generate(&env);

    client.delegate_vote(&owner, &delegate_a, &5u64);
    // Second delegation for the same job must fail.
    client.delegate_vote(&owner, &delegate_b, &5u64);
}

#[test]
fn test_delegated_vote_counts_same_as_direct_vote_in_resolution() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _dispute_id, _escrow_id, _admin) = setup_initialized_dispute_contract(&env);

    let job_client = Address::generate(&env);
    let freelancer = Address::generate(&env);

    let dispute_id = client.raise_dispute(
        &1u64,
        &job_client,
        &freelancer,
        &job_client,
        &String::from_str(&env, "Issue"),
        &3u32,
        &None,
    );

    // Two direct voters for freelancer.
    let voter1 = Address::generate(&env);
    let voter2 = Address::generate(&env);
    client.cast_vote(&dispute_id, &voter1, &VoteChoice::Freelancer, &String::from_str(&env, "v1"));
    client.cast_vote(&dispute_id, &voter2, &VoteChoice::Freelancer, &String::from_str(&env, "v2"));

    // One delegated vote for freelancer.
    let owner = Address::generate(&env);
    let delegate = Address::generate(&env);
    client.delegate_vote(&owner, &delegate, &1u64);
    client.cast_vote(&dispute_id, &delegate, &VoteChoice::Freelancer, &String::from_str(&env, "delegated"));

    // 3 votes for freelancer — resolution should succeed.
    let status = client.resolve_dispute(&dispute_id);
    assert_eq!(status, DisputeStatus::ResolvedForFreelancer);
}

#[test]
#[should_panic(expected = "Error(Contract, #10)")] // DisputeError::ConflictOfInterest = 10
fn test_conflict_of_interest_voter_is_party() {
    let env = Env::default();
    env.mock_all_auths();

    let dispute_contract_id = env.register_contract(None, DisputeContract);
    let client = DisputeContractClient::new(&env, &dispute_contract_id);

    let reputation_contract_id = env.register_contract(None, MockReputationContract);
    let escrow_contract_id = env.register_contract(None, DummyEscrow);
    let admin = Address::generate(&env);

    client.initialize(&admin, &reputation_contract_id, &300, &escrow_contract_id);

    let user_client = Address::generate(&env);
    let freelancer = Address::generate(&env);

    let dispute_id = client.raise_dispute(
        &1u64,
        &user_client,
        &freelancer,
        &user_client,
        &String::from_str(&env, "Issue"),
        &3u32,
        &None,
    );

    // Client tries to vote on their own dispute
    client.cast_vote(
        &dispute_id,
        &user_client,
        &VoteChoice::Client,
        &String::from_str(&env, "Vote"),
    );
}
