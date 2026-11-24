# Playlist Galaxy

Open a planet to play its playlist. Switching planets saves the current song and its elapsed time. Opening that planet again picks up at the saved point. The sky view keeps the current playlist playing. Loading the site stays silent until a listener chooses a planet or a song.

## Use the galaxy

- Open **My Galaxy → Midnight → Ember** to hear the original demo *Afterglow*. Return to Midnight, open **Tide** for *Blue Hour*, then revisit Ember to resume. Browsing galaxies or systems keeps the current audio playing.
- Drag the sky to orbit. Use the wheel or pinch to zoom at a point, and Shift-drag or move two fingers together to pan. The round center control restores the view. With the map focused, use the arrow keys to rotate, Shift+arrows to pan, +/− to zoom and 0 to reset. Map gestures work with WebGL disabled. Reduced motion makes camera changes immediate.
- The path above a planet opens any ancestor. Escape goes up one level. Each map remembers its camera angle and zoom for this visit. Tap **เพลย์ลิสต์** to fold the song list and see more of the planet. Its moons and the player remain available.
- Create a galaxy from the universe, a system inside a galaxy, or a playlist planet inside a system. **จัดการดาว** lets you rename or move a planet, or give it a moon with its own playlist. Everything you create stays on this browser.
- The Milky Way has the Solar System and TRAPPIST-1 to explore. When creating a galaxy or system, the catalog picker can copy a name or a whole planetary system into your music map. Multi-host systems retain their individual stars. When adding a moon to a Solar System planet you can also pick its catalog name. The checked-in [galaxy catalog](docs/galaxies.md) and [planetary systems](docs/planetary-systems/README.md) load on demand. User collections can be arranged freely. Orbital spacing, galaxy shapes and planet colors are illustrative.
- Existing playlist IDs, MP3s and playback positions carry forward. Older user-created root planets live in **My Galaxy → Midnight**. Saturn and Neptune remain reachable in the Solar System, and Luna is under Earth.
- Use **เพิ่ม MP3** to add local files. The audio and playlist data live in IndexedDB on this browser. The playback position is saved on this device. Clearing the site's data removes them.
- Use **Apple Music** to connect, search the catalog, and add songs, or paste an Apple Music song link. Full in-app playback requires a configured MusicKit app, listener authorization and an eligible subscription. Saved Apple links also open in Apple Music.
- **Saturn Pirate Radio** is available inside Saturn and at [radio.html](radio.html).

## Run locally

Serve the root directory over HTTP to use browser modules and storage.

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Open <http://localhost:8000/>. On Vercel use the Other preset, the repository root and an empty build command. A plain static server runs the galaxy and MP3 player; Vercel also serves the Apple token endpoint.

## Enable Apple Music

Create a MusicKit-enabled media identifier and an associated Media Services private key in the Apple Developer account. Set these server-side Vercel environment variables for Production, then deploy a new build.

| Name | Value |
| --- | --- |
| `APPLE_MUSIC_TEAM_ID` | Apple Developer team ID |
| `APPLE_MUSIC_KEY_ID` | Media Services key ID |
| `APPLE_MUSIC_PRIVATE_KEY` | The entire PEM private key from the .p8 file, including its header and footer. Literal newline escapes also work. |
| `APPLE_MUSIC_ORIGIN` | Optional exact public origin. Defaults to `https://playlist-galaxy.vercel.app`. Set it to a local or preview origin in that environment to try real MusicKit there. |

The server signs short-lived ES256 developer tokens restricted to the configured site origin. Only the signed developer token reaches the browser. MusicKit handles the listener's authorization. Local MP3s use the browser's audio element. [Apple media identifiers and keys](https://developer.apple.com/help/account/capabilities/create-a-media-identifier-and-private-key/) · [MusicKit on the Web](https://developer.apple.com/musickit/)

## Galaxy checks

```sh
node --test checks/*.test.cjs
python3 -m pip install playwright
python3 -m playwright install chromium
python3 checks/galaxy.py
python3 checks/camera.py
python3 checks/receiver.py
```

The camera check uses trusted pointer input, including two-finger gestures, and switches between actual audio files before each flight lands. It also covers reduced motion, browser history and WebGL-disabled rendering.

The galaxy browser check uses FFmpeg to generate its own MP3s. Pass `--chromium /path/to/chromium` for an installed browser. It checks the hierarchical map, catalog copies, mobile touch, version-one storage upgrades, the demo and local audio players, and MusicKit with a test double. Use an authorized Apple Music subscription to check full catalog playback end to end.

## Saturn radio

The original receiver synthesizes three stations in the browser. Press **Power on** at its receiver to listen.

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

## Source

- `score.js` synthesizes and schedules the three programs, crossfades station changes, and controls the output level.
- `phosphor.js` renders the procedural illustrations, percussion envelopes, and oscilloscope.
- `aircheck.js` records the receiver output and previews the latest clip from its local download URL.
- `radio.js` handles power, tuning, keyboard shortcuts, touch, and the field guide.
- `radio.html` and `radio.css` define the physical receiver and its responsive layout.
