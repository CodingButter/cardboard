---
name: feedback-voice-carries-content
description: "Voice calls MUST carry the actual content of the response, not a placeholder 'let me check' intro. The user listens to voice as the primary channel — if the spoken text is just 'looking now', they get nothing."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: f7e2d687-9aca-4eae-927f-568e2969ddc7
---

When a turn produces findings, a status report, a list of changes, or any meaningful result, **the voice synthesis must contain that content** — not a short "let me check / on it / verifying now" intro.

**Why:** The user listens to voice as the primary channel and reads the detailed text only when something catches their attention in the audio. If the only voice for a turn is a generic "checking" line, they hear nothing useful and have to fall back to reading the text — which defeats the point of the voice channel.

The user has explicitly called this out: "why do you only insist on talking at the beginning?" The pattern that triggered it was synthesizing a "checking now" intro, running the actual investigation in tool calls, then writing the findings only as text.

**How to apply:**
- If a turn has a single meaningful response, voice that response (with the detailed text written below for reference).
- If a turn has BOTH an intro action ("checking now") AND a findings report ("here's what I found"), the findings is what gets voiced — either skip the intro or roll it into the same voice call ("checking... and here's what I found...").
- If you must voice twice in one turn (e.g., dispatching an agent before findings are available), the second voice carries the substantive content.
- Don't truncate. The spoken summary should match the depth of the text response. If the text has 8 bullet points, the voice mentions the main ones — don't reduce to "everything's fine".
- One-line confirmations ("audio delivered", "merged + pushed") are fine when they ARE the substantive content — the rule is content-bearing, not always-long.

See `[[feedback-voice-mcp-playback]]` for the playback pipeline rule and `[[feedback-voice-first-response]]` for the open-of-turn rule.
