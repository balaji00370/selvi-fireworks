// Pure helpers (no Deno / network APIs) so they can be unit-tested in Node.

export const STATUS_LABEL: any = {
  placed: 'Order placed', packed: 'Packed', transporting: 'Transporting', arrived: 'Arrived', cancelled: 'Cancelled'
};

export function money(n: any): string {
  return '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function normMobile(m: any): string {
  return String(m || '').replace(/\D/g, '').slice(-10);
}

/** "+91" + 10 digits, the form WhatsApp / MSG91 want (no plus sign) */
export function intlMobile(m: any): string {
  return '91' + normMobile(m);
}

export function corsHeaders(origin: string | null, allowed: string): any {
  const allow = !allowed || allowed === '*' ? '*' : (origin && allowed.split(',').map((s: string) => s.trim()).includes(origin) ? origin : allowed.split(',')[0].trim());
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-customer-token',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin'
  };
}

/** data:image/jpeg;base64,.... -> { mime, bytes } or null. Max 1.5 MB, jpeg/png/webp only. */
export function parseImageDataUrl(s: any): any {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(String(s || ''));
  if (!m) return null;
  const bin = atob(m[2].replace(/\s/g, ''));
  if (bin.length === 0 || bin.length > 1_500_000) return null;
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const ext = m[1] === 'image/png' ? 'png' : m[1] === 'image/webp' ? 'webp' : 'jpg';
  return { mime: m[1], bytes, ext };
}

export function validateSubmitBody(b: any): string | null {
  if (!b || typeof b !== 'object') return 'Invalid request';
  if (!b.customer || typeof b.customer !== 'object') return 'Customer details are missing';
  if (!Array.isArray(b.items) || b.items.length === 0) return 'No products in the order';
  if (b.items.length > 250) return 'Too many products';
  for (const it of b.items) {
    if (!it || !Number.isInteger(it.pid) || !Number.isInteger(it.qty) || it.qty < 1 || it.qty > 100000) return 'Invalid product or quantity';
  }
  if (!b.screenshot) return 'Payment screenshot is required';
  return null;
}

/** Postgres RAISE EXCEPTION 'CODE: text' -> HTTP status + message for the browser */
export function mapDbError(message: string): any {
  const m = /^(INVALID|MIN_ORDER|PRICE_MISMATCH|TOO_MANY|RATE_LIMIT|NOT_FOUND|NO_CHANGE|BAD_TRANSITION|NO_ACCOUNT|UNAUTHORIZED)\b:?\s*(.*)$/s.exec(String(message || '').trim());
  if (!m) return { status: 500, code: 'SERVER_ERROR', message: 'Something went wrong. Please try again.' };
  const status: any = { INVALID: 400, MIN_ORDER: 422, PRICE_MISMATCH: 409, TOO_MANY: 429, RATE_LIMIT: 429, NOT_FOUND: 404, NO_CHANGE: 409, BAD_TRANSITION: 409, NO_ACCOUNT: 404, UNAUTHORIZED: 401 };
  const friendly: any = {
    MIN_ORDER: 'The minimum booking value is ₹5,000.',
    PRICE_MISMATCH: 'Prices have changed. Please reload the Book Now page and try again.',
    TOO_MANY: 'Too many requests. Please wait a moment and try again.',
    RATE_LIMIT: 'Too many attempts. Please try again in an hour.',
    NOT_FOUND: 'We could not find that order.'
  };
  return { status: status[m[1]], code: m[1], message: friendly[m[1]] || m[2] || m[1] };
}

// ---------- message texts ----------
// WhatsApp templates take positional variables:
//   placed:                          [name, billNo, amount, trackLink]
//   packed / transporting / arrived / cancelled / payment_rejected: [name, billNo, trackLink]
// SMS (India DLT limits variable length) never gets the long link; the fixed link text lives in the DLT template:
//   placed: [name, billNo, amount]   others: [name, billNo]
export const CUSTOMER_KINDS = ['placed', 'packed', 'transporting', 'arrived', 'cancelled', 'payment_rejected'];

