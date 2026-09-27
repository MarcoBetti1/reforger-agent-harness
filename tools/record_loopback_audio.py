"""Record the selected Windows speaker's system mix through WASAPI loopback.

This is a local evidence tool. It does not change the addon or game audio.
Install dependencies with ``python -m pip install -r tools/requirements-loopback.txt``.
"""

from __future__ import annotations

import argparse
import math
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

try:
    import numpy as np
    import soundcard as sc
    import soundfile as sf
except ImportError as exc:
    raise SystemExit(
        f"Missing {exc.name}. Install: python -m pip install -r "
        "tools/requirements-loopback.txt"
    ) from exc


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def speakers():
    devices = sc.all_speakers()
    default = sc.default_speaker()
    return devices, default


def choose_speaker(query: str | None):
    devices, default = speakers()
    if not query:
        if default is None:
            raise ValueError("Windows has no default speaker; select an endpoint explicitly")
        return default

    matches = [
        device for device in devices
        if query.casefold() in device.name.casefold() or query == device.id
    ]
    if len(matches) != 1:
        names = ", ".join(device.name for device in matches) or "none"
        raise ValueError(f"Speaker query {query!r} matched {len(matches)} devices: {names}")
    return matches[0]


def list_speakers() -> None:
    devices, default = speakers()
    if not devices:
        print("No Windows playback endpoints found")
        return
    for device in devices:
        marker = " [default]" if default and device.id == default.id else ""
        print(f"{device.name}{marker}\n  id: {device.id}")


def play_test_tone(speaker, samplerate: int) -> None:
    # A quiet, identifiable 440 Hz signal through the selected output endpoint.
    time.sleep(0.4)
    frames = int(0.8 * samplerate)
    phase = np.arange(frames, dtype=np.float64) / samplerate
    tone = (0.12 * np.sin(2.0 * np.pi * 440.0 * phase)).astype(np.float32)
    fade = min(int(0.03 * samplerate), frames // 2)
    tone[:fade] *= np.linspace(0.0, 1.0, fade, dtype=np.float32)
    tone[-fade:] *= np.linspace(1.0, 0.0, fade, dtype=np.float32)
    stereo = np.column_stack((tone, tone))
    speaker.play(stereo, samplerate=samplerate, channels=2)


def record(args: argparse.Namespace) -> None:
    if sys.platform != "win32":
        raise ValueError("This helper is for Windows WASAPI loopback")
    if args.duration_seconds <= 0 or args.duration_seconds > 7200:
        raise ValueError("--duration-seconds must be greater than 0 and at most 7200")
    if args.self_test and args.duration_seconds < 2:
        raise ValueError("--self-test needs at least 2 seconds")

    output = args.output.resolve()
    if output.exists() and not args.overwrite:
        raise FileExistsError(f"Refusing to overwrite {output}; choose a new file or --overwrite")
    stop_file = args.stop_file.resolve() if args.stop_file else None
    if stop_file and stop_file.exists():
        raise FileExistsError(f"Stop signal already exists: {stop_file}")

    speaker = choose_speaker(args.speaker)
    if speaker.channels < 2:
        raise ValueError("The selected endpoint is not stereo; this helper records two channels")
    loopback = sc.get_microphone(speaker.id, include_loopback=True)
    if loopback is None or not loopback.isloopback:
        raise RuntimeError(f"No WASAPI loopback endpoint for {speaker.name}")

    samplerate = 48000
    block_frames = 4800
    total_frames = int(args.duration_seconds * samplerate)
    output.parent.mkdir(parents=True, exist_ok=True)
    print(f"Speaker: {speaker.name}")
    print(f"Loopback: {loopback.name}")
    print(f"Output: {output}")
    if stop_file:
        print(f"Stop file: {stop_file}")
    print(f"Start UTC: {utc_now()}", flush=True)

    peak = 0.0
    sum_squares = 0.0
    frames_written = 0
    tone_thread = None
    interrupted = False
    stopped_by_file = False
    mode = "w" if args.overwrite else "x"
    with sf.SoundFile(output, mode=mode, samplerate=samplerate, channels=2,
                      format="WAV", subtype="PCM_16") as wav:
        with loopback.recorder(samplerate=samplerate, channels=2,
                               blocksize=block_frames) as capture:
            if args.self_test:
                tone_thread = threading.Thread(
                    target=play_test_tone, args=(speaker, samplerate),
                    daemon=True,
                )
                tone_thread.start()
            try:
                while frames_written < total_frames:
                    if stop_file and stop_file.exists():
                        stopped_by_file = True
                        break
                    take = min(block_frames, total_frames - frames_written)
                    samples = np.asarray(capture.record(numframes=take))
                    if samples.ndim != 2 or samples.shape[1] != 2 or samples.shape[0] == 0:
                        raise RuntimeError(f"Unexpected loopback block shape: {samples.shape}")
                    samples = samples[:take]
                    wav.write(samples)
                    peak = max(peak, float(np.max(np.abs(samples))))
                    sum_squares += float(np.sum(np.square(samples, dtype=np.float64)))
                    frames_written += samples.shape[0]
            except KeyboardInterrupt:
                interrupted = True

    if tone_thread:
        tone_thread.join(timeout=2)
    rms = math.sqrt(sum_squares / max(1, frames_written * 2))
    print(f"End UTC: {utc_now()}")
    print(f"Recorded: {frames_written / samplerate:.3f} s, peak={peak:.4f}, rms={rms:.4f}")
    if interrupted:
        print("Stopped by user; WAV finalized")
    if stopped_by_file:
        print("Stop file detected; WAV finalized")
    if args.self_test and rms < 0.002:
        raise RuntimeError(
            "Self-test recorded near silence; verify the chosen output endpoint and Windows volume"
        )
    if peak < 0.002:
        print("Near silence: play game audio through the selected endpoint and retry", file=sys.stderr)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--list-devices", action="store_true", help="List Windows playback endpoints")
    parser.add_argument("--speaker", help="Unique speaker-name substring or exact Windows endpoint id")
    parser.add_argument("--output", type=Path, help="Destination 48 kHz stereo PCM WAV")
    parser.add_argument("--duration-seconds", type=float, default=10.0)
    parser.add_argument("--overwrite", action="store_true")
    parser.add_argument("--self-test", action="store_true", help="Play a quiet test tone to verify loopback")
    parser.add_argument("--stop-file", type=Path, help="Stop and finalize when this file appears")
    args = parser.parse_args()
    try:
        if args.list_devices:
            list_speakers()
            return 0
        if not args.output:
            parser.error("--output is required unless --list-devices is used")
        record(args)
        return 0
    except (OSError, RuntimeError, ValueError) as exc:
        print(f"Loopback capture failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
