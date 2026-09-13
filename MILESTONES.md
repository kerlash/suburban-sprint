# Ten-milestone build

1. **Ride feel** — reduced body bounce and added power-surge camera lag/catch-up.
2. **World motion** — separate sky, mid-distance, track, and foreground movement rates.
3. **Rider animation** — four pedal frames whose speed follows live cadence.
4. **Mission presentation** — stage banners, story/numeric targets, countdowns, and audio cues.
5. **Trainer control** — explicit FTMS control request, acknowledged ERG target commands, reset/release, and telemetry-safe error handling.
6. **Rider persistence** — editable name, FTP, weight, sound preference, and browser-local storage.
7. **Workout library** — distinct 10, 20, and 30-minute missions.
8. **Results and ghosts** — ride recaps, 25-ride history, one-second power traces, and best-attempt ghost racing.
9. **Install and hosting** — landscape PWA, offline cache, install icons, relative URLs, and GitHub Pages workflow.
10. **Peloton and controls** — same-device multi-tab riders, isolated future transport layer, fullscreen, keyboard pause, and safe pause/resume.

## Verified here

- TypeScript production build
- Automated deployment-asset, PWA-manifest, URL, and workout-duration checks
- Browser startup with no console errors
- Workout selection and stage transition banner
- Pause/resume state and status copy
- Setup/profile dialog layout
- Two-tab Local Peloton discovery and stale-rider removal

## Requires physical or external validation

- First live FTMS ERG command and reset/release behavior on the Wahoo KICKR BIKE v1
- Full mission completion while collecting real power, cadence, and heart rate
- PWA installation from the final HTTPS host
- Internet multiplayer; Local Peloton currently validates the client protocol only
- Final GitHub Pages publication, which requires a repository/account choice
