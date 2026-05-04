import { Router, Response } from 'express';
import { userRepo } from '../db/repositories/userRepo.js';
import { usageRepo } from '../db/repositories/usageRepo.js';
import { featureUsageRepo } from '../db/repositories/featureUsageRepo.js';

import { profileRepoV2 } from '../db/repositories/profileRepoV2.js';
import { AuthRequest } from '../types.js';
import { getUserLimits, getEffectivePlan, getTrialEndsAt, isTrialExpired, TRIAL_DAYS, getUsagePeriodStart } from '../lib/planLimits.js';
import { getBillingUser, countSeats, SEAT_CAP } from '../lib/billing.js';
import { CSV_ROWS_PER_CREDIT } from '../lib/creditPolicy.js';
import { tokensRemainingForUser } from '../lib/tokenQuota.js';

const router = Router();

/** IST-adjusted start of current day / month */
function periodStartIST(period: 'day' | 'month'): string {
  const now = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  let start: Date;
  if (period === 'day') {
    start = new Date(now);
    start.setHours(0, 0, 0, 0);
  } else {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
  }
  return start.toISOString().replace('Z', '');
}

// GET /api/usage — returns current usage across all features for the authenticated user
router.get('/', (req: AuthRequest, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const user = userRepo.findById(req.user.id);
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const billingUser = getBillingUser(user);
  const plan = getEffectivePlan(billingUser);
  const limits = getUserLimits(billingUser);

  // Usage-period start: yearly billing window for paid users (resets on
  // Razorpay renewal), or account lifetime for free-trial users (no
  // reset; they hit the 30-day trial wall instead). All per-feature
  // counters below are scoped to this same window.
  const periodStart = getUsagePeriodStart(billingUser);

  // Messages counter — kept for the "messages this month" analytics
  // display even though the per-feature limit was removed.
  let messagesUsed = 0;
  try {
    messagesUsed = usageRepo.countByBillingUser(billingUser.id, periodStartIST('month'));
  } catch (err) {
    console.error('[usage] messages count failed', err);
  }

  let attachmentsUsed = 0;
  try {
    attachmentsUsed = featureUsageRepo.countSinceForBillingUser(billingUser.id, 'attachment_upload', periodStart);
  } catch (err) {
    console.error('[usage] attachments count failed', err);
  }

  let suggestionsUsed = 0;
  try {
    suggestionsUsed = featureUsageRepo.countSinceForBillingUser(billingUser.id, 'ai_suggestions', periodStart);
  } catch (err) {
    console.error('[usage] suggestions count failed', err);
  }

  // Read counters from the immutable feature_usage log so deleting a
  // draft does not reduce the quota counter.
  let noticesUsed = 0;
  try {
    noticesUsed = featureUsageRepo.countSinceForBillingUser(billingUser.id, 'notice', periodStart);
  } catch (err) {
    console.error('[usage] notices count failed', err);
  }

  let boardResolutionsUsed = 0;
  try {
    boardResolutionsUsed = featureUsageRepo.countSinceForBillingUser(billingUser.id, 'board_resolution', periodStart);
  } catch (err) {
    console.error('[usage] board resolutions count failed', err);
  }

  let partnershipDeedsUsed = 0;
  try {
    partnershipDeedsUsed = featureUsageRepo.countSinceForBillingUser(billingUser.id, 'partnership_deeds', periodStart);
  } catch (err) {
    console.error('[usage] partnership deeds count failed', err);
  }

  // Bank statement analyses — credits, not run count. Sum credits_used
  // to match what the bank-statement landing page shows.
  let bankStatementsUsed = 0;
  try {
    bankStatementsUsed = featureUsageRepo.sumCreditsSinceForBillingUser(billingUser.id, 'bank_statement_analyze', periodStart);
  } catch (err) {
    console.error('[usage] bank statements credit sum failed', err);
  }

  let ledgerScrutinyUsed = 0;
  try {
    ledgerScrutinyUsed = featureUsageRepo.sumCreditsSinceForBillingUser(billingUser.id, 'ledger_scrutiny', periodStart);
  } catch (err) {
    console.error('[usage] ledger scrutiny credit sum failed', err);
  }

  // Saved profiles (count — not period based)
  let profilesUsed = 0;
  try {
    profilesUsed = profileRepoV2.countByBillingUser(billingUser.id);
  } catch (err) {
    console.error('[usage] profiles count failed', err);
  }

  // Trial info (only relevant for free-plan users)
  const trialEndsAt = getTrialEndsAt(user.created_at);
  const trialExpired = user.plan === 'free' ? isTrialExpired(user.created_at) : false;
  const trialDaysLeft = user.plan === 'free'
    ? Math.max(0, Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : null;

  // Surface "shared with" info for invited users
  const isSharedMember = !!user.inviter_id && user.inviter_id !== user.id;
  const sharedWith = isSharedMember
    ? {
        inviterId: billingUser.id,
        inviterName: billingUser.name,
        memberCount: countSeats(billingUser.id).accepted,
        seatCap: SEAT_CAP,
      }
    : undefined;

  // Cross-feature token budget — the only HARD quota gate. Per-
  // feature counters below are kept as soft analytics display.
  const tokenStats = tokensRemainingForUser(req);

  res.json({
    plan,
    planExpiresAt: user.plan_expires_at ?? null,
    trialEndsAt,
    trialExpired,
    trialDaysLeft,
    trialDays: TRIAL_DAYS,
    pluginRole: user.plugin_role ?? undefined,
    consultantId: user.plugin_consultant_id ?? undefined,
    sharedWith,
    tokens: {
      used: tokenStats.used,
      budget: tokenStats.budget,
      remaining: tokenStats.remaining,
    },
    // Per-feature limits were removed — only the cross-feature token
    // budget gates now. The per-feature USAGE counters below are kept
    // for analytics display ("you've drafted 22 notices this period")
    // but no longer carry a `limit` field. UI should hide the "of Y"
    // portion. The only field on UserLimits is `profiles` (multi-
    // tenant structure cap, not an AI cost gate).
    usage: {
      messages: { used: messagesUsed, period: 'month', label: 'Messages' },
      attachments: { used: attachmentsUsed, period: 'month', label: 'Attachments' },
      suggestions: { used: suggestionsUsed, period: 'month', label: 'AI Suggestions' },
      notices: { used: noticesUsed, period: 'month', label: 'Notice Drafts' },
      boardResolutions: { used: boardResolutionsUsed, period: 'month', label: 'Board Resolutions' },
      partnershipDeeds: { used: partnershipDeedsUsed, period: 'month', label: 'Partnership Deeds' },
      bankStatements: {
        used: bankStatementsUsed,
        period: 'month',
        label: 'Bank Statement Transactions',
        rowsPerCredit: CSV_ROWS_PER_CREDIT.bank_statement ?? 100,
      },
      ledgerScrutiny: {
        used: ledgerScrutinyUsed,
        period: 'month',
        label: 'Ledger Transactions',
        rowsPerCredit: CSV_ROWS_PER_CREDIT.ledger_scrutiny ?? 100,
      },
      profiles: {
        used: profilesUsed,
        limit: limits.profiles,
        period: 'total',
        label: 'Saved Tax Profiles',
      },
    },
  });
});

export default router;
