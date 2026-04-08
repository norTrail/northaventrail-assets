---
name: versioned-release
description: Create a cache-busted versioned copy of a JS or CSS file when making breaking changes. Use when changing filename versions (e.g. v2026 → v2027).
user-invocable: true
allowed-tools: "Read Glob Grep Write Edit Bash"
---

# Versioned Asset Release

Files on assets.northaventrail.org are cached 1 year immutable by Cloudflare. Breaking changes **require a new versioned filename** — never overwrite an existing versioned file.

## Process

1. **Identify the file** — confirm which file needs a new version (e.g. `tails-ui.v2026.js` → `tails-ui.v2027.js`).

2. **Read the current file** — understand what's changing and why the change is breaking.

3. **Create the new versioned file** — copy content, apply changes, use the new filename.

4. **Find all references** — search for the old filename across the codebase:
   ```
   grep -r "tails-ui.v2026" .
   ```
   Cross-reference the File Map in CLAUDE.md to know which pages are affected.

5. **Update references** — update any JS/CSS imports or `<script>`/`<link>` tags pointing to the old version.

6. **Verify** — confirm the old versioned file still exists (for existing cached users), and the new file is correct.

7. **Commit and push** — Cloudflare Pages auto-deploys on push to GitHub.

## Verification Required

- [ ] New file exists with correct filename
- [ ] Old file untouched (do NOT delete it)
- [ ] All references updated to new version
- [ ] No console errors expected from the change
- [ ] CLAUDE.md File Map is still accurate (update if needed)

## Common Excuses — Reject These

- "I'll just update the existing file" — No. Files are immutable-cached for 1 year.
- "I only changed a comment, it's not really breaking" — If you changed the file, new users get it but cached users don't. Version it if behavior changes.
- "I can't find all the references" — Use Grep on the full repo. Check CLAUDE.md File Map.

## Red Flags

- Deleting or renaming the old versioned file
- Updating more than one version bump at a time without explicit instruction
- Touching JSON data files (trail-poi.latest.json, sheep-locations, etc.) — those are GAS-generated
