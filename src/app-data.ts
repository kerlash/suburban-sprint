export type RiderProfile = {
  name: string;
  ftp: number;
  weightLb: number;
  soundEnabled: boolean;
};

export type RideResult = {
  id: string;
  completedAt: string;
  workoutId: string;
  workoutName: string;
  durationSeconds: number;
  distanceKm: number;
  averagePower: number;
  averageSpeedKph?: number;
  percentFtp?: number;
  trainingPoints?: number;
  normalizedPower?: number;
  ftpWatts?: number;
  maxPower: number;
  averageCadence: number;
  averageHeartRate: number;
  onTargetPercent: number;
  powerTrace?: number[];
};

export type PerformanceMetrics = {
  averageSpeedKph: number;
  percentFtp: number;
  trainingPoints: number;
  normalizedPower: number;
};

export type WorkoutPhase = {
  seconds: number;
  title: string;
  story: string;
  pct: number;
  cadence?: number;
};

export type Workout = {
  id: string;
  name: string;
  description: string;
  difficulty: 'Moderate' | 'Spicy';
  phases: WorkoutPhase[];
};

const busChase: WorkoutPhase[] = [
  { seconds: 120, title: 'ROLL OUT', story: 'Wake up the legs. The neighbors are pretending not to watch.', pct: .55 },
  { seconds: 60, title: 'JOIN THE CHASE', story: 'Settle in and reel in the riders ahead.', pct: .70 },
  { seconds: 60, title: 'CLOSE THE GAP', story: 'First chase: get onto the back of the group.', pct: .88 },
  { seconds: 60, title: 'HIDE IN THE DRAFT', story: 'Easy now. Let somebody else look heroic.', pct: .55 },
  { seconds: 60, title: 'SPIN THE LEGS', story: 'Quick feet through the bell lap.', pct: .70, cadence: 95 },
  { seconds: 60, title: 'BRIDGE ACROSS', story: 'The leaders are escaping. Politely ruin their plan.', pct: .95 },
  { seconds: 60, title: 'CATCH YOUR BREATH', story: 'Recover. Try to look like this was intentional.', pct: .60 },
  { seconds: 90, title: 'CATCH THE BUS', story: 'Final chase. That bus has been smug for long enough.', pct: .90 },
  { seconds: 30, title: 'VICTORY LAP', story: 'Easy home. The neighborhood is mildly impressed.', pct: .50 }
];

export const WORKOUTS: Workout[] = [
  {
    id: 'bus-chase-10', name: 'Bus Chase', description: '10 min · short chases and cadence work', difficulty: 'Moderate', phases: busChase
  },
  {
    id: 'neighborhood-tempo-20', name: 'Neighborhood Tempo', description: '20 min · four steady tempo laps', difficulty: 'Moderate',
    phases: [
      { seconds: 180, title: 'OPEN THE GARAGE', story: 'Warm up before anyone notices the outfit.', pct: .55 },
      { seconds: 180, title: 'TEMPO LAP ONE', story: 'Smooth pressure. Wave like this is effortless.', pct: .78 },
      { seconds: 60, title: 'COAST PAST THE HOA', story: 'Recover and avoid making eye contact.', pct: .55 },
      { seconds: 180, title: 'TEMPO LAP TWO', story: 'Hold the wheel and keep the story believable.', pct: .78 },
      { seconds: 60, title: 'LEMONADE STOP', story: 'A very fast imaginary refreshment break.', pct: .55 },
      { seconds: 180, title: 'TEMPO LAP THREE', story: 'The legs know the route now.', pct: .80 },
      { seconds: 60, title: 'MAILBOX RECOVERY', story: 'Easy spin. No mail was harmed.', pct: .55 },
      { seconds: 180, title: 'FINAL TEMPO LAP', story: 'Finish tidy. The curtains are definitely moving.', pct: .82 },
      { seconds: 120, title: 'ROLL HOME', story: 'Cool down and invent an impressive recap.', pct: .50 }
    ]
  },
  {
    id: 'crit-night-30', name: 'Neighborhood Crit', description: '30 min · tempo with five hard attacks', difficulty: 'Spicy',
    phases: [
      { seconds: 240, title: 'COURSE INSPECTION', story: 'Four minutes to identify all imaginary hazards.', pct: .55 },
      ...Array.from({ length: 5 }, (_, i): WorkoutPhase[] => [
        { seconds: 180, title: `PACK LAP ${i + 1}`, story: 'Stay smooth in the group and guard your snacks.', pct: .78 },
        { seconds: 60, title: `ATTACK ${i + 1}`, story: 'Somebody moved. This cannot go unanswered.', pct: 1.05 }
      ]).flat(),
      { seconds: 240, title: 'LAST LONG LAP', story: 'Steady pressure all the way to the bell.', pct: .70 },
      { seconds: 120, title: 'PARADE LAP', story: 'Cool down. Accept applause with dignity.', pct: .48 }
    ]
  }
];

const PROFILE_KEY = 'suburban-sprint.profile.v1';
const HISTORY_KEY = 'suburban-sprint.history.v1';
export const DEFAULT_PROFILE: RiderProfile = { name: 'Rider', ftp: 200, weightLb: 170, soundEnabled: true };

export function loadProfile(): RiderProfile {
  try { return { ...DEFAULT_PROFILE, ...JSON.parse(localStorage.getItem(PROFILE_KEY) || '{}') }; }
  catch { return { ...DEFAULT_PROFILE }; }
}

export function saveProfile(profile: RiderProfile) {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}

export function loadHistory(): RideResult[] {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); }
  catch { return []; }
}

export function saveRide(result: RideResult) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify([result, ...loadHistory()].slice(0, 25)));
  window.dispatchEvent(new CustomEvent('ridehistorychanged'));
}

export function workoutSeconds(workout: Workout) {
  return workout.phases.reduce((sum, phase) => sum + phase.seconds, 0);
}

export function calculatePerformanceMetrics(powerTrace: number[], durationSeconds: number, distanceKm: number, ftpWatts: number): PerformanceMetrics {
  const samples = powerTrace.filter(sample => Number.isFinite(sample) && sample >= 0);
  const averageSpeedKph = durationSeconds > 0 ? distanceKm / (durationSeconds / 3600) : 0;
  if (!samples.length || durationSeconds <= 0 || ftpWatts <= 0) return { averageSpeedKph, percentFtp: 0, trainingPoints: 0, normalizedPower: 0 };

  const averagePower = samples.reduce((sum, watts) => sum + watts, 0) / samples.length;
  const rollingWindow = Math.min(30, samples.length);
  let rollingSum = samples.slice(0, rollingWindow).reduce((sum, watts) => sum + watts, 0);
  let fourthPowerSum = Math.pow(rollingSum / rollingWindow, 4);
  let rollingCount = 1;
  for (let index = rollingWindow; index < samples.length; index++) {
    rollingSum += samples[index] - samples[index - rollingWindow];
    fourthPowerSum += Math.pow(rollingSum / rollingWindow, 4);
    rollingCount++;
  }
  const normalizedPower = Math.pow(fourthPowerSum / rollingCount, .25);
  const intensity = normalizedPower / ftpWatts;
  return {
    averageSpeedKph,
    percentFtp: averagePower / ftpWatts * 100,
    trainingPoints: durationSeconds / 3600 * intensity * intensity * 100,
    normalizedPower
  };
}
