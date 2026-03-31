---
name: axe-accessibility
description: Run and interpret axe-core accessibility audits for websites and web apps. Use when the user wants WCAG-focused issue finding, remediation guidance, or accessibility regression checks.
---

# Axe Accessibility

## Overview

Use this skill when the user wants an accessibility audit, ADA/WCAG issue summary, or concrete remediation guidance for a website or web application.

This skill is optimized for live URLs first. For static sites, prefer testing the deployed page unless the user explicitly asks for local-only analysis.

## When To Use

Use this skill when the request includes any of the following:

- ADA or accessibility review
- WCAG issue detection
- keyboard, screen-reader, focus, contrast, landmark, heading, or form-label problems
- accessibility regression checking after a UI change
- page-level audits for one or more URLs

Do not treat axe results as full compliance certification. Axe is strong for automated detection, but manual review is still required for keyboard behavior, reading order, meaningful alt text quality, and task completion flows.

## Primary Workflow

1. Identify the target URL or URLs.
2. Prefer the production or preview URL over raw source files.
3. Check whether `axe` is already available:

```bash
axe --version
```

4. If not available, prefer an ephemeral run through `npx`:

```bash
npx @axe-core/cli --version
```

5. Run axe against the page and capture machine-readable output when possible:

```bash
npx @axe-core/cli https://example.com --save axe-results.json
```

6. Summarize the findings by severity and impact, then translate them into concrete code fixes.
7. Call out what axe cannot verify automatically and recommend manual follow-up checks.

## Result Interpretation

Prioritize findings in this order:

- blockers that prevent keyboard or screen-reader use
- missing names, labels, or roles on interactive controls
- focus visibility and focus order problems
- form errors, status messaging, and validation announcements
- landmark, heading, and document-structure issues
- color contrast and visual-only cues

When reporting results, include:

- the affected URL
- the rule or issue category
- the user impact in plain language
- the likely HTML/CSS/JS fix
- whether the issue should be fixed in shared components or page-specific markup

## Output Pattern

Use a concise structure like:

- `Critical`: issues that block or seriously impair access
- `Important`: issues that create significant friction
- `Minor`: lower-risk cleanup items
- `Manual review still needed`: checks axe cannot conclusively verify

For each issue, prefer a fix-oriented explanation over a raw dump of selectors.

## Recommendations For This Repo Type

For static pages and CDN-hosted assets:

- audit the live page URL that consumes the shared JS/CSS
- if the problem comes from a shared map or control pattern, fix the shared asset rather than patching one page only
- pay extra attention to map controls, icon-only buttons, popups, focus management, and reduced-motion behavior

## Common Fix Areas

- icon buttons missing accessible names
- custom controls not reachable by keyboard
- dialogs or popups without focus management
- insufficient color contrast in overlays or badges
- missing form labels, descriptions, or error associations
- heading order skipping levels
- landmarks missing or duplicated ambiguously
- status text not announced to assistive tech

## Manual Review Checklist

After automated results, manually verify:

- full keyboard-only navigation
- visible focus on every interactive element
- escape and close behavior for dialogs and popups
- map interactions without requiring drag-only gestures
- screen-reader names for buttons, links, and form controls
- instructions that do not rely on color alone

## Notes

- `axe-core` supports WCAG 2.0, 2.1, and 2.2 rules plus best-practice checks.
- Automated coverage is partial; Deque notes that manual review is still needed for incomplete and non-automatable issues.
- If `npx` or browser dependencies are blocked, explain the blocker briefly and suggest either installing `@axe-core/cli` or auditing a live URL from an environment where the CLI can run.
