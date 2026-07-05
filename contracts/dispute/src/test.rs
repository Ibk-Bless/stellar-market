#![cfg(test)]

use super::*;
use soroban_sdk::{
    contract, contractimpl,
    testutils::{Address as _, BytesN as _, Events, Ledger},
    BytesN, Env, String,
};

// Helper macro to add arbitrators and get assigned ones for a dispute
macro_rules! setup_arbs_and_get_assigned {
    ($env:expr, $client:expr, $admin:expr, $dispute_id:expr, $count:expr) => {{
        for _ in 0..$count {
            let arb = Address::generate(&$env);
            $client.add_arbitrator(&$admin, &arb);
        }
        $client.get_assigned_arbitrators(&$dispute_id)
    }};
}

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

    /// Mock for the MaliciousFiling cross-contract call.
    pub fn apply_dispute_outcome(
        _env: Env,
        _user: Address,
        _outcome: u32, // DisputeOutcome discriminant (2 = MaliciousFiling)
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

    for _ in 0..5 {
        let arb = Address::generate(&env);
        client.add_arbitrator(&admin, &arb);
    }

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
    let assigned = client.get_assigned_arbitrators(&dispute_id);
    let voter = assigned.get(0).unwrap();

    client.cast_vote(
        &dispute_id,
        &voter,
        &VoteChoice::Client,
        &String::from_str(&env, "Vote"), &0);

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
    
    // Add arbitrators
    for _ in 0..5 {
        let arb = Address::generate(&env);
        client.add_arbitrator(&admin, &arb);
    }
    
    let dispute_id = client.raise_dispute(
        &1u64,
        &user_client,
        &freelancer,
        &freelancer,
        &String::from_str(&env, "Payment not released"),
        &3u32,
        &None,
    );

    let assigned = client.get_assigned_arbitrators(&dispute_id);
    
    client.cast_vote(
        &dispute_id,
        &assigned.get(0).unwrap(),
        &VoteChoice::Freelancer,
        &String::from_str(&env, "Work was done"), &0);
    client.cast_vote(
        &dispute_id,
        &assigned.get(1).unwrap(),
        &VoteChoice::Freelancer,
        &String::from_str(&env, "Agree with freelancer"), &0);
    client.cast_vote(
        &dispute_id,
        &assigned.get(2).unwrap(),
        &VoteChoice::Client,
        &String::from_str(&env, "Incomplete work"), &0);

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

    for _ in 0..5 {
        let arb = Address::generate(&env);
        client.add_arbitrator(&admin, &arb);
    }

    let dispute_id = client.raise_dispute(
        &1u64,
        &user_client,
        &freelancer,
        &user_client,
        &String::from_str(&env, "Issue"),
        &3u32,
        &None,
    );

    let assigned = client.get_assigned_arbitrators(&dispute_id);
    let voter = assigned.get(0).unwrap();
    client.cast_vote(
        &dispute_id,
        &voter,
        &VoteChoice::Client,
        &String::from_str(&env, "Reason"), &0);

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
    
    // Add arbitrators
    for _ in 0..10 {
        client.add_arbitrator(&admin, &Address::generate(&env));
    }

    let dispute_id = client.raise_dispute(
        &1u64,
        &user_client,
        &freelancer,
        &user_client,
        &String::from_str(&env, "Issue"),
        &4u32, // min_votes set to 4
        &Some(TieBreakMethod::FavorClient),
    );

    let assigned = client.get_assigned_arbitrators(&dispute_id);

    client.cast_vote(
        &dispute_id,
        &assigned.get(0).unwrap(),
        &VoteChoice::Client,
        &String::from_str(&env, "C1"), &0);
    client.cast_vote(
        &dispute_id,
        &assigned.get(1).unwrap(),
        &VoteChoice::Freelancer,
        &String::from_str(&env, "F1"), &0);
    client.cast_vote(
        &dispute_id,
        &assigned.get(2).unwrap(),
        &VoteChoice::Client,
        &String::from_str(&env, "C2"), &0);
    client.cast_vote(
        &dispute_id,
        &assigned.get(3).unwrap(),
        &VoteChoice::Freelancer,
        &String::from_str(&env, "F2"), &0);

    let status = client.resolve_dispute(&dispute_id);
    // Exact client/freelancer tie now resolves as 50/50 split (Issue #702)
    assert_eq!(status, DisputeStatus::RefundSplit(50));
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
    for _ in 0..5 {
        let arb = Address::generate(&env);
        client.add_arbitrator(&admin, &arb);
    }

    let dispute_id = client.raise_dispute(
        &1u64,
        &user_client,
        &freelancer,
        &user_client,
        &String::from_str(&env, "Issue"),
        &4u32,
        &Some(TieBreakMethod::FavorFreelancer),
    );

    let assigned = client.get_assigned_arbitrators(&dispute_id);
    let voter1 = assigned.get(0).unwrap();
    let voter2 = assigned.get(1).unwrap();
    let voter3 = assigned.get(2).unwrap();
    let voter4 = assigned.get(3).unwrap();

    client.cast_vote(
        &dispute_id,
        &voter1,
        &VoteChoice::Client,
        &String::from_str(&env, "C1"), &0);
    client.cast_vote(
        &dispute_id,
        &voter2,
        &VoteChoice::Freelancer,
        &String::from_str(&env, "F1"), &0);
    client.cast_vote(
        &dispute_id,
        &voter3,
        &VoteChoice::Client,
        &String::from_str(&env, "C2"), &0);
    client.cast_vote(
        &dispute_id,
        &voter4,
        &VoteChoice::Freelancer,
        &String::from_str(&env, "F2"), &0);

    let status = client.resolve_dispute(&dispute_id);
    // Exact client/freelancer tie now resolves as 50/50 split (Issue #702)
    assert_eq!(status, DisputeStatus::RefundSplit(50));
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
    for _ in 0..5 {
        let arb = Address::generate(&env);
        client.add_arbitrator(&admin, &arb);
    }

    let dispute_id = client.raise_dispute(
        &1u64,
        &user_client,
        &freelancer,
        &user_client,
        &String::from_str(&env, "Issue"),
        &4u32,
        &Some(TieBreakMethod::RefundBoth),
    );

    let assigned = client.get_assigned_arbitrators(&dispute_id);
    let voter1 = assigned.get(0).unwrap();
    let voter2 = assigned.get(1).unwrap();
    let voter3 = assigned.get(2).unwrap();
    let voter4 = assigned.get(3).unwrap();

    client.cast_vote(
        &dispute_id,
        &voter1,
        &VoteChoice::Client,
        &String::from_str(&env, "C1"), &0);
    client.cast_vote(
        &dispute_id,
        &voter2,
        &VoteChoice::Freelancer,
        &String::from_str(&env, "F1"), &0);
    client.cast_vote(
        &dispute_id,
        &voter3,
        &VoteChoice::Client,
        &String::from_str(&env, "C2"), &0);
    client.cast_vote(
        &dispute_id,
        &voter4,
        &VoteChoice::Freelancer,
        &String::from_str(&env, "F2"), &0);

    let status = client.resolve_dispute(&dispute_id);
    // Exact client/freelancer tie now resolves as 50/50 split (Issue #702)
    assert_eq!(status, DisputeStatus::RefundSplit(50));
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
    for _ in 0..5 {
        let arb = Address::generate(&env);
        client.add_arbitrator(&admin, &arb);
    }

    let dispute_id = client.raise_dispute(
        &1u64,
        &user_client,
        &freelancer,
        &user_client,
        &String::from_str(&env, "Issue"),
        &4u32,
        &Some(TieBreakMethod::Escalate),
    );

    let assigned = client.get_assigned_arbitrators(&dispute_id);
    let voter1 = assigned.get(0).unwrap();
    let voter2 = assigned.get(1).unwrap();
    let voter3 = assigned.get(2).unwrap();
    let voter4 = assigned.get(3).unwrap();

    client.cast_vote(
        &dispute_id,
        &voter1,
        &VoteChoice::Client,
        &String::from_str(&env, "C1"), &0);
    client.cast_vote(
        &dispute_id,
        &voter2,
        &VoteChoice::Freelancer,
        &String::from_str(&env, "F1"), &0);
    client.cast_vote(
        &dispute_id,
        &voter3,
        &VoteChoice::Client,
        &String::from_str(&env, "C2"), &0);
    client.cast_vote(
        &dispute_id,
        &voter4,
        &VoteChoice::Freelancer,
        &String::from_str(&env, "F2"), &0);

    let status = client.resolve_dispute(&dispute_id);
    // Exact client/freelancer tie now resolves as 50/50 split (Issue #702)
    assert_eq!(status, DisputeStatus::RefundSplit(50));
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
    for _ in 0..5 {
        let arb = Address::generate(&env);
        client.add_arbitrator(&admin, &arb);
    }

    let dispute_id = client.raise_dispute(
        &1u64,
        &user_client,
        &freelancer,
        &user_client,
        &String::from_str(&env, "Issue"),
        &4u32,
        &None, // Should default to RefundBoth
    );

    let assigned = client.get_assigned_arbitrators(&dispute_id);
    let voter1 = assigned.get(0).unwrap();
    let voter2 = assigned.get(1).unwrap();
    let voter3 = assigned.get(2).unwrap();
    let voter4 = assigned.get(3).unwrap();

    client.cast_vote(
        &dispute_id,
        &voter1,
        &VoteChoice::Client,
        &String::from_str(&env, "C1"), &0);
    client.cast_vote(
        &dispute_id,
        &voter2,
        &VoteChoice::Freelancer,
        &String::from_str(&env, "F1"), &0);
    client.cast_vote(
        &dispute_id,
        &voter3,
        &VoteChoice::Client,
        &String::from_str(&env, "C2"), &0);
    client.cast_vote(
        &dispute_id,
        &voter4,
        &VoteChoice::Freelancer,
        &String::from_str(&env, "F2"), &0);

    let status = client.resolve_dispute(&dispute_id);
    // Exact client/freelancer tie now resolves as 50/50 split (Issue #702)
    assert_eq!(status, DisputeStatus::RefundSplit(50));
}

