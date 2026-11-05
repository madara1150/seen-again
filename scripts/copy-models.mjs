// Puts the model weights the app serves from public/models:
// - face-api.js models, copied from node_modules
// - MobileNet v2 (image embeddings for recognising handed-out items), downloaded once
import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';

const src = 'node_modules/@vladmandic/face-api/model';
const dest = 'public/models';
const wanted = ['ssd_mobilenetv1_model', 'face_landmark_68_model', 'face_recognition_model'];

mkdirSync(dest, { recursive: true });
for (const file of readdirSync(src)) {
  if (wanted.some((w) => file.startsWith(w))) cpSync(`${src}/${file}`, `${dest}/${file}`);
}

const MOBILENET = 'https://storage.googleapis.com/tfjs-models/savedmodel/mobilenet_v2_1.0_224';
const mnDest = `${dest}/mobilenet_v2`;
if (!existsSync(`${mnDest}/model.json`)) {
  try {
    mkdirSync(mnDest, { recursive: true });
    const json = await (await fetch(`${MOBILENET}/model.json`)).json();
    const shards = json.weightsManifest.flatMap((m) => m.paths);
    for (const shard of shards) {
      const res = await fetch(`${MOBILENET}/${shard}`);
      if (!res.ok) throw new Error(`${shard}: HTTP ${res.status}`);
      writeFileSync(`${mnDest}/${shard}`, Buffer.from(await res.arrayBuffer()));
    }
    writeFileSync(`${mnDest}/model.json`, JSON.stringify(json)); // last, so a partial download is retried
    console.log(`MobileNet v2 downloaded (${shards.length} shards)`);
  } catch (e) {
    console.warn(`Could not download MobileNet v2 (item recognition will be unavailable): ${e.message}`);
  }
}
