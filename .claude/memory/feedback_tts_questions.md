---
name: feedback-tts-questions
description: "Always TTS the question content when calling AskUserQuestion. User often isn't watching the screen and needs the audio cue."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 7c1d9c99-8bc0-445e-84a2-2fadbbb70b5c
---

User direction: "You need to TTS so i know your asking questions. im not right by the screen right now".

Whenever calling `AskUserQuestion`, ALSO call `mcp__voice__synthesize` in the same turn with the question content. Don't rely on the visual UI alone — the user may be away from the screen and won't see the prompt.

**How to apply:**

1. **Always pair `AskUserQuestion` with a voice TTS call** containing:
   - A short phrase indicating a question is being asked.
   - The substance of the question (not just "I'm asking something").
   - Optionally, the recommended option.

2. Pattern:
   ```
   mcp__voice__synthesize → spoken question + recommendation
   bash play
   AskUserQuestion → the visual chooser
   ```

3. The voice carries content; the AskUserQuestion is the formal capture.

**Why:** The user runs this session via terminal + voice; visual question prompts are easy to miss when they step away. Audio is the channel they can always hear.

**Related rules:**
- [[feedback-voice-first-response]] — every response opens with a voice call.
- [[feedback-voice-carries-content]] — the voice MUST carry the substantive content.
- [[feedback-text-for-remote-sessions]] — text always accompanies voice for phone sessions.
