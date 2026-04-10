import { Router, Response } from 'express';
import { userRepo } from '../db/repositories/userRepo.js';
import { usageRepo } from '../db/repositories/usageRepo.js';
import { featureUsageRepo } from '../db/repositories/featureUsageRepo.js';
import { noticeRepo } from '../db/repositories/noticeRepo.js';
import { profileRepo } from '../db/repositories/profileRepo.js';
import { AuthRequest } from '../types.js';
import { getUserLimits, getEffectivePlan } from '../lib/planLimits.js';

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

  const plan = getEffectivePlan(user);
  const limits = getUserLimits(user);

  // Messages
  let messagesUsed = 0;
  try {
    messagesUsed = usageRepo.countByUser(req.user.id, periodStartIST(limits.messages.period));
  } catch (err) {
    console.error('[usage] messages count failed', err);
  }

  // Attachments (monthly)
  let attachmentsUsed = 0;
  try {
    attachmentsUsed = featureUsageRepo.countThisMonth(req.user.id, 'attachment_upload');
  } catch (err) {
    console.error('[usage] attachments count failed', err);
  }

  // AI Suggestions (monthly)
  let suggestionsUsed = 0;
  try {
    suggestionsUsed = featureUsageRepo.countThisMonth(req.user.id, 'ai_suggestions');
  } catch (err) {
    console.error('[usage] suggestions count failed', err);
  }

  // Notice drafts (monthly)
  let noticesUsed = 0;
  try {
    noticesUsed = noticeRepo.countByUserMonth(req.user.id);
  } catch (err) {
    console.error('[usage] notices count failed', err);
  }

  // Saved profiles (count — not period based)
  let profilesUsed = 0;
  try {
    profilesUsed = profileRepo.countByUser(req.user.id);
  } catch (err) {
    console.error('[usage] profiles count failed', err);
  }

  res.json({
    plan,
    pluginRole: user.plugin_role ?? undefined,
    consultantId: user.plugin_consultant_id ?? undefined,
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
