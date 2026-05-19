---
name: feedback-text-for-remote-sessions
description: "Voice plays on the desktop only. When the user is on a remote phone client, they read text. Always write substantive text alongside any voice synth — voice is not a substitute for text content."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 7c1d9c99-8bc0-445e-84a2-2fadbbb70b5c
---

User direction: "youll need to respond with text as well since my phone doesnt play the voice".

**Context:** Voice synthesis via `mcp__voice__synthesize` + the `curl | mbuffer | ffplay` playback pipeline runs on the desktop machine where the Bash tool executes. When the user is remote-controlling Claude Code from their phone (via the `/remote-control` skill), the voice plays through the desktop speakers but the phone only displays text.

**The rule:** Every response that uses voice MUST also include text that carries the same substantive content. Voice is a *companion* to text, not a substitute for it.

**Concrete pattern:**

Before this rule:
```
[mcp__voice__synthesize "Tool palette landed. Next is brush."]
[Bash plays the audio]
(no text)
```
→ Desktop user hears it. Phone user sees nothing.

After this rule:
```
[mcp__voice__synthesize "Tool palette landed. Next is brush."]
[Bash plays the audio]

Text: "ToolPalette fix landed at <sha>. Dispatching Brush audit next."
```
→ Both desktop AND phone user know what happened.

**End-of-turn text minimum:** even if the voice has fully narrated the milestone, end with a 1-2 line text summary. Don't end on tool calls or pure voice.

**Related rules:**
- [[feedback-voice-first-response]] — every response opens with a voice call.
- [[feedback-voice-carries-content]] — voice must carry substantive content.
- [[feedback-tts-questions]] — AskUserQuestion must be paired with voice.

This rule is the text-side counterpart: voice + text both carry content, neither is a placeholder for the other.