export function messageFor(kind: string, order: any, ctx: any): any {
  const c = order.customer || {};
  const name = String(c.name || 'Customer').split(/\s+/)[0];
  const link = (ctx.siteUrl || '').replace(/\/$/, '') + '/vieworders.html?order=' + encodeURIComponent(order.no);
  const phone = ctx.businessPhone || '';
  const amount = money(order.total);
  const T: any = {
    placed: {
      subject: `Order ${order.no} received — Selvi Fireworks`,
      text: `Selvi Fireworks: Hi ${name}, thank you! Your order ${order.no} (${amount}) is received. Track it: ${link}`,
      params: [name, order.no, amount, link],
      smsParams: [name, order.no, amount]
    },
    packed: {
      subject: `Order ${order.no} is packed`,
      text: `Selvi Fireworks: Hi ${name}, your order ${order.no} is packed at our Sivakasi factory. Track it: ${link}`,
      params: [name, order.no, link],
      smsParams: [name, order.no]
    },
    transporting: {
      subject: `Order ${order.no} is on its way`,
      text: `Selvi Fireworks: Hi ${name}, your order ${order.no} is on its way by transport. Track it: ${link}`,
      params: [name, order.no, link],
      smsParams: [name, order.no]
    },
    arrived: {
      subject: `Order ${order.no} has arrived`,
      text: `Selvi Fireworks: Hi ${name}, your order ${order.no} has arrived. Our team will call you shortly. Details: ${link}`,
      params: [name, order.no, link],
      smsParams: [name, order.no]
    },
    cancelled: {
      subject: `Order ${order.no} was cancelled`,
      text: `Selvi Fireworks: Hi ${name}, your order ${order.no} was cancelled. Please call ${phone} for help. ${link}`,
      params: [name, order.no, link],
      smsParams: [name, order.no]
    },
    payment_rejected: {
      subject: `We could not verify the payment for ${order.no}`,
      text: `Selvi Fireworks: Hi ${name}, we could not verify the payment for order ${order.no}. Please call ${phone}. ${link}`,
      params: [name, order.no, link],
      smsParams: [name, order.no]
    }
  };
  const t = T[kind];
  if (!t) return null;
  const rows = (order.items || []).map((i: any) =>
    `<tr><td style="padding:6px 8px;border-bottom:1px solid #eee">${esc(i.name)}</td><td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${i.qty}</td><td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${money(i.amt)}</td></tr>`).join('');
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#111">
  <h2 style="margin:0 0 6px;color:#b8860b">Selvi Fireworks Industries</h2>
  <p>Hi ${esc(name)},</p>
  <p>${esc(t.text.replace(/^Selvi Fireworks: Hi [^,]+, /, '').replace(/ (Track it|Details): .*$/, ''))}</p>
  ${kind === 'placed' ? `<table style="width:100%;border-collapse:collapse;font-size:14px"><tr style="background:#f5f5f5"><th style="padding:6px 8px;text-align:left">Product</th><th style="padding:6px 8px;text-align:right">Qty</th><th style="padding:6px 8px;text-align:right">Amount</th></tr>${rows}
  <tr><td colspan="2" style="padding:8px;text-align:right"><b>Total (incl. packing)</b></td><td style="padding:8px;text-align:right"><b>${amount}</b></td></tr></table>` : ''}
  <p><a href="${link}" style="background:#ffd700;color:#000;padding:10px 18px;border-radius:20px;text-decoration:none;font-weight:bold">Track your order</a></p>
  <p style="color:#666;font-size:12px">Bill no ${esc(order.no)} · Need help? Call ${esc(phone)}</p></div>`;
  return { subject: t.subject, text: t.text, html, params: t.params, smsParams: t.smsParams };
}

export function adminMessage(kind: string, order: any, ctx: any): any {
  const c = order.customer || {};
  const where = [c.city, c.district].filter(Boolean).join(', ');
  const link = (ctx.siteUrl || '').replace(/\/$/, '') + '/admin.html';
  if (kind === 'new_order') {
    return {
      subject: `New order ${order.no} — ${money(order.total)}`,
      html: `<div style="font-family:Arial,sans-serif"><h3>New order ${esc(order.no)}</h3>
        <p><b>${esc(c.name)}</b> · ${esc(c.mobile)} · ${esc(where)}<br>Total ${money(order.total)} · ${(order.items || []).length} products</p>
        <p>Check the payment screenshot against the bank account, then update the order:<br><a href="${link}">${link}</a></p></div>`
    };
  }
  if (kind === 'arrived') {
    return {
      subject: `CALL CUSTOMER: order ${order.no} has arrived`,
      html: `<div style="font-family:Arial,sans-serif"><h3>Order ${esc(order.no)} has arrived</h3>
        <p>Please call <b>${esc(c.name)}</b> on <b>${esc(c.mobile)}</b> (${esc(where)}) to tell them their parcel is at the transport office.</p></div>`
    };
  }
  return null;
}

export function esc(s: any): string {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (ch: string) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as any)[ch]);
}

export async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b: number) => b.toString(16).padStart(2, '0')).join('');
}

export function randomDigits(n: number): string {
  const a = new Uint32Array(n); crypto.getRandomValues(a);
  return [...a].map((x: number) => String(x % 10)).join('');
}

export function randomToken(): string {
  const a = new Uint8Array(32); crypto.getRandomValues(a);
  return [...a].map((b: number) => b.toString(16).padStart(2, '0')).join('');
}
