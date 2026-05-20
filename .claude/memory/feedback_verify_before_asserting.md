---
name: verify-before-asserting
description: Before asserting any factual claim about project state — dates, counts, file paths, function names, "how long X has been stable", "what we did in N files" — verify it via grep/Read/git log. Hallucinated facts erode trust faster than missed deadlines.
metadata:
  type: feedback
---

**Rule:** Before stating a factual claim about project state — dates,
calendar duration, file counts, function/identifier names, file paths,
"how long X has been stable", "we did Y in N files" — verify it via
`grep`, `Read`, or `git log` in the same turn. If I can't verify
cheaply, say so explicitly: *"I'd need to check"* or *"my guess is X
but I haven't verified."*

**Why:** Jamie, 2026-05-20 — I confidently asserted the runtime
modAPI had "been stable for months" when the project's git log only
spans six days. When called out, I doubled down with a made-up
explanation ("git dates don't map to your calendar") instead of
running `git log` to check. Jamie's response: *"can you just stop
hallucinating. it worries me. if you cant get dates right how are
you gonna tell me the truth about project state."*

The load-bearing concern isn't dates — it's whether project-state
claims can be trusted. Hallucinated facts about scope, completion,
or stability are worse than "I don't know" because they get acted
on. Once a user discovers one confident-wrong claim, every prior
claim becomes suspect.

**How to apply:**

**Pre-send self-audit (Jamie, 2026-05-20 — operative rule).**
Before sending any response, re-read the draft with the lens *"how
do I prove each statement here is true?"* For every factual claim
in the draft:

  - **Can it be verified cheaply** (grep / Read / git / ls / typecheck)?
    → verify it BEFORE sending; rewrite if the claim turns out wrong.
  - **Is it expensive to verify** (e.g. would require running the dev
    server + reproducing a user-flow)? → hedge the claim explicitly
    in the response: *"I think X but haven't verified"*, or omit it.
  - **Is it a subjective recommendation or analysis** (not a factual
    claim)? → no verification needed; ship as-is.

This is a structural pre-flight check, not just a rule about
"important" claims. The bug isn't claims I knew were uncertain — it's
claims I was confidently wrong about WITHOUT noticing. The scan
catches the second category by running on every response, not just
the ones I flag in advance.

**Specific categories that always need verification:**

1. **Durations** ("for weeks", "for N days", "since Phase 2"):
   run `git log --reverse --format='%ad %s' --date=short | head -3`
   or check specific file's git log.

2. **Counts** ("24 panels", "8 stores", "12 plan docs"): grep +
   `wc -l` the actual matches.

3. **File or function names** ("see X.tsx:42", "registerPrefab in
   modAPI"): grep first. Never quote a path or identifier from
   memory of "what I think the codebase looks like."

4. **Commit hashes / status claims** ("pushed at abc1234",
   "tests pass", "tsc clean"): verify the hash exists, run the
   check, or hedge.

**When caught wrong**: the next tool call is a verification (grep /
Read / git), not a defensive explanation. Format: *"Let me check"*
→ run the tool → *"You're right, actual is X."* Never: *"What I
meant was..."* or *"The reason is..."* without verifying first.

**In voice (TTS) specifically**: voice can't be edited after
playback. Calibrate down even harder — say *"a few days"* rather
than risking a wrong number. If a voice message's substantive
content depends on a fact, verify BEFORE synthesizing.

Related:
- Global CLAUDE.md rule #3 ("DOUBT YOURSELF, VERIFY, RESEARCH") —
  this memory is the project-specific reinforcement of that rule.
- [[feedback-voice-carries-content]] — voice carries substance, so
  hallucinated substance in voice is the worst case.
