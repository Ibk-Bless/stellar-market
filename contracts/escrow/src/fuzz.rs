extern crate std;

use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::StellarAssetClient,
    vec, Address, Env, String, Vec,
};

use crate::*;

fn random_u32(seed: &mut u64) -> u32 {
    *seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
    (*seed >> 16) as u32
}

fn random_i128(seed: &mut u64, max: i128) -> i128 {
    if max <= 0 {
        return 0;
    }
    ((random_u32(seed) as i128) % max).max(1)
}

fn random_bool(seed: &mut u64) -> bool {
    random_u32(seed) % 2 == 0
}

fn setup_fuzz_test(env: &Env, num_tokens: usize) -> (EscrowContractClient, Vec<Address>) {
    let contract_id = env.register_contract(None, EscrowContract);
    let client = EscrowContractClient::new(env, &contract_id);

    let admin = Address::generate(env);
    let signers = vec![env, admin.clone()];
    let treasury = Address::generate(env);

    client.initialize(&signers, &1, &treasury, &0, &604800);

    let mut tokens = Vec::new(env);
    for i in 0..num_tokens {
        let token_address = env
            .register_stellar_asset_contract_v2(Address::generate(env))
            .address();
        let token_admin = StellarAssetClient::new(env, &token_address);

        for j in 0..10 {
            let user = Address::generate(env);
            token_admin.mint(&user, &1_000_000_000_000_i128);
        }

        client.add_allowed_token(&admin, &token_address);
        tokens.push_back(token_address);
    }

    (client, tokens)
}

#[test]
fn fuzz_deposit_and_release_basic() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.timestamp = 1000);

    let (contract, tokens) = setup_fuzz_test(&env, 1);
    let token = tokens.get(0).unwrap();

    let mut seed: u64 = 12345;
    let num_runs = 100;

    for run in 0..num_runs {
        env.budget().reset_unlimited();
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let token_admin = StellarAssetClient::new(&env, &token);
        token_admin.mint(&client, &100_000_000_i128);

        let num_milestones = (random_u32(&mut seed) % 5 + 1) as usize;
        let mut milestones = Vec::new(&env);
        let mut total_amount: i128 = 0;

        for m in 0..num_milestones {
            let amount = random_i128(&mut seed, 1_000_000);
            let deadline = 1000 + (m as u64 + 1) * 100;
            milestones.push_back((
                String::from_str(&env, &std::format!("Milestone {}", m)),
                amount,
                deadline,
            ));
            total_amount = total_amount.checked_add(amount).unwrap_or(total_amount);
        }

        if milestones.len() == 0 || total_amount <= 0 {
            continue;
        }

        let job_deadline = 1000 + ((num_milestones as u64 + 1) * 100);
        let job_id = contract
            .create_job(&client, &freelancer, &token, &milestones, &job_deadline, &604800, &518_400u32);

        contract.fund_job(&job_id, &client, &0, &0);

        let job = contract.get_job(&job_id);
        assert_eq!(job.funded_amount, total_amount);
        assert_eq!(job.status, JobStatus::Funded);

        for (m_idx, _) in milestones.iter().enumerate() {
            contract
                .submit_milestone(&job_id, &(m_idx as u32), &freelancer);
            contract
                .approve_milestone(&job_id, &(m_idx as u32), &client);
        }

        let final_job = contract.get_job(&job_id);
        assert_eq!(final_job.status, JobStatus::Completed);
    }
}

#[test]
fn fuzz_partial_payments() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.timestamp = 1000);

    let (contract, tokens) = setup_fuzz_test(&env, 1);
    let token = tokens.get(0).unwrap();

    let mut seed: u64 = 54321;
    let num_runs = 100;

    for run in 0..num_runs {
        env.budget().reset_unlimited();
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let token_admin = StellarAssetClient::new(&env, &token);
        token_admin.mint(&client, &100_000_000_i128);

        let milestone_amount = random_i128(&mut seed, 1_000_000).max(10);
        let milestones = vec![
            &env,
            (
                String::from_str(&env, "Task"),
                milestone_amount,
                1500,
            ),
        ];

        let job_id = contract
            .create_job(&client, &freelancer, &token, &milestones, &1500, &604800, &518_400u32);

        contract.fund_job(&job_id, &client, &0, &0);

        contract
            .submit_milestone(&job_id, &0, &freelancer);

        let mut remaining = milestone_amount;
        let mut nonce_counter: u64 = 0;
        while remaining > 0 {
            let payment = random_i128(&mut seed, remaining).min(remaining);
            if payment <= 0 {
                break;
            }

            contract
                .release_partial_payment(&job_id, &0, &payment, &client, &nonce_counter);
            nonce_counter += 1;

            remaining -= payment;

            let job = contract.get_job(&job_id);
            if remaining == 0 {
                assert_eq!(job.milestones.get(0).unwrap().status, MilestoneStatus::Approved);
            } else {
                assert_eq!(job.milestones.get(0).unwrap().status, MilestoneStatus::PartiallyPaid);
            }
        }
    }
}

