use anchor_lang::prelude::*;
use anchor_lang::system_program;
use circuit_drops::{
    BatchAccount, CircuitConfig, ADVANCE_BPS, ADVANCE_DELAY_SECONDS, BALANCE_DELAY_SECONDS,
    CANCELLATION_SECONDS, POLICY_VERSION,
};

// POC ID for compilation ONLY. Rotate both program IDs locally before deployment.
declare_id!("AWraC1ZQVWzjfRfzYB87U9nvEHYnowXrYTjZrdLVuDg9");

#[program]
pub mod circuit_escrow {
    use super::*;

    // Anyone may pay rent to initialize the unique vault for an authorized batch.
    // No recipient, dates, admin or policy is accepted from this caller.
    pub fn initialize_vault(ctx: Context<InitializeVault>) -> Result<()> {
        let batch = &ctx.accounts.batch;
        require!(
            batch.version == POLICY_VERSION,
            EscrowError::UnsupportedPolicy
        );
        require!(
            batch.cancellation_seconds == CANCELLATION_SECONDS && batch.advance_bps == ADVANCE_BPS,
            EscrowError::UnsupportedPolicy
        );
        require!(
            batch.closes_at > batch.opens_at
                && batch.production_starts_at >= add_time(batch.closes_at, ADVANCE_DELAY_SECONDS)?
                && batch.release_at > batch.production_starts_at
                && batch.advance_eligible_at == add_time(batch.closes_at, ADVANCE_DELAY_SECONDS)?
                && batch.balance_eligible_at == add_time(batch.release_at, BALANCE_DELAY_SECONDS)?,
            EscrowError::InvalidSchedule
        );
        require!(
            batch.seller_payment_wallet != ctx.accounts.vault.key()
                && batch.seller_payment_wallet != Pubkey::default(),
            EscrowError::InvalidRecipient
        );
        ctx.accounts.vault.set_inner(BatchVault {
            version: POLICY_VERSION,
            batch: batch.key(),
            config: ctx.accounts.config.key(),
            seller_payment_wallet: batch.seller_payment_wallet,
            opens_at: batch.opens_at,
            closes_at: batch.closes_at,
            advance_eligible_at: batch.advance_eligible_at,
            balance_eligible_at: batch.balance_eligible_at,
            total_deposited: 0,
            total_cancelled: 0,
            total_topups: 0,
            total_admin_refunded: 0,
            total_seller_paid: 0,
            total_redirected: 0,
            frozen: false,
            manual_settlement: false,
            advance_claimed: false,
            balance_claimed: false,
            admin_sequence: 0,
            bump: ctx.bumps.vault,
        });
        emit!(VaultInitialized {
            vault: ctx.accounts.vault.key(),
            batch: batch.key()
        });
        Ok(())
    }

