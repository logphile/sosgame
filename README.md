# sosgame
 
## A tiny game with a big smile
 
I built this Three.js SOS game for two simple reasons:
 
1) To see what the brand‑new ChatGPT‑5 model could really do when asked to co‑build a complete, polished mini‑game from scratch.
2) Because my young daughter loves the pencil‑and‑paper version of SOS — and seeing it come alive with color, sound, and motion makes her day.
 
The result is a lightweight, mobile‑friendly SOS that plays great on phones and desktops, with smooth visuals, subtle ambient music, and satisfying score sounds. Most importantly, it kept our short attention spans happy: building this took under an hour end‑to‑end with ChatGPT‑5 as my pair‑programmer.
 
## Rules of SOS (7×7)
 
- Place either an S or an O in any empty square on your turn.
- Form the sequence S‑O‑S horizontally, vertically, or diagonally to score.
- If you score, you take another turn immediately.
- The board ends when all squares are filled; highest score wins.
 
## Highlights
 
- Three.js 3D board with player‑colored letters and scoring lines.
- Mobile‑ready: responsive layout, larger board on small screens, pinch‑to‑zoom; mouse‑wheel zoom on desktop.
- Sound design: soft modern chime fallback + classic “pac‑dot” score SFX.
- Ambient music with file playback (assets/ambient.mp3) and a tasteful synth fallback; dedicated Sound/Music toggles.
- Clean HUD with quick letter selection and a return‑to‑menu button.
 
## Why this project exists
 
I wanted a real, hands‑on test of ChatGPT‑5’s coding flow — not just snippets, but a fully working, polished experience with audio, UI, mobile touches, and gameplay correctness (including overlapping SOS, repeat turns on scores, and ignoring occupied cells). ChatGPT‑5 performed impressively well as a rapid prototyping partner.
 
## Time to build
 
- Under an hour from idea to playable, polished game.
 
## Endorsement
 
> Strong endorsement: ChatGPT‑5 is excellent for fast, iterative game prototyping — from rendering and input handling to audio polish and UX details. It felt like pair‑programming with a tireless senior engineer.
 
## Running locally
 
1) Start a static server in this folder (PowerShell helper: `serve.ps1`, default port 5500).
2) Open `http://localhost:5500/` in your browser.
3) Optional: place `assets/ambient.mp3` to use a custom background track.

## Play online

This game is currently deployed on Azure Static Web Apps.

Play it here:

https://lemon-pebble-0b7263a10.1.azurestaticapps.net

Have fun — and if you grew up playing SOS on paper, this is a cozy, modern remix you can play together. ❤️
