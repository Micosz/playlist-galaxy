# Playlist Galaxy

The first instrument in Playlist Galaxy is **Ringband · Saturn Pirate Radio**, a three-station receiver for the Saturn system. Turn the dial to switch both the live score and the phosphor display. Oscillators, filtered noise, delay lines, and a timed sequencer generate the music in your browser. The rings, ice moon, and polar vortex are drawn locally on canvas.

## Launch

Open `index.html` in a modern browser and press **Power on**. The receiver also runs from any static web server. For example, from this directory run:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Then open <http://127.0.0.1:8000/>. All assets ship in this folder. Playback works offline, with no build, dependencies, account, API keys, or audio downloads.

On Vercel, select the **Other** framework preset, use the repository root, and leave the build command empty.

## Stations

| Preset | Frequency | Broadcast |
| --- | --- | --- |
| 1 | 88.3 MHz · Cassini Drift | A swung 84 BPM dub signal, with sub-bass, filtered chord stabs, and dotted echoes. The outer ring traces the kick. |
| 2 | 96.7 MHz · Ice Choir | A 66 BPM ambient broadcast from Enceladus. Detuned pads, pitched glass tones, and low pulses light the moon's limb. |
| 3 | 105.1 MHz · Hex Static | A 128 BPM electro transmission from the polar hexagon. Resonant bass patterns, dry percussion, and sharp echoes drive the storm outline. |

## Controls

| Control | Action |
| --- | --- |
| Tuning dial | Drag sideways or vertically from the hub, turn the rim, or tap to cycle. A detent selects each station. |
| Station presets or **1–3** | Jump directly to a station. You can tune while the receiver is in standby. |
| **← / →**, **↑ / ↓** | Move one station. **Home / End** select the first or last. |
| **Power on / Power off** or **Space** | Start or stop the score. Space also activates a focused button. |
| Speaker button or **M** | Toggle mute while preserving the volume setting. |
| Volume slider | Drag the fader, or focus it and use the standard range keys. |
| **Record 12 s** / **Stop clip** | Capture up to 12 seconds of the live receiver on browsers with audio recording. Tune across stations during a take. |
| **Play clip** / **Stop preview** | Listen to the latest take from the beginning, on air or in standby. |
| **Save clip** | Download the latest completed aircheck in the browser’s audio format. |
| Field guide | Open the station log and controls. Press **Escape** or the close button to return. |

The artwork and oscilloscope follow the running score. With reduced motion enabled, the screen holds a still illustration for each station and the audio continues. Touch feedback uses vibration on supported devices. A reload starts a fresh session at preset 1 in standby and 58% volume. Each new performance varies its notes and accents.

## Record an aircheck

Power on, choose **Record 12 s**, then try presets **2** and **3**. Choose **Stop clip** to finish early, or wait for **Save clip**. The recording follows the speaker volume and mute. Powering off or switching away from the tab finishes the current take. The latest clip stays in the receiver until another take succeeds or you leave the page.

Choose **Play clip** to audition that take. On air, the station keeps time silently and becomes audible again when the preview ends. The display holds its illustration. The fader and mute control the preview. Tuning, changing power, starting another recording or hiding the tab ends the preview. In standby, playing a clip leaves the synthesizer asleep. **Save clip** remains available if the browser cannot play the recording.

## Checks

From this directory, run the display checks with Node:

```sh
node --test checks/display.test.cjs
```

The browser checks use Python Playwright and Chromium. They exercise startup with a user gesture, all three stations, retunes, mute, volume zero, rapid power cycles, touch, reduced motion, decoded audio downloads, repeated clip playback and an unsupported-format fallback.

```sh
python3 -m pip install playwright
python3 -m playwright install chromium
python3 checks/receiver.py
```

To use an installed Chromium, pass `--chromium /path/to/chromium` to the last command.

## Source

- `score.js` synthesizes and schedules the three programs, crossfades station changes, and controls the output level.
- `phosphor.js` renders the procedural illustrations, percussion envelopes, and oscilloscope.
- `aircheck.js` records the receiver output and previews the latest clip from its local download URL.
- `radio.js` handles power, tuning, keyboard shortcuts, touch, and the field guide.
- `index.html` and `radio.css` define the physical receiver and its responsive layout.