    // Circuit co-signs the exact SOL quote, buyer, selected location and order ID.
    // There is no trusted client-side amount, USD conversion or supply counter.
    pub fn purchase(ctx: Context<Purchase>, args: PurchaseArgs) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let vault = &ctx.accounts.vault;
        let cancel_until = validate_purchase(vault, &args, now)?;
        // All additions and funding bounds are checked BEFORE the transfer.
        let deposited = add(vault.total_deposited, args.amount_lamports)?;
        add(deposited, vault.total_topups)?;
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.buyer.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                },
            ),
            args.amount_lamports,
        )?;
        ctx.accounts.vault.total_deposited = deposited;
        ctx.accounts.order.set_inner(OrderReceipt {
            version: POLICY_VERSION,
            vault: ctx.accounts.vault.key(),
            order_id: args.order_id,
            buyer: ctx.accounts.buyer.key(),
            pickup_location_id: args.pickup_location_id,
            quantity: args.quantity,
            amount_paid: args.amount_lamports,
            refunded_lamports: 0,
            purchased_at: now,
            cancel_until,
            cancelled: false,
            bump: ctx.bumps.order,
        });
        emit!(OrderPurchased {
            vault: ctx.accounts.vault.key(),
            order: ctx.accounts.order.key(),
            buyer: ctx.accounts.buyer.key(),
            amount: args.amount_lamports,
            cancel_until
        });
        Ok(())
    }

    // Cancellation remains available during a freeze. Admins cannot spend pool
    // funds before close+48h, so even the last buyer's 24h window stays funded.
    pub fn cancel_order(ctx: Context<CancelOrder>) -> Result<()> {
        let order = &ctx.accounts.order;
        let amount = cancellation_due(order, Clock::get()?.unix_timestamp)?;
        let cancelled = add(ctx.accounts.vault.total_cancelled, amount)?;
        send_from_vault(
            &ctx.accounts.vault,
            &ctx.accounts.buyer.to_account_info(),
            amount,
        )?;
        ctx.accounts.vault.total_cancelled = cancelled;
        ctx.accounts.order.refunded_lamports = ctx.accounts.order.amount_paid;
        ctx.accounts.order.cancelled = true;
        emit_movement(
            &ctx.accounts.vault,
            ctx.accounts.buyer.key(),
            ctx.accounts.buyer.key(),
            amount,
            0,
            ctx.accounts.order.key(),
            [0; 32],
        );
        Ok(())
    }

    // Permissionless execution; destination is ALWAYS the stored seller wallet.
    // A seller or a worker can trigger it without a fresh Circuit approval.
    pub fn claim_advance(ctx: Context<ClaimSeller>) -> Result<()> {
        let amount = ctx
            .accounts
            .vault
            .advance_due(Clock::get()?.unix_timestamp)?;
        let paid = add(ctx.accounts.vault.total_seller_paid, amount)?;
        send_from_vault(
            &ctx.accounts.vault,
            &ctx.accounts.recipient.to_account_info(),
            amount,
        )?;
        ctx.accounts.vault.total_seller_paid = paid;
        ctx.accounts.vault.advance_claimed = true;
        emit_movement(
            &ctx.accounts.vault,
            ctx.accounts.caller.key(),
            ctx.accounts.recipient.key(),
            amount,
            1,
            Pubkey::default(),
            [0; 32],
        );
        Ok(())
    }

    // If the advance was never claimed, this pays ALL unpaid purchase proceeds.
    // Topups/surplus donations are never included in ordinary seller entitlement.
    pub fn claim_balance(ctx: Context<ClaimSeller>) -> Result<()> {
        let amount = ctx
            .accounts
            .vault
            .balance_due(Clock::get()?.unix_timestamp)?;
        let paid = add(ctx.accounts.vault.total_seller_paid, amount)?;
        send_from_vault(
            &ctx.accounts.vault,
            &ctx.accounts.recipient.to_account_info(),
            amount,
        )?;
        ctx.accounts.vault.total_seller_paid = paid;
        ctx.accounts.vault.balance_claimed = true;
        emit_movement(
            &ctx.accounts.vault,
            ctx.accounts.caller.key(),
            ctx.accounts.recipient.key(),
            amount,
            2,
            Pubkey::default(),
            [0; 32],
        );
        Ok(())
    }

    pub fn set_frozen(
        ctx: Context<AdminControl>,
        frozen: bool,
        expected_sequence: u64,
        reason_hash: [u8; 32],
    ) -> Result<()> {
        authorize_decision(&ctx.accounts.vault, expected_sequence, reason_hash)?;
        ctx.accounts.vault.admin_sequence = add(expected_sequence, 1)?;
        ctx.accounts.vault.frozen = frozen;
        emit!(FreezeChanged {
            vault: ctx.accounts.vault.key(),
            admin: ctx.accounts.admin_authority.key(),
            frozen,
            sequence: ctx.accounts.vault.admin_sequence,
            reason_hash
        });
        Ok(())
    }

    pub fn admin_refund(
        ctx: Context<AdminRefund>,
        amount: u64,
        expected_sequence: u64,
        reason_hash: [u8; 32],
    ) -> Result<()> {
        prepare_admin_movement(&ctx.accounts.vault, amount, expected_sequence, reason_hash)?;
        require!(!ctx.accounts.order.cancelled, EscrowError::AlreadyCancelled);
        let refund = add(ctx.accounts.order.refunded_lamports, amount)?;
        require!(
            refund <= ctx.accounts.order.amount_paid,
            EscrowError::RefundExceedsPurchase
        );
        let total = add(ctx.accounts.vault.total_admin_refunded, amount)?;
        send_from_vault(
            &ctx.accounts.vault,
            &ctx.accounts.recipient.to_account_info(),
            amount,
        )?;
        ctx.accounts.order.refunded_lamports = refund;
        ctx.accounts.vault.total_admin_refunded = total;
        mark_manual(&mut ctx.accounts.vault, expected_sequence)?;
        emit_movement(
            &ctx.accounts.vault,
            ctx.accounts.admin_authority.key(),
            ctx.accounts.recipient.key(),
            amount,
            3,
            ctx.accounts.order.key(),
            reason_hash,
        );
        Ok(())
    }

    pub fn admin_pay_seller(
        ctx: Context<AdminTransfer>,
        amount: u64,
        expected_sequence: u64,
        reason_hash: [u8; 32],
    ) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.recipient.key(),
            ctx.accounts.vault.seller_payment_wallet,
            EscrowError::InvalidRecipient
        );
        prepare_admin_movement(&ctx.accounts.vault, amount, expected_sequence, reason_hash)?;
        let total = add(ctx.accounts.vault.total_seller_paid, amount)?;
        send_from_vault(
            &ctx.accounts.vault,
            &ctx.accounts.recipient.to_account_info(),
            amount,
        )?;
        ctx.accounts.vault.total_seller_paid = total;
        mark_manual(&mut ctx.accounts.vault, expected_sequence)?;
        emit_movement(
            &ctx.accounts.vault,
            ctx.accounts.admin_authority.key(),
            ctx.accounts.recipient.key(),
            amount,
            4,
            Pubkey::default(),
            reason_hash,
        );
        Ok(())
    }

    // Circuit can send remaining funds to ANY non-executable recipient, including
    // its own treasury, WITHOUT the seller signing. This is NOT a buyer refund.
    pub fn admin_redirect(
        ctx: Context<AdminTransfer>,
        amount: u64,
        expected_sequence: u64,
        reason_hash: [u8; 32],
    ) -> Result<()> {
        prepare_admin_movement(&ctx.accounts.vault, amount, expected_sequence, reason_hash)?;
        let total = add(ctx.accounts.vault.total_redirected, amount)?;
        send_from_vault(
            &ctx.accounts.vault,
            &ctx.accounts.recipient.to_account_info(),
            amount,
        )?;
        ctx.accounts.vault.total_redirected = total;
        mark_manual(&mut ctx.accounts.vault, expected_sequence)?;
        emit_movement(
            &ctx.accounts.vault,
            ctx.accounts.admin_authority.key(),
            ctx.accounts.recipient.key(),
            amount,
            5,
            Pubkey::default(),
            reason_hash,
        );
        Ok(())
    }

    // Voluntary contribution to THIS batch, not a refundable purchase.
    pub fn top_up(ctx: Context<TopUp>, amount: u64) -> Result<()> {
        require!(amount > 0, EscrowError::InvalidAmount);
        let topups = add(ctx.accounts.vault.total_topups, amount)?;
        add(ctx.accounts.vault.total_deposited, topups)?;
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.contributor.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                },
            ),
            amount,
        )?;
        ctx.accounts.vault.total_topups = topups;
        emit!(PoolFunded {
            vault: ctx.accounts.vault.key(),
            contributor: ctx.accounts.contributor.key(),
            amount,
            direct_transfer_surplus: false
        });
        Ok(())
    }

    // Recover donations sent directly to the PDA without a top_up instruction.
    // Rent is excluded and surplus is never treated as a buyer's purchase.
    pub fn sync_surplus(ctx: Context<SyncSurplus>) -> Result<()> {
        let info = ctx.accounts.vault.to_account_info();
        let spendable = sub(
            info.lamports(),
            Rent::get()?.minimum_balance(info.data_len()),
        )?;
        let extra = sub(spendable, ctx.accounts.vault.available()?)?;
        require!(extra > 0, EscrowError::NothingToPay);
        let topups = add(ctx.accounts.vault.total_topups, extra)?;
        add(ctx.accounts.vault.total_deposited, topups)?;
        ctx.accounts.vault.total_topups = topups;
        emit!(PoolFunded {
            vault: ctx.accounts.vault.key(),
            contributor: ctx.accounts.caller.key(),
            amount: extra,
            direct_transfer_surplus: true
        });
        Ok(())
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct PurchaseArgs {
    pub order_id: [u8; 16],
    pub pickup_location_id: [u8; 16],
    pub amount_lamports: u64,
    pub quantity: u32,
    pub quote_expires_at: i64,
}

#[derive(Accounts)]
pub struct InitializeVault<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [b"circuit-config"], bump = config.bump,
        seeds::program = circuit_drops::ID,
        constraint = config.version == POLICY_VERSION @ EscrowError::UnsupportedPolicy)]
    pub config: Account<'info, CircuitConfig>,
    #[account(seeds = [b"batch", batch.batch_id.as_ref()], bump = batch.bump,
        seeds::program = circuit_drops::ID,
        has_one = config @ EscrowError::WrongConfig)]
    pub batch: Account<'info, BatchAccount>,
    #[account(init, payer = payer, space = 8 + BatchVault::INIT_SPACE,
        seeds = [b"batch-vault", batch.key().as_ref()], bump)]
    pub vault: Account<'info, BatchVault>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(args: PurchaseArgs)]
