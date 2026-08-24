# Launch kit — copy for HN / Twitter / 内推

## One-liner

**Your agent didn't pick the wrong tool — it invented the email.**

## Tweet (English)

> Agents rarely fail by picking the wrong tool. They fail by filling the *right* tool with a hallucinated email, ID, or path.
>
> We built `agent-latch`: wrap your tool `execute` — ungrounded args never run.
>
> 100 invented recipients → 0 escapes.
>
> npm install agent-latch

## Tweet (中文)

> Agent 很少是「调错工具」，而是「工具对了、参数是模型编的」。
>
> `agent-latch`：在 tool execute 前过 provenance 闸门，未接地参数直接拒跑。
>
> bench：100 个编造收件人 → 0 逃逸。
>
> npm install agent-latch

## HN title options

1. Show HN: Latch – block AI agents from calling tools with model-invented arguments
2. Show HN: A provenance gate for agent tool calls (plain JSON, Vercel AI SDK ready)

## HN body (short)

Most guardrails filter text. Latch seals **values**.

If `to`, `accountId`, or `path` did not come from the user or a verified tool, the call does not run. Works with plain JSON tool args (OpenAI / Anthropic / Vercel AI SDK): wrap `execute` with `latchTool`.

Bench: 100 model-invented emails → 0 sends with latch, 100 without.

MIT, ~500 LOC core. Looking for feedback on the provenance model and what sensitive fields you'd gate first.

## Demo commands (for posts)

```bash
git clone https://github.com/aarondai23/agent-latch
cd agent-latch && npm install
npm run demo:dropin    # before/after
npm run demo:audit     # why it was blocked
npm run example:ai-sdk # Vercel AI SDK pattern
npm run bench          # 100 → 0
```

## Screenshot text (terminal)

Run `npm run demo:dropin` and capture:

```
WITHOUT latch
Mailbox: [ { to: 'board@acme.com', ... } ]

WITH latch
Invented board@: { blocked: true, ... }
User-said alice@: { sent: true, ... }
```

## Who to send it to first

- Teams shipping agent write tools (email, CRM, billing, file delete)
- Vercel AI SDK / LangGraph builders hitting silent wrong-recipient bugs
- Security folks tired of text-only guardrails

## After publish checklist

- [ ] npm: `npm view agent-latch`
- [ ] GitHub: add topics `ai-agent`, `tool-use`, `provenance`, `safety`
- [ ] README badge: npm version (after first publish)
- [ ] Pin `examples/vercel-ai-sdk` in README
