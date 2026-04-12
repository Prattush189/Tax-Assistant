/**
 * Low-level HTTP client for the Income Tax e-filing portal.
 *
 * Ported from the C# SmartTDS reference (IncomeTaxNewAutomation.cs). Uses
 * Node's native `fetch` plus a minimal per-instance cookie jar. Zero new
 * dependencies.
 *
 * SECURITY:
 *   - This client handles live IT portal credentials. Callers must ensure
 *     the password is never logged, persisted, or returned in HTTP
 *     responses. See server/routes/itPortalImport.ts for the auth contract.
 *   - The cookie jar is instance-local (not shared between requests). After
 *     logout() it is cleared. After the request handler returns, the whole
 *     client instance is eligible for GC.
 */
import type {
  PortalBankMasterDetails,
  PortalJurisdictionDetails,
  PortalLoginResponse,
  PortalUserProfile,
} from './types.js';

const BASE = 'https://eportal.incometax.gov.in';

// Exact headers from the C# reference — the portal is picky about these.
const BASE_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  Origin: 'https://eportal.incometax.gov.in',
  Referer: 'https://eportal.incometax.gov.in/iec/foservices/',
  'Content-Type': 'application/json',
};

export interface LoginResult {
  ok: boolean;
  error?: string;
  fullName?: string;
}

interface PostJsonResult<T> {
  status: number;
  raw: string;
  data: T;
}

export class ItPortalClient {
  private cookies = new Map<string, string>();

  private cookieHeader(): string {
    if (this.cookies.size === 0) return '';
    return Array.from(this.cookies.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }

  /**
   * Absorbs Set-Cookie headers from a response into the local jar.
   * Uses Headers.getSetCookie() (Node 18.14+) when available, falling back
   * to the raw `set-cookie` value.
   */
  private absorbCookies(res: Response): void {
    const anyHeaders = res.headers as unknown as {
      getSetCookie?: () => string[];
    };
    let lines: string[] = [];
    if (typeof anyHeaders.getSetCookie === 'function') {
      lines = anyHeaders.getSetCookie();
    } else {
      // Fallback: `get('set-cookie')` joins multiple values with ', ' which
      // is lossy for cookies. Split on ', ' only when the next segment looks
      // like a new cookie (contains '=').
      const single = res.headers.get('set-cookie');
      if (single) {
        lines = single.split(/,\s*(?=[A-Za-z_][A-Za-z0-9_]*=)/);
      }
    }
    for (const line of lines) {
      const first = line.split(';')[0];
      const eq = first.indexOf('=');
      if (eq > 0) {
        const name = first.slice(0, eq).trim();
        const value = first.slice(eq + 1).trim();
        if (name) this.cookies.set(name, value);
      }
    }
  }

  private async postJson<T = unknown>(
    path: string,
    body: unknown,
  ): Promise<PostJsonResult<T>> {
    const headers: Record<string, string> = { ...BASE_HEADERS };
    const cookie = this.cookieHeader();
    if (cookie) headers.Cookie = cookie;

    // Disable automatic redirect following so we can capture Set-Cookie
    // headers at every hop. The portal sometimes returns 302 during auth.
    const res = await fetch(BASE + path, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      redirect: 'manual',
    });
    this.absorbCookies(res);

    // Follow redirects manually (up to 5 hops) to capture cookies at each step
    let finalRes = res;
    let hops = 0;
    while (
      (finalRes.status === 301 || finalRes.status === 302 || finalRes.status === 307) &&
      hops < 5
    ) {
      const location = finalRes.headers.get('location');
      if (!location) break;
      const redirectUrl = location.startsWith('http')
        ? location
        : BASE + location;
      const redirectHeaders: Record<string, string> = { ...BASE_HEADERS };
      const redirectCookie = this.cookieHeader();
      if (redirectCookie) redirectHeaders.Cookie = redirectCookie;
      finalRes = await fetch(redirectUrl, {
        method: 'GET',
        headers: redirectHeaders,
        redirect: 'manual',
      });
      this.absorbCookies(finalRes);
      hops++;
    }

    const raw = await finalRes.text();
    let data: T;
    try {
      data = JSON.parse(raw) as T;
    } catch {
      data = raw as unknown as T;
    }
    return { status: finalRes.status, raw, data };
  }