pub struct Purchase<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    pub platform_authority: Signer<'info>,
    #[account(seeds = [b"circuit-config"], bump = config.bump,
        seeds::program = circuit_drops::ID,
        has_one = platform_authority @ EscrowError::UnauthorizedPlatform,
        constraint = config.version == POLICY_VERSION @ EscrowError::UnsupportedPolicy)]
    pub config: Account<'info, CircuitConfig>,
    #[account(mut, seeds = [b"batch-vault", vault.batch.as_ref()], bump = vault.bump,
        has_one = config @ EscrowError::WrongConfig,
        constraint = vault.version == POLICY_VERSION @ EscrowError::UnsupportedPolicy)]
    pub vault: Account<'info, BatchVault>,
    #[account(init, payer = buyer, space = 8 + OrderReceipt::INIT_SPACE,
        seeds = [b"order", vault.key().as_ref(), args.order_id.as_ref()], bump)]
    pub order: Account<'info, OrderReceipt>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CancelOrder<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(mut, seeds = [b"batch-vault", vault.batch.as_ref()], bump = vault.bump,
        constraint = vault.version == POLICY_VERSION @ EscrowError::UnsupportedPolicy)]
    pub vault: Account<'info, BatchVault>,
    #[account(mut, seeds = [b"order", vault.key().as_ref(), order.order_id.as_ref()], bump = order.bump,
        has_one = vault @ EscrowError::WrongVault,
        has_one = buyer @ EscrowError::UnauthorizedBuyer)]
    pub order: Account<'info, OrderReceipt>,
}

