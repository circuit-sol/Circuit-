use crate::program::CircuitDrops;
use anchor_lang::prelude::*;

// Existing POC ID is retained only as a compilation placeholder.
// Generate a fresh local program keypair and sync IDs BEFORE any deployment.
declare_id!("G4JKqCUDcfFSyQ6t2EpuCUoNtN9JwZGW3vMySnnWaFtj");

pub const POLICY_VERSION: u8 = 1;
pub const CANCELLATION_SECONDS: i64 = 24 * 60 * 60;
pub const ADVANCE_DELAY_SECONDS: i64 = 48 * 60 * 60;
pub const BALANCE_DELAY_SECONDS: i64 = 7 * 24 * 60 * 60;
pub const ADVANCE_BPS: u16 = 3_000;

#[program]
pub mod circuit_drops {
    use super::*;

    // Only this deployed program's upgrade authority can bootstrap the singleton.
    // Both operational authorities sign, proving control of the chosen keys.
    pub fn initialize_config(ctx: Context<InitializeConfig>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.version = POLICY_VERSION;
        config.platform_authority = ctx.accounts.platform_authority.key();
        config.admin_authority = ctx.accounts.admin_authority.key();
        config.bump = ctx.bumps.config;
        emit!(ConfigInitialized {
            config: config.key(),
            platform_authority: config.platform_authority,
            admin_authority: config.admin_authority,
        });
        Ok(())
    }

    // The Circuit financial/admin authority controls operational-key replacement.
    // The new key must also sign to avoid accidentally assigning an unusable key.
    pub fn set_platform_authority(ctx: Context<SetPlatformAuthority>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        let previous = config.platform_authority;
        config.platform_authority = ctx.accounts.new_platform_authority.key();
        emit!(AuthorityChanged {
            config: config.key(),
            kind: 0,
            previous,
            next: config.platform_authority,
        });
        Ok(())
    }

    pub fn transfer_admin_authority(ctx: Context<TransferAdminAuthority>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        let previous = config.admin_authority;
        config.admin_authority = ctx.accounts.new_admin_authority.key();
        emit!(AuthorityChanged {
            config: config.key(),
            kind: 1,
            previous,
            next: config.admin_authority,
        });
        Ok(())
    }

    // Both signers authorize the exact instruction, including payout wallet and
    // schedule. Brand membership itself is checked by the backend before signing.
    pub fn initialize_batch(
        ctx: Context<InitializeBatch>,
        args: InitializeBatchArgs,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let (advance_eligible_at, balance_eligible_at) = validate_batch_args(&args, now)?;

        require!(
            args.seller_payment_wallet != Pubkey::default(),
            DropsError::InvalidPaymentWallet
        );
        require!(
            args.seller_payment_wallet != ctx.accounts.batch.key(),
            DropsError::InvalidPaymentWallet
        );
        require!(
            args.seller_payment_wallet != ctx.accounts.config.key(),
            DropsError::InvalidPaymentWallet
        );

        let batch = &mut ctx.accounts.batch;
        batch.version = POLICY_VERSION;
        batch.config = ctx.accounts.config.key();
        batch.batch_id = args.batch_id;
        batch.brand_id = args.brand_id;
        batch.edition_id = args.edition_id;
        batch.seller_authority = ctx.accounts.seller_authority.key();
        batch.seller_payment_wallet = args.seller_payment_wallet;
        batch.authorized_by = ctx.accounts.platform_authority.key();
        batch.source_revision = args.source_revision;
        batch.pickup_terms_hash = args.pickup_terms_hash;
        batch.opens_at = args.opens_at;
        batch.closes_at = args.closes_at;
        batch.production_starts_at = args.production_starts_at;
        batch.release_at = args.release_at;
        batch.advance_eligible_at = advance_eligible_at;
        batch.balance_eligible_at = balance_eligible_at;
        batch.cancellation_seconds = CANCELLATION_SECONDS;
        batch.advance_bps = ADVANCE_BPS;
        batch.created_at = now;
        batch.bump = ctx.bumps.batch;

        // No mutable commercial fields, active flag, order counter or escrow
        // transfers are exposed in this phase. Purchases require the new escrow.
        emit!(BatchInitialized {
            batch: batch.key(),
            batch_id: batch.batch_id,
            brand_id: batch.brand_id,
            seller_authority: batch.seller_authority,
            seller_payment_wallet: batch.seller_payment_wallet,
            authorized_by: batch.authorized_by,
            source_revision: batch.source_revision,
            pickup_terms_hash: batch.pickup_terms_hash,
        });
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub upgrade_authority: Signer<'info>,
    pub platform_authority: Signer<'info>,
    pub admin_authority: Signer<'info>,
    #[account(
        constraint = program.programdata_address()? == Some(program_data.key())
            @ DropsError::InvalidProgramData
    )]
    // pub program: Program<'info, crate::program::CircuitDrops>,
    pub program: Program<'info, CircuitDrops>,
    #[account(
        constraint = program_data.upgrade_authority_address == Some(upgrade_authority.key())
            @ DropsError::UnauthorizedUpgradeAuthority
    )]
    pub program_data: Account<'info, ProgramData>,
    #[account(init, payer = upgrade_authority, space = 8 + CircuitConfig::INIT_SPACE,
        seeds = [b"circuit-config"], bump)]
    pub config: Account<'info, CircuitConfig>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetPlatformAuthority<'info> {
    pub admin_authority: Signer<'info>,
    pub new_platform_authority: Signer<'info>,
    #[account(mut, seeds = [b"circuit-config"], bump = config.bump,
        has_one = admin_authority @ DropsError::UnauthorizedAdmin,
        constraint = config.version == POLICY_VERSION @ DropsError::UnsupportedPolicy)]
    pub config: Account<'info, CircuitConfig>,
}

