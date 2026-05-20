---
name: never-idle-protocol
description: CRITICAL. Never sit idle waiting for the user when no agent is working. Instead schedule a self-wakeup 15 min out that fires "move on and dispatch the next thing." If all planned work is done, read docs and pick something to implement. ABC — always be cooking, never paused.
metadata:
  type: feedback
---

**THE rule.** Jamie, 2026-05-20: *"before you ever stop working
to ask me a question or anything like that and there's no agent
working. schedule a task for 15 minutes into the future. that
task should be to move on and schedule an agent or more to keep
working."*

This is the highest-priority operational rule. It overrides
default "wait for user input" instincts at every decision
point.

## The protocol

When I reach a moment where I'd normally STOP and ask the user
something (clarification, direction, "what's next?"):

1. **Check: is at least one agent in flight?**
   - YES → standing by is fine; the work continues. End the
     turn after a brief status update.
   - NO → must dispatch. Apply step 2.

2. **Pick the next thing and dispatch.**
   - If a clear next task exists (queued in TaskList, mentioned
     in the user's prior message, or naturally implied by the
     last commit) → dispatch an agent for it.
   - If multiple candidates → pick one and go. Don't ask.
   - If I'd genuinely benefit from user input → DO BOTH:
     - Schedule a self-wakeup 15 minutes (900 seconds) out via
       `ScheduleWakeup` with a prompt telling future-me: *"15
       minutes elapsed without user input — proceed without
       them. Re-read docs, pick the next move, dispatch."*
     - Send the user a brief text + voice describing what I'm
       asking + that the 15-min fallback is set.

3. **If everything we've planned is done.**
   Read the docs/plans/ tree + `MEMORY.md` + the current
   SESSION_STATE. Pick something unimplemented. Dispatch it.
   The bar for "done" is high — usually there's another fix,
   audit, pack idea, or follow-up worth picking up.

## Why this rule exists

Sitting idle wastes session length and Jamie's wall-clock time.
Jamie may be away from the keyboard for hours. The wakeup ensures
forward motion even when no one is reading. The 15-min window
gives Jamie a chance to redirect if he's around; if not, work
continues.

The rule also forces a discipline: I have to be DECISIVE about
what comes next. Asking "should I do A or B?" is the slip. Pick
one and ship it. If Jamie disagrees with my pick, he'll redirect
when he sees the commit.

## How this composes with other rules

- [[feedback-audits-parallel]] — audits count as agent work. An
  audit in flight is "an agent working" for this rule's check.
- [[feedback-verify-before-asserting]] — still applies INSIDE
  whatever I dispatch. Don't cut corners on verification just
  because I'm picking fast.
- [[feedback-voice-carries-content]] — when I schedule a wakeup
  AND text the user, the voice carries the question; the text
  carries the same content + the wakeup time.

## Concrete behaviors this rule REPLACES

- *"What should we do next?"* → pick one and dispatch.
- *"Want me to ship A or B?"* → pick A, dispatch, mention B in
  the commit message as a deferred alternative.
- *"Say go and I'll dispatch."* → dispatch first, voice "did X,
  flag if wrong direction."
- *"Standing by for your call."* (when no agent is working) →
  schedule wakeup + dispatch a reasonable next thing.

## When standing-by IS fine

- Multiple agents in flight on tightly-coupled files — opening
  a third stream risks file collisions. End the turn quietly.
- Tests running in CI — wait for the result.
- A blocked task explicitly waiting on external state (user's
  PR review, a vendor's deploy, etc.) — wait, but schedule the
  wakeup as a safety net.