#[derive(Accounts)]
pub struct ClaimSeller<'info> {
    pub caller: Signer<'info>,
    #[account(mut, seeds = [b"batch-vault", vault.batch.as_ref()], bump = vault.bump,
        constraint = vault.version == POLICY_VERSION @ EscrowError::UnsupportedPolicy)]
    pub vault: Account<'info, BatchVault>,
    /// CHECK: Restricted to stored destination; send_from_vault rejects self/executable targets.
    #[account(mut, address = vault.seller_payment_wallet @ EscrowError::InvalidRecipient)]
    pub recipient: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct AdminControl<'info> {
    pub admin_authority: Signer<'info>,
    #[account(seeds = [b"circuit-config"], bump = config.bump, seeds::program = circuit_drops::ID,
        has_one = admin_authority @ EscrowError::UnauthorizedAdmin,
        constraint = config.version == POLICY_VERSION @ EscrowError::UnsupportedPolicy)]
    pub config: Account<'info, CircuitConfig>,
    #[account(mut, seeds = [b"batch-vault", vault.batch.as_ref()], bump = vault.bump,
        has_one = config @ EscrowError::WrongConfig,
        constraint = vault.version == POLICY_VERSION @ EscrowError::UnsupportedPolicy)]
    pub vault: Account<'info, BatchVault>,
}

