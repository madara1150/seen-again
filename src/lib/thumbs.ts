'use client';

import { useEffect, useState } from 'react';
import { getSupabase } from './supabase/client';
import { FACES_BUCKET } from './supabase/config';

const TTL_SECONDS = 3600;
const cache = new Map<string, { url: string; expires: number }>();

/** Signed URLs for private face thumbnails, batched and cached for most of their lifetime. */
export function useThumbUrls(paths: (string | null | undefined)[]) {
  const key = [...new Set(paths.filter(Boolean) as string[])].sort().join('|');
  const [, setVersion] = useState(0);

  useEffect(() => {
    const now = Date.now();
    const missing = key ? key.split('|').filter((p) => (cache.get(p)?.expires ?? 0) < now) : [];
    if (!missing.length) return;
    let cancelled = false;
    getSupabase()
      .storage.from(FACES_BUCKET)
      .createSignedUrls(missing, TTL_SECONDS)
      .then(({ data }) => {
        for (const item of data ?? []) {
          if (item.path && item.signedUrl) {
            cache.set(item.path, { url: item.signedUrl, expires: Date.now() + (TTL_SECONDS - 300) * 1000 });
          }
        }
        if (!cancelled) setVersion((v) => v + 1);
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  return (path: string | null | undefined) => (path ? cache.get(path)?.url : undefined);
}

export async function uploadThumb(userId: string, blob: Blob) {
  const path = `${userId}/${crypto.randomUUID()}.jpg`;
  const { error } = await getSupabase().storage.from(FACES_BUCKET).upload(path, blob, { contentType: 'image/jpeg' });
  if (error) throw error;
  return path;
}

export async function removeThumbs(paths: (string | null)[]) {
  const list = [...new Set(paths.filter(Boolean) as string[])];
  for (let i = 0; i < list.length; i += 100) {
    const { error } = await getSupabase().storage.from(FACES_BUCKET).remove(list.slice(i, i + 100));
    if (error) throw error;
  }
}
