type DateInput = string | number | Date;

export const fmtDateTime = (t: DateInput) =>
  new Date(t).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });

export const fmtDate = (t: DateInput) =>
  new Date(t).toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

export const fmtTime = (t: DateInput) =>
  new Date(t).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export function fmtDuration(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} วินาที`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} นาที`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ชม. ${m % 60} นาที`;
  const d = Math.floor(h / 24);
  return `${d} วัน ${h % 24} ชม.`;
}

export function fmtAgo(t: DateInput) {
  const ms = Date.now() - new Date(t).getTime();
  return ms < 10000 ? 'เมื่อสักครู่' : `${fmtDuration(ms)}ที่แล้ว`;
}