#[derive(Accounts)]
pub struct AdminTransfer<'info> {
    pub admin_authority: Signer<'info>,
    #[account(seeds = [b"circuit-config"], bump = config.bump, seeds::program = circuit_drops::ID,
        has_one = admin_authority @ EscrowError::UnauthorizedAdmin,
        constraint = config.version == POLICY_VERSION @ EscrowError::UnsupportedPolicy)]
    pub config: Account<'info, CircuitConfig>,
    #[account(mut, seeds = [b"batch-vault", vault.batch.as_ref()], bump = vault.bump,
        has_one = config @ EscrowError::WrongConfig,
        constraint = vault.version == POLICY_VERSION @ EscrowError::UnsupportedPolicy)]
    pub vault: Account<'info, BatchVault>,
    /// CHECK: Circuit deliberately authorizes arbitrary destinations; checked on transfer.
    #[account(mut)]
    pub recipient: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct AdminRefund<'info> {
    pub admin_authority: Signer<'info>,
    #[account(seeds = [b"circuit-config"], bump = config.bump, seeds::program = circuit_drops::ID,
        has_one = admin_authority @ EscrowError::UnauthorizedAdmin,
        constraint = config.version == POLICY_VERSION @ EscrowError::UnsupportedPolicy)]
    pub config: Account<'info, CircuitConfig>,
    #[account(mut, seeds = [b"batch-vault", vault.batch.as_ref()], bump = vault.bump,
        has_one = config @ EscrowError::WrongConfig,
        constraint = vault.version == POLICY_VERSION @ EscrowError::UnsupportedPolicy)]
    pub vault: Account<'info, BatchVault>,
    #[account(mut, seeds = [b"order", vault.key().as_ref(), order.order_id.as_ref()], bump = order.bump,
        has_one = vault @ EscrowError::WrongVault)]
    pub order: Account<'info, OrderReceipt>,
    /// CHECK: A recorded refund may only go to the original buyer.
    #[account(mut, address = order.buyer @ EscrowError::InvalidRecipient)]
    pub recipient: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct TopUp<'info> {
    #[account(mut)]
    pub contributor: Signer<'info>,
    #[account(mut, seeds = [b"batch-vault", vault.batch.as_ref()], bump = vault.bump,
        constraint = vault.version == POLICY_VERSION @ EscrowError::UnsupportedPolicy)]
    pub vault: Account<'info, BatchVault>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SyncSurplus<'info> {
    pub caller: Signer<'info>,
    #[account(mut, seeds = [b"batch-vault", vault.batch.as_ref()], bump = vault.bump,
        constraint = vault.version == POLICY_VERSION @ EscrowError::UnsupportedPolicy)]
    pub vault: Account<'info, BatchVault>,
}

#[account]
#[derive(InitSpace)]
pub struct BatchVault {
    pub version: u8,
    pub batch: Pubkey,
    pub config: Pubkey,
    pub seller_payment_wallet: Pubkey,
    pub opens_at: i64,
    pub closes_at: i64,
    pub advance_eligible_at: i64,
    pub balance_eligible_at: i64,
    pub total_deposited: u64,
    pub total_cancelled: u64,
    pub total_topups: u64,
    pub total_admin_refunded: u64,
    pub total_seller_paid: u64,
    pub total_redirected: u64,
    pub frozen: bool,
    pub manual_settlement: bool,
    pub advance_claimed: bool,
    pub balance_claimed: bool,
    pub admin_sequence: u64,
    pub bump: u8,
}

impl BatchVault {
    pub fn available(&self) -> Result<u64> {
        let funded = add(self.total_deposited, self.total_topups)?;
        let refunds = add(self.total_cancelled, self.total_admin_refunded)?;
        let paid = add(self.total_seller_paid, self.total_redirected)?;
        sub(funded, add(refunds, paid)?)
    }

    fn normal_allowed(&self) -> Result<()> {
        require!(!self.frozen, EscrowError::VaultFrozen);
        require!(
            !self.manual_settlement,
            EscrowError::ManualSettlementRequired
        );
        require!(!self.balance_claimed, EscrowError::AlreadyPaid);
        Ok(())
    }

    fn advance_due(&self, now: i64) -> Result<u64> {
        self.normal_allowed()?;
        require!(now >= self.advance_eligible_at, EscrowError::PayoutTooEarly);
        require!(!self.advance_claimed, EscrowError::AlreadyPaid);
        let net = sub(self.total_deposited, self.total_cancelled)?;
        // Multiply in u128; remainder stays for the final payout.
        let entitlement = ((net as u128) * (ADVANCE_BPS as u128) / 10_000) as u64;
        let amount = sub(entitlement, self.total_seller_paid)?;
        require!(amount > 0, EscrowError::NothingToPay);
        Ok(amount)
    }