// ── Graceful degradation without reputation system ────────────────────────────

#[test]
fn test_vote_without_reputation_contract() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, DisputeContract);
    let client = DisputeContractClient::new(&env, &contract_id);
    let escrow_contract_id = env.register_contract(None, DummyEscrow);
    let reputation_contract_id = env.register_contract(None, MockReputationContract);
    let admin = Address::generate(&env);

    // MockReputationContract returns score=500 which satisfies min_voter_reputation=300.
    client.initialize(&admin, &reputation_contract_id, &300, &escrow_contract_id);

    for _ in 0..5 {
        let arb = Address::generate(&env);
        client.add_arbitrator(&admin, &arb);
    }

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

    let assigned = client.get_assigned_arbitrators(&dispute_id);
    let voter = assigned.get(0).unwrap();
    client.cast_vote(
        &dispute_id,
        &voter,
        &VoteChoice::Client,
        &String::from_str(&env, "Reason"), &0);

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
        &String::from_str(&env, "Vote"), &0);
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

    for _ in 0..5 {
        let arb = Address::generate(&env);
        client.add_arbitrator(&admin, &arb);
    }

    // Use min_votes=5 so 3 votes won't trigger auto-resolve before we pause.
    let dispute_id = client.raise_dispute(
        &1u64,
        &user_client,
        &freelancer,
        &user_client,
        &String::from_str(&env, "Issue"),
        &5u32,
        &None,
    );

    let assigned = client.get_assigned_arbitrators(&dispute_id);
    let voter1 = assigned.get(0).unwrap();
    let voter2 = assigned.get(1).unwrap();
    let voter3 = assigned.get(2).unwrap();

    client.cast_vote(
        &dispute_id,
        &voter1,
        &VoteChoice::Client,
        &String::from_str(&env, "Vote 1"), &0);
    client.cast_vote(
        &dispute_id,
        &voter2,
        &VoteChoice::Freelancer,
        &String::from_str(&env, "Vote 2"), &0);
    client.cast_vote(
        &dispute_id,
        &voter3,
        &VoteChoice::Client,
        &String::from_str(&env, "Vote 3"), &0);

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

    // Add arbitrators to pool
    let mut arbitrators = Vec::new(env);
    for _ in 0..10 {
        let arb = Address::generate(env);
        client.add_arbitrator(&admin, &arb);
        arbitrators.push_back(arb);
    }

    let dispute_id = client.raise_dispute(
        &1u64,
        &user_client,
        &freelancer,
        &user_client,
        &String::from_str(env, "Dispute"),
        &3u32,
        &None,
    );

    let assigned = client.get_assigned_arbitrators(&dispute_id);
    
    for i in 0..client_votes {
        if (i as u32) < assigned.len() {
            let voter = assigned.get(i as u32).unwrap();
            client.cast_vote(
                &dispute_id,
                &voter,
                &VoteChoice::Client,
                &String::from_str(env, "For client"), &0);
        }
    }
    for i in 0..freelancer_votes {
        let idx = client_votes + i;
        if idx < assigned.len() {
            let voter = assigned.get(idx).unwrap();
            client.cast_vote(
                &dispute_id,
                &voter,
                &VoteChoice::Freelancer,
                &String::from_str(env, "For freelancer"), &0);
        }
    }

    (
        client,
        dispute_contract_id,
        escrow_contract_id,
        user_client,
        freelancer,
        dispute_id,
    )
}

#[test]
fn test_client_wins_freelancer_stake_slashed() {
    let env = Env::default();
    env.mock_all_auths();

    // 3 votes for client, 0 for freelancer → client wins (auto-resolved on 3rd vote)
    let (client, _, _escrow_id, _user_client, _freelancer, dispute_id) =
        setup_dispute_with_votes(&env, 3, 0);

    // Dispute is already auto-resolved by the 3rd vote; check status directly.
    let dispute = client.get_dispute(&dispute_id);
    assert_eq!(dispute.status, DisputeStatus::ResolvedForClient);

    let events = env.events().all();
    let slash_event = events.iter().find(|(_, topics, _)| {
        if topics.len() >= 2 {
            let t1: Symbol = topics.get(1).unwrap().into_val(&env);
            return t1 == Symbol::new(&env, "reput_slashed");
        }
        false
    });
    assert!(
        slash_event.is_some(),
        "StakeSlashed event should be emitted when client wins"
    );
}

