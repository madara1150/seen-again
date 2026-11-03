import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { cookieOptions, SERVER_SUPABASE_URL, SUPABASE_KEY } from './config';

export async function getServerSupabase() {
  const cookieStore = await cookies();
  return createServerClient(SERVER_SUPABASE_URL, SUPABASE_KEY, {
    cookieOptions,
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
      },
    },
  });
}
