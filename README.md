# Playlist Galaxy

Open a planet to play its playlist. Switching planets saves the current song and its elapsed time. Opening that planet again picks up at the saved point. The sky view keeps the current playlist playing. Loading the site stays silent until a listener chooses a planet or a song.

## Use the galaxy

- Open **My Galaxy → Midnight → Ember** to hear the original demo *Afterglow*. Return to Midnight, open **Tide** for *Blue Hour*, then revisit Ember to resume. Browsing galaxies or systems keeps the current audio playing.
- Click a planet for an automatic flight. Or hover over it and scroll up to fly in at your own pace. Stop to hold the view, scroll down to retrace the approach, or press Escape to cancel. Reaching the planet opens its playlist. On a fresh visit your browser may ask for a click on Play. This also works for galaxies, systems and moon markers.
- On a touchscreen, tap a destination to fly there or tap **คุมการบิน** and then the destination to steer. Slide the bottom bar forward or back. Lift partway to hold the view. Release at the far right to enter and start or resume its playlist. **ยกเลิก** returns to the departure view. **กลับ** names the parent you can reach with your thumb.
- Drag the sky to orbit. Scroll over open space to zoom around the pointer. With two fingers, spread or pinch around the planet and move your fingers together to carry it across the map. Shift-drag also pans. The round center control restores the view. With the map focused, use the arrow keys to rotate, Shift+arrows to pan, +/− to zoom and 0 to reset. Tab to a planet to zoom around that planet with +/−. Map gestures work with WebGL disabled. Reduced motion makes camera changes immediate.
- The path above a planet opens any ancestor. Escape goes up one level. Each map remembers its camera angle and zoom for this visit. Tap **เพลย์ลิสต์** to fold the song list and see more of the planet. Its moons and the player remain available.
- Create a galaxy from the universe, a system inside a galaxy, or a playlist planet inside a system. **จัดการดาว** lets you rename or move a planet, or give it a moon with its own playlist. Everything you create stays on this browser.
- The Milky Way has the Solar System and TRAPPIST-1 to explore. When creating a galaxy or system, the catalog picker can copy a name or a whole planetary system into your music map. Multi-host systems retain their individual stars. When adding a moon to a Solar System planet you can also pick its catalog name. The checked-in [galaxy catalog](docs/galaxies.md) and [planetary systems](docs/planetary-systems/README.md) load on demand. User collections can be arranged freely. Orbital spacing, galaxy shapes and planet colors are illustrative.
- Existing playlist IDs, MP3s and playback positions carry forward. Older user-created root planets live in **My Galaxy → Midnight**. Saturn and Neptune remain reachable in the Solar System, and Luna is under Earth.
- Use **เพิ่ม MP3** to add local files. The audio and playlist data live in IndexedDB on this browser. The playback position is saved on this device. Clearing the site's data removes them.
- Use **Apple Music** to connect, search the catalog, and add songs, or paste an Apple Music song link. Full in-app playback requires a configured MusicKit app, listener authorization and an eligible subscription. Saved Apple links also open in Apple Music.
- **Saturn Pirate Radio** is available inside Saturn and at [radio.html](radio.html).

## Find a world or song

Choose **ค้นหา** in the header or press **/**. Search by world, track, artist, or a name in the parent path. **ดูดาว** opens the planet with the current song still playing. **เล่น** plays the chosen track from its saved position when available and leaves you on the same map. Saved Apple Music links open in Apple Music. **ดูข้อมูล** shows a catalog object's address and facts. Enter in the search field opens the first result for browsing. Escape returns from catalog facts to results, then closes search.

The app searches your in-memory library and reads the two bundled astronomy catalogs on the first query. Only the fixed astronomy files are fetched and cached for later searches while offline. Private queries and track names stay in the tab. New and imported items appear immediately.

## Move your library to another device

Open **จัดการดาว (···) → ย้ายหรือสำรองคลังเพลง** on any playlist planet. On a new device, the same action is inside **สร้างกาแล็กซี** on the universe map. Choose **เตรียมไฟล์สำรอง**, then **ดาวน์โหลดไฟล์สำรอง**. On the other device choose **เลือกไฟล์นำเข้า**, check the counts and size, then **รวมเข้ากับคลังนี้**. Selecting the file only previews it.

The local `.pgalaxy` file includes your map, playlist order, personal MP3s, Apple Music links and per-planet listening positions. Anyone you give the file to can play its MP3s. Export and import work offline without an account. Apple Music authorization stays on each device. Existing map and planet URLs keep their IDs.

The merge adds missing items by ID. A customized destination planet and its saved listening position win. A factory planet that still has its original settings can adopt the backup’s name, appearance and parent. Independently created planets with the same name keep their separate IDs. Reimporting a file does not create additional records. Shared MP3 content is written once. Older files stored directly under a track ID keep playing in place.

Version 1 has a 44-byte header (`PGALAXY`, a one-byte version, a big-endian JSON length and the metadata’s SHA-256 digest). The UTF-8 manifest lists worlds, tracks, saved positions and ordered audio payloads. Original MP3 bytes follow it. Each media key is the SHA-256 of the concatenated binary SHA-256 digests of its consecutive 1 MiB chunks. The reader verifies lengths, relationships, metadata and every payload before offering the merge. One IndexedDB transaction commits the merged records, audio and restored positions together. [IndexedDB transaction lifetime](https://www.w3.org/TR/IndexedDB-3/#transaction-lifetime)

A backup can contain up to 4,096 worlds, 10,000 tracks, 128 MiB per MP3, 4 MiB of metadata and 512 MiB overall. Preparing a backup reports an error if an MP3 is missing or a limit is exceeded.

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
python3 checks/backup.py
python3 checks/search.py
python3 checks/camera.py
python3 checks/navigation.py
python3 checks/journeys.py
python3 checks/wheel_travel.py
python3 checks/thumb_navigation.py
python3 checks/receiver.py
```

The camera check uses trusted pointer input, including two-finger gestures, and switches between actual audio files before each flight lands. It also covers reduced motion, browser history and WebGL-disabled rendering.

The galaxy browser check uses FFmpeg to generate its own MP3s. Pass `--chromium /path/to/chromium` for an installed browser. It checks the hierarchical map, catalog copies, mobile touch, version-one storage upgrades, the demo and local audio players, and MusicKit with a test double. Use an authorized Apple Music subscription to check full catalog playback end to end.

The backup check creates independent Chromium profiles and generated MP3s, downloads an actual backup, and imports it with HTTP disabled. It reopens the recipient after moving the backup file, checks playback and resume, repeated and concurrent imports, protected destination values, rejected versions, damaged media, quota rollback and version-two storage upgrades. Pass `--offline-html "/path/to/Playlist Galaxy.html"` to exercise an extracted offline copy, or `--evidence /tmp/playlist-backup` to save the mobile import review.

See the [Safari/iPhone smoke test and cross-engine commands](docs/browser-compatibility.md) for music, storage and download checks.

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
