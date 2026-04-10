import { Router, Response } from 'express';
import { userRepo } from '../db/repositories/userRepo.js';
import { usageRepo } from '../db/repositories/usageRepo.js';
import { featureUsageRepo } from '../db/repositories/featureUsageRepo.js';
import { noticeRepo } from '../db/repositories/noticeRepo.js';
import { profileRepo } from '../db/repositories/profileRepo.js';
import { AuthRequest } from '../types.js';

const router = Router();

// Plan limits — mirror the enforcement in other routes
const MESSAGE_LIMITS: Record<string, { limit: number; period: 'day' | 'month' }> = {
  free: { limit: 10, period: 'day' },
  pro: { limit: 1000, period: 'month' },
  enterprise: { limit: 10000, period: 'month' },
};

const ATTACHMENT_LIMITS: Record<string, number> = { free: 10, pro: 100, enterprise: 500 };
const SUGGESTION_LIMITS: Record<string, number> = { free: 50, pro: 200, enterprise: 1000 };
const NOTICE_LIMITS: Record<string, number> = { free: 3, pro: 30, enterprise: 100 };
const PROFILE_LIMITS: Record<string, number> = { free: 1, pro: 10, enterprise: 50 };

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
  const plan = user?.plan ?? 'free';

  // Messages
  const messagesConfig = MESSAGE_LIMITS[plan] ?? MESSAGE_LIMITS.free;
  let messagesUsed = 0;
  try {
    messagesUsed = usageRepo.countByUser(req.user.id, periodStartIST(messagesConfig.period));
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
    usage: {
      messages: {
        used: messagesUsed,
        limit: messagesConfig.limit,
        period: messagesConfig.period,
        label: messagesConfig.period === 'day' ? 'Messages Today' : 'Messages This Month',
      },
      attachments: {
        used: attachmentsUsed,
        limit: ATTACHMENT_LIMITS[plan] ?? 10,
        period: 'month',
        label: 'Attachments This Month',
      },
      suggestions: {
        used: suggestionsUsed,
        limit: SUGGESTION_LIMITS[plan] ?? 50,
        period: 'month',
        label: 'AI Suggestions This Month',
      },
      notices: {
        used: noticesUsed,
        limit: NOTICE_LIMITS[plan] ?? 3,
        period: 'month',
        label: 'Notice Drafts This Month',
      },
      profiles: {
        used: profilesUsed,
        limit: PROFILE_LIMITS[plan] ?? 1,
        period: 'total',
        label: 'Saved Tax Profiles',
      },
    },
  });
});

export default router;
