// Sends WhatsApp (Meta Cloud API), SMS (MSG91) and email (Resend). A channel that is not configured is
// "skipped"; a channel that fails is logged as "failed". Neither can ever break an order.
import { intlMobile, messageFor, adminMessage, CUSTOMER_KINDS } from './logic.ts';

export function makeNotifier(deps: any) {
  const env = (k: string): string => (deps.env(k) || '').trim();
  const f = deps.fetchFn;

  async function sendEmail(to: string, subject: string, html: string): Promise<any> {
    if (!env('RESEND_API_KEY') || !env('MAIL_FROM')) return { status: 'skipped', error: 'Resend not configured' };
    const r = await f('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + env('RESEND_API_KEY'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env('MAIL_FROM'), to: [to], subject, html })
    });
    const j: any = await r.json().catch(() => ({}));
    return r.ok ? { status: 'sent', id: j.id } : { status: 'failed', error: JSON.stringify(j).slice(0, 300) };
  }

  async function sendWhatsApp(mobile: string, template: string, params: string[], buttonCode?: string): Promise<any> {
    if (!env('WHATSAPP_TOKEN') || !env('WHATSAPP_PHONE_ID') || !template) return { status: 'skipped', error: 'WhatsApp template not configured' };
    const r = await f(`https://graph.facebook.com/v20.0/${env('WHATSAPP_PHONE_ID')}/messages`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + env('WHATSAPP_TOKEN'), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp', to: intlMobile(mobile), type: 'template',
        template: {
          name: template, language: { code: env('WA_LANG') || 'en' },
          components: [{ type: 'body', parameters: params.map((p: string) => ({ type: 'text', text: String(p) })) } as any]
            .concat(buttonCode ? [{ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: buttonCode }] }] : [])
        }
      })
    });
    const j: any = await r.json().catch(() => ({}));
    return r.ok ? { status: 'sent', id: j.messages && j.messages[0] && j.messages[0].id } : { status: 'failed', error: JSON.stringify(j).slice(0, 300) };
  }

  async function sendSms(mobile: string, templateId: string, params: string[]): Promise<any> {
    if (!env('MSG91_AUTH_KEY') || !templateId) return { status: 'skipped', error: 'MSG91 template not configured' };
    const rec: any = { mobiles: intlMobile(mobile) };
    params.forEach((p: string, i: number) => { rec['var' + (i + 1)] = String(p); });
    const r = await f('https://control.msg91.com/api/v5/flow', {
      method: 'POST',
      headers: { authkey: env('MSG91_AUTH_KEY'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ template_id: templateId, short_url: '0', recipients: [rec] })
    });
    const j: any = await r.json().catch(() => ({}));
    return r.ok && j.type !== 'error' ? { status: 'sent', id: j.request_id || j.message } : { status: 'failed', error: JSON.stringify(j).slice(0, 300) };
  }

  async function record(order: any, channel: string, template: string, to: string, audience: string, fn: () => Promise<any>) {
    let res: any;
    try { res = await fn(); } catch (e: any) { res = { status: 'failed', error: String((e && e.message) || e).slice(0, 300) }; }
    try {
      await deps.db.logNotification({
        order_no: order.no, channel, template, to_addr: to, audience,
        status: res.status, provider_id: res.id || null, error: res.error || null
      });
    } catch (_e) { /* logging must never fail the request */ }
    return res;
  }

  const ctx = () => ({ siteUrl: env('SITE_URL'), businessPhone: env('BUSINESS_PHONE') });

  /** message to the customer on every channel they can be reached on */
  async function toCustomer(order: any, kind: string): Promise<any[]> {
    if (!CUSTOMER_KINDS.includes(kind)) return [];
    const msg = messageFor(kind, order, ctx());
    if (!msg) return [];
    const c = order.customer || {};
    const up = kind.toUpperCase();
    const jobs: Promise<any>[] = [
      record(order, 'whatsapp', kind, c.mobile, 'customer', () => sendWhatsApp(c.mobile, env('WA_TPL_' + up), msg.params)),
      record(order, 'sms', kind, c.mobile, 'customer', () => sendSms(c.mobile, env('MSG91_TPL_' + up), msg.smsParams))
    ];
    if (c.email) jobs.push(record(order, 'email', kind, c.email, 'customer', () => sendEmail(c.email, msg.subject, msg.html)));
    return Promise.all(jobs);
  }

  /** message to the shop owner (new order, parcel arrived -> call the customer) */
  async function toAdmin(order: any, kind: string): Promise<any[]> {
    const msg = adminMessage(kind, order, ctx());
    const to = env('ADMIN_EMAIL');
    if (!msg) return [];
    if (!to) return [await record(order, 'email', kind, '', 'admin', async () => ({ status: 'skipped', error: 'ADMIN_EMAIL not set' }))];
    return [await record(order, 'email', kind, to, 'admin', () => sendEmail(to, msg.subject, msg.html))];
  }

  /** one-time login code by SMS and WhatsApp (whichever are configured); the code itself is never logged */
  async function sendOtp(mobile: string, code: string): Promise<any[]> {
    const o = { no: null };
    return Promise.all([
      record(o, 'sms', 'otp', mobile, 'customer', () => sendSms(mobile, env('MSG91_TPL_OTP'), [code])),
      record(o, 'whatsapp', 'otp', mobile, 'customer', () => sendWhatsApp(mobile, env('WA_TPL_OTP'), [code], env('WA_OTP_BUTTON') === '1' ? code : ''))
    ]);
  }

  return { toCustomer, toAdmin, sendEmail, sendWhatsApp, sendSms, sendOtp };
}
