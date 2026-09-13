# Suburban Sprint

A trailing-camera browser game that turns an indoor cyclist's Bluetooth power, cadence, and heart rate into a bright cartoon neighborhood race.

## Run locally

1. Install Node.js 20 or newer and pnpm.
2. Run `pnpm install`.
3. Run `pnpm run validate`.
4. Run `pnpm run preview`.
5. Open `http://127.0.0.1:4173` in Chrome or Edge.

Localhost is treated as a secure browser context. A deployed build must use HTTPS because Web Bluetooth is restricted to secure contexts and pairing must begin with a user click.

## Current build

- Wahoo KICKR BIKE-tested FTMS power and cadence telemetry
- Bluetooth Cycling Power fallback and standard Heart Rate support
- Polar H10 and COROS-compatible heart-rate service reader
- Optional FTMS ERG target-power control, kept off until the rider explicitly enables it. ERG on sends mission target watts; ERG off is read-only and uses bike watts to drive the display, speed, distance, and visuals.
- 10-minute Bus Chase, 20-minute Neighborhood Tempo, and 30-minute Neighborhood Crit
- FTP-scaled numeric targets, cadence objectives, story prompts, three-second countdowns, and synthesized audio cues
- Cadence-driven four-frame pedal animation, power-surge camera tracking, and multi-depth scenery motion
- Editable rider name, FTP, weight, sound preference, fullscreen mode, and pause/resume
- Browser-local ride history with TP training load, average %FTP, average/max power, cadence, heart rate, distance, average speed, and target score. The course is a repeating 1 km oval with a live minimap.
- Best-ride ghost using a saved one-second power trace
- Same-device Local Peloton discovery through `BroadcastChannel`; opening a second tab creates another visible rider
- Installable landscape PWA with offline asset caching
- GitHub Pages deployment workflow in `.github/workflows/pages.yml`

## Trainer-control safety

Telemetry and control are separate. Connecting a trainer only reads data. The **Enable ERG** button becomes available only if the trainer advertises the FTMS Fitness Machine Control Point. Enabling it requests control and waits for the trainer's success response. Each workout stage then sends a signed target-power command. A rejection or timeout pauses ERG commands without disconnecting telemetry.

The first live ERG test should be performed while seated and at a low target. The rider can press **Release ERG** at any time. Mission Pause also sends the FTMS Reset procedure before releasing control; power/cadence telemetry stays connected.

## Hosting

All application URLs are relative, so the build works at a domain root or a repository subpath. GitHub Pages is the prepared default:

1. Create a GitHub repository and push this folder to its `main` branch.
2. In repository **Settings → Pages**, choose **GitHub Actions** as the source.
3. The included workflow builds `dist`, uploads it as the Pages artifact, and deploys it.
4. Use the generated HTTPS Pages URL in Chrome or Edge.

No backend is required for single-player, history, workouts, ghosts, or same-device Local Peloton. Internet multiplayer will require a small authoritative room service; `src/multiplayer.ts` is deliberately isolated so its local transport can later be replaced with WebSocket transport.

## Validation

`pnpm run validate` compiles TypeScript, builds the static site, verifies required deployment assets, confirms PWA icon and display settings, checks GitHub Pages-safe URLs, and asserts the workout durations are exactly 10, 20, and 30 minutes.
