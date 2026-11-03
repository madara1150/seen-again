'use client';

export type PermState = 'prompt' | 'requesting' | 'denied' | 'nocamera' | 'insecure' | 'busy' | 'error';

const CONSENT_KEY = 'ft-consent';

export function hasConsent() {
  try {
    return localStorage.getItem(CONSENT_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveConsent() {
  try {
    localStorage.setItem(CONSENT_KEY, '1');
  } catch {
    /* ignore */
  }
}

export async function cameraPermission(): Promise<PermissionState | 'insecure'> {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) return 'insecure';
  try {
    return (await navigator.permissions.query({ name: 'camera' as PermissionName })).state;
  } catch {
    return 'prompt'; // browser can't query camera permission; we'll find out on request
  }
}

/** Which gate screen to show for a getUserMedia failure. */
export function permStateForError(e: unknown): PermState {
  switch ((e as DOMException)?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'denied';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'nocamera';
    case 'NotReadableError':
      return 'busy';
    default:
      return 'error';
  }
}

export async function listCameras() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === 'videoinput');
}
