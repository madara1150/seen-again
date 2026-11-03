'use client';

import type { User } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import { getSupabase } from './supabase/client';

export function useUser() {
  const [user, setUser] = useState<User | null>(null);
  useEffect(() => {
    const supabase = getSupabase();
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
    const { data } = supabase.auth.onAuthStateChange((_e, session) => setUser(session?.user ?? null));
    return () => data.subscription.unsubscribe();
  }, []);
  return user;
}