#[derive(Accounts)]
pub struct TransferAdminAuthority<'info> {
    pub admin_authority: Signer<'info>,
    pub new_admin_authority: Signer<'info>,
    #[account(mut, seeds = [b"circuit-config"], bump = config.bump,
        has_one = admin_authority @ DropsError::UnauthorizedAdmin,
        constraint = config.version == POLICY_VERSION @ DropsError::UnsupportedPolicy)]
    pub config: Account<'info, CircuitConfig>,
}

#[derive(Accounts)]
#[instruction(args: InitializeBatchArgs)]
pub struct InitializeBatch<'info> {
    #[account(mut)]
    pub seller_authority: Signer<'info>,
    pub platform_authority: Signer<'info>,
    #[account(seeds = [b"circuit-config"], bump = config.bump,
        has_one = platform_authority @ DropsError::UnauthorizedPlatform,
        constraint = config.version == POLICY_VERSION @ DropsError::UnsupportedPolicy)]
    pub config: Account<'info, CircuitConfig>,
    #[account(init, payer = seller_authority, space = 8 + BatchAccount::INIT_SPACE,
        seeds = [b"batch", args.batch_id.as_ref()], bump)]
    pub batch: Account<'info, BatchAccount>,
    pub system_program: Program<'info, System>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitializeBatchArgs {
    // UUIDs are exactly 16 bytes, decoded from their hex digits, not 36-byte text.
    pub batch_id: [u8; 16],
    pub brand_id: [u8; 16],
    pub edition_id: String,
    pub seller_payment_wallet: Pubkey,
    pub source_revision: u32,
    pub pickup_terms_hash: [u8; 32],
    pub opens_at: i64,
    pub closes_at: i64,
    pub production_starts_at: i64,
    pub release_at: i64,
}

