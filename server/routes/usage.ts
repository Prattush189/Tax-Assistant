import { Router, Response } from 'express';
import { userRepo } from '../db/repositories/userRepo.js';
import { usageRepo } from '../db/repositories/usageRepo.js';
import { featureUsageRepo } from '../db/repositories/featureUsageRepo.js';
import { noticeRepo } from '../db/repositories/noticeRepo.js';
import { profileRepo } from '../db/repositories/profileRepo.js';
import { AuthRequest } from '../types.js';
import { getUserLimits, getEffectivePlan } from '../lib/planLimits.js';
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

  // Usage counters always reflect the POOL owner (inviter or self).
  // This means an invitee sees the combined "3,200 of 10,000 used" number
  // — consistent with the plan text — rather than their personal slice.
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

  // Notice drafts (monthly)
  let noticesUsed = 0;
  try {
    noticesUsed = noticeRepo.countByBillingUserMonth(billingUser.id);
  } catch (err) {
    console.error('[usage] notices count failed', err);
  }

  // Saved profiles (count — not period based)
  let profilesUsed = 0;
  try {
    profilesUsed = profileRepo.countByBillingUser(billingUser.id);
  } catch (err) {
    console.error('[usage] profiles count failed', err);
  }

  // Surface "shared with" info for invited users
  const isSharedMember = !!user.inviter_id && user.inviter_id !== user.id;
  const sharedWith = isSharedMember
    ? {
        inviterId: billingUser.id,
        inviterName: billingUser.name,
        memberCount: countSeats(billingUser.id).accepted, // incl. inviter
        seatCap: SEAT_CAP,
      }
    : undefined;

  res.json({
    plan,
    pluginRole: user.plugin_role ?? undefined,
    consultantId: user.plugin_consultant_id ?? undefined,
    sharedWith,
    usage: {
      messages: {
        used: messagesUsed,
        limit: limits.messages.limit,
        period: limits.messages.period,
        label: limits.messages.period === 'day' ? 'Messages Today' : 'Messages This Month',
      },
      attachments: {
        used: attachmentsUsed,
        limit: limits.attachments,
        period: 'month',
        label: 'Attachments This Month',
      },
      suggestions: {
        used: suggestionsUsed,
        limit: limits.suggestions,
        period: 'month',
        label: 'AI Suggestions This Month',
      },
      notices: {
        used: noticesUsed,
        limit: limits.notices,
        period: 'month',
        label: 'Notice Drafts This Month',
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
