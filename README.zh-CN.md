# Latch

> 中文说明。英文主文档见 [README.md](./README.md)。

**npm 包名**：`agent-latch`（`latch` 已被占用）、`agent-outcome`（副作用校验）

```bash
npm install agent-latch agent-outcome
npm run demo -w agent-latch
npm run demo:receipt
npm run example:receipt   # latch + outcome 联调
npm run bench -w agent-latch
```

Companion：`budget` / `approval` / `idempotency` / `saga` / `continuity` / `witness`

写工具闸门叠放顺序见 [`docs/COMPOSE.md`](./docs/COMPOSE.md)。

```bash
npm run demo:budget
npm run demo:approval
npm run demo:idempotency
npm run demo:saga
npm run example:gates       # latch + approval + budget
npm run example:compose     # 五闸门全栈
npm run example:langgraph   # checkpoint 重派发防双花
```
