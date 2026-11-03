const PUBLIC_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';
export const isSupabaseConfigured = Boolean(PUBLIC_URL && SUPABASE_KEY);

/**
 * NEXT_PUBLIC_SUPABASE_URL may be a path such as "/supabase": the browser then talks to
 * Supabase through this app (next.config rewrites it to SUPABASE_INTERNAL_URL), so a
 * self-hosted setup only has to expose one HTTPS port.
 */
export const isProxied = PUBLIC_URL.startsWith('/');

/** URL for code running in the browser. */
export const browserSupabaseUrl = () => (isProxied ? `${location.origin}${PUBLIC_URL}` : PUBLIC_URL);

/** URL for code running on the server (proxy.ts, route handlers). */
export const SERVER_SUPABASE_URL = process.env.SUPABASE_INTERNAL_URL || PUBLIC_URL;

// Fixed name, because the default is derived from the URL host, which differs between
// the browser ("myhost/supabase") and the server ("127.0.0.1") when proxied.
export const cookieOptions = { name: 'sb-face-tracker-auth-token' };

export const FACES_BUCKET = 'faces';