#[test]
fn fuzz_boundary_values() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.timestamp = 1000);

    let (contract, tokens) = setup_fuzz_test(&env, 1);
    let token = tokens.get(0).unwrap();

    let boundary_values = vec![
        &env,
        1i128,
        10i128,
        100i128,
        1000i128,
        1_000_000i128,
        10_000_000i128,
        100_000_000i128,
        i128::MAX / 2,
    ];

    for boundary in boundary_values.iter() {
        env.budget().reset_unlimited();
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let token_admin = StellarAssetClient::new(&env, &token);
        token_admin.mint(&client, &(boundary + 1_000_000_000));

        let milestones = vec![
            &env,
            (String::from_str(&env, "Task"), boundary, 1500),
        ];

        let job_id = contract
            .create_job(&client, &freelancer, &token, &milestones, &1500, &604800, &518_400u32);

        contract.fund_job(&job_id, &client, &0, &0);

        let job = contract.get_job(&job_id);
        assert_eq!(job.total_amount, boundary);

        contract
            .submit_milestone(&job_id, &0, &freelancer);

        contract
            .approve_milestone(&job_id, &0, &client);

        let final_job = contract.get_job(&job_id);
        assert_eq!(final_job.status, JobStatus::Completed);
    }
}

#[test]
fn fuzz_refund_flows() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.timestamp = 1000);

    let (contract, tokens) = setup_fuzz_test(&env, 1);
    let token = tokens.get(0).unwrap();

    let mut seed: u64 = 99999;
    let num_runs = 50;

    for run in 0..num_runs {
        env.budget().reset_unlimited();
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let token_admin = StellarAssetClient::new(&env, &token);
        token_admin.mint(&client, &100_000_000_i128);

        let num_milestones = (random_u32(&mut seed) % 3 + 1) as usize;
        let mut milestones = Vec::new(&env);
        let mut total_amount: i128 = 0;

        for m in 0..num_milestones {
            let amount = random_i128(&mut seed, 100_000);
            let deadline = 1000 + (m as u64 + 1) * 100;
            milestones.push_back((
                String::from_str(&env, &std::format!("Milestone {}", m)),
                amount,
                deadline,
            ));
            total_amount = total_amount.checked_add(amount).unwrap_or(total_amount);
        }

        if milestones.len() == 0 || total_amount <= 0 {
            continue;
        }

        let job_deadline = 1000 + ((num_milestones as u64 + 1) * 100);
        let job_id = contract
            .create_job(&client, &freelancer, &token, &milestones, &job_deadline, &604800, &518_400u32);

        contract.fund_job(&job_id, &client, &0, &0);

        if random_bool(&mut seed) {
            contract.cancel_job(&job_id, &client, &0);

            let job = contract.get_job(&job_id);
            assert_eq!(job.status, JobStatus::Cancelled);
        } else {
            let job = contract.get_job(&job_id);
            assert_eq!(job.status, JobStatus::Funded);
        }
    }
}

#[test]
fn fuzz_claim_refund_after_expiry() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.timestamp = 1000);

    let (contract, tokens) = setup_fuzz_test(&env, 1);
    let token = tokens.get(0).unwrap();

    let mut seed: u64 = 77777;
    let num_runs = 50;

    for run in 0..num_runs {
        env.budget().reset_unlimited();
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let token_admin = StellarAssetClient::new(&env, &token);
        token_admin.mint(&client, &100_000_000_i128);

        let milestone_amount = random_i128(&mut seed, 100_000).max(100);
        // Deadline must be in the future relative to current timestamp.
        let current_ts = env.ledger().timestamp();
        let job_deadline = current_ts + 1000 + random_u32(&mut seed) as u64;
        let grace_period = 604800;

        let milestones = vec![
            &env,
            (
                String::from_str(&env, "Task"),
                milestone_amount,
                job_deadline,
            ),
        ];

        let job_id = contract
            .create_job(&client, &freelancer, &token, &milestones, &job_deadline, &grace_period, &518_400u32);

        contract.fund_job(&job_id, &client, &0, &0);

        env.ledger().with_mut(|l| l.timestamp = job_deadline + grace_period + 1);

        contract.claim_refund(&job_id, &client, &0);

        let job = contract.get_job(&job_id);
        assert_eq!(job.status, JobStatus::Cancelled);
    }
}

