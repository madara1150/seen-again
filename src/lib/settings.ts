'use client';

import { useCallback, useSyncExternalStore } from 'react';

export interface Settings {
  /** max euclidean distance between descriptors to count as the same person */
  threshold: number;
  /** minutes away before a return counts as a new visit */
  gapMinutes: number;
  /** min face width in px before an unknown face is registered */
  minFace: number;
  /** label stored on each visit, to tell cameras apart */
  cameraName: string;
}

export const DEFAULT_SETTINGS: Settings = { threshold: 0.5, gapMinutes: 5, minFace: 80, cameraName: '' };

const KEY = 'ft-settings';
const listeners = new Set<() => void>();
let cached: Settings | null = null;

export function readSettings(): Settings {
  if (cached) return cached;
  try {
    cached = { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    cached = { ...DEFAULT_SETTINGS };
  }
  return cached!;
}

export function writeSettings(next: Settings) {
  cached = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable: keep in memory */
  }
  listeners.forEach((l) => l());
}

export function useSettings() {
  const settings = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    readSettings,
    () => DEFAULT_SETTINGS
  );
  const update = useCallback((patch: Partial<Settings>) => writeSettings({ ...readSettings(), ...patch }), []);
  return [settings, update] as const;
}
