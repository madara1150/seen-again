'use client';

export type FaceApi = typeof import('@vladmandic/face-api');

interface Tf {
  ready: () => Promise<void>;
  getBackend: () => string;
}

let loading: Promise<FaceApi> | null = null;

/**
 * Loads face-api.js (browser build) and the three models we need, once per page,
 * then runs each model once on a blank image: the first WebGL inference compiles
 * shaders and can take seconds, so we pay that before the camera starts.
 */
export function loadFaceApi(): Promise<FaceApi> {
  if (!loading) {
    loading = (async () => {
      const faceapi = await import('@vladmandic/face-api');
      await (faceapi.tf as unknown as Tf).ready();
      await Promise.all([
        faceapi.nets.ssdMobilenetv1.loadFromUri('/models'),
        faceapi.nets.faceLandmark68Net.loadFromUri('/models'),
        faceapi.nets.faceRecognitionNet.loadFromUri('/models'),
      ]);
      await warmUp(faceapi);
      return faceapi;
    })();
    loading.catch(() => (loading = null));
  }
  return loading;
}

async function warmUp(faceapi: FaceApi) {
  const blank = (size: number) => {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    c.getContext('2d')!.fillRect(0, 0, size, size);
    return c;
  };
  await faceapi.detectAllFaces(blank(320), new faceapi.SsdMobilenetv1Options());
  await faceapi.nets.faceLandmark68Net.detectLandmarks(blank(112));
  await faceapi.nets.faceRecognitionNet.computeFaceDescriptor(blank(150));
}

/** "webgl" / "wasm" are hardware-accelerated; "cpu" is very slow. */
export const backendName = (faceapi: FaceApi) => (faceapi.tf as unknown as Tf).getBackend();