    fn balance_due(&self, now: i64) -> Result<u64> {
        self.normal_allowed()?;
        require!(now >= self.balance_eligible_at, EscrowError::PayoutTooEarly);
        let amount = sub(
            sub(self.total_deposited, self.total_cancelled)?,
            self.total_seller_paid,
        )?;
        require!(amount > 0, EscrowError::NothingToPay);
        Ok(amount)
    }
}

#[account]
#[derive(InitSpace)]
pub struct OrderReceipt {
    pub version: u8,
    pub vault: Pubkey,
    pub order_id: [u8; 16],
    pub buyer: Pubkey,
    pub pickup_location_id: [u8; 16],
    pub quantity: u32,
    pub amount_paid: u64,
    pub refunded_lamports: u64,
    pub purchased_at: i64,
    pub cancel_until: i64,
    pub cancelled: bool,
    pub bump: u8,
}

fn add(a: u64, b: u64) -> Result<u64> {
    a.checked_add(b)
        .ok_or_else(|| error!(EscrowError::Arithmetic))
}
fn sub(a: u64, b: u64) -> Result<u64> {
    a.checked_sub(b)
        .ok_or_else(|| error!(EscrowError::Arithmetic))
}
fn add_time(a: i64, b: i64) -> Result<i64> {
    a.checked_add(b)
        .ok_or_else(|| error!(EscrowError::Arithmetic))
}

fn validate_purchase(vault: &BatchVault, args: &PurchaseArgs, now: i64) -> Result<i64> {
    require!(
        !vault.frozen && !vault.manual_settlement,
        EscrowError::VaultFrozen
    );
    require!(
        now >= vault.opens_at && now < vault.closes_at,
        EscrowError::SalesClosed
    );
    require!(
        now < args.quote_expires_at && args.quote_expires_at <= vault.closes_at,
        EscrowError::QuoteExpired
    );
    require!(
        args.amount_lamports > 0 && args.quantity > 0,
        EscrowError::InvalidAmount
    );
    require!(
        args.order_id != [0; 16] && args.pickup_location_id != [0; 16],
        EscrowError::InvalidIdentity
    );
    add_time(now, CANCELLATION_SECONDS)
}

fn cancellation_due(order: &OrderReceipt, now: i64) -> Result<u64> {
    require!(!order.cancelled, EscrowError::AlreadyCancelled);
    require!(now < order.cancel_until, EscrowError::CancellationExpired);
    let amount = sub(order.amount_paid, order.refunded_lamports)?;
    require!(amount > 0, EscrowError::NothingToPay);
    Ok(amount)
}

fn authorize_decision(vault: &BatchVault, expected: u64, reason: [u8; 32]) -> Result<()> {
    require!(
        vault.admin_sequence == expected,
        EscrowError::AdminSequenceConflict
    );
    require!(reason != [0; 32], EscrowError::ReasonRequired);
    Ok(())
}

fn prepare_admin_movement(
    vault: &BatchVault,
    amount: u64,
    expected: u64,
    reason: [u8; 32],
) -> Result<()> {
    admin_movement_at(
        vault,
        amount,
        expected,
        reason,
        Clock::get()?.unix_timestamp,
    )
}

fn admin_movement_at(
    vault: &BatchVault,
    amount: u64,
    expected: u64,
    reason: [u8; 32],
    now: i64,
) -> Result<()> {
    authorize_decision(vault, expected, reason)?;
    require!(vault.frozen, EscrowError::FreezeRequired);
    require!(
        now >= vault.advance_eligible_at,
        EscrowError::CancellationProtection
    );
    require!(amount > 0, EscrowError::InvalidAmount);
    require!(amount <= vault.available()?, EscrowError::InsufficientPool);
    Ok(())
}

fn mark_manual(vault: &mut BatchVault, expected: u64) -> Result<()> {
    vault.manual_settlement = true;
    vault.admin_sequence = add(expected, 1)?;
    Ok(())
}