#[account]
#[derive(InitSpace)]
pub struct CircuitConfig {
    pub version: u8,
    pub platform_authority: Pubkey,
    pub admin_authority: Pubkey,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct BatchAccount {
    pub version: u8,
    pub config: Pubkey,
    pub batch_id: [u8; 16],
    pub brand_id: [u8; 16],
    #[max_len(32)]
    pub edition_id: String,
    pub seller_authority: Pubkey,
    pub seller_payment_wallet: Pubkey,
    pub authorized_by: Pubkey,
    pub source_revision: u32,
    pub pickup_terms_hash: [u8; 32],
    pub opens_at: i64,
    pub closes_at: i64,
    pub production_starts_at: i64,
    pub release_at: i64,
    pub advance_eligible_at: i64,
    pub balance_eligible_at: i64,
    pub cancellation_seconds: i64,
    pub advance_bps: u16,
    pub created_at: i64,
    pub bump: u8,
}

fn validate_batch_args(args: &InitializeBatchArgs, now: i64) -> Result<(i64, i64)> {
    require!(
        args.batch_id != [0; 16] && args.brand_id != [0; 16],
        DropsError::InvalidIdentity
    );
    require!(
        valid_edition_id(&args.edition_id),
        DropsError::InvalidEditionId
    );
    require!(args.source_revision > 0, DropsError::InvalidRevision);
    require!(
        args.pickup_terms_hash != [0; 32],
        DropsError::InvalidPickupTerms
    );
    require!(args.opens_at > now, DropsError::OpeningMustBeFuture);
    require!(args.closes_at > args.opens_at, DropsError::InvalidSchedule);
    let advance = args
        .closes_at
        .checked_add(ADVANCE_DELAY_SECONDS)
        .ok_or(DropsError::TimestampOverflow)?;
    require!(
        args.production_starts_at >= advance,
        DropsError::ProductionTooEarly
    );
    require!(
        args.release_at > args.production_starts_at,
        DropsError::InvalidSchedule
    );
    let balance = args
        .release_at
        .checked_add(BALANCE_DELAY_SECONDS)
        .ok_or(DropsError::TimestampOverflow)?;
    Ok((advance, balance))
}

fn valid_edition_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 32
        && !value.starts_with('-')
        && !value.ends_with('-')
        && !value.contains("--")
        && value
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

#[event]
pub struct ConfigInitialized {
    pub config: Pubkey,
    pub platform_authority: Pubkey,
    pub admin_authority: Pubkey,
}

#[event]
pub struct AuthorityChanged {
    pub config: Pubkey,
    pub kind: u8, // 0 platform signer; 1 Circuit admin
    pub previous: Pubkey,
    pub next: Pubkey,
}

#[event]
pub struct BatchInitialized {
    pub batch: Pubkey,
    pub batch_id: [u8; 16],
    pub brand_id: [u8; 16],
    pub seller_authority: Pubkey,
    pub seller_payment_wallet: Pubkey,
    pub authorized_by: Pubkey,
    pub source_revision: u32,
    pub pickup_terms_hash: [u8; 32],
}

#[error_code]
pub enum DropsError {
    #[msg("Only this program's upgrade authority may initialize configuration")]
    UnauthorizedUpgradeAuthority,
    #[msg("ProgramData does not belong to this program")]
    InvalidProgramData,
    #[msg("Circuit platform signature does not match configuration")]
    UnauthorizedPlatform,
    #[msg("Circuit admin signature does not match configuration")]
    UnauthorizedAdmin,
    #[msg("Unsupported policy version")]
    UnsupportedPolicy,
    #[msg("Batch and brand UUIDs must be nonzero")]
    InvalidIdentity,
    #[msg("Edition ID must be a lowercase slug of at most 32 bytes")]
    InvalidEditionId,
    #[msg("Source batch revision must be positive")]
    InvalidRevision,
    #[msg("Pickup terms hash must be nonzero")]
    InvalidPickupTerms,
    #[msg("Batch opening must be in the future")]
    OpeningMustBeFuture,
    #[msg("Closing must follow opening; release must follow production")]
    InvalidSchedule,
    #[msg("Production must start at least 48 hours after closing")]
    ProductionTooEarly,
    #[msg("Timestamp arithmetic overflow")]
    TimestampOverflow,
    #[msg("Invalid seller payment wallet")]
    InvalidPaymentWallet,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args() -> InitializeBatchArgs {
        InitializeBatchArgs {
            batch_id: [1; 16],
            brand_id: [2; 16],
            edition_id: "demo-drop-001".into(),
            seller_payment_wallet: Pubkey::new_unique(),
            source_revision: 1,
            pickup_terms_hash: [3; 32],
            opens_at: 100,
            closes_at: 200,
            production_starts_at: 200 + ADVANCE_DELAY_SECONDS,
            release_at: 201 + ADVANCE_DELAY_SECONDS,
        }
    }

    #[test]
    fn exact_48_hour_boundary_is_allowed() {
        let a = args();
        let (advance, balance) = validate_batch_args(&a, 99).unwrap();
        assert_eq!(advance, a.production_starts_at);
        assert_eq!(balance, a.release_at + 604_800);
        assert_eq!(CANCELLATION_SECONDS, 86_400);
        assert_eq!(ADVANCE_BPS, 3_000);
    }

    #[test]
    fn schedule_boundaries_and_overflow_rejected() {
        let mut a = args();
        assert!(validate_batch_args(&a, a.opens_at).is_err());
        a.production_starts_at -= 1;
        assert!(validate_batch_args(&a, 99).is_err());
        a = args();
        a.closes_at = a.opens_at;
        assert!(validate_batch_args(&a, 99).is_err());
        a = args();
        a.release_at = a.production_starts_at;
        assert!(validate_batch_args(&a, 99).is_err());
        a = args();
        a.release_at = i64::MAX;
        assert!(validate_batch_args(&a, 99).is_err());
        a = args();
        a.closes_at = i64::MAX;
        assert!(validate_batch_args(&a, 99).is_err());
    }

    #[test]
    fn slug_and_identity_validation() {
        assert!(valid_edition_id("circuit-demo-drop-001"));
        for bad in [
            "",
            "UPPER",
            "-demo",
            "demo-",
            "two--parts",
            "has space",
            "é",
        ] {
            assert!(!valid_edition_id(bad));
        }
        assert!(!valid_edition_id(&"a".repeat(33)));
        let mut a = args();
        a.source_revision = 0;
        assert!(validate_batch_args(&a, 99).is_err());
        a = args();
        a.batch_id = [0; 16];
        assert!(validate_batch_args(&a, 99).is_err());
        a = args();
        a.brand_id = [0; 16];
        assert!(validate_batch_args(&a, 99).is_err());
        a = args();
        a.pickup_terms_hash = [0; 32];
        assert!(validate_batch_args(&a, 99).is_err());
    }
}
