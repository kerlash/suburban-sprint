import * as Phaser from 'phaser';
import { SensorHub, type Telemetry } from './sensors.js';
import { WORKOUTS, calculatePerformanceMetrics, loadProfile, saveProfile, loadHistory, saveRide, workoutSeconds, type Workout } from './app-data.js';
import { LocalPeloton, type PelotonPeer } from './multiplayer.js';

const hub = new SensorHub();
let profile = loadProfile();
let activeWorkout: Workout = WORKOUTS[0];
let phases = activeWorkout.phases;
let totalSeconds = workoutSeconds(activeWorkout);
let ghostEnabled = true;
const LAP_KM = .25;

class MissionAudio {
  private context?: AudioContext;
  async unlock() {
    this.context ||= new AudioContext();
    if (this.context.state === 'suspended') await this.context.resume();
  }
  cue(kind: 'start' | 'countdown' | 'phase' | 'finish') {
    if (!profile.soundEnabled || !this.context) return;
    const notes = kind === 'finish' ? [523, 659, 784] : kind === 'phase' ? [440, 660] : kind === 'start' ? [330, 440, 660] : [660];
    notes.forEach((frequency, index) => {
      const oscillator = this.context!.createOscillator(), gain = this.context!.createGain(), at = this.context!.currentTime + index * .11;
      oscillator.type = 'triangle'; oscillator.frequency.setValueAtTime(frequency, at);
      gain.gain.setValueAtTime(.0001, at); gain.gain.exponentialRampToValueAtTime(.10, at + .015); gain.gain.exponentialRampToValueAtTime(.0001, at + .13);
      oscillator.connect(gain).connect(this.context!.destination); oscillator.start(at); oscillator.stop(at + .15);
    });
  }
}
const missionAudio = new MissionAudio();
const peloton = new LocalPeloton();

class RideScene extends Phaser.Scene {
  private telemetry: Telemetry = hub.data;
  private speed = 0; private distance = 0; private worldDistance = 0; private elapsed = 0; private roadPhase = 0;
  private running = false; private paused = false; private complete = false; private onTarget = 0; private sampleTime = 0;
  private powerSum = 0; private cadenceSum = 0; private hrSum = 0; private hrTime = 0; private maxPower = 0;
  private backdrop!: Phaser.GameObjects.Image; private lines!: Phaser.GameObjects.Graphics;
  private rider!: Phaser.GameObjects.Sprite; private shadow!: Phaser.GameObjects.Ellipse; private bus!: Phaser.GameObjects.Container;
  private rivals: Phaser.GameObjects.Image[] = []; private ghost!: Phaser.GameObjects.Image; private props: Array<{ object: Phaser.GameObjects.Container; z: number; lane: number }> = [];
  private midProps: Array<{ object: Phaser.GameObjects.Container; z: number; lane: number }> = [];
  private clouds: Array<{ object: Phaser.GameObjects.Container; homeX: number; speed: number }> = [];
  private watts!: Phaser.GameObjects.Text; private cadence!: Phaser.GameObjects.Text; private hr!: Phaser.GameObjects.Text; private speedText!: Phaser.GameObjects.Text;
  private title!: Phaser.GameObjects.Text; private story!: Phaser.GameObjects.Text; private target!: Phaser.GameObjects.Text; private feedback!: Phaser.GameObjects.Text; private lap!: Phaser.GameObjects.Text;
  private cursors?: Phaser.Types.Input.Keyboard.CursorKeys; private results?: Phaser.GameObjects.Container; private busZ = .20;
  private baseRiderScale = 1; private backdropScale = 1; private cameraGap = 0; private powerFollower = hub.data.power;
  private phaseNumber = -1; private lastCountdown = -1; private sentTarget = -1;
  private powerTrace: number[] = []; private ghostTrace: number[] = []; private ghostZ = .24;
  private peers: PelotonPeer[] = []; private remoteRiders = new Map<string, Phaser.GameObjects.Image>(); private lastPelotonSend = 0;

