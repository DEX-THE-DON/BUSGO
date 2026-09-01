/**
 * M-Pesa Daraja STK Push integration — a direct port of the Python version.
 *
 * Real API flow:
 *   1. OAuth access token (consumer key/secret via Basic auth).
 *   2. STK password = base64(timestamp + shortcode + passkey).
 *   3. POST /mpesa/stkpush/v1/processrequest with the customer's phone.
 *   4. Safaricom calls MPESA_CALLBACK_URL with the result, which the app
 *      verifies and applies idempotently.
 *
 * The app degrades gracefully: `configured()` is false until the real keys are
 * set, and the simulated M-Pesa flow remains available for local dev.
 */
import { env } from './env.js';

const MPESA_BASE_URL =
  env.mpesa.env === 'sandbox'
    ? 'https://sandbox.safaricom.co.ke'
    : 'https://api.safaricom.co.ke';

/** Equivalent of ValueError in the Python client (bad phone number). */
export class DarajaValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DarajaValidationError';
  }
}

export function configured(): boolean {
  return Boolean(env.mpesa.consumerKey && env.mpesa.consumerSecret && env.mpesa.passkey);
}

export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('0')) return '254' + digits.slice(1);
  if (digits.startsWith('254')) return digits;
  throw new DarajaValidationError('Phone number must be a Kenyan number like 2547XXXXXXXX.');
}

export async function getAccessToken(): Promise<string> {
  const resp = await fetch(
    `${MPESA_BASE_URL}/oauth/v1/generate?grant_type=client_credentials`,
    {
      headers: {
        Authorization:
          'Basic ' +
          Buffer.from(`${env.mpesa.consumerKey}:${env.mpesa.consumerSecret}`).toString('base64'),
      },
    },
  );
  if (!resp.ok) throw new Error(`Daraja access token request failed (HTTP ${resp.status})`);
  const data = (await resp.json()) as Record<string, unknown>;
  const token = data.access_token;
  if (!token) throw new Error(`Daraja access token request failed: ${JSON.stringify(data)}`);
  return String(token);
}

/** Local-time YYYYMMDDHHMMSS (mirrors Python datetime.now().strftime(...)). */
function localTimestamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function stkPassword(): [string, string] {
  const timestamp = localTimestamp();
  const raw = `${env.mpesa.shortcode}${env.mpesa.passkey}${timestamp}`;
  return [Buffer.from(raw, 'utf8').toString('base64'), timestamp];
}

export async function stkPush(
  phone: string,
  amount: number,
  accountReference: string,
  transactionDesc = 'BUSGO Seat Booking',
): Promise<Record<string, unknown>> {
  const token = await getAccessToken();
  const [password, timestamp] = stkPassword();
  const normalized = normalizePhone(phone);
  const payload = {
    BusinessShortCode: env.mpesa.shortcode,
    Password: password,
    Timestamp: timestamp,
    TransactionType: 'CustomerPayBillOnline',
    Amount: Math.round(amount),
    PartyA: normalized,
    PartyB: env.mpesa.shortcode,
    PhoneNumber: normalized,
    CallBackURL: env.mpesa.callbackUrl,
    AccountReference: (accountReference || 'BUSGO').slice(0, 12),
    TransactionDesc: transactionDesc.slice(0, 13),
  };
  const resp = await fetch(`${MPESA_BASE_URL}/mpesa/stkpush/v1/processrequest`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) throw new Error(`Daraja STK push failed (HTTP ${resp.status})`);
  return (await resp.json()) as Record<string, unknown>;
}

export interface ParsedCallback {
  checkout_request_id: string;
  result_code: number;
  result_desc: string;
  metadata: Record<string, unknown>;
}

export function parseCallback(body: Record<string, unknown>): ParsedCallback | null {
  try {
    const bodyAny = body as { Body?: { stkCallback?: Record<string, unknown> } };
    const stk = bodyAny.Body?.stkCallback;
    if (!stk) return null;
    const checkoutId = stk.CheckoutRequestID as string;
    const resultCode = stk.ResultCode as number;
    const resultDesc = (stk.ResultDesc ?? '') as string;
    const metadata: Record<string, unknown> = {};
    const cbMeta = stk.CallbackMetadata as { Item?: Array<Record<string, unknown>> } | undefined;
    for (const item of cbMeta?.Item ?? []) {
      metadata[String(item.Name)] = item.Value;
    }
    return {
      checkout_request_id: checkoutId,
      result_code: resultCode,
      result_desc: resultDesc,
      metadata,
    };
  } catch {
    return null;
  }
}
