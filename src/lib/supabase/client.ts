import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { browserSupabaseUrl, cookieOptions, SUPABASE_KEY } from './config';

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!client) client = createBrowserClient(browserSupabaseUrl(), SUPABASE_KEY, { cookieOptions });
  return client;
}