  constructor() { super('ride'); }
  preload() { this.load.image('track', './assets/oval-track.png'); this.load.image('riderKey', './assets/rider-rear-keyed.png'); this.load.image('riderCycleKey', './assets/rider-pedal-strip.png'); }
  create() {
    this.keyRider(); this.keyPedalCycle(); const { width, height } = this.scale;
    this.backdrop = this.add.image(width / 2, height / 2, 'track');
    this.backdropScale = Math.max(width / this.backdrop.width, height / this.backdrop.height) * 1.07;
    this.backdrop.setScale(this.backdropScale);
    this.lines = this.add.graphics().setDepth(1);
    this.clouds = Array.from({ length: 5 }, (_, i) => ({ object: this.makeCloud(i), homeX: width * (i + .25) / 4.5, speed: .09 + i % 3 * .025 }));
    this.midProps = Array.from({ length: 10 }, (_, i) => ({ object: this.makeMidProp(i), z: .025 + i * .035, lane: i % 2 ? 1.48 : -1.48 }));
    this.props = Array.from({ length: 16 }, (_, i) => ({ object: this.makeProp(i), z: (i + 1) / 17, lane: i % 2 ? 1.06 : -1.06 }));
    this.bus = this.makeBus();
    this.rivals = [this.add.image(0, 0, 'rider').setTint(0xc99cff), this.add.image(0, 0, 'rider').setTint(0xbef56f)];
    this.ghost = this.add.image(0, 0, 'rider').setTint(0x72dcff).setAlpha(.58).setDepth(3).setVisible(false);
    this.shadow = this.add.ellipse(width * .53, height * .89, width * .17, height * .045, 0x07111a, .32).setDepth(4);
    this.rider = this.add.sprite(width * .53, height * .93, 'riderCycle', 0).setOrigin(.5, 1).setDepth(5);
    if (!this.anims.exists('pedal-cycle')) this.anims.create({ key: 'pedal-cycle', frames: this.anims.generateFrameNumbers('riderCycle', { start: 0, end: 3 }), frameRate: 5.67, repeat: -1 });
    this.rider.play('pedal-cycle');
    this.baseRiderScale = Math.min(height * .54, width * .34) / this.rider.height;
    this.rider.setScale(this.baseRiderScale);
    this.makeHud(); this.cursors = this.input.keyboard?.createCursorKeys();
    hub.addEventListener('telemetry', this.receive); this.events.once('shutdown', () => hub.removeEventListener('telemetry', this.receive));
    peloton.addEventListener('peers', this.receivePeers); this.events.once('shutdown', () => peloton.removeEventListener('peers', this.receivePeers));
    this.scale.on('resize', () => this.scene.restart());
  }
  public startMission() {
    this.results?.destroy(true); this.results = undefined; this.running = true; this.paused = false; this.complete = false; this.elapsed = 0; this.distance = 0;
    this.onTarget = 0; this.sampleTime = 0; this.powerSum = 0; this.cadenceSum = 0; this.hrSum = 0; this.hrTime = 0; this.maxPower = 0; this.busZ = .20; this.cameraGap = 0; this.powerFollower = this.telemetry.power; this.phaseNumber = -1; this.lastCountdown = -1; this.sentTarget = -1; this.powerTrace = []; this.ghostZ = .24;
    const best = loadHistory().filter(ride => ride.workoutId === activeWorkout.id && ride.powerTrace?.length).sort((a, b) => b.onTargetPercent - a.onTargetPercent)[0];
    this.ghostTrace = best?.powerTrace || []; this.ghost.setVisible(ghostEnabled && this.ghostTrace.length > 0); this.bus.setVisible(true);
    missionAudio.cue('start');
  }
  public chooseWorkout(workout: Workout) {
    if (this.running) return false;
    activeWorkout = workout; phases = workout.phases; totalSeconds = workoutSeconds(workout); this.elapsed = 0; this.distance = 0; this.complete = false;
    this.title.setText(`⚑  ${workout.name.toUpperCase()}`); this.story.setText(workout.description);
    this.target.setText(`FTP ${profile.ftp} W  ·  ${workout.difficulty.toUpperCase()}  ·  ${this.clock(totalSeconds)}`);
    this.feedback.setText('START WHEN READY').setColor('#ffffff'); this.results?.destroy(true); this.results = undefined; this.bus.setVisible(true); return true;
  }
  public refreshProfile() {
    this.target.setText(`FTP ${profile.ftp} W  ·  ${activeWorkout.difficulty.toUpperCase()}  ·  ${this.clock(totalSeconds)}`);
  }
  public togglePause() {
    if (!this.running) return false;
    this.paused = !this.paused;
    this.feedback.setText(this.paused ? 'MISSION PAUSED' : 'BACK TO WORK').setColor(this.paused ? '#ffffff' : '#6ff0a0');
    return this.paused;
  }
  public endWorkout() {
    if (!this.running || !this.paused) return false;
    this.finish();
    return true;
  }
  public get isRunning() { return this.running; }
  public get isPaused() { return this.paused; }
  public syncTrainerTarget() {
    if (!this.running || !hub.controlEnabled) return;
    const goal = Math.round(profile.ftp * this.activePhase().phase.pct); this.sentTarget = goal;
    hub.setTargetPower(goal).catch(error => window.dispatchEvent(new CustomEvent('controlerror', { detail: error instanceof Error ? error.message : String(error) })));
  }
  private receive = (event: Event) => { this.telemetry = (event as CustomEvent<Telemetry>).detail; };
  private receivePeers = (event: Event) => {
    this.peers = (event as CustomEvent<PelotonPeer[]>).detail.filter(peer => peer.workoutId === activeWorkout.id).slice(0, 5);
    const active = new Set(this.peers.map(peer => peer.id));
    for (const [id, rider] of this.remoteRiders) if (!active.has(id)) { rider.destroy(); this.remoteRiders.delete(id); }
    this.peers.forEach((peer, index) => { if (!this.remoteRiders.has(peer.id)) this.remoteRiders.set(peer.id, this.add.image(0, 0, 'rider').setTint([0xff8e5c, 0x78e08f, 0xb388ff, 0xff72ae, 0x5ce1e6][index]).setDepth(3)); });
  };
  private keyRider() {
    if (this.textures.exists('rider')) return;
    const image = this.textures.get('riderKey').getSourceImage() as HTMLImageElement, canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth || image.width; canvas.height = image.naturalHeight || image.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true }); if (!ctx) throw new Error('Canvas unavailable');
    ctx.drawImage(image, 0, 0); const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < pixels.data.length; i += 4) { const r = pixels.data[i], g = pixels.data[i + 1], b = pixels.data[i + 2], key = Math.min(r, b) - g; if (r > 165 && b > 165 && key > 65) pixels.data[i + 3] = Math.round(255 * (1 - Phaser.Math.Clamp((key - 65) / 55, 0, 1))); }
    ctx.putImageData(pixels, 0, 0); this.textures.addCanvas('rider', canvas);
  }
  private keyPedalCycle() {
    if (this.textures.exists('riderCycle')) return;
    const image = this.textures.get('riderCycleKey').getSourceImage() as HTMLImageElement, canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth || image.width; canvas.height = image.naturalHeight || image.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true }); if (!ctx) throw new Error('Canvas unavailable');
    ctx.drawImage(image, 0, 0); const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < pixels.data.length; i += 4) { const r = pixels.data[i], g = pixels.data[i + 1], b = pixels.data[i + 2], key = Math.min(r, b) - g; if (r > 165 && b > 165 && key > 65) pixels.data[i + 3] = Math.round(255 * (1 - Phaser.Math.Clamp((key - 65) / 55, 0, 1))); }
    ctx.putImageData(pixels, 0, 0);
    this.textures.addSpriteSheet('riderCycle', canvas as unknown as HTMLImageElement, { frameWidth: Math.floor(canvas.width / 4), frameHeight: canvas.height, endFrame: 3 });
  }
  private makeBus() {
    const c = this.add.container(0, 0).setDepth(2), g = this.add.graphics();
    g.fillStyle(0x14202b).fillCircle(-32, 31, 10).fillCircle(32, 31, 10).fillStyle(0xffc928).fillRoundedRect(-58, -44, 116, 74, 12).lineStyle(5, 0x172533).strokeRoundedRect(-58, -44, 116, 74, 12).fillStyle(0x9ee8ff);
    for (let x = -43; x <= 23; x += 22) g.fillRoundedRect(x, -31, 17, 22, 3);
    return c.add([g, this.add.text(0, 4, 'BUS', { fontFamily: 'Barlow Condensed', fontSize: 16, color: '#182432', fontStyle: 'bold' }).setOrigin(.5)]);
  }
  private makeProp(i: number) {
    const c = this.add.container(0, 0).setDepth(2), g = this.add.graphics();
    if (i % 2) g.lineStyle(5, 0xffffff).lineBetween(0, -45, 0, 20).fillStyle(i % 4 === 1 ? 0xff5c58 : 0x48cbd0).fillTriangle(2, -43, 37, -32, 2, -19).lineStyle(3, 0x172533).strokeTriangle(2, -43, 37, -32, 2, -19);
    else g.fillStyle(0xffcf32).fillTriangle(0, -34, -18, 20, 18, 20).lineStyle(4, 0x172533).strokeTriangle(0, -34, -18, 20, 18, 20).fillStyle(0xffffff).fillRect(-12, -2, 24, 7);
    return c.add(g);
  }
  private makeCloud(i: number) {
    const c = this.add.container(0, this.scale.height * (.105 + i % 2 * .04)).setDepth(.25).setAlpha(.42), g = this.add.graphics();
    g.fillStyle(0xffffff, .9).fillEllipse(-28, 5, 68, 24).fillCircle(-5, -5, 23).fillCircle(20, 1, 17).fillCircle(-32, 2, 14);
    g.fillStyle(0xb8e8f4, .55).fillEllipse(-2, 11, 74, 11);
    return c.add(g).setScale(.42 + i % 3 * .09);
  }
  private makeMidProp(i: number) {
    const c = this.add.container(0, 0).setDepth(.8), g = this.add.graphics();
    if (i % 3 === 0) {
      g.fillStyle(0x72472c).fillRect(-5, -18, 10, 39).lineStyle(3, 0x17323f).strokeRect(-5, -18, 10, 39);
      g.fillStyle(0x4da943).fillCircle(-18, -25, 23).fillCircle(5, -40, 29).fillCircle(28, -23, 22);
      g.lineStyle(4, 0x17323f).strokeCircle(-18, -25, 23).strokeCircle(5, -40, 29).strokeCircle(28, -23, 22);
      g.fillStyle(0x89d64b).fillCircle(-9, -39, 10).fillCircle(18, -35, 9);
    } else if (i % 3 === 1) {
      g.fillStyle(0xfff5d6).fillRoundedRect(-37, -34, 74, 49, 4).lineStyle(4, 0x17323f).strokeRoundedRect(-37, -34, 74, 49, 4);
      g.fillStyle(i % 2 ? 0xff5c58 : 0x48cbd0).fillTriangle(-44, -34, 0, -64, 44, -34).lineStyle(4, 0x17323f).strokeTriangle(-44, -34, 0, -64, 44, -34);
      g.fillStyle(0x86d9f1).fillRect(-25, -24, 19, 20).fillRect(7, -24, 19, 20);
    } else {
      g.fillStyle(0x17323f).fillRoundedRect(-48, -29, 96, 39, 7).lineStyle(4, 0xffffff).strokeRoundedRect(-48, -29, 96, 39, 7);
      c.add(this.add.text(0, -10, i % 2 ? 'GO!' : 'RIDE!', { fontFamily: 'Barlow Condensed', fontSize: 23, color: '#ffcf32', fontStyle: 'bold' }).setOrigin(.5));
    }
    return c.add(g);
  }
  private makeHud() {
    const { width, height } = this.scale, card = Math.min(440, width * .34);
    this.add.rectangle(18, 18, card, 94, 0x092f4a, .94).setOrigin(0).setStrokeStyle(2, 0x2c6d8e).setDepth(10);
    this.title = this.add.text(34, 27, '⚑  READY AT THE RAIL', { fontFamily: 'Barlow Condensed', fontSize: 23, color: '#fff', fontStyle: 'bold' }).setDepth(11);
    this.story = this.add.text(35, 58, 'Pair your devices, then start the 10-minute mission.', { fontFamily: 'Inter', fontSize: 12, color: '#b9d8e8' }).setDepth(11);
    this.target = this.add.text(35, 80, `FTP ${profile.ftp} W  ·  ${activeWorkout.difficulty.toUpperCase()}  ·  ${this.clock(totalSeconds)}`, { fontFamily: 'Inter', fontSize: 12, color: '#6ff0a0', fontStyle: 'bold' }).setDepth(11);
    const start = Math.max(card + 38, width * .40), gap = (width - start - 18) / 4;
    const stat = (x: number, label: string, color: string) => { this.add.rectangle(x, 18, Math.max(94, gap - 9), 94, 0x092f4a, .94).setOrigin(.5, 0).setStrokeStyle(2, 0x2c6d8e).setDepth(10); this.add.text(x, 31, label, { fontFamily: 'Inter', fontSize: 10, color: '#9fc1d3', fontStyle: 'bold' }).setOrigin(.5, 0).setDepth(11); return this.add.text(x, 53, '—', { fontFamily: 'Barlow Condensed', fontSize: Math.min(31, gap * .23), color, fontStyle: 'bold' }).setOrigin(.5, 0).setDepth(11); };
    this.watts = stat(start + gap * .5, 'POWER', '#ffd042'); this.cadence = stat(start + gap * 1.5, 'CADENCE', '#65e2da'); this.hr = stat(start + gap * 2.5, 'HEART RATE', '#ff6965'); this.speedText = stat(start + gap * 3.5, 'SPEED', '#fff');
    this.feedback = this.add.text(width / 2, height - 58, 'START WHEN READY', { fontFamily: 'Barlow Condensed', fontSize: 20, color: '#fff', fontStyle: 'bold', backgroundColor: '#092f4add', padding: { x: 12, y: 5 } }).setOrigin(.5).setDepth(12);
    this.lap = this.add.text(width - 25, height - 43, 'LAP 1  ·  0.00 KM', { fontFamily: 'Inter', fontSize: 11, color: '#fff', fontStyle: 'bold' }).setOrigin(1, 0).setDepth(12);
  }
  private project(z: number, lane = 0) {
    const { width, height } = this.scale, d = Math.pow(Phaser.Math.Clamp(z, 0, 1), 1.7), half = width * (.15 + d * .52), bend = -.032 + Math.sin((this.worldDistance % LAP_KM) / LAP_KM * Math.PI * 2) * .017;
    return { x: width * .53 + bend * width * d * d + lane * half, y: height * .47 + d * height * .53, scale: .055 + d * .72 };
  }
  private activePhase() { let at = 0; for (let index = 0; index < phases.length; index++) { const phase = phases[index], end = at + phase.seconds; if (this.elapsed < end) return { phase, end, index }; at = end; } return { phase: phases[phases.length - 1], end: totalSeconds, index: phases.length - 1 }; }
  private clock(seconds: number) { const v = Math.max(0, Math.ceil(seconds)); return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`; }
  private announcePhase(label: string, goal: number) {
    const { width, height } = this.scale, panel = this.add.rectangle(0, 0, Math.min(510, width * .58), 88, 0x092f4a, .96).setStrokeStyle(3, 0xffcf32);
    const heading = this.add.text(0, -13, label, { fontFamily: 'Barlow Condensed', fontSize: 31, color: '#ffffff', fontStyle: 'bold' }).setOrigin(.5);
    const detail = this.add.text(0, 23, `${goal} W TARGET`, { fontFamily: 'Inter', fontSize: 12, color: '#6ff0a0', fontStyle: 'bold' }).setOrigin(.5);
    const banner = this.add.container(width / 2, height * .32 + 20, [panel, heading, detail]).setAlpha(0).setDepth(20);
    this.tweens.add({ targets: banner, alpha: 1, y: height * .32, duration: 220, hold: 1050, yoyo: true, onComplete: () => banner.destroy(true) });
  }
  private drawLines() {
    const { width, height } = this.scale; this.lines.clear();
    for (let i = 0; i < 18; i++) { const z1 = (i / 18 + this.roadPhase) % 1, z2 = Math.min(1, z1 + .036 + z1 * .025), a = this.project(z1, -.18), b = this.project(z2, -.18), w1 = 1 + z1 * 5, w2 = 1 + z2 * 5; this.lines.fillStyle(0xffffff, .9).fillPoints([new Phaser.Geom.Point(a.x - w1, a.y), new Phaser.Geom.Point(a.x + w1, a.y), new Phaser.Geom.Point(b.x + w2, b.y), new Phaser.Geom.Point(b.x - w2, b.y)]); }
    const bar = Math.min(720, width - 70), x = width / 2 - bar / 2, y = height - 18, ratio = this.running || this.complete ? this.elapsed / totalSeconds : 0;
    this.lines.fillStyle(0x102c40, .92).fillRoundedRect(x - 8, y - 8, bar + 16, 20, 10).fillStyle(0x44677c).fillRoundedRect(x, y - 2, bar, 8, 4).fillStyle(0x68df79).fillRoundedRect(x, y - 2, bar * ratio, 8, 4);
    let at = 0; for (const phase of phases.slice(0, -1)) { at += phase.seconds; this.lines.fillStyle(0xffffff, .7).fillRect(x + bar * at / totalSeconds - 1, y - 4, 2, 12); }
  }
  private finish() {
    this.running = false; this.complete = true; this.paused = false; this.bus.setVisible(false); const { width, height } = this.scale;
    const avgP = this.sampleTime ? Math.round(this.powerSum / this.sampleTime) : 0, avgC = this.sampleTime ? Math.round(this.cadenceSum / this.sampleTime) : 0, avgH = this.hrTime ? Math.round(this.hrSum / this.hrTime) : 0, score = Math.round(this.onTarget / Math.max(1, this.sampleTime) * 100);
    const performance = calculatePerformanceMetrics(this.powerTrace, this.sampleTime, this.distance, profile.ftp);
    const avgSpeed = performance.averageSpeedKph.toFixed(1), percentFtp = Math.round(performance.percentFtp), trainingPoints = Math.round(performance.trainingPoints);
    missionAudio.cue('finish');
    saveRide({ id: crypto.randomUUID(), completedAt: new Date().toISOString(), workoutId: activeWorkout.id, workoutName: activeWorkout.name, durationSeconds: Math.round(this.sampleTime), distanceKm: this.distance, averagePower: avgP, averageSpeedKph: performance.averageSpeedKph, percentFtp: performance.percentFtp, trainingPoints: performance.trainingPoints, normalizedPower: performance.normalizedPower, ftpWatts: profile.ftp, maxPower: Math.round(this.maxPower), averageCadence: avgC, averageHeartRate: avgH, onTargetPercent: score, powerTrace: this.powerTrace });
    const shade = this.add.rectangle(-width / 2, -height / 2, width, height, 0x03121e, .62).setOrigin(0), panel = this.add.rectangle(0, 0, Math.min(620, width - 40), Math.min(410, height - 40), 0x092f4a, .97).setStrokeStyle(4, 0xffcf32);
    const title = this.add.text(0, -150, 'MISSION COMPLETE', { fontFamily: 'Barlow Condensed', fontSize: 43, color: '#ffcf32', fontStyle: 'bold' }).setOrigin(.5), joke = this.add.text(0, -106, 'The bus has filed a formal complaint.', { fontFamily: 'Inter', fontSize: 14, color: '#b9d8e8' }).setOrigin(.5);
    const rideDuration = this.clock(this.sampleTime), stats = this.add.text(0, 10, `TRAINING POINTS (TP)  ${trainingPoints}    ·    AVG %FTP  ${percentFtp}%\nON TARGET  ${score}%    ·    AVG POWER  ${avgP} W    ·    MAX  ${Math.round(this.maxPower)} W\nAVG CADENCE  ${avgC} RPM    ·    AVG HR  ${avgH || '—'} BPM\nDISTANCE  ${this.distance.toFixed(2)} KM    ·    AVG SPEED  ${avgSpeed} KPH\nRIDE TIME  ${rideDuration}    ·    LAPS  ${(this.distance / LAP_KM).toFixed(1)}`, { fontFamily: 'Barlow Condensed', fontSize: 21, color: '#fff', fontStyle: 'bold', align: 'center', lineSpacing: 8 }).setOrigin(.5);
    this.results = this.add.container(width / 2, height / 2, [shade, panel, title, joke, stats, this.add.text(0, 165, 'PRESS START AGAIN FOR ANOTHER RUN', { fontFamily: 'Inter', fontSize: 11, color: '#6ff0a0', fontStyle: 'bold' }).setOrigin(.5)]).setDepth(30);
  }
  update(time: number, deltaMs: number) {
    hub.updateDemo(time); const dt = Math.min(deltaMs / 1000, .05), power = this.telemetry.power, riderKg = profile.weightLb * .453592, drive = power * .97 / Math.max(this.speed, .8), rolling = riderKg * 9.81 * .004, aero = .5 * 1.225 * .34 * this.speed * this.speed;
    this.speed = Phaser.Math.Clamp(this.speed + (drive - rolling - aero) / riderKg * dt, 0, 18); if (power < 8) this.speed = Math.max(0, this.speed - .32 * dt);
    const travel = this.speed * dt / 1000;
    this.worldDistance += travel;
    if (this.running && !this.paused) this.distance += travel;
    this.roadPhase = (this.roadPhase + this.speed * dt * .018) % 1;
    if (this.running && !this.paused) {
      this.elapsed = Math.min(totalSeconds, this.elapsed + dt); const { phase, end, index } = this.activePhase(), goal = Math.round(profile.ftp * phase.pct), cadenceOk = !phase.cadence || this.telemetry.cadence >= phase.cadence - 5, powerOk = power >= goal * .9 && power <= goal * 1.1;
      if (index !== this.phaseNumber) {
        this.phaseNumber = index; this.lastCountdown = -1; this.announcePhase(phase.title, goal); missionAudio.cue(index ? 'phase' : 'start');
        if (hub.controlEnabled && goal !== this.sentTarget) { this.sentTarget = goal; hub.setTargetPower(goal).catch(error => window.dispatchEvent(new CustomEvent('controlerror', { detail: error instanceof Error ? error.message : String(error) }))); }
      }
      if (powerOk && cadenceOk) this.onTarget += dt; this.sampleTime += dt; this.powerSum += power * dt; this.cadenceSum += this.telemetry.cadence * dt; if (this.telemetry.heartRate) { this.hrSum += this.telemetry.heartRate * dt; this.hrTime += dt; }
      this.maxPower = Math.max(this.maxPower, power); this.busZ = Phaser.Math.Clamp(this.busZ + (power / goal - .88) * dt * .018, .10, .62);
      this.powerTrace[Math.floor(this.elapsed)] = Math.round(power);
      const ghostPower = this.ghostTrace[Math.floor(this.elapsed)];
      if (ghostEnabled && ghostPower !== undefined) this.ghostZ = Phaser.Math.Clamp(this.ghostZ + (power - ghostPower) / profile.ftp * dt * .035, .12, .38);
      this.title.setText(`⚑  ${phase.title}`); this.story.setText(phase.story); this.target.setText(`TARGET ${goal} W${phase.cadence ? `  ·  ${phase.cadence}+ RPM` : ''}  ·  ${this.clock(end - this.elapsed)}`);
      const remaining = Math.ceil(end - this.elapsed), next = phases[index + 1];
      if (next && remaining <= 3 && remaining !== this.lastCountdown) { this.lastCountdown = remaining; missionAudio.cue('countdown'); }
      if (next && remaining <= 3) this.feedback.setText(`NEXT: ${next.title} IN ${remaining}`).setColor('#ffffff');
      else if (power < goal * .9) this.feedback.setText(`PUSH  +${Math.max(1, Math.round(goal - power))} W`).setColor('#ffcf32'); else if (power > goal * 1.1) this.feedback.setText(`EASE  ${Math.round(power - goal)} W`).setColor('#ff8a75'); else if (!cadenceOk) this.feedback.setText(`QUICKER FEET  ${phase.cadence}+ RPM`).setColor('#65e2da'); else this.feedback.setText('RIGHT ON TARGET').setColor('#6ff0a0');
      if (this.elapsed >= totalSeconds) this.finish();
    } else if (this.complete) { this.title.setText('⚑  MISSION COMPLETE'); this.story.setText('The bus has been caught. Its dignity has not recovered.'); this.target.setText(`FTP ${profile.ftp} W  ·  ${this.distance.toFixed(2)} KM  ·  ${(this.distance / LAP_KM).toFixed(1)} LAPS`); this.feedback.setText('RIDE COMPLETE').setColor('#6ff0a0'); }
    const steer = (this.cursors?.left.isDown ? -1 : 0) + (this.cursors?.right.isDown ? 1 : 0), bob = Math.sin(time * .011 * Math.max(.5, this.telemetry.cadence / 85)), standing = power > Math.max(120, profile.ftp * .82) && this.telemetry.cadence > 0 && this.telemetry.cadence < 72;
    this.powerFollower += (power - this.powerFollower) * (1 - Math.exp(-dt * .7));
    const surge = Phaser.Math.Clamp((power - this.powerFollower) / 85, 0, 1);
    const gapTarget = surge * this.scale.height * .028;
    this.cameraGap += (gapTarget - this.cameraGap) * (1 - Math.exp(-dt * (gapTarget > this.cameraGap ? 5 : 1.8)));
    const cameraScale = 1 - this.cameraGap / this.scale.height * 1.25;
    this.rider.x = Phaser.Math.Linear(this.rider.x, this.scale.width * .53 + steer * this.scale.width * .075 + (standing ? Math.sin(time * .006) * this.scale.width * .006 : 0), .08);
    this.rider.y = this.scale.height * .93 - this.cameraGap + bob * (standing ? 1.25 : .65) - (standing ? 2 : 0);
    this.rider.setScale(this.baseRiderScale * cameraScale * (standing ? 1.015 : 1));
    this.rider.rotation = steer * .045 + Math.sin(time * .004) * .002 + (standing ? Math.sin(time * .007) * .012 : 0);
    if (this.telemetry.cadence < 5) {
      if (!this.rider.anims.isPaused) this.rider.anims.pause();
    } else {
      if (this.rider.anims.isPaused) this.rider.anims.resume();
      this.rider.anims.timeScale = Phaser.Math.Clamp(this.telemetry.cadence / 85, .35, 1.8);
    }
    this.shadow.setPosition(this.rider.x, this.scale.height * .89 - this.cameraGap * .55).setScale(cameraScale);
    this.clouds.forEach((cloud, i) => {
      const span = this.scale.width + 320;
      const travelX = this.worldDistance * 1000 * cloud.speed + time * .0025 * (i % 2 ? 1 : .7);
      cloud.object.x = Phaser.Math.Wrap(cloud.homeX - travelX, -160, span - 160);
    });
    this.midProps.forEach((p, i) => {
      p.z += this.speed * dt * .0065;
      if (p.z > .39) { p.z = .018; p.lane = i % 2 ? 1.48 : -1.48; }
      const pos = this.project(p.z, p.lane);
      p.object.setPosition(pos.x, pos.y).setScale(pos.scale * 1.55).setDepth(.55 + p.z).setAlpha(Phaser.Math.Clamp(p.z * 8, .18, .9));
    });
    this.props.forEach((p, i) => { p.z += this.speed * dt * .025; if (p.z > 1.04) { p.z -= 1; p.lane = i % 2 ? 1.06 : -1.06; } const pos = this.project(p.z, p.lane); p.object.setPosition(pos.x, pos.y).setScale(pos.scale * .82).setDepth(1.5 + p.z * 2.2).setAlpha(Phaser.Math.Clamp(p.z * 5, 0, 1)); });
    const bus = this.project(this.busZ, .18); this.bus.setPosition(bus.x, bus.y).setScale(bus.scale); [{ z: .27, lane: -.08 }, { z: .20, lane: .34 }].forEach((d, i) => { const pos = this.project(d.z + Math.sin(time * .0008 + i) * .018, d.lane); this.rivals[i].setPosition(pos.x, pos.y + Math.sin(time * .009 + i * 2) * 1.5).setOrigin(.5, 1).setScale(pos.scale * .29).setDepth(3); });
    if (this.ghost.visible) { const ghost = this.project(this.ghostZ, -.34); this.ghost.setPosition(ghost.x, ghost.y).setOrigin(.5, 1).setScale(ghost.scale * .29); }
    this.peers.forEach((peer, index) => { const z = Phaser.Math.Clamp(.23 + (this.distance - peer.distanceKm) * 1.8, .11, .40), pos = this.project(z, -.12 + index * .17); this.remoteRiders.get(peer.id)?.setPosition(pos.x, pos.y).setOrigin(.5, 1).setScale(pos.scale * .29); });
    if (time - this.lastPelotonSend > 250) { this.lastPelotonSend = time; peloton.publish(profile.name, activeWorkout.id, power, this.distance); }
    const orbit = this.worldDistance / LAP_KM * Math.PI * 2;
    this.backdrop.setPosition(this.scale.width / 2 + Math.sin(orbit) * this.scale.width * .028, this.scale.height / 2 + Math.cos(orbit) * this.scale.height * .006);
    this.backdrop.setScale(this.backdropScale * (1 + Math.sin(orbit * .5) * .004));
    this.drawLines(); this.watts.setText(`${Math.round(power)} W`); this.cadence.setText(`${Math.round(this.telemetry.cadence)} RPM`); this.hr.setText(this.telemetry.heartRate ? `${Math.round(this.telemetry.heartRate)} BPM` : '—'); this.speedText.setText(`${(this.speed * 3.6).toFixed(1)} KPH`); this.lap.setText(`LAP ${Math.floor(this.distance / LAP_KM) + 1}  ·  ${this.distance.toFixed(2)} KM  ·  ${this.clock(totalSeconds - this.elapsed)}`);
  }
}

const game = new Phaser.Game({ type: Phaser.AUTO, parent: 'game', backgroundColor: '#79d7f7', scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' }, render: { antialias: true }, scene: [RideScene] });
const scene = () => game.scene.getScene('ride') as unknown as RideScene;
const status = document.querySelector('#status') as HTMLElement;
const trainer = document.querySelector('#trainer-button') as HTMLButtonElement;
const hr = document.querySelector('#hr-button') as HTMLButtonElement;
const mission = document.querySelector('#mission-button') as HTMLButtonElement;
const pauseButton = document.querySelector('#pause-button') as HTMLButtonElement;
const endWorkoutButton = document.querySelector('#end-workout-button') as HTMLButtonElement;
const erg = document.querySelector('#erg-button') as HTMLButtonElement;
const workoutSelect = document.querySelector('#workout-select') as HTMLSelectElement;
const setupButton = document.querySelector('#setup-button') as HTMLButtonElement;
const setupPanel = document.querySelector('#setup-panel') as HTMLElement;
const setupClose = document.querySelector('#setup-close') as HTMLButtonElement;
const profileName = document.querySelector('#profile-name') as HTMLInputElement;
const profileFtp = document.querySelector('#profile-ftp') as HTMLInputElement;
const profileWeight = document.querySelector('#profile-weight') as HTMLInputElement;
const profileSave = document.querySelector('#profile-save') as HTMLButtonElement;
const soundToggle = document.querySelector('#sound-toggle') as HTMLInputElement;
const demo = document.querySelector('#demo-toggle') as HTMLInputElement;
const ghostToggle = document.querySelector('#ghost-toggle') as HTMLInputElement;
const historyElement = document.querySelector('#ride-history') as HTMLElement;
const fullscreenButton = document.querySelector('#fullscreen-button') as HTMLButtonElement;
const installButton = document.querySelector('#install-button') as HTMLButtonElement;
const roomStatus = document.querySelector('#room-status') as HTMLElement;

function renderHistory() {
  historyElement.replaceChildren(); const history = loadHistory();
  if (!history.length) { const empty = document.createElement('p'); empty.className = 'empty-history'; empty.textContent = 'Finish a mission and your recap will appear here.'; historyElement.append(empty); return; }
  history.slice(0, 8).forEach(ride => {
    const row = document.createElement('div'); row.className = 'history-row';
    const name = document.createElement('strong'); name.textContent = ride.workoutName;
    const historicalPerformance = calculatePerformanceMetrics(ride.powerTrace || [], ride.durationSeconds, ride.distanceKm, ride.ftpWatts || profile.ftp);
    const speed = ride.averageSpeedKph ?? historicalPerformance.averageSpeedKph;
    const percentFtp = ride.percentFtp ?? (historicalPerformance.percentFtp || (profile.ftp ? ride.averagePower / profile.ftp * 100 : undefined));
    const trainingPoints = ride.trainingPoints ?? (historicalPerformance.trainingPoints || (profile.ftp ? ride.durationSeconds / 3600 * Math.pow(ride.averagePower / profile.ftp, 2) * 100 : 0));
    const detail = document.createElement('span'); detail.textContent = `${new Date(ride.completedAt).toLocaleDateString()} · ${ride.averagePower} W avg${percentFtp === undefined ? '' : ` · ${Math.round(percentFtp)}% FTP`} · ${ride.distanceKm.toFixed(1)} km · ${speed.toFixed(1)} kph`;
    const score = document.createElement('b'); score.textContent = `${Math.round(trainingPoints)} TP`;
    row.append(name, detail, score); historyElement.append(row);
  });
}

WORKOUTS.forEach(workout => { const option = document.createElement('option'); option.value = workout.id; option.textContent = `${workout.name} — ${Math.round(workoutSeconds(workout) / 60)} min`; workoutSelect.append(option); });
profileName.value = profile.name; profileFtp.value = String(profile.ftp); profileWeight.value = String(profile.weightLb); soundToggle.checked = profile.soundEnabled; demo.checked = hub.demoEnabled; ghostToggle.checked = ghostEnabled; renderHistory();

workoutSelect.addEventListener('change', () => {
  const workout = WORKOUTS.find(item => item.id === workoutSelect.value) || WORKOUTS[0];
  if (!scene().chooseWorkout(workout)) { workoutSelect.value = activeWorkout.id; status.textContent = 'Finish or restart the current mission before changing courses.'; return; }
  mission.textContent = `Start ${Math.round(workoutSeconds(workout) / 60)}-min mission`; status.textContent = `${workout.name}: ${workout.description}.`;
});
trainer.addEventListener('click', async () => { try { status.textContent = 'Choose your trainer in the Bluetooth window…'; const name = await hub.connectTrainer(); trainer.classList.add('connected'); trainer.querySelector('span')!.textContent = name; demo.checked = false; erg.disabled = !hub.trainerControlAvailable; status.textContent = hub.trainerControlAvailable ? `${name} connected. ERG control is available but remains off.` : `${name} connected for power and cadence; ERG control is unavailable.`; } catch (e) { status.textContent = e instanceof Error ? e.message : String(e); } });
hr.addEventListener('click', async () => { try { status.textContent = 'Choose your Polar or COROS heart-rate sensor…'; const name = await hub.connectHeartRate(); hr.classList.add('connected'); hr.querySelector('span')!.textContent = name; status.textContent = `Receiving heart rate from ${name}.`; } catch (e) { status.textContent = e instanceof Error ? e.message : String(e); } });
erg.addEventListener('click', async () => { try { if (hub.controlEnabled) { await hub.disableTrainerControl(); erg.classList.remove('connected'); erg.querySelector('span')!.textContent = 'Enable ERG'; } else { status.textContent = 'Requesting trainer control…'; await hub.enableTrainerControl(); erg.classList.add('connected'); erg.querySelector('span')!.textContent = 'Release ERG'; scene().syncTrainerTarget(); } } catch (e) { status.textContent = e instanceof Error ? e.message : String(e); } });
mission.addEventListener('click', () => { void missionAudio.unlock(); scene().startMission(); mission.textContent = 'Restart mission'; pauseButton.disabled = false; pauseButton.textContent = 'Pause'; endWorkoutButton.hidden = true; status.textContent = `${activeWorkout.name} running — ${Math.round(totalSeconds / 60)} min, FTP ${profile.ftp} W${hub.controlEnabled ? ', ERG on' : ''}.`; });
pauseButton.addEventListener('click', async () => { const paused = scene().togglePause(); pauseButton.textContent = paused ? 'Resume' : 'Pause'; endWorkoutButton.hidden = !paused; if (paused && hub.controlEnabled) { await hub.disableTrainerControl(); erg.classList.remove('connected'); erg.querySelector('span')!.textContent = 'Enable ERG'; } status.textContent = paused ? 'Mission paused. ERG released; trainer telemetry remains connected. End workout is ready.' : `${activeWorkout.name} resumed.`; });
endWorkoutButton.addEventListener('click', () => { if (!scene().endWorkout()) return; endWorkoutButton.hidden = true; pauseButton.disabled = true; pauseButton.textContent = 'Pause'; status.textContent = 'Workout ended. Your partial-ride summary is shown on the course.'; renderHistory(); });
demo.addEventListener('change', () => { hub.demoEnabled = demo.checked; status.textContent = hub.demoEnabled ? 'Demo rider active — start when ready.' : 'Demo paused. Connect your devices to ride.'; });
ghostToggle.addEventListener('change', () => { ghostEnabled = ghostToggle.checked; status.textContent = ghostEnabled ? 'Best-ride ghost enabled when a matching completed mission exists.' : 'Ghost rider hidden.'; });
setupButton.addEventListener('click', () => { setupPanel.hidden = false; renderHistory(); profileName.focus(); });
setupClose.addEventListener('click', () => { setupPanel.hidden = true; });
setupPanel.addEventListener('click', event => { if (event.target === setupPanel) setupPanel.hidden = true; });
window.addEventListener('keydown', event => { if (event.key === 'Escape') setupPanel.hidden = true; });
window.addEventListener('keydown', event => { if (event.code === 'Space' && scene().isRunning && document.activeElement?.tagName !== 'INPUT') { event.preventDefault(); pauseButton.click(); } });
profileSave.addEventListener('click', () => {
  profile = { name: profileName.value.trim() || 'Rider', ftp: Phaser.Math.Clamp(Number(profileFtp.value) || 200, 50, 700), weightLb: Phaser.Math.Clamp(Number(profileWeight.value) || 170, 70, 500), soundEnabled: soundToggle.checked };
  profileFtp.value = String(profile.ftp); profileWeight.value = String(profile.weightLb); saveProfile(profile); scene().refreshProfile(); setupPanel.hidden = true; status.textContent = `Saved ${profile.name}: FTP ${profile.ftp} W, ${profile.weightLb} lb.`;
});
fullscreenButton.addEventListener('click', () => { if (!document.fullscreenElement) void document.documentElement.requestFullscreen(); else void document.exitFullscreen(); });
window.addEventListener('ridehistorychanged', renderHistory);
hub.addEventListener('controlstatus', event => { status.textContent = (event as CustomEvent<string>).detail; });
window.addEventListener('controlerror', event => { void hub.disableTrainerControl(); erg.classList.remove('connected'); erg.querySelector('span')!.textContent = 'Enable ERG'; status.textContent = (event as CustomEvent<string>).detail; });
peloton.addEventListener('peers', event => { const count = (event as CustomEvent<PelotonPeer[]>).detail.length; roomStatus.textContent = count ? `LOCAL PELOTON · ${count + 1} RIDERS` : 'LOCAL PELOTON · SOLO'; });

let installPrompt: Event | undefined;
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; installButton.hidden = false; });
installButton.addEventListener('click', () => { if (!installPrompt) return; const prompt = installPrompt as Event & { prompt(): Promise<void> }; void prompt.prompt(); installPrompt = undefined; installButton.hidden = true; });
if ('serviceWorker' in navigator) window.addEventListener('load', () => { void navigator.serviceWorker.register('./sw.js'); });
