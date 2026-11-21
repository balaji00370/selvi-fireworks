// Connects the handlers to the real Supabase / provider APIs (used by the three index.ts files).
import { makeDb } from './db.ts';
import { makeNotifier } from './notify.ts';
import { makeHandlers } from './handlers.ts';

declare const Deno: any;
declare const EdgeRuntime: any;

export function build() {
  const env = (k: string) => Deno.env.get(k) || '';
  const db = makeDb(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));
  const notifier = makeNotifier({ env, fetchFn: fetch, db });
  // let messages finish after the HTTP response has been sent
  const background = (p: Promise<any>) => {
    const safe = p.catch((e: any) => console.error('background task failed:', e && e.message ? e.message : e));
    if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(safe);
    return safe;
  };
  return makeHandlers({ db, notifier, background, allowedOrigin: env('ALLOWED_ORIGIN') || '*',
    pepper: env('OTP_SECRET') || env('SUPABASE_SERVICE_ROLE_KEY'), devOtp: env('OTP_DEV_RETURN') === '1', requireLogin: env('REQUIRE_LOGIN') !== '0' });
}
