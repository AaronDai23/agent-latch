# Create GitHub Release v0.1.3

After npm publish succeeds:

```bash
# 1. Push commits + tag
git push origin main
git tag v0.1.3
git push origin v0.1.3

# 2. Create release (paste body from RELEASE_v0.1.3.md)
gh release create v0.1.3 \
  --title "v0.1.3 — Provenance gate for agent tool args" \
  --notes-file .github/RELEASE_v0.1.3.md
```

Or on GitHub: **Releases → Draft new release** → tag `v0.1.3` → paste `.github/RELEASE_v0.1.3.md`.

## Screenshot for README / social

Clean terminal output (no npm warnings):

```bash
npm run demo:screenshot
```

Recommended: record terminal at 80×24 cols, dark theme, font JetBrains Mono / SF Mono.

Suggested filename: `docs/demo-screenshot.png` (committed in repo)

## Attach to release (optional)

- Terminal screenshot from `demo:screenshot`
- Link to npm: https://www.npmjs.com/package/agent-latch
