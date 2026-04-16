import { Router, Response } from 'express';
import { AuthRequest } from '../types.js';
import { userRepo, type BillingDetails } from '../db/repositories/userRepo.js';

const router = Router();

/** GET /api/billing-details — return saved billing details for current user */
router.get('/', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Authentication required' }); return; }
  const details = userRepo.getBillingDetails(req.user.id);
  res.json({ billingDetails: details });
});

/** PUT /api/billing-details — save billing details for current user */
router.put('/', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Authentication required' }); return; }

  const { name, addressLine1, addressLine2, city, state, pincode, gstin } = req.body ?? {};

  if (!name?.trim() || !addressLine1?.trim() || !city?.trim() || !state?.trim() || !pincode?.trim()) {
    res.status(400).json({ error: 'name, addressLine1, city, state and pincode are required' });
    return;
  }

  const details: BillingDetails = {
    name:         name.trim(),
    addressLine1: addressLine1.trim(),
    addressLine2: addressLine2?.trim() || undefined,
    city:         city.trim(),
    state:        state.trim(),
    pincode:      pincode.trim(),
    gstin:        gstin?.trim().toUpperCase() || undefined,
  };

  userRepo.setBillingDetails(req.user.id, details);
  res.json({ ok: true, billingDetails: details });
});

export default router;
