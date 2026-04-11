/**
 * POST /api/it-portal/import
 *
 * Orchestrates a one-shot import from the Income Tax e-filing portal:
 *   1. Authenticates with the user's PAN + IT portal password
 *   2. Fetches userProfileService, myBankAccountService, jurisdictionDetailsService
 *   3. Maps the responses to profile slices
 *   4. Upserts the generic profile (creates a new row if profileId is not
 *      supplied, otherwise updates the existing one)
 *   5. If itrDraftId is supplied, patches the draft's PersonalInfo + Banks
 *   6. Logs out
 *
 * SECURITY CONTRACT:
 *   - `password` is read once from req.body, passed to ItPortalClient.login(),
 *     and never referenced again. It is NOT logged, persisted, or returned
 *     in any response.
 *   - The mapper and repo writes only touch the user's own data (scoped by
 *     req.user.id). Other users cannot be affected.
 *   - HTTPS is expected in production. On local dev the request may traverse
 *     plain HTTP — acceptable because no real credentials should be tested
 *     locally.
 */
import { Router, Response } from 'express';
import { ItPortalClient } from '../lib/itPortal/client.js';
import { mapPortalToProfile, MappedProfile } from '../lib/itPortal/mapper.js';
import { profileRepoV2 } from '../db/repositories/profileRepoV2.js';
import { itrDraftRepo } from '../db/repositories/itrDraftRepo.js';
import { userRepo } from '../db/repositories/userRepo.js';
import { getBillingUserId } from '../lib/billing.js';
import { AuthRequest } from '../types.js';

const router = Router();

const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