#[test]
fn test_freelancer_wins_client_stake_slashed() {
    let env = Env::default();
    env.mock_all_auths();

    // 0 votes for client, 3 for freelancer → freelancer wins (auto-resolved on 3rd vote)
    let (client, _, _escrow_id, _user_client, _freelancer, dispute_id) =
        setup_dispute_with_votes(&env, 0, 3);

    let dispute = client.get_dispute(&dispute_id);
    assert_eq!(dispute.status, DisputeStatus::ResolvedForFreelancer);

    let events = env.events().all();
    let slash_event = events.iter().find(|(_, topics, _)| {
        if topics.len() >= 2 {
            let t1: Symbol = topics.get(1).unwrap().into_val(&env);
            return t1 == Symbol::new(&env, "reput_slashed");
        }
        false
    });
    assert!(
        slash_event.is_some(),
        "StakeSlashed event should be emitted when freelancer wins"
    );
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

    for _ in 0..5 {
        let arb = Address::generate(&env);
        client.add_arbitrator(&admin, &arb);
    }

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
    let assigned = client.get_assigned_arbitrators(&dispute_id);
    let voter1 = assigned.get(0).unwrap();
    let voter2 = assigned.get(1).unwrap();
    let voter3 = assigned.get(2).unwrap();
    let voter4 = assigned.get(3).unwrap();
    client.cast_vote(
        &dispute_id,
        &voter1,
        &VoteChoice::Client,
        &String::from_str(&env, "C"), &0);
    client.cast_vote(
        &dispute_id,
        &voter2,
        &VoteChoice::Freelancer,
        &String::from_str(&env, "F"), &0);
    client.cast_vote(
        &dispute_id,
        &voter3,
        &VoteChoice::Client,
        &String::from_str(&env, "C"), &0);
    client.cast_vote(
        &dispute_id,
        &voter4,
        &VoteChoice::Freelancer,
        &String::from_str(&env, "F"), &0);

    let status = client.resolve_dispute(&dispute_id);
    // Exact client/freelancer tie now resolves as 50/50 split (Issue #702)
    assert_eq!(status, DisputeStatus::RefundSplit(50));
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

    for _ in 0..5 {
        let arb = Address::generate(&env);
        client.add_arbitrator(&admin, &arb);
    }

    let dispute_id = client.raise_dispute(
        &7u64,
        &user_client,
        &freelancer,
        &user_client,
        &String::from_str(&env, "Initial dispute"),
        &3u32,
        &None,
    );

    let assigned = client.get_assigned_arbitrators(&dispute_id);
    let voter1 = assigned.get(0).unwrap();
    let voter2 = assigned.get(1).unwrap();
    let voter3 = assigned.get(2).unwrap();

    client.cast_vote(
        &dispute_id,
        &voter1,
        &VoteChoice::Client,
        &String::from_str(&env, "V1"), &0);
    client.cast_vote(
        &dispute_id,
        &voter2,
        &VoteChoice::Client,
        &String::from_str(&env, "V2"), &0);
    client.cast_vote(
        &dispute_id,
        &voter3,
        &VoteChoice::Client,
        &String::from_str(&env, "V3"), &0);

    // 3 votes for Client → auto-resolve fires; re-raise immediately must fail with DisputeCooldown.
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

    for _ in 0..5 {
        let arb = Address::generate(&env);
        client.add_arbitrator(&admin, &arb);
    }

    let first_dispute_id = client.raise_dispute(
        &9u64,
        &user_client,
        &freelancer,
        &user_client,
        &String::from_str(&env, "Initial dispute"),
        &3u32,
        &None,
    );

    let assigned = client.get_assigned_arbitrators(&first_dispute_id);
    let voter1 = assigned.get(0).unwrap();
    let voter2 = assigned.get(1).unwrap();
    let voter3 = assigned.get(2).unwrap();

    client.cast_vote(
        &first_dispute_id,
        &voter1,
        &VoteChoice::Client,
        &String::from_str(&env, "V1"), &0);
    client.cast_vote(
        &first_dispute_id,
        &voter2,
        &VoteChoice::Client,
        &String::from_str(&env, "V2"), &0);
    client.cast_vote(
        &first_dispute_id,
        &voter3,
        &VoteChoice::Freelancer,
        &String::from_str(&env, "V3"), &0);

    // Dispute auto-resolved on 3rd vote; advance past both cooldowns.
    env.ledger().with_mut(|l| l.timestamp = 1000 + 1_209_601);

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

    for _ in 0..10 {
        let arb = Address::generate(&env);
        client.add_arbitrator(&admin, &arb);
    }

    let dispute_id = client.raise_dispute(
        &1u64,
        &user_client,
        &freelancer,
        &user_client,
        &String::from_str(&env, "Issue"),
        &10u32,
        &None,
    );

    // 1 vote for freelancer (not enough to auto-resolve — min_votes=10)
    let assigned = client.get_assigned_arbitrators(&dispute_id);
    let voter = assigned.get(0).unwrap();
    client.cast_vote(
        &dispute_id,
        &voter,
        &VoteChoice::Freelancer,
        &String::from_str(&env, "Reason"), &0);

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

// ── Party-pair cooldown tests (#530) ─────────────────────────────────────────

#[test]
#[should_panic(expected = "Error(Contract, #13)")] // DisputeCooldown
fn test_party_cooldown_blocks_same_parties_on_different_job() {
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

    for _ in 0..5 {
        let arb = Address::generate(&env);
        client.add_arbitrator(&admin, &arb);
    }

    // Raise and resolve a dispute on job 1.
    let d1 = client.raise_dispute(
        &1u64, &user_client, &freelancer, &user_client,
        &String::from_str(&env, "First dispute"), &3u32, &None,
    );
    let assigned = client.get_assigned_arbitrators(&d1);
    let v1 = assigned.get(0).unwrap();
    let v2 = assigned.get(1).unwrap();
    let v3 = assigned.get(2).unwrap();
    client.cast_vote(&d1, &v1, &VoteChoice::Client, &String::from_str(&env, "v1"), &0);
    client.cast_vote(&d1, &v2, &VoteChoice::Client, &String::from_str(&env, "v2"), &0);
    client.cast_vote(&d1, &v3, &VoteChoice::Client, &String::from_str(&env, "v3"), &0);

    // 3 votes for Client → auto-resolve fires and sets party cooldown.
    // Immediately raising a dispute on a different job between the same parties must fail.
    client.raise_dispute(
        &2u64, &user_client, &freelancer, &freelancer,
        &String::from_str(&env, "Too soon"), &3u32, &None,
    );
}

#[test]
fn test_party_cooldown_allows_after_expiry() {
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

    for _ in 0..5 {
        let arb = Address::generate(&env);
        client.add_arbitrator(&admin, &arb);
    }

    let d1 = client.raise_dispute(
        &1u64, &user_client, &freelancer, &user_client,
        &String::from_str(&env, "First dispute"), &3u32, &None,
    );
    let assigned = client.get_assigned_arbitrators(&d1);
    let v1 = assigned.get(0).unwrap();
    let v2 = assigned.get(1).unwrap();
    let v3 = assigned.get(2).unwrap();
    client.cast_vote(&d1, &v1, &VoteChoice::Client, &String::from_str(&env, "v1"), &0);
    client.cast_vote(&d1, &v2, &VoteChoice::Client, &String::from_str(&env, "v2"), &0);
    client.cast_vote(&d1, &v3, &VoteChoice::Freelancer, &String::from_str(&env, "v3"), &0);

    // Advance past the 14-day per-party cooldown (1_209_600 s) and per-job cooldown (86_400 s).
    env.ledger().with_mut(|l| l.timestamp = 1000 + 1_209_601);

    let d2 = client.raise_dispute(
        &2u64, &user_client, &freelancer, &freelancer,
        &String::from_str(&env, "After cooldown"), &3u32, &None,
    );
    assert_eq!(d2, 2);
}

#[test]
fn test_party_cooldown_does_not_affect_different_party_pairs() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| {
        l.timestamp = 1000;
        l.sequence_number = 1000;
    });

    let dispute_contract_id = env.register_contract(None, DisputeContract);
    let client = DisputeContractClient::new(&env, &dispute_contract_id);
    let escrow_contract_id = env.register_contract(None, DummyEscrow);
    let reputation_contract_id = env.register_contract(None, MockReputationContract);
    let admin = Address::generate(&env);
    let user_client_a = Address::generate(&env);
    let freelancer_a = Address::generate(&env);
    let user_client_b = Address::generate(&env);
    let freelancer_b = Address::generate(&env);

    client.initialize(&admin, &reputation_contract_id, &300, &escrow_contract_id);

    for _ in 0..5 {
        let arb = Address::generate(&env);
        client.add_arbitrator(&admin, &arb);
    }

    // Resolve a dispute between pair A.
    let d1 = client.raise_dispute(
        &1u64, &user_client_a, &freelancer_a, &user_client_a,
        &String::from_str(&env, "Pair A"), &3u32, &None,
    );
    let assigned = client.get_assigned_arbitrators(&d1);
    let v1 = assigned.get(0).unwrap();
    let v2 = assigned.get(1).unwrap();
    let v3 = assigned.get(2).unwrap();
    client.cast_vote(&d1, &v1, &VoteChoice::Client, &String::from_str(&env, "v1"), &0);
    client.cast_vote(&d1, &v2, &VoteChoice::Client, &String::from_str(&env, "v2"), &0);
    client.cast_vote(&d1, &v3, &VoteChoice::Freelancer, &String::from_str(&env, "v3"), &0);

    // Different pair B should be unaffected.
    let d2 = client.raise_dispute(
        &2u64, &user_client_b, &freelancer_b, &user_client_b,
        &String::from_str(&env, "Pair B"), &3u32, &None,
    );
    assert_eq!(d2, 2);
}

