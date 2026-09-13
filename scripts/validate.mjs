import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const required = [
  'dist/index.html', 'dist/src/main.js', 'dist/src/sensors.js', 'dist/src/app-data.js', 'dist/src/multiplayer.js',
  'dist/vendor/phaser.esm.min.js', 'dist/manifest.webmanifest', 'dist/sw.js', 'dist/icons/icon-192.png',
  'dist/icons/icon-512.png', 'dist/assets/oval-track.png', 'dist/assets/rider-pedal-strip.png'
];
await Promise.all(required.map(path => access(resolve(path))));

const manifest = JSON.parse(await readFile('dist/manifest.webmanifest', 'utf8'));
if (manifest.display !== 'fullscreen' || manifest.orientation !== 'landscape') throw new Error('PWA manifest is not configured for the game display.');
if (!manifest.icons.some(icon => icon.sizes === '192x192') || !manifest.icons.some(icon => icon.sizes === '512x512')) throw new Error('PWA install icons are incomplete.');

const index = await readFile('dist/index.html', 'utf8');
if (/\b(?:src|href)="\/(?!\/)/.test(index)) throw new Error('Root-relative URL found; GitHub Pages subpath deployment would fail.');

globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {}, key: () => null, length: 0 };
globalThis.window = { dispatchEvent: () => true };
const { WORKOUTS, calculatePerformanceMetrics, workoutSeconds } = await import('../dist/src/app-data.js');
const durations = WORKOUTS.map(workoutSeconds);
if (durations.join(',') !== '600,1200,1800') throw new Error(`Unexpected workout durations: ${durations.join(',')}`);

const steadyRide = calculatePerformanceMetrics(Array(600).fill(200), 600, 5, 200);
if (Math.round(steadyRide.percentFtp) !== 100 || Math.round(steadyRide.trainingPoints * 10) / 10 !== 16.7 || Math.round(steadyRide.normalizedPower) !== 200 || Math.round(steadyRide.averageSpeedKph) !== 30) {
  throw new Error(`Unexpected performance metrics: ${JSON.stringify(steadyRide)}`);
}

console.log(`Validated ${required.length} deployment assets, ${WORKOUTS.length} workouts, PWA manifest, and Pages-safe URLs.`);
