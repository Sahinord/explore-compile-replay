# 目前已有的部分

[English](../../../docs/status.md) · 简体中文 · [日本語](../../ja/docs/status.md) · [Español](../../es/docs/status.md) · [Português](../../pt-BR/docs/status.md) · [Tiếng Việt](../../vi/docs/status.md) · [Türkçe](../../tr/docs/status.md)

逐个部分列出：哪些是草案，哪些还没开始。随代码一起更新。

| 部分 | 状态 |
|---|---|
| 轨迹模式，[`spec/schema.ts`](../../../spec/schema.ts) | 草案。通过类型检查，附有一个经过校验的示例和一份生成的 [JSON Schema](../../../spec/trace.schema.json)。一步可以带有证据（截图、手指落下的位置），供展示轨迹的工具使用 |
| 适配器契约，[`spec/contract.ts`](../../../spec/contract.ts) | 草案。通过类型检查 |
| 七条定律，[`spec/laws.md`](../../../spec/laws.md) | 草案 |
| 核心，[`packages/core`](../../../packages/core/src/index.ts) | 第一部分：通过驱动记录轨迹、校验、计算哈希、解析参数、检查源码映射、区分已记录的 bug 和回归 |
| `ecr` 命令，[`packages/cli`](../../../packages/cli/src/run.ts) | 从本仓库运行：`validate`、`compile`、`replay`、`repair`、`conformance`。还没有发布到 npm。见[命令说明](command.md) |
| MCP 服务器，供智能体探索 | 尚未开始。欢迎贡献：[CONTRIBUTING.md](../../../CONTRIBUTING.md) |
| 参考适配器，[`packages/adapter-fixture`](../../../packages/adapter-fixture/src/adapter.ts) | 可以运行。一个内存中的待办清单，编译为普通的 `node:test` 文件 |
| 一致性套件，[`packages/conformance`](../../../packages/conformance/src/index.ts) | 检查 L1、L2、L3、L4（断网时）、L5 和 L7，以及 L6 的一部分 |
| 修复，[`packages/core`](../../../packages/core/src/repair.ts) | 第一部分：`ecr repair` 对出现偏差的那一步接受或拒绝一个新操作。它不调用模型，自己也不提出任何方案。只在参考适配器上试过，还没在设备上试过 |
| 移动适配器，[`packages/adapter-maestro`](../../../packages/adapter-maestro/README.md) | 草案。一套移动端词汇和一个编译为 [Maestro](https://maestro.dev) flow 的编译器。在 Android 模拟器上针对 mobile-agent-testers 的演示应用：两个手写的 flow 在一个[手动启动的运行](../../../.github/workflows/device.yml)中重放；智能体探索的四条路径中，两条停在某一步，另外两条（37 步和 25 步）在没有模型的情况下完整重放。失败时会指出它的步骤或检查。没有驱动。没在 iOS 上试过。在正在试验的真实应用 LocalSend 上，一条智能体路径（8 步）和一个无模型机器人的 24 条路径中的 20 条完整重放 |
| Web 适配器，编译为 Playwright 测试 | 尚未开始。欢迎贡献：[CONTRIBUTING.md](../../../CONTRIBUTING.md) |
| 漂移基准：重放在应该中断、修复或保持失败时，是否真的如此？ | 尚未运行。它的协议先写好了：[`paper/protocol.md`](../../../paper/protocol.md) |
| 论文 | 正在撰写。尚无测量结果。预印本将随第一个版本发布在 Zenodo 上 |