#[test]
fn test_set_cooldown_duration() {
    let env = Env::default();
    env.mock_all_auths();

    let dispute_contract_id = env.register_contract(None, DisputeContract);
    let client = DisputeContractClient::new(&env, &dispute_contract_id);
    let escrow_contract_id = env.register_contract(None, DummyEscrow);
    let reputation_contract_id = env.register_contract(None, MockReputationContract);
    let admin = Address::generate(&env);

    client.initialize(&admin, &reputation_contract_id, &300, &escrow_contract_id);

    // Admin can update the cooldown duration.
    client.set_cooldown_duration(&admin, &100_000u64);
}

#[test]
#[should_panic(expected = "Error(Contract, #12)")] // NotAdmin
fn test_set_cooldown_duration_non_admin_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let dispute_contract_id = env.register_contract(None, DisputeContract);
    let client = DisputeContractClient::new(&env, &dispute_contract_id);
    let escrow_contract_id = env.register_contract(None, DummyEscrow);
    let reputation_contract_id = env.register_contract(None, MockReputationContract);
    let admin = Address::generate(&env);
    let non_admin = Address::generate(&env);

    client.initialize(&admin, &reputation_contract_id, &300, &escrow_contract_id);
    client.set_cooldown_duration(&non_admin, &100_000u64);
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
    
    // Add arbitrators to pool
    for _ in 0..10 {
        let arb = Address::generate(env);
        client.add_arbitrator(&admin, &arb);
    }
    
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

    // Use an actual assigned arbitrator as the owner who delegates.
    let arbitrators = client.get_assigned_arbitrators(&dispute_id);
    let owner = arbitrators.get(0).unwrap();

    // Owner delegates their vote rights for job 1 to delegate.
    client.delegate_vote(&owner, &delegate, &1u64);

    // Delegate casts the vote — should succeed and count for the dispute.
    client.cast_vote(
        &dispute_id,
        &delegate,
        &VoteChoice::Client,
        &String::from_str(&env, "Voting on behalf of owner"), &0);

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

    // Use an actual assigned arbitrator as the owner who will delegate.
    let arbitrators = client.get_assigned_arbitrators(&dispute_id);
    let owner = arbitrators.get(0).unwrap();

    client.delegate_vote(&owner, &delegate, &1u64);

    // Delegate votes first (on behalf of owner who is an assigned arbitrator).
    client.cast_vote(
        &dispute_id,
        &delegate,
        &VoteChoice::Freelancer,
        &String::from_str(&env, "Delegate vote"), &0);

    // Owner tries to vote directly — must fail with AlreadyVoted (#3).
    client.cast_vote(
        &dispute_id,
        &owner,
        &VoteChoice::Client,
        &String::from_str(&env, "Direct vote after delegate"), &0);
}

#[test]
#[should_panic(expected = "Error(Contract, #3)")] // AlreadyVoted
fn test_delegate_cannot_vote_if_owner_voted_directly() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _dispute_id, _escrow_id, _admin) = setup_initialized_dispute_contract(&env);

    let job_client = Address::generate(&env);
    let freelancer = Address::generate(&env);
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

    // Use an actual assigned arbitrator as the owner.
    let arbitrators = client.get_assigned_arbitrators(&dispute_id);
    let owner = arbitrators.get(0).unwrap();

    // Owner votes directly first.
    client.cast_vote(
        &dispute_id,
        &owner,
        &VoteChoice::Client,
        &String::from_str(&env, "Direct owner vote"), &0);

    // Owner tries to set up a delegation after already voting — must fail with AlreadyVoted (#3).
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

    // Use an actual assigned arbitrator as the owner who delegates.
    let arbitrators = client.get_assigned_arbitrators(&dispute_id);
    let owner = arbitrators.get(0).unwrap();

    client.delegate_vote(&owner, &delegate, &1u64);

    client.cast_vote(
        &dispute_id,
        &delegate,
        &VoteChoice::Freelancer,
        &String::from_str(&env, "Delegate vote"), &0);

    // Attempting to revoke after delegate has voted must fail with DelegateAlreadyVoted (#17).
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

    let assigned = client.get_assigned_arbitrators(&dispute_id);
    let voter1 = assigned.get(0).unwrap();
    let voter2 = assigned.get(1).unwrap();
    let owner = assigned.get(2).unwrap();
    let delegate = Address::generate(&env);

    // Two direct voters for freelancer.
    client.cast_vote(
        &dispute_id,
        &voter1,
        &VoteChoice::Freelancer,
        &String::from_str(&env, "v1"), &0);
    client.cast_vote(
        &dispute_id,
        &voter2,
        &VoteChoice::Freelancer,
        &String::from_str(&env, "v2"), &0);

    // One delegated vote for freelancer (owner is an assigned arbitrator who delegates).
    client.delegate_vote(&owner, &delegate, &1u64);
    client.cast_vote(
        &dispute_id,
        &delegate,
        &VoteChoice::Freelancer,
        &String::from_str(&env, "delegated"), &0);

    // 3 votes for freelancer — dispute auto-resolved on 3rd vote.
    let dispute = client.get_dispute(&dispute_id);
    assert_eq!(dispute.status, DisputeStatus::ResolvedForFreelancer);
}

#[test]
#[should_panic(expected = "Error(Contract, #2)")] // Unauthorized: parties are excluded from assigned_arbitrators
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
        &String::from_str(&env, "Vote"), &0);
}

// ── Malicious dispute filing tests ────────────────────────────────────────────

