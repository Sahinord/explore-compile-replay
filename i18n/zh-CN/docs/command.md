# `ecr` 命令

[English](../../../docs/command.md) · 简体中文 · [日本語](../../ja/docs/command.md) · [Español](../../es/docs/command.md) · [Português](../../pt-BR/docs/command.md) · [Tiếng Việt](../../vi/docs/command.md) · [Türkçe](../../tr/docs/command.md)

这里的一切都从本仓库的克隆运行，需要 Node 22.18 或更高版本以及 pnpm。编译和重放都不调用模型。

<a name="check-your-clone"></a>

## 检查你的克隆

```sh
pnpm install
pnpm check        # types, schema, examples, links, tests, conformance
pnpm conformance  # the report alone
```

参考适配器的报告：

```text
L1  Determinism   pass     same bytes on two compilations, same verdict on 3 replays (1 trace, 1 target)
L2  Fidelity      pass     recorded traces replay as observed, and an instrumented system receives their actions and oracles in order, and nothing else (1 trace, 1 target)
L3  Traceability  pass     every step has one range, inside the file, with no overlap (1 trace, 1 target)
L4  No model      partial  no artifact imports a known model SDK; this run did not have the network closed
L5  State         pass     state identical after restore (1 trace)
L6  Safe repair   partial  a new action for one step leaves the text of the other steps (4 patches); that a behaviour change comes back as a failed oracle is not checked yet
L7  No secret     pass     1 secret value searched in traces and artifacts, none found
```

"partial" 和 "skipped" 都不算通过。它们标出套件还无法证明、或在这次运行中没能证明的部分。在命令周围断开网络时 L4 才算通过：CI 在一个只有回环接口的网络命名空间里运行 `pnpm conformance --network-closed`。

想在一个例子上看清这三步，把下面两个文件并排阅读：

- 一次探索记录下的轨迹：[`anna-first-item.trace.json`](../../../packages/adapter-fixture/examples/anna-first-item.trace.json)
- 它编译出的测试：[`anna-first-item.test.mjs`](../../../packages/adapter-fixture/examples/anna-first-item.test.mjs)。它不从本项目导入任何东西，只保存参数的名称，从不保存参数的值。

移动应用也一样：[一份轨迹](../../../packages/adapter-maestro/examples/anna-first-item-mobile.trace.json)和它编译出的 [Maestro flow](../../../packages/adapter-maestro/examples/anna-first-item-mobile.flow.yaml)。

在设备上、不用模型，针对 mobile-agent-testers 的演示应用及其预埋的 bug：

```text
pass  tiny-todo-first-task (maestro, 61927 ms)
bug   tiny-todo-one-tasks (maestro, 65996 ms)
      oracle_failed  step search  oracle counter-singular: Assertion is false: "1 task" is visible
      This oracle was recorded as a bug, and the bug is still there. The steps after it did not run.
```

第二份轨迹把一个 bug 记录为检查：计数器显示 "1 tasks"。这两份轨迹目前都是手写的，在 [`packages/adapter-maestro/device`](../../../packages/adapter-maestro/device)。

测试会针对系统的两个修改版本重放这个文件。新的行为会以检查失败的形式出现。移动了位置的目标会在它的那一步以 `target_not_found` 出现。

## 校验、编译、重放

目前它从本仓库运行。编译和重放都不调用模型。

```sh
TRACE=packages/adapter-fixture/examples/anna-first-item.trace.json
ADAPTER=packages/adapter-fixture/src/index.ts

pnpm ecr validate $TRACE --adapter $ADAPTER          # schema, then the adapter's vocabularies
pnpm ecr compile $TRACE --adapter $ADAPTER --check   # is the compiled file up to date? For CI

export ECR_PARAM_ITEM_TITLE="Buy bread" ECR_PARAM_PRIVATE_NOTE="Door code 4821"
pnpm ecr replay $TRACE --adapter $ADAPTER            # pass  anna-first-item (node-test, 80 ms)
pnpm ecr conformance $TRACE --adapter $ADAPTER       # the report above, for any adapter
```

轨迹保存参数的名称。测试运行时，参数的值从环境变量 `ECR_PARAM_<NAME>` 中读取。

想知道重放是否稳定，就运行多次并保留每一次的结果：

```text
$ pnpm ecr replay $TRACE --adapter $ADAPTER --times 3 --report replays.json
pass  anna-first-item  replay 1 of 3 (81 ms)
pass  anna-first-item  replay 2 of 3 (62 ms)
pass  anna-first-item  replay 3 of 3 (60 ms)
      anna-first-item: 3 pass on 3 replays (node-test)
wrote  replays.json
```