  /**
   * Two-step login flow + force-login handling. Mirrors C# Auth().
   *
   * PAN is the username. Password is passed in plaintext and base64-encoded
   * before hitting the wire (per the portal's contract — it's NOT a hash).
   */
  async login(pan: string, password: string): Promise<LoginResult> {
    // ── Step 1: probe ──
    const step1 = await this.postJson<PortalLoginResponse>('/iec/loginapi/login', {
      entity: pan.slice(0, 15),
      serviceName: 'wLoginService',
    });
    if (step1.status !== 200) {
      return { ok: false, error: `Portal step 1 returned HTTP ${step1.status}` };
    }
    const step1Obj = step1.data;
    if (
      !step1Obj?.messages ||
      !step1Obj.messages.some((m) => m.type === 'INFO' && m.desc === 'OK')
    ) {
      const msg =
        step1Obj?.messages?.map((m) => `${m.type}-${m.desc}`).join(' / ') ??
        'unknown error';
      return { ok: false, error: `Portal rejected the PAN: ${msg}` };
    }
    if (step1Obj.secLoginOptions === 'DSC') {
      return {
        ok: false,
        error:
          'This PAN requires DSC login. Password login is disabled for this account.',
      };
    }

    // ── Step 2: authenticate ──
    // Reuse every field from step1, add password, null out otp/forgn fields
    // (C# explicitly sets these to null — the portal is picky).
    const step2Body: Record<string, unknown> = {
      errors: step1Obj.errors,
      reqId: step1Obj.reqId,
      entity: step1Obj.entity,
      entityType: step1Obj.entityType,
      role: step1Obj.role,
      uidValdtnFlg: step1Obj.uidValdtnFlg,
      aadhaarMobileValidated: step1Obj.aadhaarMobileValidated,
      secAccssMsg: step1Obj.secAccssMsg,
      imagePath: step1Obj.imagePath,
      secLoginOptions: step1Obj.secLoginOptions,
      aadhaarLinkedWithUserId: step1Obj.aadhaarLinkedWithUserId,
      exemptedPan: step1Obj.exemptedPan,
      userConsent: step1Obj.userConsent,
      imgByte: step1Obj.imgByte,
      pass: Buffer.from(password, 'ascii').toString('base64'),
      passValdtnFlg: null,
      otpGenerationFlag: null,
      otp: null,
      otpValdtnFlg: null,
      otpSourceFlag: null,
      contactPan: null,
      contactMobile: null,
      contactEmail: null,
      email: null,
      mobileNo: null,
      forgnDirEmailId: null,
      serviceName: 'loginService',
      dtoService: 'LOGIN',
    };

    let authResponse: PostJsonResult<PortalLoginResponse> | null = null;
    // Up to 10 retries on "Request is not authenticated" (portal anti-bot)
    for (let attempt = 0; attempt < 10; attempt++) {
      authResponse = await this.postJson<PortalLoginResponse>(
        '/iec/loginapi/login',
        step2Body,
      );
      if (authResponse.status !== 200) {
        if (attempt < 9) {
          await sleep(1000);
          continue;
        }
        return {
          ok: false,
          error: `Portal step 2 returned HTTP ${authResponse.status}`,
        };
      }
      if (authResponse.raw.includes('Request is not authenticated')) {
        if (attempt < 9) {
          await sleep(1000);
          continue;
        }
        return {
          ok: false,
          error: 'Portal rejected the request after multiple retries.',
        };
      }
      break;
    }
    if (!authResponse) {
      return { ok: false, error: 'Portal authentication failed (no response)' };
    }

    if (authResponse.raw.includes('Invalid Password')) {
      return { ok: false, error: 'Invalid password.' };
    }

    const authObj = authResponse.data;
    if (!authObj) {
      return { ok: false, error: 'Portal returned an empty authentication response.' };
    }

    // ── Step 3: force-login if session already active ──
    if (
      authObj.messages?.some((m) => m.desc === 'Session already active')
    ) {
      const forceBody: Record<string, unknown> = {
        aadhaarLinkedWithUserId: authObj.aadhaarLinkedWithUserId,
        aadhaarMobileValidated: authObj.aadhaarMobileValidated,
        clientIp: authObj.clientIp,
        email: authObj.email,
        entity: authObj.entity,
        entityType: authObj.entityType,
        errors: authObj.errors,
        exemptedPan: authObj.exemptedPan,
        imagePath: authObj.imagePath,
        imgByte: authObj.imgByte,
        lastLoginSuccessFlag: authObj.lastLoginSuccessFlag,
        mobileNo: authObj.mobileNo,
        otpGenerationFlag: 'true',
        otpValdtnFlg: 'true',
        pass: null,
        passValdtnFlg: 'true',
        remark: 'Continue',
        reqId: authObj.reqId,
        role: authObj.role,
        secAccssMsg: authObj.secAccssMsg,
        secLoginOptions: authObj.secLoginOptions,
        serviceName: 'loginService',
        uidValdtnFlg: authObj.uidValdtnFlg,
        userConsent: authObj.userConsent,
        userType: authObj.userType,
        dtoService: 'LOGIN',
      };
      const force = await this.postJson<PortalLoginResponse>(
        '/iec/loginapi/login',
        forceBody,
      );
      if (force.status !== 200 || force.raw.includes('Request is not authenticated')) {
        return { ok: false, error: 'Force-login failed.' };
      }
      // After force-login, subsequent API calls work with the cookies we
      // absorbed during this call.
    } else if (
      !authObj.messages?.some((m) => m.type === 'INFO' && m.desc === 'OK')
    ) {
      const infoMsg =
        authObj.messages?.map((m) => m.desc).filter(Boolean).join(' / ') ??
        'Unknown error';
      return { ok: false, error: `Portal rejected login: ${infoMsg}` };
    }

    // Try to extract the user's display name
    let fullName: string | undefined;
    try {
      const parsed = JSON.parse(authResponse.raw) as { fullName?: string };
      if (parsed?.fullName) fullName = parsed.fullName;
    } catch {}

    console.log('[itPortal] Login successful for', pan, '| cookies:', this.cookies.size,
      '| keys:', Array.from(this.cookies.keys()).join(', '));
    return { ok: true, fullName };
  }

