/* Online ordering settings.
   Leave both empty to keep testing in "this browser only" mode.
   After setting up Supabase (see supabase/SETUP.md) paste the two values from
   Supabase dashboard -> Project Settings -> API:
     supabaseUrl : the Project URL            e.g. https://abcdefgh.supabase.co
     anonKey     : the "anon public" key      (safe to put here; never use the service_role key) */
window.SELVI_CONFIG = {
  supabaseUrl: '',
  anonKey: ''
};
// (test hook used by the automated browser tests; harmless otherwise)
if (window.__SELVI_TEST_CONFIG) { window.SELVI_CONFIG = window.__SELVI_TEST_CONFIG; }