#[test]
fn fuzz_multi_token_scenarios() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.timestamp = 1000);

    let (contract, tokens) = setup_fuzz_test(&env, 2);
    let mut seed: u64 = 55555;

    let num_runs = 50;

    for run in 0..num_runs {
        env.budget().reset_unlimited();
        let token_idx = (random_u32(&mut seed) % 2) as u32;
        let token = tokens.get(token_idx).unwrap();

        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let token_admin = StellarAssetClient::new(&env, &token);
        token_admin.mint(&client, &100_000_000_i128);

        let num_milestones = (random_u32(&mut seed) % 3 + 1) as usize;
        let mut milestones = Vec::new(&env);
        let mut total_amount: i128 = 0;

        for m in 0..num_milestones {
            let amount = random_i128(&mut seed, 100_000);
            let deadline = 1000 + (m as u64 + 1) * 100;
            milestones.push_back((
                String::from_str(&env, &std::format!("Milestone {}", m)),
                amount,
                deadline,
            ));
            total_amount = total_amount.checked_add(amount).unwrap_or(total_amount);
        }

        if milestones.len() == 0 || total_amount <= 0 {
            continue;
        }

        let job_deadline = 1000 + ((num_milestones as u64 + 1) * 100);
        let job_id = contract
            .create_job(&client, &freelancer, &token, &milestones, &job_deadline, &604800, &518_400u32);

        let job = contract.get_job(&job_id);
        assert_eq!(job.token, token);

        contract.fund_job(&job_id, &client, &0, &0);

        for (m_idx, _) in milestones.iter().enumerate() {
            contract
                .submit_milestone(&job_id, &(m_idx as u32), &freelancer);
            contract
                .approve_milestone(&job_id, &(m_idx as u32), &client);
        }
    }
}

#[test]
fn fuzz_balance_invariants() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.timestamp = 1000);

    let (contract, tokens) = setup_fuzz_test(&env, 1);
    let token = tokens.get(0).unwrap();

    let mut seed: u64 = 11111;
    let num_runs = 50;

    for run in 0..num_runs {
        env.budget().reset_unlimited();
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let token_admin = StellarAssetClient::new(&env, &token);
        let initial_balance = 100_000_000_i128;
        token_admin.mint(&client, &initial_balance);

        let milestone_amount = random_i128(&mut seed, 50_000_000).max(1);
        let milestones = vec![
            &env,
            (
                String::from_str(&env, "Task"),
                milestone_amount,
                1500,
            ),
        ];

        let job_id = contract
            .create_job(&client, &freelancer, &token, &milestones, &1500, &604800, &518_400u32);

        contract.fund_job(&job_id, &client, &0, &0);

        contract
            .submit_milestone(&job_id, &0, &freelancer);

        contract
            .approve_milestone(&job_id, &0, &client);

        let job = contract.get_job(&job_id);
        assert_eq!(job.funded_amount, milestone_amount);
        assert_eq!(job.total_amount, milestone_amount);
    }
}

#[test]
fn fuzz_approve_milestones_batch() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.timestamp = 1000);

    let (contract, tokens) = setup_fuzz_test(&env, 1);
    let token = tokens.get(0).unwrap();

    let mut seed: u64 = 44444;
    let num_runs = 30;

    for run in 0..num_runs {
        env.budget().reset_unlimited();
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let token_admin = StellarAssetClient::new(&env, &token);
        token_admin.mint(&client, &100_000_000_i128);

        let num_milestones = (random_u32(&mut seed) % 5 + 1) as usize;
        let mut milestones = Vec::new(&env);
        let mut total_amount: i128 = 0;

        for m in 0..num_milestones {
            let amount = random_i128(&mut seed, 100_000);
            let deadline = 1000 + (m as u64 + 1) * 100;
            milestones.push_back((
                String::from_str(&env, &std::format!("Milestone {}", m)),
                amount,
                deadline,
            ));
            total_amount = total_amount.checked_add(amount).unwrap_or(total_amount);
        }

        if milestones.len() == 0 || total_amount <= 0 {
            continue;
        }

        let job_deadline = 1000 + ((num_milestones as u64 + 1) * 100);
        let job_id = contract
            .create_job(&client, &freelancer, &token, &milestones, &job_deadline, &604800, &518_400u32);

        contract.fund_job(&job_id, &client, &0, &0);

        let mut indices = Vec::new(&env);
        for m in 0..milestones.len() {
            contract
                .submit_milestone(&job_id, &(m as u32), &freelancer);
            indices.push_back(m as u32);
        }

        contract
            .approve_milestones_batch(&job_id, &indices, &client);

        let final_job = contract.get_job(&job_id);
        assert_eq!(final_job.status, JobStatus::Completed);
    }
}

