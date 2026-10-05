use super::*;

fn vault() -> BatchVault {
    BatchVault {
        version: 1, batch: Pubkey::new_unique(), config: Pubkey::new_unique(),
        seller_payment_wallet: Pubkey::new_unique(), opens_at: 100, closes_at: 200,
        advance_eligible_at: 200 + ADVANCE_DELAY_SECONDS,
        balance_eligible_at: 200 + ADVANCE_DELAY_SECONDS + 1 + BALANCE_DELAY_SECONDS,
        total_deposited: 1000, total_cancelled: 0, total_topups: 0,
        total_admin_refunded: 0, total_seller_paid: 0, total_redirected: 0,
        frozen: false, manual_settlement: false, advance_claimed: false,
        balance_claimed: false, admin_sequence: 0, bump: 255,
    }
}

fn order() -> OrderReceipt {
    OrderReceipt { version: 1, vault: Pubkey::new_unique(), order_id: [1; 16],
        buyer: Pubkey::new_unique(), pickup_location_id: [2; 16], quantity: 1,
        amount_paid: 100, refunded_lamports: 0, purchased_at: 199,
        cancel_until: 199 + CANCELLATION_SECONDS, cancelled: false, bump: 255 }
}

#[test]
fn purchase_boundary_and_full_late_cancellation() {
    let v = vault();
    let mut args = PurchaseArgs { order_id: [1; 16], pickup_location_id: [2; 16],
        amount_lamports: 100, quantity: 1, quote_expires_at: 200 };
    assert!(validate_purchase(&v, &args, 99).is_err());
    assert!(validate_purchase(&v, &args, 100).is_ok());
    assert_eq!(validate_purchase(&v, &args, 199).unwrap(), 199 + 86_400);
    assert!(validate_purchase(&v, &args, 200).is_err());
    args.quote_expires_at = 199;
    assert!(validate_purchase(&v, &args, 199).is_err());
    args.quote_expires_at = 201;
    assert!(validate_purchase(&v, &args, 199).is_err());
    let o = order();
    assert_eq!(cancellation_due(&o, 200).unwrap(), 100); // batch already closed
    assert!(cancellation_due(&o, o.cancel_until - 1).is_ok());
    assert!(cancellation_due(&o, o.cancel_until).is_err());
}

#[test]
fn refunds_removed_from_advance_and_rounding_stays_in_balance() {
    let mut v = vault();
    v.total_cancelled = 1;
    assert!(v.advance_due(v.advance_eligible_at - 1).is_err());
    let advance = v.advance_due(v.advance_eligible_at).unwrap();
    assert_eq!(advance, 299); // floor(999 * .30)
    v.total_seller_paid = advance; v.advance_claimed = true;
    assert!(v.advance_due(v.advance_eligible_at).is_err());
    assert!(v.balance_due(v.balance_eligible_at - 1).is_err());
    assert_eq!(v.balance_due(v.balance_eligible_at).unwrap(), 700);
    v.total_seller_paid = 999; v.balance_claimed = true;
    assert!(v.balance_due(v.balance_eligible_at).is_err());
    assert_eq!(v.available().unwrap(), 0);
}

#[test]
fn late_first_claim_includes_unclaimed_advance_but_not_topups() {
    let mut v = vault(); v.total_topups = 2000;
    assert_eq!(v.balance_due(v.balance_eligible_at).unwrap(), 1000);
    v.total_seller_paid = 1000; v.balance_claimed = true;
    assert_eq!(v.available().unwrap(), 2000);
}

#[test]
fn freeze_blocks_payouts_but_does_not_change_cancellation() {
    let mut v = vault(); v.frozen = true;
    assert!(v.advance_due(v.advance_eligible_at).is_err());
    assert!(v.balance_due(v.balance_eligible_at).is_err());
    assert_eq!(cancellation_due(&order(), 201).unwrap(), 100);
    assert!(admin_movement_at(&v, 100, 0, [1; 32], v.advance_eligible_at - 1).is_err());
    assert!(admin_movement_at(&v, 100, 0, [1; 32], v.advance_eligible_at).is_ok());
}

#[test]
fn admin_resolution_requires_frozen_sufficient_pool_reason_and_fresh_sequence() {
    let mut v = vault(); let now = v.balance_eligible_at;
    assert!(admin_movement_at(&v, 100, 0, [1; 32], now).is_err());
    v.frozen = true;
    assert!(admin_movement_at(&v, 100, 1, [1; 32], now).is_err());
    assert!(admin_movement_at(&v, 100, 0, [0; 32], now).is_err());
    assert!(admin_movement_at(&v, 1001, 0, [1; 32], now).is_err());
    v.total_redirected = 100;
    mark_manual(&mut v, 0).unwrap();
    assert_eq!(v.admin_sequence, 1);
    v.frozen = false;
    assert!(v.balance_due(now).is_err()); // unfreezing does not undo reallocation
    assert_eq!(v.available().unwrap(), 900);
}

#[test]
fn aggregate_refunds_can_exceed_an_orders_remaining_70_percent() {
    let mut v = vault();
    v.total_seller_paid = 300; v.advance_claimed = true; v.frozen = true;
    // A 500-lamport purchase can be fully refunded from this batch's 700 balance.
    assert!(admin_movement_at(&v, 500, 0, [1; 32], v.balance_eligible_at).is_ok());
    v.total_admin_refunded = 500;
    assert_eq!(v.available().unwrap(), 200);
    assert!(admin_movement_at(&v, 500, 1, [1; 32], v.balance_eligible_at).is_err());
    v.total_topups = 300; v.admin_sequence = 1;
    assert!(admin_movement_at(&v, 500, 1, [1; 32], v.balance_eligible_at).is_ok());
}

#[test]
fn arithmetic_fails_closed_and_small_amounts_remain_claimable_at_final_deadline() {
    assert!(add(u64::MAX, 1).is_err());
    assert!(sub(0, 1).is_err());
    assert!(add_time(i64::MAX, 1).is_err());
    let mut v = vault(); v.total_deposited = 1;
    assert!(v.advance_due(v.advance_eligible_at).is_err());
    assert_eq!(v.balance_due(v.balance_eligible_at).unwrap(), 1);
    v.total_deposited = u64::MAX;
    assert_eq!(v.advance_due(v.advance_eligible_at).unwrap(),
        ((u64::MAX as u128) * 3000 / 10000) as u64);
    v.total_topups = 1;
    assert!(v.available().is_err());
}