  async fetchUserProfile(pan: string): Promise<PortalUserProfile | null> {
    console.log('[itPortal] Fetching user profile for', pan, '| cookies:', this.cookies.size);
    const res = await this.postJson<PortalUserProfile>(
      '/iec/servicesapi/auth/saveEntity',
      {
        serviceName: 'userProfileService',
        userId: pan,
      },
    );
    console.log('[itPortal] userProfile status:', res.status, '| body length:', res.raw.length);
    if (res.status !== 200) {
      console.warn('[itPortal] userProfile failed:', res.raw.slice(0, 300));
      return null;
    }
    if (res.raw.includes('Unauthorized') || res.raw.includes('Request is not authenticated')) {
      console.warn('[itPortal] userProfile: session expired');
      return null;
    }
    return res.data ?? null;
  }

  async fetchBankDetails(pan: string): Promise<PortalBankMasterDetails | null> {
    console.log('[itPortal] Fetching bank details for', pan);
    const res = await this.postJson<PortalBankMasterDetails>(
      '/iec/servicesapi/auth/getEntity',
      {
        entityNum: pan,
        serviceName: 'myBankAccountService',
        header: { formName: 'FO-054-PBACC' },
      },
    );
    console.log('[itPortal] bankDetails status:', res.status);
    if (res.status !== 200 || res.raw.includes('Unauthorized') || res.raw.includes('Request is not authenticated')) {
      console.warn('[itPortal] bankDetails failed:', res.raw.slice(0, 300));
      return null;
    }
    return res.data ?? null;
  }

  async fetchJurisdiction(
    pan: string,
  ): Promise<PortalJurisdictionDetails | null> {
    console.log('[itPortal] Fetching jurisdiction for', pan);
    const res = await this.postJson<PortalJurisdictionDetails>(
      '/iec/servicesapi/auth/saveEntity',
      {
        serviceName: 'jurisdictionDetailsService',
        loggedInUserId: pan,
      },
    );
    console.log('[itPortal] jurisdiction status:', res.status);
    if (res.status !== 200 || res.raw.includes('Unauthorized') || res.raw.includes('Request is not authenticated')) {
      console.warn('[itPortal] jurisdiction failed:', res.raw.slice(0, 300));
      return null;
    }
    return res.data ?? null;
  }

  /**
   * Best-effort logout. Silently swallows errors — the portal will expire
   * our session server-side in ~15 minutes regardless.
   */
  async logout(): Promise<void> {
    try {
      await this.postJson('/iec/loginapi/login', { serviceName: 'logoutService' });
    } catch {
      // ignore
    }
    this.cookies.clear();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
