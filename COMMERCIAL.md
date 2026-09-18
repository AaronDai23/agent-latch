# Latch Commercial Model

This is a draft commercialization boundary for `agent-latch` and `agent-outcome`.

## Core thesis

Open source is the distribution and trust layer. Revenue should come from **production controls around the libraries**, not from trying to charge for the core TypeScript packages themselves.

The free packages prove:

- dangerous tool args can be blocked before execution
- fake tool success can be rejected after execution
- teams can adopt the primitives locally without vendor lock-in

The paid product should answer the next question:

> How does an organization manage provenance, outcome verification, budget, and audit across many agents and teams?

## Product boundary

### Keep open source

These belong in MIT packages because they drive adoption and credibility:

- `agent-latch` core provenance primitives
- `agent-outcome` core receipt and reconcile primitives
- local in-process logs and examples
- framework adapters and starter integrations
- benchmarks, demos, and reference implementations

### Sell as Pro / Enterprise

These are organizational features, not library features:

- hosted policy registry
- shared dashboards for deny / verify-failed events
- managed reconcile workers and webhook handling
- alerts to Slack / PagerDuty
- budget caps by tenant, tool, or workflow
- role-based approvals for dangerous flows
- SSO, RBAC, audit export, tenant isolation
- vertical policy packs for fintech / health / support
- rollout simulation and policy diffing

## Packaging

### Free

Use case: individual developers and small teams evaluating reliability patterns.

Includes:

- local provenance enforcement
- local outcome verification
- examples and docs

Price: `$0`

Goal: maximize adoption, trust, and incident-driven discovery.

### Pro

Use case: small teams already running agents in production with mutating tools.

Includes:

- shared policy management
- hosted audit views
- alerting
- basic budget controls
- managed reconcile jobs

Price target: `$99-299/mo`

Metering options:

- active agents
- protected workflows
- monthly mutating tool calls

### Enterprise

Use case: security, platform, and compliance buyers.

Includes:

- SSO / RBAC / audit export
- environment separation
- approval workflows
- compliance packs
- policy rollout simulation
- premium support

Price target: `$2k-20k+/yr`

The upper bound depends more on risk reduction and compliance burden than on raw API volume.

## Fastest route to first revenue

Before building SaaS, sell integration help.

Example offers:

- 1-week provenance audit of an existing agent workflow
- 2-week integration package for `agent-latch` + `agent-outcome`
- custom policy design for CRM, billing, or support flows

Why this works:

- teams with agent write tools already feel the pain
- the buyer values expertise more than polish at the start
- services conversations reveal what the paid control plane should be

## What not to rely on

- npm downloads alone
- GitHub stars alone
- generic "better observability for agents" positioning
- shipping all companion packages before there is demand

## Recommended sequence

### Now

- push `agent-latch` and `agent-outcome` as the public wedge
- collect concrete failure stories from users
- offer integration help manually

### Next

Build one paid wedge only:

1. `Budget Enforcer`, or
2. vertical policy packs

Do not build both at once.

### Later

After design partners exist, add one hosted control-plane feature:

- hosted audit dashboard, or
- managed reconcile service

Again, choose one first.

## Positioning line

`agent-latch` and `agent-outcome` are not just guardrails. They are the enforcement layer for mutating agent tools in production.

## Simple pricing page draft

### Free

For local development and self-hosted reliability primitives.

### Pro

For teams that need shared policy, alerting, and managed verification workflows.

### Enterprise

For organizations that need governance, compliance evidence, and centralized control.

---

## 对外话术：能承诺 / 不能承诺

Use this when selling, posting, or answering “真的能解决问题吗？”

### 一句话定位

> 我们给 AI agent 的**写工具**加硬闸门：不满足条件就不能执行。  
> 用来降低生产事故，不是让模型永远正确。

English:

> Hard gates on agent **write tools**: if the check fails, the call does not run.  
> We reduce production incidents — we do not make the model infallible.

### 能承诺

| 问题 | 包 | 前提 |
|---|---|---|
| 未接地的敏感参数被拦下 | `agent-latch` | 写路径已 wrap |
| 假成功不能当成功 | `agent-outcome` | 配置了 verify |
| 超预算 / 超次数强制停 | `agent-latch-budget` | 配置了 limits |
| 人批 A、执行 B 被拒 | `agent-latch-approval` | 审批流已接入 |
| 同意图重试不二次副作用 | `agent-latch-idempotency` | 持久化 store + 下游 key + reconcile |
| 放行/拒绝可审计 | 全部 | 使用 audit / log |

Copy-paste (中文):

```text
能解决的是 agent 写真实世界时的执行失控：
编参数、假成功、烧钱、审批漂移、重试双花。

不解决的是：模型理解错、业务规则错、数据源本身错。
目标是：危险写操作在代码层被拦住，把生产事故半径压小。
```

Copy-paste (English):

```text
We solve execution-layer failures for agent write tools:
invented args, fake success, runaway cost, approval drift, retry double-spend.

We do not solve: wrong user intent, wrong business rules, bad source data.
Goal: block dangerous writes in code, not “make AI never wrong.”
```

### 不能承诺

1. **不保证模型理解对用户意图** — 用户说错、确认错，闸门不会读心。
2. **不保证数据源正确** — CRM 里就是错地址且来源合法，仍可能放行。
3. **不保证绕过 wrap 后仍安全** — 未接入 gate 的工具路径不在保护范围内。
4. **不保证“再用一个 AI 检查”等价** — 我们是代码层拒跑，不是再猜一次。
5. **不保证“装上 = 金融级 exactly-once”** — 幂等需持久化 + 下游 key + reconcile，缺一不可。
6. **不替代合规认证 / 权限系统 / 支付风控** — 我们是写路径上的保险丝，不是全公司安全底座。

### 客户问“真能解决问题吗？”

```text
能解决的是执行层事故，不是认知层错误。

如果你的 agent 会发信、退款、改数据，
这些闸门可以明显降低“不该执行却执行了”的概率。

如果你期望“装上以后 AI 就不会错”，
那不是这个产品，我们也不会这么承诺。
```

### 销售红线（别说满）

| 别说 | 改成 |
|---|---|
| 保证不双花 | 在持久化 + 下游 key + 对账齐全时，可防止同意图二次副作用 |
| 杜绝幻觉 | 拦截未接地敏感参数进入写工具 |
| 替代人工审批 | 让人审批绑定真实 payload，防止批 A 执行 B |
| 企业级一键合规 | 提供可审计的写路径闸门；需接入你的工具与存储 |
| AI 永远不会错 | 降低写操作生产事故；不解决语义/业务判断错误 |

### 免费 20 分钟检查（获客用）

```text
我可以免费帮你看 20 分钟：你们会改真实世界的 agent 工具，
哪里有生产事故风险，缺哪道闸门（血统 / 副作用 / 预算 / 审批 / 幂等）。

邮件：13794872595@163.com（注明：agent 写工具检查）
```

