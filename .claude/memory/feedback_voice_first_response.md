---
name: feedback-voice-first-response
description: Always start every response with a short voice call (one paragraph or less) before the detailed text response.
metadata: 
  node_type: memory
  type: feedback
  originSessionId: f7e2d687-9aca-4eae-927f-568e2969ddc7
---

For every response, lead with a `mcp__voice__synthesize` call (omit `play_local`, pipe the returned URL through the response's "Recommended playback" command in a background Bash). Keep the spoken text to **one paragraph or less** — a concise summary of what's about to happen or what just finished. Then write the full detailed text response below it.

**Why:** The user works with the agent through audio as the primary channel. A short voice intro lets them stay informed and parallel-process while the long-form text and tool calls scroll past. Skipping the voice call cuts them out of the loop.

**How to apply:** Every assistant turn → first action is `mcp__voice__synthesize` (then the playback Bash). The spoken text is a tight summary: what was found, what's about to be dispatched, or what just completed — never the long detailed response itself. Then write the normal detailed text. See `[[feedback-voice-mcp-playback]]` for the playback pipeline directive and `[[feedback-always-delegate]]` for the parallel rule that complements this (voice + delegate are the two open-of-turn habits).
