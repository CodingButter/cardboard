---
name: feedback-voice-chunks
description: Voice MCP responses longer than ~20 seconds (≈55 words / 350 chars) must be split into multiple back-to-back synthesize+pipe pairs. Each individual voice call stays ≤20s; pairs serialize naturally because playback is foreground.
metadata: 
  node_type: memory
  type: feedback
  originSessionId: f7e2d687-9aca-4eae-927f-568e2969ddc7
---

When a voice response is long enough that a single synthesis would run past ~20 seconds, split it into multiple synthesize → pipe pairs and run them in sequence within the same turn. Don't try to cram a paragraph-plus into one call.

**Why:** Long single-utterance synth has two failure modes — (1) Chatterbox is more likely to mid-utterance stall or mispronounce on long passages, and (2) if the user wants to interrupt or react, they can't until the whole long block finishes playing. Short chunks recover gracefully and let the user jump in between them. Foreground playback guarantees the pairs play back-to-back without overlap.

**How to apply:**
- Rule of thumb: synthesize text under ~55 words / ~350 chars per call. ~20 seconds at conversational rate.
- For longer content: split at natural sentence boundaries. Each chunk is a complete sentence (or two short sentences) that stands on its own — never split mid-sentence.
- Pattern per turn:
  ```
  synthesize(chunk_1) → pipe(chunk_1)  // foreground, blocks
  synthesize(chunk_2) → pipe(chunk_2)
  ...
  ```
- All synth+pipe pairs run BEFORE other tool calls per `[[feedback-voice-mcp-playback]]`. With multiple chunks, the pairs still come first as a contiguous block.
- Keep the substance distribution per `[[feedback-voice-carries-content]]` — every chunk should carry real findings, not filler. Don't pad to hit the 20s target; cut content if a chunk falls short of substance.
- When the response is genuinely short (one sentence), one chunk is correct — don't artificially split.