function safeParse<T>(s: string | undefined | null, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

/**
 * Server-side equivalent of profileToItrPersonal + profileToItrBanks from
 * src/components/profile/lib/prefillAdapters.ts. Kept in-sync manually —
 * both files target the same CBDT ITR1 shape.
 */
function applyItrPrefill(
  draft: Record<string, unknown>,
  mapped: MappedProfile,
): Record<string, unknown> {
  const personalInfo = (draft.PersonalInfo as Record<string, unknown> | undefined) ?? {};
  const assesseeName = (personalInfo.AssesseeName as Record<string, unknown> | undefined) ?? {};
  const existingAddress = (personalInfo.Address as Record<string, unknown> | undefined) ?? {};
  const verification = (draft.Verification as Record<string, unknown> | undefined) ?? {};
  const declaration = (verification.Declaration as Record<string, unknown> | undefined) ?? {};

  const id = mapped.identity;
  const addr = mapped.address;

  const newAssesseeName = {
    ...assesseeName,
    FirstName: id.firstName ?? assesseeName.FirstName,
    MiddleName: id.middleName ?? assesseeName.MiddleName,
    SurNameOrOrgName: id.lastName ?? assesseeName.SurNameOrOrgName,
  };

  const newAddress = {
    ...existingAddress,
    ResidenceNo: addr.flatNo ?? existingAddress.ResidenceNo,
    ResidenceName: addr.premiseName ?? existingAddress.ResidenceName,
    RoadOrStreet: addr.roadOrStreet ?? existingAddress.RoadOrStreet,
    LocalityOrArea: addr.locality ?? existingAddress.LocalityOrArea,
    CityOrTownOrDistrict: addr.city ?? existingAddress.CityOrTownOrDistrict,
    StateCode: addr.stateCode ?? existingAddress.StateCode,
    CountryCode: addr.countryCode ?? existingAddress.CountryCode,
    PinCode: addr.pinCode ?? existingAddress.PinCode,
    CountryCodeMobile: addr.mobileCountryCode ?? existingAddress.CountryCodeMobile,
    MobileNo: addr.mobile ?? existingAddress.MobileNo,
    EmailAddress: addr.email ?? existingAddress.EmailAddress,
  };

  const newPersonalInfo = {
    ...personalInfo,
    AssesseeName: newAssesseeName,
    PAN: id.pan ?? personalInfo.PAN,
    AadhaarCardNo: id.aadhaar ?? personalInfo.AadhaarCardNo,
    DOB: id.dob ?? personalInfo.DOB,
    Address: newAddress,
  };

  const fullName = [id.firstName, id.middleName, id.lastName]
    .filter((s): s is string => Boolean(s))
    .join(' ');
  const newDeclaration = {
    ...declaration,
    AssesseeVerName: fullName || declaration.AssesseeVerName,
    AssesseeVerPAN: id.pan ?? declaration.AssesseeVerPAN,
  };

  const newVerification = {
    ...verification,
    Declaration: newDeclaration,
  };

  // Banks → Refund.BankAccountDtls.AddtnlBankDetails
  const bankDetails = mapped.banks.map((b, i) => ({
    IFSCCode: b.ifsc,
    BankName: b.name,
    BankAccountNo: b.accountNo,
    AccountType: b.type ?? 'SB',
    UseForRefund: b.isDefault ? 'true' : 'false',
  }));
  // Guarantee exactly one refund account
  if (bankDetails.length > 0 && !bankDetails.some((b) => b.UseForRefund === 'true')) {
    bankDetails[0].UseForRefund = 'true';
  }

  const existingRefund = (draft.Refund as Record<string, unknown> | undefined) ?? {};
  const newRefund =
    bankDetails.length > 0
      ? {
          ...existingRefund,
          BankAccountDtls: { AddtnlBankDetails: bankDetails },
        }
      : existingRefund;

  return {
    ...draft,
    PersonalInfo: newPersonalInfo,
    Verification: newVerification,
    Refund: newRefund,
  };
}

// POST /api/it-portal/import
router.post('/import', async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Auth required' });
    return;
  }

  const { pan, password, profileId, itrDraftId } = (req.body ?? {}) as {
    pan?: string;
    password?: string;
    profileId?: string;
    itrDraftId?: string;
  };

  // ── Validation ────────────────────────────────────────────────────────
  if (typeof pan !== 'string' || !PAN_REGEX.test(pan.toUpperCase())) {
    res.status(400).json({ error: 'PAN must match format ABCDE1234F' });
    return;
  }
  if (typeof password !== 'string' || password.length === 0) {
    res.status(400).json({ error: 'Password required' });
    return;
  }
  const normalisedPan = pan.toUpperCase();

  // If profileId is provided, make sure it belongs to the caller before
  // spending time on portal round trips.
  if (typeof profileId === 'string' && profileId.length > 0) {
    const existing = profileRepoV2.findByIdForUser(profileId, req.user.id);
    if (!existing) {
      res.status(404).json({ error: 'Target profile not found' });
      return;
    }
  }
  // Same for itrDraftId.
  if (typeof itrDraftId === 'string' && itrDraftId.length > 0) {
    const draft = itrDraftRepo.findByIdForUser(itrDraftId, req.user.id);
    if (!draft) {
      res.status(404).json({ error: 'Target ITR draft not found' });
      return;
    }
  }

  const client = new ItPortalClient();
  try {
    // ── Step 1: authenticate with the portal ─────────────────────────
    const loginResult = await client.login(normalisedPan, password);
    if (!loginResult.ok) {
      res.status(401).json({ error: loginResult.error ?? 'Login failed' });
      return;
    }

    // ── Step 2: fetch the three endpoints in parallel ────────────────
    const [portalProfile, portalBanks, portalJurisdiction] = await Promise.all([
      client.fetchUserProfile(normalisedPan).catch(() => null),
      client.fetchBankDetails(normalisedPan).catch(() => null),
      client.fetchJurisdiction(normalisedPan).catch(() => null),
    ]);

    if (!portalProfile || !portalProfile.pan) {
      res
        .status(502)
        .json({ error: 'Portal accepted login but returned no profile data.' });
      return;
    }

    // ── Step 3: map ───────────────────────────────────────────────────
    const mapped = mapPortalToProfile(
      portalProfile,
      portalBanks,
      portalJurisdiction,
    );

    // ── Step 4: upsert profile ───────────────────────────────────────
    let targetProfileId = profileId;
    if (!targetProfileId) {
      const actor = userRepo.findById(req.user.id) ?? {
        id: req.user.id,
        inviter_id: null,
      };
      const billingUserId = getBillingUserId(actor);
      const created = profileRepoV2.create(req.user.id, mapped.name, billingUserId);
      targetProfileId = created.id;
    } else {
      // Update the name on the existing profile if the portal has a fuller one
      profileRepoV2.updateName(targetProfileId, req.user.id, mapped.name);
    }

    profileRepoV2.updateSlice(
      targetProfileId,
      req.user.id,
      'identity_data',
      JSON.stringify(mapped.identity),
    );
    profileRepoV2.updateSlice(
      targetProfileId,
      req.user.id,
      'address_data',
      JSON.stringify(mapped.address),
    );
    profileRepoV2.updateSlice(
      targetProfileId,
      req.user.id,
      'banks_data',
      JSON.stringify(mapped.banks),
    );

    // Merge jurisdiction into existing noticeDefaults so we don't overwrite
    // user-entered sender fields.
    const existing = profileRepoV2.findByIdForUser(targetProfileId, req.user.id);
    const existingNd = safeParse<Record<string, unknown>>(
      existing?.notice_defaults,
      {},
    );
    const mergedNd = {
      ...existingNd,
      ...(mapped.noticeDefaults.jurisdiction
        ? { jurisdiction: mapped.noticeDefaults.jurisdiction }
        : {}),
    };
    profileRepoV2.updateSlice(
      targetProfileId,
      req.user.id,
      'notice_defaults',
      JSON.stringify(mergedNd),
    );

    // ── Step 5: optional ITR draft prefill ───────────────────────────
    let prefilledDraftId: string | null = null;
    if (typeof itrDraftId === 'string' && itrDraftId.length > 0) {
      const draftRow = itrDraftRepo.findByIdForUser(itrDraftId, req.user.id);
      if (draftRow) {
        const payload = safeParse<Record<string, unknown>>(
          draftRow.ui_payload,
          {},
        );
        const patched = applyItrPrefill(payload, mapped);
        itrDraftRepo.updatePayload(
          itrDraftId,
          req.user.id,
          JSON.stringify(patched),
        );
        prefilledDraftId = itrDraftId;
      }
    }

    res.json({
      ok: true,
      profileId: targetProfileId,
      prefilledDraftId,
      imported: {
        name: mapped.name,
        pan: portalProfile.pan,
        bankCount: mapped.banks.length,
        hasJurisdiction: Boolean(mapped.noticeDefaults.jurisdiction),
      },
    });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Unknown error during import',
    });
  } finally {
    await client.logout();
  }
});

export default router;
