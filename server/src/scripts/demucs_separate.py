#!/usr/bin/env python3
"""Separate vocals from background music/noise using Demucs (htdemucs).

Usage:
    python3 demucs_separate.py <input> <output> [cpu|cuda]

The input can be any audio/video format supported by ffmpeg.
Output is written as a 16kHz mono WAV file (Whisper-ready).
Exit code 0 on success, 1 on failure (stderr has the error).
"""
import sys
import os

def main():
    if len(sys.argv) < 3:
        print("Usage: demucs_separate.py <input> <output> [cpu|cuda]", file=sys.stderr)
        sys.exit(1)

    input_path = sys.argv[1]
    output_path = sys.argv[2]
    device = sys.argv[3] if len(sys.argv) > 3 else "cpu"

    if not os.path.isfile(input_path):
        print(f"Input file not found: {input_path}", file=sys.stderr)
        sys.exit(1)

    # Point cache to persistent volume when available.
    os.environ.setdefault("DEMUCS_CACHE", "/data/docscanner/cache/demucs")
    os.environ.setdefault("XDG_CACHE_HOME", "/data/docscanner/cache")

    try:
        from demucs.api import Separator
        import torch
        import torchaudio
    except ImportError as e:
        print(f"Missing dependency: {e}. Install with: pip install demucs torchaudio", file=sys.stderr)
        sys.exit(1)

    try:
        separator = Separator(model="htdemucs", device=device)
        (ref, separated) = separator.separate_audio_file(input_path)
        vocals = separated["vocals"]

        # Resample to 16kHz mono (Whisper's expected format).
        if ref.shape[0] > 1:
            vocals = vocals.mean(dim=0, keepdim=True)
        target_sr = 16000
        if ref.shape[1] != target_sr:
            vocals = torchaudio.functional.resample(vocals, ref.shape[1], target_sr)

        os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
        torchaudio.save(output_path, vocals.cpu(), target_sr)
        print(output_path)
    except Exception as e:
        print(f"Demucs separation failed: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
