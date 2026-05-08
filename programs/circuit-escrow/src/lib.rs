use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_id!("8b866KXrU94jAEuZYNr8WTkuXJELPvu6eW1v89pSAUrN");

#[program]
pub mod circuit_escrow {
    use super::*;

    pub fn initialize_escrow(
        ctx: Context<InitializeEscrow>,
        drop_id: String,
        amount: u64,
    ) -> Result<()> {
        require!(amount > 0, EscrowError::InvalidAmount);
        require!(!drop_id.is_empty(), EscrowError::InvalidDropId);
        require!(drop_id.len() <= 64, EscrowError::DropIdTooLong);

        let escrow = &mut ctx.accounts.escrow_account;
        escrow.buyer = ctx.accounts.buyer.key();
        escrow.designer = ctx.accounts.designer.key();
        escrow.amount = amount;
        escrow.drop_id = drop_id;
        escrow.delivered = false;
        escrow.bump = ctx.bumps.escrow_account;

        // Transfer escrow funds from buyer into the PDA via CPI.
        // The PDA is program-owned so it can receive but not send via system program;
        // release in confirm_delivery uses direct lamport manipulation instead.
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.buyer.to_account_info(),
                    to: ctx.accounts.escrow_account.to_account_info(),
                },
            ),
            amount,
        )?;

        msg!(
            "Escrow initialized: drop_id={} amount={} buyer={} designer={}",
            ctx.accounts.escrow_account.drop_id,
            ctx.accounts.escrow_account.amount,
            ctx.accounts.escrow_account.buyer,
            ctx.accounts.escrow_account.designer,
        );

        Ok(())
    }

    pub fn confirm_delivery(ctx: Context<ConfirmDelivery>) -> Result<()> {
        require!(
            !ctx.accounts.escrow_account.delivered,
            EscrowError::AlreadyDelivered
        );

        let amount = ctx.accounts.escrow_account.amount;

        // PDA is owned by this program, not the system program, so we move
        // lamports directly rather than via system_program::transfer CPI.
        **ctx
            .accounts
            .escrow_account
            .to_account_info()
            .try_borrow_mut_lamports()? -= amount;
        **ctx.accounts.designer.try_borrow_mut_lamports()? += amount;

        ctx.accounts.escrow_account.delivered = true;

        msg!(
            "Delivery confirmed: drop_id={} amount={} designer={}",
            ctx.accounts.escrow_account.drop_id,
            amount,
            ctx.accounts.escrow_account.designer,
        );

        Ok(())
    }
}

// ─── Accounts ────────────────────────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(drop_id: String, amount: u64)]
pub struct InitializeEscrow<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,

    /// CHECK: Designer's wallet — only stored as the payment recipient.
    /// No ownership or type check required; validated on confirm_delivery.
    pub designer: UncheckedAccount<'info>,

    #[account(
        init,
        payer = buyer,
        space = 8 + EscrowAccount::INIT_SPACE,
        seeds = [b"escrow", drop_id.as_bytes(), buyer.key().as_ref()],
        bump,
    )]
    pub escrow_account: Account<'info, EscrowAccount>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ConfirmDelivery<'info> {
    /// The buyer must sign to confirm they received the drop.
    #[account(mut)]
    pub buyer: Signer<'info>,

    /// CHECK: Validated against the pubkey stored in escrow_account.designer.
    #[account(
        mut,
        constraint = designer.key() == escrow_account.designer @ EscrowError::InvalidDesigner,
    )]
    pub designer: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [b"escrow", escrow_account.drop_id.as_bytes(), buyer.key().as_ref()],
        bump = escrow_account.bump,
        // Ensures the signing buyer matches the one recorded at initialization.
        has_one = buyer @ EscrowError::UnauthorizedBuyer,
    )]
    pub escrow_account: Account<'info, EscrowAccount>,
}

// ─── State ───────────────────────────────────────────────────────────────────

#[account]
#[derive(InitSpace)]
pub struct EscrowAccount {
    pub buyer: Pubkey,    // 32
    pub designer: Pubkey, // 32
    pub amount: u64,      // 8
    #[max_len(64)]
    pub drop_id: String,  // 4 + 64
    pub delivered: bool,  // 1
    pub bump: u8,         // 1
                          // total (excl. discriminator): 142 bytes
}

// ─── Errors ──────────────────────────────────────────────────────────────────

#[error_code]
pub enum EscrowError {
    #[msg("Escrow has already been marked as delivered")]
    AlreadyDelivered,

    #[msg("Only the original buyer can confirm delivery")]
    UnauthorizedBuyer,

    #[msg("Designer account does not match the escrow record")]
    InvalidDesigner,

    #[msg("Escrow amount must be greater than zero")]
    InvalidAmount,

    #[msg("Drop ID cannot be empty")]
    InvalidDropId,

    #[msg("Drop ID exceeds the maximum length of 64 characters")]
    DropIdTooLong,
}