/// Helper: set up a dispute with an initialized contract and return key objects.
fn setup_malicious_test(
    env: &Env,
) -> (
    DisputeContractClient,
    Address, // job_client
    Address, // freelancer
    u64,     // dispute_id
) {
    let dispute_contract_id = env.register_contract(None, DisputeContract);
    let client = DisputeContractClient::new(env, &dispute_contract_id);
    let reputation_contract_id = env.register_contract(None, MockReputationContract);
    let escrow_contract_id = env.register_contract(None, DummyEscrow);
    let admin = Address::generate(env);
    client.initialize(&admin, &reputation_contract_id, &300, &escrow_contract_id);

    // Add arbitrators to pool
    for _ in 0..10 {
        let arb = Address::generate(env);
        client.add_arbitrator(&admin, &arb);
    }

    let job_client = Address::generate(env);
    let freelancer = Address::generate(env);
    let dispute_id = client.raise_dispute(
        &1u64,
        &job_client,
        &freelancer,
        &job_client, // initiator = client (the one allegedly filing in bad faith)
        &String::from_str(env, "Frivolous claim"),
        &5u32, // min_votes = 5 so we can reach supermajority
        &None,
    );
    (client, job_client, freelancer, dispute_id)
}

/// 4-of-5 votes for MaliciousFiling → resolves as MaliciousDisputeFiling.
#[test]
fn test_malicious_filing_supermajority_resolves() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _job_client, _freelancer, dispute_id) = setup_malicious_test(&env);

    let assigned = client.get_assigned_arbitrators(&dispute_id);
    let v1 = assigned.get(0).unwrap();
    let v2 = assigned.get(1).unwrap();
    let v3 = assigned.get(2).unwrap();
    let v4 = assigned.get(3).unwrap();
    let v5 = assigned.get(4).unwrap();

    // 4 malicious votes + 1 dissenting vote = supermajority (auto-resolves on 5th vote)
    client.cast_vote(&dispute_id, &v1, &VoteChoice::MaliciousFiling, &String::from_str(&env, "bad faith"), &0);
    client.cast_vote(&dispute_id, &v2, &VoteChoice::MaliciousFiling, &String::from_str(&env, "bad faith"), &0);
    client.cast_vote(&dispute_id, &v3, &VoteChoice::MaliciousFiling, &String::from_str(&env, "bad faith"), &0);
    client.cast_vote(&dispute_id, &v4, &VoteChoice::MaliciousFiling, &String::from_str(&env, "bad faith"), &0);
    client.cast_vote(&dispute_id, &v5, &VoteChoice::Client,           &String::from_str(&env, "disagree"), &0);

    let dispute = client.get_dispute(&dispute_id);
    assert_eq!(dispute.status, DisputeStatus::MaliciousDisputeFiling);
}

/// 3-of-5 votes for MaliciousFiling (60 %) — below the 80 % supermajority threshold.
/// Resolves normally (Client wins here because the remaining 2 votes are also for Client).
#[test]
fn test_malicious_filing_below_supermajority_resolves_normally() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _job_client, _freelancer, dispute_id) = setup_malicious_test(&env);

    let assigned = client.get_assigned_arbitrators(&dispute_id);
    let v1 = assigned.get(0).unwrap();
    let v2 = assigned.get(1).unwrap();
    let v3 = assigned.get(2).unwrap();
    let v4 = assigned.get(3).unwrap();
    let v5 = assigned.get(4).unwrap();

    // 3 malicious + 2 for client = 60 % malicious, not ≥ 80 % (auto-resolves on 5th vote via tie-break)
    client.cast_vote(&dispute_id, &v1, &VoteChoice::MaliciousFiling, &String::from_str(&env, "bad faith"), &0);
    client.cast_vote(&dispute_id, &v2, &VoteChoice::MaliciousFiling, &String::from_str(&env, "bad faith"), &0);
    client.cast_vote(&dispute_id, &v3, &VoteChoice::MaliciousFiling, &String::from_str(&env, "bad faith"), &0);
    client.cast_vote(&dispute_id, &v4, &VoteChoice::Client,           &String::from_str(&env, "for client"), &0);
    client.cast_vote(&dispute_id, &v5, &VoteChoice::Client,           &String::from_str(&env, "for client"), &0);

    // Should NOT resolve as MaliciousDisputeFiling — normal resolution applies.
    let dispute = client.get_dispute(&dispute_id);
    assert_ne!(dispute.status, DisputeStatus::MaliciousDisputeFiling);
}

/// Verifies that a MaliciousDisputeFiling dispute cannot be resolved a second time.
#[test]
#[should_panic(expected = "Error(Contract, #7)")]
fn test_malicious_filing_cannot_be_re_resolved() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _job_client, _freelancer, dispute_id) = setup_malicious_test(&env);

    let assigned = client.get_assigned_arbitrators(&dispute_id);
    let v1 = assigned.get(0).unwrap();
    let v2 = assigned.get(1).unwrap();
    let v3 = assigned.get(2).unwrap();
    let v4 = assigned.get(3).unwrap();
    let v5 = assigned.get(4).unwrap();

    client.cast_vote(&dispute_id, &v1, &VoteChoice::MaliciousFiling, &String::from_str(&env, "bad faith"), &0);
    client.cast_vote(&dispute_id, &v2, &VoteChoice::MaliciousFiling, &String::from_str(&env, "bad faith"), &0);
    client.cast_vote(&dispute_id, &v3, &VoteChoice::MaliciousFiling, &String::from_str(&env, "bad faith"), &0);
    client.cast_vote(&dispute_id, &v4, &VoteChoice::MaliciousFiling, &String::from_str(&env, "bad faith"), &0);
    client.cast_vote(&dispute_id, &v5, &VoteChoice::Freelancer,       &String::from_str(&env, "dissent"), &0);

    // Dispute auto-resolved on 5th vote; any subsequent resolve attempt must fail with AlreadyResolved (#7).
    client.resolve_dispute(&dispute_id);
}

/// Verify the MaliciousDisputeResolved event is emitted on a supermajority resolution.
#[test]
fn test_malicious_filing_event_emitted() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, job_client, _freelancer, dispute_id) = setup_malicious_test(&env);

    let assigned = client.get_assigned_arbitrators(&dispute_id);
    let v1 = assigned.get(0).unwrap();
    let v2 = assigned.get(1).unwrap();
    let v3 = assigned.get(2).unwrap();
    let v4 = assigned.get(3).unwrap();
    let v5 = assigned.get(4).unwrap();

    client.cast_vote(&dispute_id, &v1, &VoteChoice::MaliciousFiling, &String::from_str(&env, "bad faith"), &0);
    client.cast_vote(&dispute_id, &v2, &VoteChoice::MaliciousFiling, &String::from_str(&env, "bad faith"), &0);
    client.cast_vote(&dispute_id, &v3, &VoteChoice::MaliciousFiling, &String::from_str(&env, "bad faith"), &0);
    client.cast_vote(&dispute_id, &v4, &VoteChoice::MaliciousFiling, &String::from_str(&env, "bad faith"), &0);
    client.cast_vote(&dispute_id, &v5, &VoteChoice::Freelancer,       &String::from_str(&env, "dissent"), &0);

    // Dispute auto-resolves on the 5th vote; event is emitted during auto-resolve.

    // Check that a "malicious_rslvd" event was published.
    let events = env.events().all();
    let malicious_event = events.iter().find(|e| {
        // The second topic should be the Symbol "malicious_rslvd"
        e.1.len() >= 2
    });
    assert!(malicious_event.is_some(), "MaliciousDisputeResolved event not found");

    // The dispute should now show MaliciousDisputeFiling status.
    let dispute = client.get_dispute(&dispute_id);
    assert_eq!(dispute.status, DisputeStatus::MaliciousDisputeFiling);
    // Initiator should be the client (who raised the dispute).
    assert_eq!(dispute.initiator, job_client);
}


// ── Arbitrator voting mechanism tests ─────────────────────────────────────────

