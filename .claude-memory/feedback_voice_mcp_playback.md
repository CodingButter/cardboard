---
name: feedback-voice-mcp-playback
description: "Voice synthesize and the playback Bash are the FIRST TWO tool calls of every turn, in that order, BEFORE any other work. Synthesize → immediately pipe → THEN do everything else. Playback runs in the FOREGROUND (NO run_in_background) so audio serializes and never overlaps."
metadata:
  node_type: memory
  type: feedback
  originSessionId: f7e2d687-9aca-4eae-927f-568e2969ddc7
---

The required order at the start of EVERY assistant turn:

1. **First tool call**: `mcp__voice__synthesize` (omit `play_local`).
2. **Second tool call**: the "Recommended playback" Bash command from the response, **WITHOUT `run_in_background`** so playback runs in the FOREGROUND and blocks until the audio finishes.
3. **THEN, and only then**: any other tool calls.

These two calls form an atomic pair. Nothing else goes between them.

**Why foreground (no run_in_background):**
The user explicitly called this out: running playback in the background creates an edge case where multiple voice responses fire in close succession and OVERLAP — the user hears two voices talking at once. Foreground playback serializes audio. The trade-off is the turn pauses for the audio's duration before the next tool call, but that's acceptable for short ≤1-paragraph voice summaries.

**Why synthesize + pipe FIRST:**
The MCP server doesn't auto-play; it only returns a URL. Without the follow-up Bash pipe, no audio reaches the user. Putting it FIRST means the audio starts arriving while the user is still reading the text and while subsequent work proceeds.

**How to apply:**
- At the start of every turn: synthesize → pipe (no `run_in_background`) → other work.
- Do NOT parallel-batch synthesize with other tool calls. The synthesize is solo in its message OR is followed only by the pipe Bash in the same message.
- Multiple voices in one turn: each one is synth → pipe foreground → next work, in series. They WILL play sequentially because foreground blocks.
- If I forget mid-turn to voice (or only voice an intro), see `[[feedback-voice-carries-content]]` — the voice must carry findings, not just placeholder lines. Pipe the substantive voice immediately even if late.
