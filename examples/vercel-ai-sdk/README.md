# Vercel AI SDK + Latch

Copy-paste pattern for [Vercel AI SDK](https://sdk.vercel.ai/) tool calling.

## Install

```bash
npm install agent-latch ai zod
```

## Copy-paste (wrap `execute`)

```ts
import { createLatch, groundFromUserMessage, latchTool, policies } from "agent-latch";
import { generateText, tool } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

const latch = createLatch();
policies(latch.gate, [
  {
    tool: "send_email",
    args: [{ path: "to", allow: ["user", "tool"] }],
  },
]);

export async function runAgent(userMessage: string, messageId: string) {
  // 1) Index what the user actually said (emails, etc.)
  groundFromUserMessage(latch.store, userMessage, messageId);

  const result = await generateText({
    model: openai("gpt-4o-mini"),
    prompt: userMessage,
    tools: {
      send_email: tool({
        description: "Send an email",
        parameters: z.object({
          to: z.string().email(),
          subject: z.string(),
        }),
        // 2) Latch wraps execute — model still sends plain JSON
        execute: latchTool(latch, "send_email", async ({ to, subject }) => {
          return sendEmail({ to, subject });
        }, {
          onDenied: (err) => ({
            error: "blocked_ungrounded_args",
            reason: err.message,
          }),
        }),
      }),
    },
  });

  // 3) Debug after the run
  console.log(latch.audit.print());
  return result;
}
```

## What happens

| Model sends | User said | Result |
|---|---|---|
| `to: "alice@acme.com"` | yes | ✅ allow (indexed/user) |
| `to: "board@acme.com"` | no | ❌ deny (model) |

The model never sees seals — only your `execute` path is gated.

## Runnable simulation (no API key)

This repo includes a local simulation of the same loop:

```bash
npm run example:ai-sdk
```

See [`agent.ts`](./agent.ts).

## CRM lookup → send

```ts
lookup_email: tool({
  parameters: z.object({ name: z.string() }),
  execute: latchTool(latch, "lookup_email", async ({ name }) => {
    const row = await crm.find(name);
    return sealFields(latch.store, "lookup_email", "c1", row, ["email"]);
  }),
}),
```

Only `send_email` needs a write policy. Lookup is read-only (no policy = bypass + audit).