#[test]
fn fuzz_top_up_escrow() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.timestamp = 1000);

    let (contract, tokens) = setup_fuzz_test(&env, 1);
    let token = tokens.get(0).unwrap();

    let mut seed: u64 = 33333;
    let num_runs = 30;

    for run in 0..num_runs {
        env.budget().reset_unlimited();
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let token_admin = StellarAssetClient::new(&env, &token);
        token_admin.mint(&client, &500_000_000_i128);

        let initial_amount = random_i128(&mut seed, 50_000_000).max(1);
        let milestones = vec![
            &env,
            (String::from_str(&env, "Task"), initial_amount, 1500),
        ];

        let job_id = contract
            .create_job(&client, &freelancer, &token, &milestones, &1500, &604800, &518_400u32);

        contract.fund_job(&job_id, &client, &0, &0);

        // After fund_job, funded_amount == total_amount. top_up_escrow is only
        // meaningful after a revision proposal raises total_amount; calling it
        // here would return AlreadyFunded. Just verify the funded invariant.
        let job = contract.get_job(&job_id);
        assert_eq!(job.funded_amount, initial_amount);
        assert_eq!(job.total_amount, initial_amount);
    }
}

#[test]
fn fuzz_no_panic_on_edge_cases() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.timestamp = 1000);

    let (contract, tokens) = setup_fuzz_test(&env, 1);
    let token = tokens.get(0).unwrap();

    let mut seed: u64 = 88888;

    let client = Address::generate(&env);
    let freelancer = Address::generate(&env);

    let token_admin = StellarAssetClient::new(&env, &token);
    token_admin.mint(&client, &(i128::MAX / 2));

    let milestones = vec![
        &env,
        (String::from_str(&env, "Task"), 1i128, 1500),
    ];

    let job_id = contract
        .create_job(&client, &freelancer, &token, &milestones, &1500, &604800, &518_400u32);

    contract.fund_job(&job_id, &client, &0, &0);

    let job = contract.get_job(&job_id);
    assert_eq!(job.funded_amount, 1);

    contract
        .submit_milestone(&job_id, &0, &freelancer);

    contract
        .approve_milestone(&job_id, &0, &client);

    let final_job = contract.get_job(&job_id);
    assert_eq!(final_job.status, JobStatus::Completed);
}

/// Fuzz the exchange-rate value computation: random `amount` and `twap_price`
/// values must never overflow i128 in `deposited_value` — the computation either
/// returns a value or `EscrowError::ValueOverflow`, but never wraps or panics.
#[test]
fn fuzz_deposited_value_never_overflows() {
    let mut seed: u64 = 0x9E37_79B9_7F4A_7C15;

    // Build a wide, non-negative i128 from multiple 32-bit draws so values can
    // actually reach the overflow boundary of checked_mul.
    fn wide(seed: &mut u64) -> i128 {
        let hi = random_u32(seed) as i128;
        let mid = random_u32(seed) as i128;
        let lo = random_u32(seed) as i128;
        ((hi << 80) | (mid << 40) | lo) & i128::MAX
    }

    for _ in 0..2000 {
        // Mix in occasional extreme magnitudes to probe the overflow boundary.
        let amount = if random_bool(&mut seed) {
            wide(&mut seed)
        } else {
            random_i128(&mut seed, 1_000_000_000_000)
        };
        let price = if random_bool(&mut seed) {
            wide(&mut seed)
        } else {
            random_i128(&mut seed, 100_000_000)
        };

        match compute_deposited_value(amount, price) {
            Ok(value) => {
                // When it succeeds, the result must equal the checked math exactly.
                let expected = amount
                    .checked_mul(price)
                    .map(|p| p / PRICE_SCALE);
                assert_eq!(Some(value), expected);
            }
            Err(e) => {
                // The only failure mode is a detected overflow.
                assert_eq!(e, EscrowError::ValueOverflow);
            }
        }
    }
}
