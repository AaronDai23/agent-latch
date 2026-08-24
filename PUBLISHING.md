# Publish checklist

## 1. GitHub (one-time)

```bash
gh auth login          # choose GitHub.com → HTTPS → Login with browser
gh repo create agent-latch --public --source=. --remote=origin --push
```

If the repo name is taken, use `agent-latch-ai` and update `packages/latch/package.json` repository URLs.

## 2. npm (one-time)

```bash
npm login              # use your npmjs.com account
npm whoami             # should print your username
```

## 3. Publish outcome package

```bash
npm run publish:receipt
```

Or from the package directory (most reliable):

```bash
cd packages/receipt
npm test && npm run build
npm publish --access public
```

Do **not** append shell comments on the same line — `# ...` can break npm.

## 4. Verify

```bash
npm view agent-outcome
npm view agent-latch
```

## Notes

- npm name **`latch`** is taken (unrelated encoding package). We publish as **`agent-latch`**.
- Brand stays **Latch** in docs; install command is `npm install agent-latch`.
- Companions (`agent-latch-saga`, etc.) can ship in v0.2 once hero gets traction.
