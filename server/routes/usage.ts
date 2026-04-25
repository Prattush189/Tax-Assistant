import { Router, Response } from 'express';
import { userRepo } from '../db/repositories/userRepo.js';
import { usageRepo } from '../db/repositories/usageRepo.js';
import { featureUsageRepo } from '../db/repositories/featureUsageRepo.js';

import { profileRepoV2 } from '../db/repositories/profileRepoV2.js';
import { AuthRequest } from '../types.js';
import { getUserLimits, getEffectivePlan, getTrialEndsAt, isTrialExpired, TRIAL_DAYS } from '../lib/planLimits.js';
import { getBillingUser, countSeats, SEAT_CAP } from '../lib/billing.js';

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

  // Messages
  let messagesUsed = 0;
  try {
    messagesUsed = usageRepo.countByBillingUser(billingUser.id, periodStartIST(limits.messages.period));
  } catch (err) {
    console.error('[usage] messages count failed', err);
  }

  // Attachments (monthly)
  let attachmentsUsed = 0;
  try {
    attachmentsUsed = featureUsageRepo.countThisMonthByBillingUser(billingUser.id, 'attachment_upload');
  } catch (err) {
    console.error('[usage] attachments count failed', err);
  }

  // AI Suggestions (monthly)
  let suggestionsUsed = 0;
  try {
    suggestionsUsed = featureUsageRepo.countThisMonthByBillingUser(billingUser.id, 'ai_suggestions');
  } catch (err) {
    console.error('[usage] suggestions count failed', err);
  }

  // Notice drafts (monthly) — read from the immutable feature_usage log so
  // that deleting a draft does not reduce the quota counter.
  let noticesUsed = 0;
  try {
    noticesUsed = featureUsageRepo.countThisMonthByBillingUser(billingUser.id, 'notice');
  } catch (err) {
    console.error('[usage] notices count failed', err);
  }

  // Board resolutions (monthly)
  let boardResolutionsUsed = 0;
  try {
    boardResolutionsUsed = featureUsageRepo.countThisMonthByBillingUser(billingUser.id, 'board_resolution');
  } catch (err) {
    console.error('[usage] board resolutions count failed', err);
  }

  // Partnership deeds (monthly)
  let partnershipDeedsUsed = 0;
  try {
    partnershipDeedsUsed = featureUsageRepo.countThisMonthByBillingUser(billingUser.id, 'partnership_deeds');
  } catch (err) {
    console.error('[usage] partnership deeds count failed', err);
  }

  // Bank statement analyses (monthly)
  let bankStatementsUsed = 0;
  try {
    bankStatementsUsed = featureUsageRepo.countThisMonthByBillingUser(billingUser.id, 'bank_statement_analyze');
  } catch (err) {
    console.error('[usage] bank statements count failed', err);
  }

  // Ledger scrutiny (monthly)
  let ledgerScrutinyUsed = 0;
  try {
    ledgerScrutinyUsed = featureUsageRepo.countThisMonthByBillingUser(billingUser.id, 'ledger_scrutiny');
  } catch (err) {
    console.error('[usage] ledger scrutiny count failed', err);
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
    usage: {
      messages: {
        used: messagesUsed,
        limit: limits.messages.limit,
        period: limits.messages.period,
        label: limits.messages.period === 'day' ? 'Messages Today' : 'Messages',
      },
      attachments: {
        used: attachmentsUsed,
        limit: limits.attachments,
        period: 'month',
        label: 'Attachments',
      },
      suggestions: {
        used: suggestionsUsed,
        limit: limits.suggestions,
        period: 'month',
        label: 'AI Suggestions',
      },
      notices: {
        used: noticesUsed,
        limit: limits.notices,
        period: 'month',
        label: 'Notice Drafts',
      },
      boardResolutions: {
        used: boardResolutionsUsed,
        limit: limits.boardResolutions,
        period: 'month',
        label: 'Board Resolutions',
      },
      partnershipDeeds: {
        used: partnershipDeedsUsed,
        limit: limits.partnershipDeeds,
        period: 'month',
        label: 'Partnership Deeds',
      },
      bankStatements: {
        used: bankStatementsUsed,
        limit: limits.bankStatements,
        period: 'month',
        label: 'Bank Statements',
      },
      ledgerScrutiny: {
        used: ledgerScrutinyUsed,
        limit: limits.ledgerScrutiny,
        period: 'month',
        label: 'Ledger Scrutinies',
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
