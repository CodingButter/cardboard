# Portable Claude memory for this repo

This directory is a **git-tracked mirror** of the auto-memory that
Claude Code maintains at
`~/.claude/projects/-home-codingbutter-development-cardboard/memory/`.

Why it exists: `~/.claude/projects/...` is per-machine. When you clone
this repo on a new computer, Claude has no prior memories about the
project. By mirroring the memory files into the repo, every machine
that pulls main also pulls the latest rules, project context, and
established patterns.

## Files

- `MEMORY.md` — the index. Each line points at one rule file.
- `feedback_*.md` — interaction rules (how Claude should behave on this project).
- `project_*.md` — engine + domain context that informs decisions.

## How a fresh Claude on a new machine should pick this up

When you clone the repo on a new machine and want Claude to behave
consistently:

1. Claude reads `CLAUDE.md` at the repo root (auto-loaded by the CLI).
2. `CLAUDE.md` instructs Claude to read this directory's `MEMORY.md`
   index.
3. Claude reads `MEMORY.md` and follows the linked rule files.

## Sync direction

The canonical write target is still
`~/.claude/projects/.../memory/` — Claude's auto-memory tooling writes
there. To keep the in-repo mirror current:

```bash
# Pull the latest memory into the repo (run after Claude writes new rules):
cp ~/.claude/projects/-home-codingbutter-development-cardboard/memory/*.md \
   .claude/memory/

# Or on a fresh machine, push the in-repo memory to the auto-memory location:
mkdir -p ~/.claude/projects/-home-codingbutter-development-cardboard/memory
cp .claude/memory/*.md \
   ~/.claude/projects/-home-codingbutter-development-cardboard/memory/
```

A future automation could keep these in sync via a Git hook or a
session-start command. For now, treat the sync as a manual step when
new rules land.
