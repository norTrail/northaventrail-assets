# Axe Commands

## Quick Checks

Check whether axe is installed:

```bash
axe --version
```

Use an ephemeral package run:

```bash
npx @axe-core/cli --version
```

Audit one page and save results:

```bash
npx @axe-core/cli https://example.com --save axe-results.json
```

Audit multiple pages one at a time and summarize patterns instead of dumping raw JSON.

## Reporting Guidance

Prefer a short summary that answers:

- What is broken?
- Who is affected?
- What should we change in code?
- What still needs manual verification?
