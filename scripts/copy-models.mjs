// Copies the face-api.js model weights we use into public/models so they are served by the app itself.
import { cpSync, mkdirSync, readdirSync } from 'node:fs';

const src = 'node_modules/@vladmandic/face-api/model';
const dest = 'public/models';
const wanted = ['ssd_mobilenetv1_model', 'face_landmark_68_model', 'face_recognition_model'];

mkdirSync(dest, { recursive: true });
for (const file of readdirSync(src)) {
  if (wanted.some((w) => file.startsWith(w))) cpSync(`${src}/${file}`, `${dest}/${file}`);
}
