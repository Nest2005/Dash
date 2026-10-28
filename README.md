# Dash

Arcade time-attack racer. Beat Blackout's unbeaten lap (0'54"221) before the 120s clock runs out.

Play: open `index.html` (or the GitHub Pages link).

## Controls
Arrow keys or WASD drive (left/right steer, up accelerate, down brake). C start, P or Esc pause, M mute.

## Files
- `index.html` structure
- `css/style.css` styles
- `js/game.js` game logic
- `assets/images`, `assets/audio` pictures and sounds

## Race HUD
- **MAP strip** (bottom right): yellow dot = your progress, red dot = Blackout's pace (his unbeaten time spread over the track), checkered flag = finish line.
- **Crashes:** hitting a car knocks you backward and slows you for 1 s (no steering or throttle), then gives 3 s of blinking invincibility. Driving off the road is allowed (you slow down), but reaching the outer edge knocks you back onto the road. Distance, score and the clock are kept; you are not sent back to the start.
- **Lap board:** your lap on the board is temporary; each new finished run replaces the previous one and it is cleared when the page reloads.
- **Near miss:** a car passing within a close margin, but not touching you, adds 250 points. Only scored at speed (30+) and once per pass. Score = distance + near-miss bonus; the lap time is unaffected.

## GitHub Pages
Push all files to a repo, then Settings > Pages > Deploy from branch > `main` / root.

## Tuning (top of `js/game.js`)
`TIME_LIMIT` (120), `STUN_TIME` (1), `OFFROAD_EDGE` (1.4), `INVINCIBLE_TIME` (3), `mapLength` (track length, 9000 = ~51s flawless lap), `BOARD_RIVALS` (Blackout and rival times).