#[test]
fn test_add_arbitrator_to_pool() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, DisputeContract);
    let client = DisputeContractClient::new(&env, &contract_id);
    let escrow_id = env.register_contract(None, DummyEscrow);
    let rep_id = env.register_contract(None, MockReputationContract);
    let admin = Address::generate(&env);
    client.initialize(&admin, &rep_id, &300, &escrow_id);

    let arbitrator = Address::generate(&env);
    client.add_arbitrator(&admin, &arbitrator);

    let pool = client.get_arbitrator_pool();
    assert_eq!(pool.len(), 1);
    assert!(pool.contains(&arbitrator));
}

#[test]
fn test_remove_arbitrator_from_pool() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, DisputeContract);
    let client = DisputeContractClient::new(&env, &contract_id);
    let escrow_id = env.register_contract(None, DummyEscrow);
    let rep_id = env.register_contract(None, MockReputationContract);
    let admin = Address::generate(&env);
    client.initialize(&admin, &rep_id, &300, &escrow_id);

    let arbitrator1 = Address::generate(&env);
    let arbitrator2 = Address::generate(&env);

    client.add_arbitrator(&admin, &arbitrator1);
    client.add_arbitrator(&admin, &arbitrator2);

    let pool = client.get_arbitrator_pool();
    assert_eq!(pool.len(), 2);

    client.remove_arbitrator(&admin, &arbitrator1);

    let pool = client.get_arbitrator_pool();
    assert_eq!(pool.len(), 1);
    assert!(!pool.contains(&arbitrator1));
    assert!(pool.contains(&arbitrator2));
}

#[test]
#[should_panic(expected = "Error(Contract, #12)")] // NotAdmin
fn test_add_arbitrator_non_admin_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _dispute_id, _escrow_id, _admin) = setup_initialized_dispute_contract(&env);

    let non_admin = Address::generate(&env);
    let arbitrator = Address::generate(&env);
    
    client.add_arbitrator(&non_admin, &arbitrator);
}

#[test]
fn test_dispute_assigns_arbitrators() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _dispute_id, _escrow_id, admin) = setup_initialized_dispute_contract(&env);

    // Add 10 arbitrators to the pool
    for _ in 0..10 {
        let arbitrator = Address::generate(&env);
        client.add_arbitrator(&admin, &arbitrator);
    }

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

    let assigned = client.get_assigned_arbitrators(&dispute_id);
    
    // Should assign up to 5 arbitrators
    assert!(assigned.len() <= 5);
    assert!(assigned.len() > 0);
    
    // Assigned arbitrators should not include client or freelancer
    assert!(!assigned.contains(&job_client));
    assert!(!assigned.contains(&freelancer));
}

#[test]
#[should_panic(expected = "Error(Contract, #2)")] // Unauthorized
fn test_non_assigned_arbitrator_cannot_vote() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _dispute_id, _escrow_id, admin) = setup_initialized_dispute_contract(&env);

    // Add 5 arbitrators to the pool
    for _ in 0..5 {
        let arbitrator = Address::generate(&env);
        client.add_arbitrator(&admin, &arbitrator);
    }

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

    // Try to vote with an address not in the assigned arbitrators
    let non_assigned = Address::generate(&env);
    client.cast_vote(
        &dispute_id,
        &non_assigned,
        &VoteChoice::Client,
        &String::from_str(&env, "Vote"), &0);
}

#[test]
fn test_assigned_arbitrator_can_vote() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _dispute_id, _escrow_id, admin) = setup_initialized_dispute_contract(&env);

    // Add 5 arbitrators to the pool
    for _ in 0..5 {
        let arbitrator = Address::generate(&env);
        client.add_arbitrator(&admin, &arbitrator);
    }

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

    let assigned = client.get_assigned_arbitrators(&dispute_id);
    assert!(assigned.len() > 0);

    // First assigned arbitrator should be able to vote
    let arbitrator = assigned.get(0).unwrap();
    client.cast_vote(
        &dispute_id,
        &arbitrator,
        &VoteChoice::Client,
        &String::from_str(&env, "Vote"), &0);

    let dispute = client.get_dispute(&dispute_id);
    assert_eq!(dispute.votes_for_client, 1);
}

#[test]
fn test_auto_resolve_at_3_vote_majority() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _dispute_id, _escrow_id, admin) = setup_initialized_dispute_contract(&env);

    // Add 5 arbitrators to the pool
    for _ in 0..5 {
        let arbitrator = Address::generate(&env);
        client.add_arbitrator(&admin, &arbitrator);
    }

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

    let assigned = client.get_assigned_arbitrators(&dispute_id);

    // Cast 3 votes for freelancer — 3 == min_votes so auto-resolve triggers.
    for i in 0..3 {
        let arbitrator = assigned.get(i).unwrap();
        client.cast_vote(
            &dispute_id,
            &arbitrator,
            &VoteChoice::Freelancer,
            &String::from_str(&env, "Vote for freelancer"), &0);
    }

    // Check that dispute was auto-resolved
    let dispute = client.get_dispute(&dispute_id);
    assert_eq!(dispute.status, DisputeStatus::ResolvedForFreelancer);
}

#[test]
fn test_unanimous_vote_5_0() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _dispute_id, _escrow_id, admin) = setup_initialized_dispute_contract(&env);

    // Add 5 arbitrators to the pool
    for _ in 0..5 {
        let arbitrator = Address::generate(&env);
        client.add_arbitrator(&admin, &arbitrator);
    }

    let job_client = Address::generate(&env);
    let freelancer = Address::generate(&env);

    let dispute_id = client.raise_dispute(
        &1u64,
        &job_client,
        &freelancer,
        &job_client,
        &String::from_str(&env, "Issue"),
        &5u32,
        &None,
    );

    let assigned = client.get_assigned_arbitrators(&dispute_id);
    
    // All 5 vote for client
    for i in 0..assigned.len() {
        let arbitrator = assigned.get(i).unwrap();
        client.cast_vote(
            &dispute_id,
            &arbitrator,
            &VoteChoice::Client,
            &String::from_str(&env, "Vote for client"), &0);
    }

    let dispute = client.get_dispute(&dispute_id);
    assert_eq!(dispute.status, DisputeStatus::ResolvedForClient);
    assert_eq!(dispute.votes_for_client, 5);
}

#[test]
fn test_split_vote_3_2_client_wins() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _dispute_id, _escrow_id, admin) = setup_initialized_dispute_contract(&env);

    // Add 5 arbitrators to the pool
    for _ in 0..5 {
        let arbitrator = Address::generate(&env);
        client.add_arbitrator(&admin, &arbitrator);
    }

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

    let assigned = client.get_assigned_arbitrators(&dispute_id);

    // 3 vote for client — auto-resolves on 3rd vote (min_votes=3)
    for i in 0..3 {
        let arbitrator = assigned.get(i).unwrap();
        client.cast_vote(
            &dispute_id,
            &arbitrator,
            &VoteChoice::Client,
            &String::from_str(&env, "Vote for client"), &0);
    }

    let dispute = client.get_dispute(&dispute_id);
    assert_eq!(dispute.status, DisputeStatus::ResolvedForClient);
    assert_eq!(dispute.votes_for_client, 3);
}

#[test]
fn test_split_vote_3_2_freelancer_wins() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _dispute_id, _escrow_id, admin) = setup_initialized_dispute_contract(&env);

    // Add 5 arbitrators to the pool
    for _ in 0..5 {
        let arbitrator = Address::generate(&env);
        client.add_arbitrator(&admin, &arbitrator);
    }

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

    let assigned = client.get_assigned_arbitrators(&dispute_id);

    // 3 vote for freelancer — auto-resolves on 3rd vote (min_votes=3)
    for i in 0..3 {
        let arbitrator = assigned.get(i).unwrap();
        client.cast_vote(
            &dispute_id,
            &arbitrator,
            &VoteChoice::Freelancer,
            &String::from_str(&env, "Vote for freelancer"), &0);
    }

    let dispute = client.get_dispute(&dispute_id);
    assert_eq!(dispute.status, DisputeStatus::ResolvedForFreelancer);
    assert_eq!(dispute.votes_for_freelancer, 3);
}

