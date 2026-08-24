# Ready-to-post — attach `docs/demo-screenshot.png`

## Twitter / X (single post, English)

```
Your agent didn't pick the wrong tool — it invented the email.

Most guardrails filter text. agent-latch seals values: if the recipient/ID/path didn't come from the user or a verified tool, the call doesn't run.

100 invented recipients → 0 escapes.

npm install agent-latch
https://github.com/aarondai23/agent-latch
```

**Attach:** `docs/demo-screenshot.png`

---

## Twitter / X (thread, English)

**1/4**
```
Your agent didn't pick the wrong tool — it invented the email.

We kept seeing the same failure: send_email(to: "board@acme.com") — never mentioned by the user, always confident, sometimes catastrophic.

Text guardrails don't catch this. So we built a provenance gate.
```

**2/4** + screenshot
```
agent-latch wraps your tool execute (OpenAI, Anthropic, Vercel AI SDK).

Sensitive args must trace to user or tool origin. Model-invented plain JSON → blocked.

Without latch: board@ sent ✗
With latch:    board@ blocked ✓, alice@ allowed ✓
```

**3/4**
```
Bench: 100 invented recipients
• without latch → 100 sends
• with latch    → 0 sends

MIT, ~500 LOC, no framework lock-in.

npm install agent-latch
```

**4/4**
```
Looking for feedback:
• Which fields would you gate first? (to, accountId, path…)
• LangGraph / Mastra adapters?

https://github.com/aarondai23/agent-latch
```

---

## 即刻发（中文单条）

```
Agent 很少是「调错工具」，而是「工具对了、参数是模型编的」。

agent-latch：敏感参数必须有 user/tool 血统，否则拒跑。
100 个编造收件人 → 0 逃逸。

npm install agent-latch
https://github.com/aarondai23/agent-latch
```

**配图：** `docs/demo-screenshot.png`

---

## LinkedIn (English, short)

Agents rarely fail by picking the wrong tool. They fail by filling the *right* tool with a hallucinated email, ID, or path.

We open-sourced **agent-latch** — a provenance gate for tool calls. Wrap your `execute`; ungrounded sensitive args never run. Works with plain JSON tool args and Vercel AI SDK.

Bench: 100 invented recipients → 0 escapes. MIT.

Try it: https://github.com/aarondai23/agent-latch

---

## Hacker News

**Title:** Show HN: agent-latch – block AI agents from calling tools with model-invented arguments

**URL:** https://github.com/aarondai23/agent-latch

**Body:** use `.github/RELEASE_v0.1.3.md` (first 3 paragraphs)

---

## GitHub Release

Attach `docs/demo-screenshot.png` as release asset when creating v0.1.3.
