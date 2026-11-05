/**
 * Rough head pose from face-api.js's 68 landmarks, for guiding face enrolment around the face.
 * Measured relative to the person's own straight-ahead pose, so no camera calibration is needed.
 */

export type Pose = 'front' | 'left' | 'right' | 'up' | 'down';

export const POSES: Pose[] = ['front', 'left', 'right', 'up', 'down'];

export const POSE_TEXT: Record<Pose, string> = {
  front: 'มองตรงมาที่กล้อง',
  left: 'หันหน้าไปทางซ้าย',
  right: 'หันหน้าไปทางขวา',
  up: 'เงยหน้าขึ้นเล็กน้อย',
  down: 'ก้มหน้าลงเล็กน้อย',
};

export const POSE_ARROW: Record<Pose, string> = { front: '◉', left: '←', right: '→', up: '↑', down: '↓' };

interface Point { x: number; y: number }

/**
 * yaw: where the nose sits between the two jaw ends (0.5 = straight), in mirrored (selfie) view.
 * pitch: where the nose tip sits between eye line and mouth (larger = looking down).
 */
export interface PoseMetrics { yaw: number; pitch: number }

const mean = (pts: Point[]) => ({
  x: pts.reduce((a, p) => a + p.x, 0) / pts.length,
  y: pts.reduce((a, p) => a + p.y, 0) / pts.length,
});

export function measurePose(pts: Point[]): PoseMetrics {
  const jawL = pts[0];
  const jawR = pts[16];
  const nose = pts[30];
  const eyes = mean(pts.slice(36, 48));
  const mouth = mean(pts.slice(48, 68));
  const r = (nose.x - jawL.x) / (jawR.x - jawL.x || 1);
  return { yaw: 1 - r, pitch: (nose.y - eyes.y) / (mouth.y - eyes.y || 1) };
}

/** Straight ahead, judged without a baseline (only used for the first capture). */
export const looksStraight = (m: PoseMetrics) => Math.abs(m.yaw - 0.5) < 0.07;

/** Does this face match the wanted pose, relative to the person's straight-ahead baseline? */
export function matchesPose(m: PoseMetrics, base: PoseMetrics, pose: Pose) {
  const dy = m.yaw - base.yaw;
  const dp = m.pitch - base.pitch;
  switch (pose) {
    case 'front':
      return Math.abs(dy) < 0.05 && Math.abs(dp) < 0.06;
    case 'left':
      return dy < -0.12;
    case 'right':
      return dy > 0.12;
    case 'up':
      return dp < -0.08 && Math.abs(dy) < 0.15;
    case 'down':
      return dp > 0.08 && Math.abs(dy) < 0.15;
  }
}
