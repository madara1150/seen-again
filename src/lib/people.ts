'use client';

import { getSupabase } from './supabase/client';
import { removeThumbs } from './thumbs';

/** Every stored photo of these people: their profile thumbnail and one per visit. */
async function photosOf(ids: number[]) {
  const supabase = getSupabase();
  const [p, v] = await Promise.all([
    supabase.from('people').select('thumb_path').in('id', ids),
    supabase.from('visits').select('thumb_path').in('person_id', ids),
  ]);
  if (p.error || v.error) throw p.error ?? v.error;
  return [...(p.data ?? []), ...(v.data ?? [])].map((r) => r.thumb_path as string | null);
}

/** Delete people with their visits, descriptors, hand-outs and photos. */
export async function deletePeople(ids: number[]) {
  if (!ids.length) return;
  const photos = await photosOf(ids);
  const { error } = await getSupabase().from('people').delete().in('id', ids);
  if (error) throw error;
  await removeThumbs(photos);
}

/**
 * Block people: everything about them is deleted as above, and only their face descriptors are
 * kept on the block list so the cameras recognise and skip them from now on.
 */
export async function blockPeople(ids: number[]) {
  if (!ids.length) return;
  const photos = await photosOf(ids);
  const { error } = await getSupabase().rpc('block_people', { p_ids: ids });
  if (error) throw error;
  await removeThumbs(photos);
}

export const BLOCK_CONFIRM =
  'บล็อกแล้ว ระบบจะลบชื่อ รูป ประวัติการมา และประวัติการรับของทั้งหมดทันที ' +
  'และจะไม่บันทึกอะไรเพิ่มอีกเมื่อคนนี้มาหน้ากล้อง (เก็บไว้แค่ลักษณะใบหน้าที่เป็นตัวเลขเพื่อให้จำได้ว่าห้ามบันทึก) ยืนยัน?';