报告为每份轨迹保存它的文件和编译出的文件的 SHA-256，为每次重放保存结果、耗时以及停下的位置：类型、步骤、检查。报告不包含系统的任何消息，也不包含任何参数值，所以可以公开。

把重放指向一个行为已经改变的系统，它会失败，并指出步骤和检查：

```text
$ pnpm ecr replay $TRACE --adapter packages/adapter-fixture/test/systems/drifted-adapter.ts
FAIL  anna-first-item (node-test, 95 ms)
      oracle_failed  step s1  oracle not-done-yet: Expected values to be strictly equal: true !== false
      A failed oracle is never repaired: it is a regression or an intended change, and a person decides.
```

## 有边界的修复

把重放指向一个已经无法按标题找到某个条目的系统，它会在某一步中断，而不是在某个检查上：

```text
$ pnpm ecr replay $TRACE --adapter packages/adapter-fixture/test/systems/moved-adapter.ts
FAIL  anna-first-item (node-test, 92 ms)
      target_not_found  step s3: No item titled "Buy bread"
```

由智能体或你自己查看系统，为这一步提出另一个操作。由 `ecr repair` 来决定。它先重放一次，确定是哪一步出现偏差。它拒绝针对其他任何一步的补丁。它编译打过补丁的轨迹，如果其他步骤的文本有变化就拒绝。然后它重放，只有当每个检查的结果都与轨迹记录的一致时才接受。

```text
$ pnpm ecr repair $TRACE --adapter packages/adapter-fixture/test/systems/moved-adapter.ts --step s3 --action '{"kind":"toggleAt","index":0}'
repaired  anna-first-item  step s3 (node-test)
      was: target_not_found  step s3: No item titled "Buy bread"
```

一个补丁只包含一步和一个操作。它无法删除或削弱任何检查，因为它根本没有办法指名某个检查。勾选错误的条目（`"index": 1`）可以通过这一步，但会让检查 `done` 失败，于是被拒绝。而当重放在某个检查上中断时，什么都不会被接受：

```text
$ pnpm ecr repair $TRACE --adapter packages/adapter-fixture/test/systems/drifted-adapter.ts --step s1 --action '{"kind":"add","title":"x"}'
REFUSED  anna-first-item  step s1 (oracle_failed)
      Oracle not-done-yet failed. A failed oracle is never repaired: it is a regression or an intended change, and a person decides
```

<a name="a-bug-is-a-test-too"></a>

## bug 也是一种测试

进行探索的智能体会发现 bug。报告描述它们。轨迹可以把它们保存为检查。

检查（oracle）说明什么应当成立。如果它在探索时是假的，就以 `"observed": "failed"` 记录：

```json
{ "id": "not-done-yet", "check": { "kind": "done", "title": "Bread", "equals": false }, "observed": "failed" }
```

编译出的文件像对待其他检查一样检查它，所以测试会一直失败，直到 bug 被修复。这是一份任何人都能运行的复现：[轨迹](../../../packages/adapter-fixture/examples/anna-new-item-ticked.trace.json)、[测试](../../../packages/adapter-fixture/examples/anna-new-item-ticked.test.mjs)。

`ecr replay` 知道轨迹记录了什么，并给出四种结果之一。只有 `FAIL` 会让命令失败。

| 结果 | 含义 |
|---|---|
| `pass` | 所有检查都成立。轨迹没有记录 bug |
| `bug` | 重放停在轨迹记录的那个 bug 上，并且只停在那里。bug 仍然存在 |
| `fixed` | 曾被记录为 bug 的检查现在成立了。去掉 `"observed": "failed"`，它就变成一道防线 |
| `FAIL` | 其他任何情况：某一步出现偏差，或者一个原本成立的检查不再成立 |

```text
$ pnpm ecr replay packages/adapter-fixture/examples/anna-new-item-ticked.trace.json --adapter packages/adapter-fixture/test/systems/buggy-adapter.ts
bug   anna-new-item-ticked (node-test, 90 ms)
      oracle_failed  step s1  oracle not-done-yet: Expected values to be strictly equal: true !== false
      This oracle was recorded as a bug, and the bug is still there. The steps after it did not run.
```

两个限制。重放会停在第一个 bug 上，所以在 bug 修复之前，轨迹中它之后的部分都不会被检查。另外，只有某一步的检查点可以是 bug，不变量（invariant）永远不能是。
