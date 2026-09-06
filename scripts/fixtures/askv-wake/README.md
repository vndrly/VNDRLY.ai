# Synthetic AskV inference fixtures

These 16 kHz, 16-bit, mono WAV files were synthesized locally using Windows
System.Speech with Microsoft David Desktop and Microsoft Zira Desktop.
They contain no microphone recording or user speech.

`fixtures.json` records the spoken text, voice, expected detector outcome and
SHA-256 of each file. Regenerate them on Windows using
`node scripts/verify-askv-wake.mjs --generate-fixtures`.

The verifier adds 0.5 seconds of leading silence and 1.5 seconds of trailing
silence in memory and sends 512-sample frames to the exact shipped worker.
A separate five-second all-zero case checks silence.

Passing these fixtures proves the bundled engine performs real inference and
that the specified positive/negative samples behave as expected. It does not
measure accuracy across accents, real microphones, room noise, or iOS devices.
