/**
 * TypeScript shapes for the Income Tax e-filing portal JSON responses.
 * Ported from the SmartTDS C# reference (IncomeTaxNewAutomation.cs).
 *
 * Only the fields we actually consume in the mapper are strongly typed; the
 * portal returns many more fields that we ignore. All fields are optional
 * because the portal is inconsistent about which ones are populated.
 */

// ── Common ────────────────────────────────────────────────────────────────

export interface PortalMessage {
  code?: string;
  type?: string;         // "INFO" | "ERROR" | "WARN"
  desc?: string;
  fieldName?: unknown;
}

export interface PortalError {
  errCd?: string;
  errFld?: string;
  errCtg?: string;
  errDesc?: string;
}

export interface PortalHeader {
  formName?: unknown;
}

// ── Login flow ────────────────────────────────────────────────────────────

/**
 * Response shape for /iec/loginapi/login at both step 1 (probe) and step 2
 * (authenticate). Mirrors C# LoginStep1Class.
 */
export interface PortalLoginResponse {
  header?: PortalHeader;
  messages?: PortalMessage[];
  errors?: PortalError[];
  reqId?: string;
  entity?: string;
  entityType?: string;
  role?: string;
  uidValdtnFlg?: string;
  aadhaarMobileValidated?: string;
  secAccssMsg?: string;
  imagePath?: string;
  secLoginOptions?: string;        // "DSC" means password login disabled
  aadhaarLinkedWithUserId?: string;
  exemptedPan?: string;
  userConsent?: string;
  imgByte?: string;
  userType?: string;
  passValdtnFlg?: string;
  mobileNo?: string;
  email?: string;
  lastLoginSuccessFlag?: string;
  clientIp?: string;
  dtoService?: string;
  fullName?: string;
}

// ── userProfileService response ───────────────────────────────────────────

/**
 * Mirrors C# UserProfile. The portal returns flat address lines addrLine1Txt
 * through addrLine5Txt plus pinCd/stateCd/countryCd as numeric codes.
 */
export interface PortalUserProfile {
  header?: PortalHeader;
  messages?: PortalMessage[];
  errors?: PortalError[];
  userId?: string;
  orgName?: string;
  priMobileNum?: string;
  priEmailId?: string;
  addrLine1Txt?: string;
  addrLine2Txt?: string;
  addrLine3Txt?: string;
  addrLine4Txt?: string;
  addrLine5Txt?: string;
  pinCd?: number;
  stateCd?: string | number;
  countryCd?: number;
  pan?: string;
  panStatus?: string;
  commAddrFlag?: string;
  tan?: string;
  roleCd?: string;
  status?: string;
  dscFlag?: string;
  residentialStatusCd?: string;
  aadhaarNum?: string;
  aadhaarLinkFlag?: string;
  firstName?: string;
  middleName?: string;
  lastName?: string;
  activationDt?: number;
  dateOfBirth?: number;
  userGender?: string;
  ctznFlag?: string;
  dob?: string;                     // often "YYYY-MM-DD"
  citizenshipCountryCd?: number;
  imagePath?: string;
  contactFirstName?: string;
  contactLastName?: string;
  contanctPanNo?: string;
}

// ── myBankAccountService response ─────────────────────────────────────────

export interface PortalBankAccount {
  header?: PortalHeader;
  messages?: PortalMessage[];
  errors?: PortalError[];
  uniqueReqId?: string;
  entityNum?: string;
  bankAcctNum?: string;
  entityType?: string;
  accountType?: string;            // "SB" | "CA" | "CC" | "OD" | "NRO" | etc.
  ifscCd?: string;
  bankName?: string;
  bankBrnchTxt?: string;
  nameAsPerBank?: string;
  mobileNo?: string;
  emailId?: string;
  status?: string;                 // "VALIDATED" when usable
  submitDt?: string;
  validDt?: string;
  refundFlag?: string;             // "Y" if this is the user's refund bank
  evcFlag?: string;
  activeFlag?: string;             // "Y" when active
}

export interface PortalBankMasterDetails {
  header?: PortalHeader;
  messages?: PortalMessage[];
  errors?: PortalError[];
  reqId?: string;
  activeBank?: PortalBankAccount[];
  inActiveBank?: PortalBankAccount[];
  failedBank?: PortalBankAccount[];
  transactionNo?: string;
}

// ── jurisdictionDetailsService response ───────────────────────────────────

export interface PortalJurisdictionDetails {
  areaCd?: string;
  areaDesc?: string;
  aoType?: string;
  rangeCd?: string;
  aoNo?: string;
  aoPplrName?: string;
  aoEmailId?: string;
  aoBldgId?: string;
  aoBldgDesc?: string;
}
