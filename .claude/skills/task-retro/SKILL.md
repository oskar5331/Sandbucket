---
name: task-retro
description: "Brief, honest retrospective on a just-finished task. Covers what got done, what was actually worked on (files/changes/verification), access/env blockers, input-quality gaps, misses and wrong assumptions, confidence flags for human review, and context worth documenting. Skips empty sections; ends with a one-line headline takeaway plus one concrete next action, then offers to save the retro to docs/retros/. Report-only except that consented file save — never edits code or commits. Triggers: human invokes /task-retro, or asks for a retro / postmortem / debrief after finishing a piece of work."
metadata:
  author: project
  version: "1.1.0"
---

# Task retrospective

A short, candid retro on the task just completed. The point is an honest
signal — what went well, what didn't, and what the next person (human or
agent) needs to know. Brevity over completeness; truth over polish.

## Operating rules

1. **Report-only.** Produce the retro as a chat message. Do not edit code,
   stage, commit, or write files unless the human explicitly asks. Writing
   a memory or a `docs/` note is a follow-up the human opts into, not part
   of the retro itself.
2. **Be direct about misses.** The value is in naming wrong assumptions,
   dead ends, and course corrections plainly. Do not soften them into
   non-statements, and do not invent problems to look thorough.
3. **Skip empty sections.** A section with nothing real to say is omitted
   entirely — not padded with filler. A retro with three honest sections
   beats one with six hollow ones.
4. **Ground claims in the session.** Base each point on what actually
   happened this task — tool failures, files touched, questions asked,
   corrections made. Don't generalise or speculate beyond it.

## When to run

- Human invokes `/task-retro`.
- Human asks for a retro, postmortem, debrief, or "how did that go" after a
  task wraps.

## How to run

1. Look back over the session: what was asked, what was built, where tools
   or permissions blocked progress, what the human had to clarify or
   correct, and what you ended up unsure about.
2. Fill the seven sections below from that evidence. Drop any section with
   nothing genuine to report.
3. Keep each section to a few tight bullets or a sentence or two — this is
   a signal, not a report.
4. Close with the headline takeaway and one concrete next action.
5. **Offer to save** the retro as
   `docs/retros/retro-N-YYYYMMDD-HHMM.md` (next free `N` — check
   the current max first — plus a UTC timestamp, which keeps two sessions
   finishing in parallel from picking the same `N` and overwriting each
   other). Ask the human; only write the file if they say yes. Writing it
   does not register the findings — that is the separate human-initiated
   loop in that folder's `README.md`.

## Sections

Cover these, in order, skipping any that are empty:

1. **Overview** — what got done, in 1–2 sentences.
2. **What I worked on** — the concrete work: the files/areas touched, the
   key changes made, and how they were verified. A few tight bullets, not a
   transcript — enough that a reader who wasn't in the session knows what
   landed. (Overview is the headline; this is the substance behind it.)
3. **Access/env issues** — blockers, workarounds, missing permissions or
   tools; how each was resolved or routed around.
4. **Input quality** — what was unclear, missing, or had to be inferred
   from the request, the codebase, or context.
5. **Misses & mistakes** — wrong assumptions, dead ends, course
   corrections. Be direct.
6. **Confidence flags** — anything you're unsure you got right, or that a
   human should double-check before relying on it.
7. **To document** — gotchas, decisions, or context worth capturing for
   next time. If something here belongs in memory or a `docs/` note, say
   so and let the human decide.

## Output format

```
Task retro — <one-line task name>

Overview: <1–2 sentences>

What I worked on:
  - <files/areas touched, key change, how verified>

Access/env issues:
  - <blocker / workaround>

Input quality:
  - <what was unclear or inferred>

Misses & mistakes:
  - <wrong assumption / dead end / correction>

Confidence flags:
  - <what to double-check>

To document:
  - <gotcha / decision worth keeping>

Headline: <one-line takeaway>
Next action: <one concrete improvement before the next similar task>
```

Omit any section heading whose body would be empty. Always keep the
`Headline` and `Next action` lines — they are the payload of the retro.

## Out of scope

- Fixing the code, committing, or writing files (report-only; §1 above).
  The one exception is saving the retro itself to `docs/retros/`,
  and only after the human accepts the offer (How to run, step 5).
- **Registering** the findings — folding them into memory, `CLAUDE.md`, a
  skill, or a GitHub issue. That is the separate human-initiated loop
  that follows the retro; saving the file is not it.
- Re-reviewing correctness, architecture or security — those belong to
  `code-review`, `security-review`, or
  the PR reviewer.
- A blow-by-blow narrative of the session. The retro is a distilled
  signal, not a transcript.
