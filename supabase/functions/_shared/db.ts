// Real database access (Supabase). The service-role key never leaves the Edge Functions.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

export function makeDb(url: string, serviceKey: string): any {
  const sb: any = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const rpc = async (fn: string, args: any) => {
    const { data, error } = await sb.rpc(fn, args);
    if (error) throw new Error(error.message);
    return data;
  };
  return {
    async uploadProof(path: string, bytes: Uint8Array, mime: string) {
      const { error } = await sb.storage.from('payment-proofs').upload(path, bytes, { contentType: mime, upsert: false });
      if (error) throw new Error('Could not store the screenshot: ' + error.message);
    },
    async deleteProof(path: string) { await sb.storage.from('payment-proofs').remove([path]); },
    createOrder: (payload: any) => rpc('create_order', { p: payload }),
    getOrder: (no: string, mobile: string) => rpc('get_order', { p_no: no, p_mobile: mobile }),
    setStatus: (no: string, status: string, by: string, note: string | null) =>
      rpc('set_order_status', { p_no: no, p_status: status, p_by: by, p_note: note }),
    setPayment: (no: string, ps: string, by: string, note: string | null) =>
      rpc('set_payment_status', { p_no: no, p_ps: ps, p_by: by, p_note: note }),
    async verifyAdmin(jwt: string) {
      const { data, error } = await sb.auth.getUser(jwt);
      if (error || !data || !data.user) return null;
      const { data: row } = await sb.from('admins').select('user_id').eq('user_id', data.user.id).maybeSingle();
      return row ? { id: data.user.id } : null;
    },
    storeOtp: (mobile: string, hash: string, mode: string) => rpc('store_otp', { p_mobile: mobile, p_hash: hash, p_mode: mode }),
    verifyOtp: (mobile: string, hash: string, name: string, email: string, tokenHash: string) =>
      rpc('verify_otp', { p_mobile: mobile, p_hash: hash, p_name: name, p_email: email, p_token_hash: tokenHash }),
    sessionCustomer: (tokenHash: string) => rpc('session_customer', { p_token_hash: tokenHash }),
    customerOrders: (tokenHash: string) => rpc('customer_orders', { p_token_hash: tokenHash }),
    updateCustomer: (tokenHash: string, name: string, email: string) => rpc('update_customer', { p_token_hash: tokenHash, p_name: name, p_email: email }),
    async endSession(tokenHash: string) { await rpc('end_session', { p_token_hash: tokenHash }); },
    async logNotification(n: any) {
      const { data: o } = n.order_no ? await sb.from('orders').select('id').eq('bill_no', n.order_no).maybeSingle() : { data: null };
      await sb.from('notifications').insert({
        order_id: o ? o.id : null, channel: n.channel, template: n.template, to_addr: n.to_addr,
        audience: n.audience, status: n.status, provider_id: n.provider_id, error: n.error
      });
    }
  };
}
