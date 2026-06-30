/// Property-based fuzz tests for reputation score arithmetic.
///
/// These tests exercise the pure scoring logic in isolation — no Soroban Env
/// required — so proptest can generate thousands of inputs quickly.
///
/// Run with: cargo test --package stellar-market-reputation

#[cfg(test)]
mod tests {
    use proptest::prelude::*;

    // -----------------------------------------------------------------------
    // Mirrors of the contract's pure arithmetic (kept in sync manually).
    // Any divergence here is itself a bug signal.
    // -----------------------------------------------------------------------

    const ONE_YEAR_IN_SECONDS: u64 = 31_536_000;
    const MAX_RATING: u32 = 5;
    const MIN_RATING: u32 = 1;
    const SCORE_SCALE: u64 = 100; // contract multiplies score by 100 before dividing

    /// Pure decay: retained_pct = saturating_sub(100, decay_rate * elapsed / year)
    fn apply_decay(total_score: u64, total_weight: u64, decay_rate: u32, elapsed_seconds: u64) -> (u64, u64) {
        if decay_rate == 0 || decay_rate >= 100 {
            return (total_score, total_weight);
        }
        let decay_amount = (decay_rate as u64).saturating_mul(elapsed_seconds) / ONE_YEAR_IN_SECONDS;
        let retained_pct = 100_u64.saturating_sub(decay_amount);
        (
            (total_score * retained_pct) / 100,
            (total_weight * retained_pct) / 100,
        )
    }

    /// Pure average: (total_score * 100) / total_weight, capped at 10_000.
    fn average_rating(total_score: u64, total_weight: u64) -> u64 {
        if total_weight == 0 {
            return 0;
        }
        ((total_score * SCORE_SCALE) / total_weight).min(10_000)
    }

    // -----------------------------------------------------------------------
    // Property 1: score with zero reviews returns 0
    // -----------------------------------------------------------------------
    #[test]
    fn prop_zero_reviews_returns_zero() {
        assert_eq!(average_rating(0, 0), 0);
    }

    // -----------------------------------------------------------------------
    // Property 2: average rating is always in [0, 10_000]
    // -----------------------------------------------------------------------
    proptest! {
        #[test]
        fn prop_average_rating_in_range(
            total_score in 0u64..=u64::MAX / 100,
            total_weight in 1u64..=u64::MAX / 100,
        ) {
            let avg = average_rating(total_score, total_weight);
            prop_assert!(avg <= 10_000, "average_rating exceeded 10_000: {}", avg);
        }
    }

    // -----------------------------------------------------------------------
    // Property 3: adding N valid reviews (rating 1–5, weight >= 1) never
    //             overflows u64 for reasonable review counts (up to 10_000).
    // -----------------------------------------------------------------------
    proptest! {
        #[test]
        fn prop_accumulate_reviews_no_overflow(
            ratings in proptest::collection::vec(MIN_RATING..=MAX_RATING, 1..=10_000usize),
            weight in 1u64..=1_000_000u64,
        ) {
            let mut total_score: u64 = 0;
            let mut total_weight: u64 = 0;
            for rating in &ratings {
                let delta_score = (*rating as u64).checked_mul(weight)
                    .expect("rating * weight overflowed u64");
                total_score = total_score.checked_add(delta_score)
                    .expect("total_score accumulated overflow");
                total_weight = total_weight.checked_add(weight)
                    .expect("total_weight accumulated overflow");
            }
            // Sanity: average is still in valid range
            let avg = average_rating(total_score, total_weight);
            prop_assert!(avg <= 10_000);
        }
    }

    // -----------------------------------------------------------------------
    // Property 4: decay never produces a score below zero (floor is 0)
    // -----------------------------------------------------------------------
    proptest! {
        #[test]
        fn prop_decay_never_below_zero(
            total_score in 0u64..=1_000_000u64,
            total_weight in 0u64..=1_000_000u64,
            decay_rate in 0u32..=100u32,
            elapsed in 0u64..=(ONE_YEAR_IN_SECONDS * 200),
        ) {
            let (s, w) = apply_decay(total_score, total_weight, decay_rate, elapsed);
            prop_assert!(s <= total_score, "score increased after decay: {} -> {}", total_score, s);
            prop_assert!(w <= total_weight, "weight increased after decay: {} -> {}", total_weight, w);
        }
    }

    // -----------------------------------------------------------------------
    // Property 5: unweighted average equals sum / n (integer division)
    //             when all weights are equal (weight = 1 per review).
    // -----------------------------------------------------------------------
    proptest! {
        #[test]
        fn prop_uniform_weight_average_equals_sum_div_n(
            ratings in proptest::collection::vec(MIN_RATING..=MAX_RATING, 1..=100usize),
        ) {
            let n = ratings.len() as u64;
            let sum: u64 = ratings.iter().map(|&r| r as u64).sum();

            // With weight=1 each: total_score=sum*1, total_weight=n
            let total_score = sum; // sum * 1
            let total_weight = n;  // n   * 1

            // Contract formula: (total_score * 100) / total_weight
            let contract_avg = average_rating(total_score, total_weight);
            // Expected integer division (scaled)
            let expected = (sum * SCORE_SCALE) / n;
            prop_assert_eq!(contract_avg, expected.min(10_000));
        }
    }

    // -----------------------------------------------------------------------
    // Property 6: fully-decayed reputation (decay_rate >= 100, large elapsed)
    //             leaves scores unchanged (rate >= 100 is a no-op guard).
    // -----------------------------------------------------------------------
    proptest! {
        #[test]
        fn prop_decay_rate_100_is_noop(
            total_score in 0u64..=1_000_000u64,
            total_weight in 0u64..=1_000_000u64,
            elapsed in 0u64..=(ONE_YEAR_IN_SECONDS * 10),
        ) {
            // decay_rate >= 100 is treated as no-op by the contract
            let (s, w) = apply_decay(total_score, total_weight, 100, elapsed);
            prop_assert_eq!(s, total_score);
            prop_assert_eq!(w, total_weight);
        }
    }
}
