# Instructions for Claude — Selvi Fireworks website

## Start of every session (do this first, before anything else)
1. Read `CONTEXT.md` (project facts and decisions) and `HANDOFF.md` (where the last session stopped).
2. Continue from `HANDOFF.md` → "Next steps". Do NOT scan or search the whole project to re-learn it;
   the file map in `CONTEXT.md` says where things are. Open only the files the task needs.

## Keep the notes up to date (saves tokens in the next session)
- Update `HANDOFF.md` when a task or milestone is finished, before a long session ends, and whenever the
  conversation has grown long (roughly every ~300k tokens). Keep it short: current state, what changed, next steps, open questions.
- When the user makes a decision that future sessions must respect, add it to `CONTEXT.md` (one line, dated).
- `CONTEXT.md` and `HANDOFF.md` are local notes: they are in `.gitignore` and must never be committed or pushed.

## How to work on this project
- Static site: plain HTML + CSS + vanilla JS. No framework, no build step. Do not add frameworks or npm to the site.
- Dark mode is final and must not change. All light-mode styling goes in `assets/css/light.css`
  (every rule scoped `[data-theme="light"]`). All phone/tablet fixes go in `assets/css/mobile.css` (loaded last).
- After editing a CSS/JS file, bump its `?v=N` in the `<link>`/`<script>` tags of the pages that use it (browser cache).
- Check visual changes in a real browser before saying they are done (headless Edge; see CONTEXT.md → Testing).
- Use only the colours already in use (gold/black for dark; white/yellow #FFD700/orange #FFA500/black for light; blue nowhere).
- Never invent business facts (licence numbers, prices, phone numbers, social links). Ask the user.
- Keep test scripts and screenshots in the session scratchpad, never in the project.
- Reply to the user in simple English; they are not a developer. Be concise.

## Saving tokens: hard decisions go to Opus (2-session method)
- Do the normal coding work in this (Sonnet) session. Do NOT re-read the whole project to make a big decision.
- When a decision is genuinely hard (architecture, security, a bug not solved after 2 tries), stop and write the user a SHORT note
  for an Opus session: the question, what was tried, the 2-3 options. The user pastes it into Opus and brings the answer back.
- Keep that note under ~15 lines. Never paste whole files into it; name the file and line instead.
