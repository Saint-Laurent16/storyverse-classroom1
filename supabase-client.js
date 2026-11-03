// Browser-safe Supabase configuration. Never use a Supabase Secret/service_role key here.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

export const SUPABASE_URL = 'https://dtkcpvcparxlbnghlunr.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_zXM_mo4SDRhr4s3Ptot5hQ_ZUi1iypX';

export const supabaseConfigured = Boolean(
  SUPABASE_URL.startsWith('https://') &&
  SUPABASE_PUBLISHABLE_KEY.startsWith('sb_publishable_')
);

export const supabase = supabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;
