#!/usr/bin/env python3
"""Separate vocals from background music/noise using Demucs (htdemucs).

Usage:
    python3 demucs_separate.py <input> <output> [cpu|cuda]

Progress is reported to stdout as PROGRESS:N (0-100).
The output path is printed as the final stdout line on success.
Exit code 0 on success, 1 on failure (stderr has the error).
"""
import sys
import os

def emit_progress(pct):
    print(f"PROGRESS:{pct}", flush=True)

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

    os.environ.setdefault("DEMUCS_CACHE", "/data/docscanner/cache/demucs")
    os.environ.setdefault("XDG_CACHE_HOME", "/data/docscanner/cache")

    try:
        import torch
        import torchaudio
        from demucs.pretrained import get_model
        from demucs.separate import apply_model
        import tqdm as _tqdm_mod
    except ImportError as e:
        print(f"Missing dependency: {e}. Install with: pip install demucs torchaudio", file=sys.stderr)
        sys.exit(1)

    try:
        emit_progress(5)
        model = get_model('htdemucs')
        model.to(device)
        model.eval()
        emit_progress(15)

        wav, sr = torchaudio.load(input_path)
        if wav.shape[0] == 1:
            wav = wav.repeat(2, 1)
        ref = wav.mean(0)
        wav = (wav - ref.mean()) / ref.std()
        emit_progress(25)

        mix = wav.to(device)

        last_pct = [25]
        original_tqdm = _tqdm_mod.tqdm

        class DemucsProgress(original_tqdm):
            def __init__(self, *args, **kwargs):
                super().__init__(*args, **kwargs)
            def update(self, n=1):
                super().update(n)
                if self.total and self.total > 0:
                    pct = int(25 + (self.n / self.total) * 60)
                    pct = min(pct, 85)
                    if pct > last_pct[0]:
                        last_pct[0] = pct
                        emit_progress(pct)

        _tqdm_mod.tqdm = DemucsProgress
        try:
            with torch.no_grad():
                sources = apply_model(model, mix[None], device=device, shifts=1, overlap=0.25, progress=True)
        finally:
            _tqdm_mod.tqdm = original_tqdm

        emit_progress(85)

        vocals = sources[0, model.sources.index("vocals")]
        vocals = vocals * ref.std() + ref.mean()

        if vocals.dim() == 2 and vocals.shape[0] > 1:
            vocals = vocals.mean(dim=0, keepdim=True)
        elif vocals.dim() == 1:
            vocals = vocals.unsqueeze(0)

        target_sr = 16000
        if sr != target_sr:
            vocals = torchaudio.functional.resample(vocals, sr, target_sr)

        emit_progress(95)
        os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
        torchaudio.save(output_path, vocals.cpu(), target_sr)
        emit_progress(100)
        print(output_path)
    except Exception as e:
        print(f"Demucs separation failed: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