fn send_from_vault(
    vault: &Account<BatchVault>,
    recipient: &AccountInfo,
    amount: u64,
) -> Result<()> {
    let info = vault.to_account_info();
    require_keys_neq!(info.key(), recipient.key(), EscrowError::InvalidRecipient);
    require!(!recipient.executable, EscrowError::InvalidRecipient);
    let tracked = vault.available()?;
    require!(amount <= tracked, EscrowError::InsufficientPool);
    let rent = Rent::get()?.minimum_balance(info.data_len());
    require!(
        info.lamports() >= add(rent, tracked)?,
        EscrowError::InsufficientPool
    );
    let from = sub(info.lamports(), amount)?;
    let to = add(recipient.lamports(), amount)?;
    **info.try_borrow_mut_lamports()? = from;
    **recipient.try_borrow_mut_lamports()? = to;
    Ok(())
}

fn emit_movement(
    vault: &Account<BatchVault>,
    actor: Pubkey,
    recipient: Pubkey,
    amount: u64,
    kind: u8,
    order: Pubkey,
    reason_hash: [u8; 32],
) {
    emit!(FundsMoved {
        vault: vault.key(),
        actor,
        recipient,
        amount,
        kind,
        order,
        admin_sequence: vault.admin_sequence,
        reason_hash
    });
}

#[event]
pub struct VaultInitialized {
    pub vault: Pubkey,
    pub batch: Pubkey,
}
#[event]
pub struct OrderPurchased {
    pub vault: Pubkey,
    pub order: Pubkey,
    pub buyer: Pubkey,
    pub amount: u64,
    pub cancel_until: i64,
}
#[event]
pub struct FreezeChanged {
    pub vault: Pubkey,
    pub admin: Pubkey,
    pub frozen: bool,
    pub sequence: u64,
    pub reason_hash: [u8; 32],
}
#[event]
pub struct PoolFunded {
    pub vault: Pubkey,
    pub contributor: Pubkey,
    pub amount: u64,
    pub direct_transfer_surplus: bool,
}
#[event]
pub struct FundsMoved {
    pub vault: Pubkey,
    pub actor: Pubkey,
    pub recipient: Pubkey,
    pub amount: u64,
    // 0 cancellation; 1 advance; 2 balance; 3 buyer refund; 4 admin seller pay; 5 redirect.
    pub kind: u8,
    pub order: Pubkey,
    pub admin_sequence: u64,
    pub reason_hash: [u8; 32],
}

#[error_code]
pub enum EscrowError {
    #[msg("Unsupported policy version")]
    UnsupportedPolicy,
    #[msg("Invalid stored batch schedule")]
    InvalidSchedule,
    #[msg("Wrong Circuit configuration")]
    WrongConfig,
    #[msg("Wrong order vault")]
    WrongVault,
    #[msg("Circuit platform signature required")]
    UnauthorizedPlatform,
    #[msg("Circuit admin signature required")]
    UnauthorizedAdmin,
    #[msg("Only the original buyer may cancel")]
    UnauthorizedBuyer,
    #[msg("The batch is frozen")]
    VaultFrozen,
    #[msg("The batch is outside its purchase window")]
    SalesClosed,
    #[msg("The signed price quote has expired or exceeds closing time")]
    QuoteExpired,
    #[msg("Amount and quantity must be positive")]
    InvalidAmount,
    #[msg("Order and pickup UUIDs must be nonzero")]
    InvalidIdentity,
    #[msg("Order already cancelled")]
    AlreadyCancelled,
    #[msg("The buyer's 24-hour cancellation window has ended")]
    CancellationExpired,
    #[msg("There is no amount available for this operation")]
    NothingToPay,
    #[msg("Payout deadline has not arrived")]
    PayoutTooEarly,
    #[msg("This scheduled payout was already claimed")]
    AlreadyPaid,
    #[msg("Circuit must complete settlement after fund reallocation")]
    ManualSettlementRequired,
    #[msg("Recipient is invalid for this operation")]
    InvalidRecipient,
    #[msg("Freeze the batch before an admin fund movement")]
    FreezeRequired,
    #[msg("Admin fund movements must wait until closing plus 48 hours")]
    CancellationProtection,
    #[msg("Recorded refunds cannot exceed this purchase's original SOL amount")]
    RefundExceedsPurchase,
    #[msg("The batch has insufficient spendable funds")]
    InsufficientPool,
    #[msg("Admin sequence changed; reconcile and refresh before acting")]
    AdminSequenceConflict,
    #[msg("Provide a nonzero hash referencing the admin decision")]
    ReasonRequired,
    #[msg("Arithmetic overflow or inconsistent pool accounting")]
    Arithmetic,
}

#[cfg(test)]
mod tests;
