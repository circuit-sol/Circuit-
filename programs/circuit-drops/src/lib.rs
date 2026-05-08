use anchor_lang::prelude::*;

declare_id!("3i1KUa7S1FjRx34SzqRAKAYsp3S8AJkCB3x7odjua7kL");

#[program]
pub mod circuit_drops {
    use super::*;

    pub fn create_drop(
        ctx: Context<CreateDrop>,
        drop_id: String,
        max_supply: u64,
    ) -> Result<()> {
        require!(!drop_id.is_empty(), DropsError::InvalidDropId);
        require!(drop_id.len() <= 64, DropsError::DropIdTooLong);
        require!(max_supply > 0, DropsError::InvalidMaxSupply);

        let drop = &mut ctx.accounts.drop_account;
        drop.designer = ctx.accounts.designer.key();
        drop.max_supply = max_supply;
        drop.current_count = 0;
        drop.drop_id = drop_id;
        drop.active = true;
        drop.bump = ctx.bumps.drop_account;

        msg!(
            "Drop created: id={} max_supply={} designer={}",
            drop.drop_id,
            drop.max_supply,
            drop.designer,
        );

        Ok(())
    }

    pub fn register_order(ctx: Context<RegisterOrder>) -> Result<()> {
        let drop = &mut ctx.accounts.drop_account;

        require!(drop.active, DropsError::DropNotActive);
        require!(drop.current_count < drop.max_supply, DropsError::DropSoldOut);

        drop.current_count += 1;

        msg!(
            "Order registered: drop_id={} count={}/{}",
            drop.drop_id,
            drop.current_count,
            drop.max_supply,
        );

        Ok(())
    }
}

// ─── Accounts ────────────────────────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(drop_id: String, max_supply: u64)]
pub struct CreateDrop<'info> {
    /// The designer who creates and owns this drop.
    #[account(mut)]
    pub designer: Signer<'info>,

    #[account(
        init,
        payer = designer,
        space = 8 + DropAccount::INIT_SPACE,
        seeds = [b"drop", drop_id.as_bytes()],
        bump,
    )]
    pub drop_account: Account<'info, DropAccount>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RegisterOrder<'info> {
    /// Caller authorising the order — can be a buyer or an upstream program via CPI.
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"drop", drop_account.drop_id.as_bytes()],
        bump = drop_account.bump,
    )]
    pub drop_account: Account<'info, DropAccount>,
}

// ─── State ───────────────────────────────────────────────────────────────────

#[account]
#[derive(InitSpace)]
pub struct DropAccount {
    pub designer: Pubkey,     // 32
    pub max_supply: u64,      // 8
    pub current_count: u64,   // 8
    #[max_len(64)]
    pub drop_id: String,      // 4 + 64
    pub active: bool,         // 1
    pub bump: u8,             // 1
                              // total (excl. discriminator): 118 bytes
}

// ─── Errors ──────────────────────────────────────────────────────────────────

#[error_code]
pub enum DropsError {
    // Code 6000 — must remain first to satisfy spec
    #[msg("Drop has reached maximum supply")]
    DropSoldOut,

    #[msg("Drop is not currently active")]
    DropNotActive,

    #[msg("Drop ID cannot be empty")]
    InvalidDropId,

    #[msg("Drop ID exceeds the maximum length of 64 characters")]
    DropIdTooLong,

    #[msg("Max supply must be greater than zero")]
    InvalidMaxSupply,
}
