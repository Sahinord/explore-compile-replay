# 编写适配器

[English](../../../docs/adapter.md) · 简体中文 · [日本語](../../ja/docs/adapter.md) · [Español](../../es/docs/adapter.md) · [Português](../../pt-BR/docs/adapter.md) · [Tiếng Việt](../../vi/docs/adapter.md) · [Türkçe](../../tr/docs/adapter.md)

适配器把 Explore-Compile-Replay 连接到一类系统。本页介绍适配器的形状以及背后的选择。确切的类型在 [`spec/contract.ts`](../../../spec/contract.ts)，数据结构在 [`spec/schema.ts`](../../../spec/schema.ts)，七条定律在 [`spec/laws.md`](../../../spec/laws.md)。

## 契约

适配器把 ECR 连接到一类系统：Web 应用、移动应用、API。它由三个小部分组成，而不是一个庞大的接口。

下面是适配器大致的样子。npm 上还没有发布任何东西。

```ts
import { defineAdapter } from "explore-compile-replay";

export default defineAdapter({
  id: "my-system",

  // 1. Two typed vocabularies: what an agent may do, what a test may check.
  actions, // e.g. tap, type, navigate
  oracles, // e.g. visible, equals. Deterministic checks, stored as data.

  // 2. A driver for the live system. Used to explore and to repair, never to replay.
  driver: {
    capabilities: { snapshot: true },
    setup, teardown,
    observe, // the state, and whether it is stable yet
    execute, // one action
    verify,  // one oracle, with no model call
    snapshot, restore,
  },

  // 3. One target per artifact format. It compiles, then runs the native tool.
  targets: [
    {
      id: "playwright",
      compile, // pure: trace in, file and source map out
      replay,  // runs the file, reports typed divergences
    },
  ],
});
```

类型草案在 [`spec/contract.ts`](../../../spec/contract.ts)，数据结构在 [`spec/schema.ts`](../../../spec/schema.ts)。示例轨迹在 [`spec/examples/`](../../../spec/examples/)。

## 设计选择

- **产物是一个标准文件。** 即使你不再使用 ECR，你的测试照样能运行。
- **没有内置的 LLM 循环。** 探索由你已经在用的智能体完成，通过 MCP 服务器和技能。ECR 负责记录、校验和编译。
- **核心永远不会导入 LLM SDK。** 重放不可能意外调用模型。
- **检查是数据。** 每个目标都能输出它们，修复可以证明自己没有删掉任何检查。
- **bug 也是一种测试。** 当智能体发现问题时，本应成立的检查被记录为失败。它会编译成一个在 bug 修复之前一直失败的测试。
