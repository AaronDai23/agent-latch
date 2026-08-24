# Publish checklist

## 1. npm (one-time)

```bash
npm login
npm whoami   # should print aarondai23
```

## 2. Commit & push first

Publish from a clean, pushed `main` so GitHub links in the package match the code.

```bash
git add packages/budget packages/approval examples/latch-approval-budget package.json package-lock.json README.md README.zh-CN.md
git commit -m "Add agent-latch-budget and agent-latch-approval companions."
git push origin main
```

## 3. Publish budget + approval

**Do not** put `# comments` on the same line as the publish command.

```bash
npm test
npm run publish:budget
npm run publish:approval
```

Or from each package (most reliable):

```bash
cd packages/budget
npm test && npm run build
npm publish --access public

cd ../approval
npm test && npm run build
npm publish --access public
```

If npm asks for 2FA:

```bash
npm publish --access public --otp=123456
```

## 4. Already published

```bash
npm run publish:hero      # agent-latch
npm run publish:receipt   # agent-outcome
```

## 5. Verify

```bash
npm view agent-latch-budget
npm view agent-latch-approval
npm view agent-latch
npm view agent-outcome
```

Install:

```bash
npm install agent-latch-budget agent-latch-approval
```

## Notes

- npm name **`latch`** is taken. Hero package is **`agent-latch`**.
- Companions ship as `agent-latch-*` (or `agent-outcome` for receipts).
- `prepublishOnly` runs tests + build before each publish.
