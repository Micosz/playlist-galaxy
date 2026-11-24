# Camera and playlist review

Drag anywhere on the map to orbit. Scroll or pinch to zoom. Tap My Galaxy → Midnight → Ember, return to Midnight and tap Tide, then return to Ember. The second visit resumes Afterglow at its saved position. Tap the playlist heading to give the planet more space. The path above the planet and Escape both work during a flight.

![Solar System on desktop and Ember on a touch viewport](camera-preview.jpg)

## Browser checks

The camera projects original sprites, orbit guides and a seeded star field with Canvas 2D. No WebGL context is needed. Opening a shared planet link stays silent. Audio starts on the listener's selection and keeps its own clock independently of the visual transition.

The test run used Chromium Headless Shell 156.0.8078.79 on Linux. It covered mouse, trusted touch including pinch, keyboard, reduced motion, direct links, browser history, imported MP3s, the original demo recordings and a populated version-one IndexedDB fixture. In separate MP3 and demo runs, all four trusted A/B selections landed during an active camera flight. Only the selected track played. The external Apple song link and the optional MusicKit integration were checked with an unconfigured endpoint and a test double. The Saturn receiver checks covered standby, mute and downloaded airchecks.

```sh
node --test checks/*.test.cjs
python3 checks/galaxy.py
python3 checks/camera.py
python3 checks/receiver.py
python3 checks/map_latency.py --runs 5
```

The Python checks use Playwright. The audio checks also use FFmpeg. Pass `--chromium /path/to/chromium` to use an installed Chromium executable.

## Cold entry into the Solar System

Starting in the Milky Way, each sample clicks the Solar System in a fresh browser context. The handler column measures synchronous processing of that click. The frame column ends at the second animation-frame callback following it. Values are medians of five runs with the same machine and browser. Mobile is a 390 × 844 touch viewport at 2× pixel density. The desktop viewport is 1160 × 760 at 1×.

| Viewport | Handler before | Handler after | Two frames before | Two frames after |
| --- | ---: | ---: | ---: | ---: |
| Desktop | 297.6 ms | 117.2 ms | 369.1 ms | 164.1 ms |
| Mobile emulation | 260.0 ms | 93.0 ms | 302.7 ms | 114.4 ms |

The before measurements used `fbc1f19035cdcad5a74f8235cd3d94a7e9ae47ea`. The after measurements used the tree published as `ed005f79d8f0ba6397933fe9762d65254d9eae8e`. Run the same timing script with each checkout for a local comparison. Real-device Safari and Android GPU timing remain unmeasured.

## Reference

The supplied Coma link reached CosmoLapse's startup error in Cloud Chrome with WebGL disabled. Chromium with software WebGL2 successfully created a context, but the Coma page returned HTTP 403 in both viewport sizes. The live camera's easing, gesture sensitivity and point density could not be measured. The published guide describes clicking a body to fly to it and navigating across astronomical scales. Playlist Galaxy uses its own timings, projected layout, surfaces and catalog. [CosmoLapse FAQ](https://cosmolapse.com/faq) · [CosmoLapse overview](https://cosmolapse.com/about)
