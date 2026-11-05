'use client';

import { readSettings } from './settings';

let ctx: AudioContext | null = null;

function tone(freq: number, start: number, duration: number, type: OscillatorType = 'sine', gain = 0.15) {
  ctx ??= new AudioContext();
  const t = ctx.currentTime + start;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.001, t + duration);
  osc.connect(g).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + duration);
}

/** short rising chime: item recorded */
export function playOk() {
  if (!readSettings().sound) return;
  tone(880, 0, 0.12);
  tone(1320, 0.08, 0.18);
}

/** two low buzzes: this person already received earlier today */
export function playWarn() {
  if (!readSettings().sound) return;
  tone(330, 0, 0.18, 'square', 0.08);
  tone(330, 0.24, 0.18, 'square', 0.08);
}