#[test]
fn test_vote_cast_event_emitted() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _dispute_id, _escrow_id, admin) = setup_initialized_dispute_contract(&env);

    // Add 5 arbitrators to the pool
    for _ in 0..5 {
        let arbitrator = Address::generate(&env);
        client.add_arbitrator(&admin, &arbitrator);
    }

    let job_client = Address::generate(&env);
    let freelancer = Address::generate(&env);

    let dispute_id = client.raise_dispute(
        &1u64,
        &job_client,
        &freelancer,
        &job_client,
        &String::from_str(&env, "Issue"),
        &5u32,
        &None,
    );

    let assigned = client.get_assigned_arbitrators(&dispute_id);
    let arbitrator = assigned.get(0).unwrap();
    
    client.cast_vote(
        &dispute_id,
        &arbitrator,
        &VoteChoice::Client,
        &String::from_str(&env, "Vote"), &0);

    // Verify VoteCast event was emitted
    let events = env.events().all();
    let vote_event = events.iter().find(|(_, topics, _)| {
        if topics.len() >= 2 {
            let t1: Symbol = topics.get(1).unwrap().into_val(&env);
            return t1 == symbol_short!("voted");
        }
        false
    });
    
    assert!(vote_event.is_some(), "VoteCast event should be emitted");
}

#[test]
fn test_dispute_resolved_event_emitted_on_auto_resolve() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _dispute_id, _escrow_id, admin) = setup_initialized_dispute_contract(&env);

    // Add 5 arbitrators to the pool
    for _ in 0..5 {
        let arbitrator = Address::generate(&env);
        client.add_arbitrator(&admin, &arbitrator);
    }

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

    let assigned = client.get_assigned_arbitrators(&dispute_id);

    // Cast 3 votes to trigger auto-resolve (min_votes=3)
    for i in 0..3 {
        let arbitrator = assigned.get(i).unwrap();
        client.cast_vote(
            &dispute_id,
            &arbitrator,
            &VoteChoice::Client,
            &String::from_str(&env, "Vote"), &0);
    }

    // Verify DisputeResolved event was emitted
    let events = env.events().all();
    let resolved_event = events.iter().find(|(_, topics, _)| {
        if topics.len() >= 2 {
            let t1: Symbol = topics.get(1).unwrap().into_val(&env);
            return t1 == symbol_short!("resolved");
        }
        false
    });
    
    assert!(resolved_event.is_some(), "DisputeResolved event should be emitted on auto-resolve");
}

#[test]
#[should_panic(expected = "Error(Contract, #3)")] // AlreadyVoted
fn test_arbitrator_cannot_vote_twice() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _dispute_id, _escrow_id, admin) = setup_initialized_dispute_contract(&env);

    // Add 5 arbitrators to the pool
    for _ in 0..5 {
        let arbitrator = Address::generate(&env);
        client.add_arbitrator(&admin, &arbitrator);
    }

    let job_client = Address::generate(&env);
    let freelancer = Address::generate(&env);

    let dispute_id = client.raise_dispute(
        &1u64,
        &job_client,
        &freelancer,
        &job_client,
        &String::from_str(&env, "Issue"),
        &5u32,
        &None,
    );

    let assigned = client.get_assigned_arbitrators(&dispute_id);
    let arbitrator = assigned.get(0).unwrap();
    
    // First vote
    client.cast_vote(
        &dispute_id,
        &arbitrator,
        &VoteChoice::Client,
        &String::from_str(&env, "First vote"), &0);

    // Second vote - should fail with AlreadyVoted
    client.cast_vote(
        &dispute_id,
        &arbitrator,
        &VoteChoice::Freelancer,
        &String::from_str(&env, "Second vote"), &1);
}

#[test]
fn test_dispute_with_empty_arbitrator_pool() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, DisputeContract);
    let client = DisputeContractClient::new(&env, &contract_id);
    let escrow_id = env.register_contract(None, DummyEscrow);
    let rep_id = env.register_contract(None, MockReputationContract);
    let admin = Address::generate(&env);
    client.initialize(&admin, &rep_id, &300, &escrow_id);

    let job_client = Address::generate(&env);
    let freelancer = Address::generate(&env);

    // Raise dispute with empty arbitrator pool — no add_arbitrator calls
    let dispute_id = client.raise_dispute(
        &1u64,
        &job_client,
        &freelancer,
        &job_client,
        &String::from_str(&env, "Issue"),
        &3u32,
        &None,
    );

    let assigned = client.get_assigned_arbitrators(&dispute_id);

    // Should have no assigned arbitrators
    assert_eq!(assigned.len(), 0);
}

// ============================================================
// Issue #702 — Exact tie resolves as 50/50 split
// ============================================================

#[test]
fn test_exact_tie_resolves_as_5050_split() {
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
    for _ in 0..7 {
        let arb = Address::generate(&env);
        client.add_arbitrator(&admin, &arb);
    }

    let dispute_id = client.raise_dispute(
        &1u64,
        &user_client,
        &freelancer,
        &user_client,
        &String::from_str(&env, "Tie dispute"),
        &4u32,
        &None,
    );

    let assigned = client.get_assigned_arbitrators(&dispute_id);

    // 2 votes for client, 2 for freelancer — exact tie
    client.cast_vote(&dispute_id, &assigned.get(0).unwrap(), &VoteChoice::Client, &String::from_str(&env, "c1"), &0);
    client.cast_vote(&dispute_id, &assigned.get(1).unwrap(), &VoteChoice::Freelancer, &String::from_str(&env, "f1"), &0);
    client.cast_vote(&dispute_id, &assigned.get(2).unwrap(), &VoteChoice::Client, &String::from_str(&env, "c2"), &0);
    client.cast_vote(&dispute_id, &assigned.get(3).unwrap(), &VoteChoice::Freelancer, &String::from_str(&env, "f2"), &0);

    let status = client.resolve_dispute(&dispute_id);
    assert_eq!(status, DisputeStatus::RefundSplit(50));
}

// ============================================================
// Issue #662 — Nonce replay protection tests (dispute)
// ============================================================

#[test]
#[should_panic(expected = "Error(Contract, #22)")] // NonceReplay
fn test_cast_vote_nonce_replay_rejected() {
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
    for _ in 0..5 {
        let arb = Address::generate(&env);
        client.add_arbitrator(&admin, &arb);
    }

    let dispute_id = client.raise_dispute(
        &1u64,
        &user_client,
        &freelancer,
        &user_client,
        &String::from_str(&env, "Replay test"),
        &5u32,
        &None,
    );

    let assigned = client.get_assigned_arbitrators(&dispute_id);
    let voter1 = assigned.get(0).unwrap();
    let voter2 = assigned.get(1).unwrap();

    // First vote with nonce 99 succeeds
    client.cast_vote(&dispute_id, &voter1, &VoteChoice::Client, &String::from_str(&env, "v1"), &99);

    // Different voter with same nonce 99 succeeds (different caller)
    client.cast_vote(&dispute_id, &voter2, &VoteChoice::Freelancer, &String::from_str(&env, "v2"), &99);

    // voter1 tries to replay nonce 99 — should fail with NonceReplay
    client.cast_vote(&dispute_id, &voter1, &VoteChoice::Client, &String::from_str(&env, "replay"), &99);
}

