/**
 * WhatsApp OTP sender — Meta WhatsApp Cloud API, same account and
 * approved template as assist.smartbizin.com.
 *
 * Env:
 *   META_WA_ACCESS_TOKEN     — permanent System User token
 *   META_WA_PHONE_NUMBER_ID  — sender phone number id from WhatsApp Manager
 *   META_WA_API_VERSION      — Graph API version (default v21.0)
 *   META_WA_TEMPLATE_OTP     — approved OTP template (default 'otp_verf';
 *                              body_1 = code, URL button suffix = code)
 *
 * Like sendMail(), never throws — returns { ok, error? }.
 */

const ACCESS_TOKEN = process.env.META_WA_ACCESS_TOKEN ?? '';
const PHONE_NUMBER_ID = process.env.META_WA_PHONE_NUMBER_ID ?? '';
const API_VERSION = process.env.META_WA_API_VERSION || 'v21.0';
const TEMPLATE_OTP = process.env.META_WA_TEMPLATE_OTP || 'otp_verf';

export const whatsappConfigured = Boolean(ACCESS_TOKEN && PHONE_NUMBER_ID);

/** `phone` is the bare 10-digit Indian mobile (see normalizePhone). */
export async function sendWhatsAppOtp(phone: string, code: string): Promise<{ ok: boolean; error?: string }> {
  if (!whatsappConfigured) return { ok: false, error: 'WhatsApp is not configured' };
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: `91${phone}`,
    type: 'template',
    template: {
      name: TEMPLATE_OTP,
      language: { code: 'en' },
      components: [
        { type: 'body', parameters: [{ type: 'text', text: code }] },
        { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] },
      ],
    },
  };
  try {
    const res = await fetch(`https://graph.facebook.com/${API_VERSION}/${PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ACCESS_TOKEN}` },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: number } };
    if (!res.ok) {
      const error = `Meta ${data.error?.code ?? res.status}: ${data.error?.message ?? res.statusText}`;
      console.warn(`[whatsapp] OTP send to ${maskPhone(phone)} failed — ${error}`);
      return { ok: false, error };
    }
    return { ok: true };
  } catch (err) {
    const error = (err as Error).message;
    console.warn(`[whatsapp] OTP send to ${maskPhone(phone)} failed — ${error}`);
    return { ok: false, error };
  }
}

/** "98******10" — safe to show in UI and logs. */
export function maskPhone(phone: string): string {
  if (phone.length < 5) return phone;
  return `${phone.slice(0, 2)}${'*'.repeat(phone.length - 4)}${phone.slice(-2)}`;
}
