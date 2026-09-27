# Record game audio alongside video

`tools/record_loopback_audio.py` captures a Windows playback endpoint through WASAPI loopback as 48 kHz stereo PCM WAV. It records the endpoint's system mix, including other apps using that output; it does not record a separate microphone or change game audio settings. Keep recordings local under `.cache` and review them before sharing.

## Setup

```powershell
python -m pip install -r tools/requirements-loopback.txt
python tools/record_loopback_audio.py --list-devices
python tools/record_loopback_audio.py --duration-seconds 3 --self-test --output .cache/test-videos/audio-check.wav
```

The optional self-test plays a quiet tone and checks the capture level. Use a fresh output path. Select the game's actual output with `--speaker '<unique listed name>'`; omitting it chooses the Windows default. A tone self-test does not prove that game audio uses the same endpoint.

## Capture and close

Start audio shortly before the existing display recorder and game launch:

```powershell
python tools/record_loopback_audio.py --duration-seconds 600 --output .cache/test-videos/game-audio.wav --stop-file .cache/test-videos/game-audio.stop
```

The helper prints UTC start/end, recorded duration, peak and RMS. After the game closes, create the chosen stop file to finish early and finalize the WAV:

```powershell
New-Item -ItemType File .cache/test-videos/game-audio.stop
```

Use new paths for each run; existing audio or stop files are rejected. The duration provides a bounded fallback. Close and inspect both recordings before hashing, clipping or muxing them. This helper was copied unchanged from the local addon development tools; its earlier Windows tone and stop-file checks succeeded. Current integration verification and run-specific audio observations belong in the corresponding test record.

On September 27, the independent copy's three-second self-test exited 0 and finalized 3.000 seconds at peak 0.6923/RMS 0.0820 on the default output. This verifies capture availability, not isolated game speech or synchronization; the endpoint can contain other system audio. The ignored local evidence is `.cache/test-videos/loopback-integration-2026-09-27.wav`.

## Combine with video

The video recorder's Desktop Duplication output is silent. Align the separately recorded WAV using capture start times and a visible/audible event, then mux it with FFmpeg. For audio started exactly two seconds before video:

```powershell
ffmpeg -i .cache/test-videos/game-video.mp4 -ss 2 -i .cache/test-videos/game-audio.wav -map 0:v:0 -map 1:a:0 -c:v copy -c:a aac -shortest .cache/test-videos/game-with-audio.mp4
```

The offset is an example, not a preset. Check the actual synchronization and crop away unrelated desktop content before publishing. A nonzero waveform or playback log alone does not identify an audible in-game line.