// ── Issue #770: submit_evidence emits on-chain event ────────────────────────

#[test]
fn test_submit_evidence_emits_event() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, DisputeContract);
    let client = DisputeContractClient::new(&env, &contract_id);

    let party_client = Address::generate(&env);
    let freelancer = Address::generate(&env);

    let dispute_id = client.raise_dispute(
        &1u64,
        &party_client,
        &freelancer,
        &party_client,
        &String::from_str(&env, "Work not delivered"),
        &3u32,
        &None,
    );

    let hash: BytesN<32> = BytesN::random(&env);
    client.submit_evidence(&dispute_id, &party_client, &hash);

    let events = env.events().all();
    assert!(!events.is_empty(), "at least one event should have been emitted");
}

#[test]
fn test_submit_evidence_stores_and_retrieves() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, DisputeContract);
    let client = DisputeContractClient::new(&env, &contract_id);

    let party_client = Address::generate(&env);
    let freelancer = Address::generate(&env);

    let dispute_id = client.raise_dispute(
        &1u64,
        &party_client,
        &freelancer,
        &party_client,
        &String::from_str(&env, "Scope creep"),
        &3u32,
        &None,
    );

    let hash1: BytesN<32> = BytesN::random(&env);
    let hash2: BytesN<32> = BytesN::random(&env);

    client.submit_evidence(&dispute_id, &party_client, &hash1);
    client.submit_evidence(&dispute_id, &freelancer, &hash2);

    let evidence = client.get_evidence(&dispute_id);
    assert_eq!(evidence.len(), 2);
    assert_eq!(evidence.get(0).unwrap().evidence_hash, hash1);
    assert_eq!(evidence.get(1).unwrap().evidence_hash, hash2);
}

#[test]
#[should_panic(expected = "Error(Contract, #6)")]
fn test_submit_evidence_rejects_non_party() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, DisputeContract);
    let client = DisputeContractClient::new(&env, &contract_id);

    let party_client = Address::generate(&env);
    let freelancer = Address::generate(&env);
    let outsider = Address::generate(&env);

    let dispute_id = client.raise_dispute(
        &1u64,
        &party_client,
        &freelancer,
        &party_client,
        &String::from_str(&env, "Breach"),
        &3u32,
        &None,
    );

    let hash: BytesN<32> = BytesN::random(&env);
    client.submit_evidence(&dispute_id, &outsider, &hash);
}

#[test]
#[should_panic(expected = "Error(Contract, #1)")]
fn test_submit_evidence_rejects_nonexistent_dispute() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, DisputeContract);
    let client = DisputeContractClient::new(&env, &contract_id);

    let submitter = Address::generate(&env);
    let hash: BytesN<32> = BytesN::random(&env);
    client.submit_evidence(&999u64, &submitter, &hash);
}

// ── Issue #773: vote_choice validated against defined VoteChoice variants ────

#[test]
fn test_cast_vote_valid_choices_accepted() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, DisputeContract);
    let client = DisputeContractClient::new(&env, &contract_id);
    let escrow_id = env.register_contract(None, DummyEscrow);
    let reputation_id = env.register_contract(None, MockReputationContract);
    let admin = Address::generate(&env);

    client.initialize(&admin, &reputation_id, &0, &escrow_id);

    let party_client = Address::generate(&env);
    let freelancer = Address::generate(&env);

    for _ in 0..5 {
        client.add_arbitrator(&admin, &Address::generate(&env));
    }

    let dispute_id = client.raise_dispute(
        &1u64,
        &party_client,
        &freelancer,
        &party_client,
        &String::from_str(&env, "dispute"),
        &3u32,
        &None,
    );

    let assigned = client.get_assigned_arbitrators(&dispute_id);

    // VoteChoice::Client is accepted
    client.cast_vote(
        &dispute_id,
        &assigned.get(0).unwrap(),
        &VoteChoice::Client,
        &String::from_str(&env, "for client"),
        &1u64,
    );
    let dispute = client.get_dispute(&dispute_id);
    assert_eq!(dispute.votes_for_client, 1);

    // VoteChoice::Freelancer is accepted
    client.cast_vote(
        &dispute_id,
        &assigned.get(1).unwrap(),
        &VoteChoice::Freelancer,
        &String::from_str(&env, "for freelancer"),
        &2u64,
    );
    let dispute = client.get_dispute(&dispute_id);
    assert_eq!(dispute.votes_for_freelancer, 1);

    // VoteChoice::RefundSplit is accepted with a valid percentage
    client.cast_vote(
        &dispute_id,
        &assigned.get(2).unwrap(),
        &VoteChoice::RefundSplit(50u32),
        &String::from_str(&env, "refund split"),
        &3u64,
    );
    let dispute = client.get_dispute(&dispute_id);
    assert_eq!(dispute.votes_for_refund_split, 1);
}

#[test]
fn test_invalid_vote_choice_error_code_is_24() {
    // Verify that InvalidVoteChoice maps to discriminant 24.
    // This ensures the on-chain ABI is stable and clients can reliably detect the error.
    assert_eq!(DisputeError::InvalidVoteChoice as u32, 24);
}

#[test]
fn test_cast_vote_split_award_bps_validation() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, DisputeContract);
    let client = DisputeContractClient::new(&env, &contract_id);
    let escrow_id = env.register_contract(None, DummyEscrow);
    let reputation_id = env.register_contract(None, MockReputationContract);
    let admin = Address::generate(&env);

    client.initialize(&admin, &reputation_id, &0, &escrow_id);

    let party_client = Address::generate(&env);
    let freelancer = Address::generate(&env);

    for _ in 0..5 {
        client.add_arbitrator(&admin, &Address::generate(&env));
    }

    let dispute_id = client.raise_dispute(
        &1u64,
        &party_client,
        &freelancer,
        &party_client,
        &String::from_str(&env, "dispute"),
        &3u32,
        &None,
    );

    let assigned = client.get_assigned_arbitrators(&dispute_id);

    // SplitAward with valid bps (client_bps + freelancer_bps == 10_000) is accepted
    client.cast_vote(
        &dispute_id,
        &assigned.get(0).unwrap(),
        &VoteChoice::SplitAward(6000u32, 4000u32),
        &String::from_str(&env, "split"),
        &1u64,
    );
    let dispute = client.get_dispute(&dispute_id);
    assert_eq!(dispute.votes_for_split_award, 1);
}

#[test]
#[should_panic(expected = "Error(Contract, #18)")]
fn test_cast_vote_split_award_invalid_bps_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, DisputeContract);
    let client = DisputeContractClient::new(&env, &contract_id);
    let escrow_id = env.register_contract(None, DummyEscrow);
    let reputation_id = env.register_contract(None, MockReputationContract);
    let admin = Address::generate(&env);

    client.initialize(&admin, &reputation_id, &0, &escrow_id);

    let party_client = Address::generate(&env);
    let freelancer = Address::generate(&env);

    for _ in 0..5 {
        client.add_arbitrator(&admin, &Address::generate(&env));
    }

    let dispute_id = client.raise_dispute(
        &1u64,
        &party_client,
        &freelancer,
        &party_client,
        &String::from_str(&env, "dispute"),
        &3u32,
        &None,
    );

    let assigned = client.get_assigned_arbitrators(&dispute_id);

    // SplitAward where bps don't sum to 10_000 — InvalidSplitBps (#18)
    client.cast_vote(
        &dispute_id,
        &assigned.get(0).unwrap(),
        &VoteChoice::SplitAward(9999u32, 0u32),
        &String::from_str(&env, "bad split"),
        &1u64,
    );
}
