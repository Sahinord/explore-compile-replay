# `ecr` コマンド

[English](../../../docs/command.md) · [简体中文](../../zh-CN/docs/command.md) · 日本語 · [Español](../../es/docs/command.md) · [Português](../../pt-BR/docs/command.md) · [Tiếng Việt](../../vi/docs/command.md) · [Türkçe](../../tr/docs/command.md)

ここにあるものはすべて、このリポジトリのクローンから、Node 22.18 以降と pnpm で動きます。コンパイルと再生はモデルを呼びません。

<a name="check-your-clone"></a>

## クローンを確認する

```sh
pnpm install
pnpm check        # types, schema, examples, links, tests, conformance
pnpm conformance  # the report alone
```

リファレンスアダプターのレポート：

```text
L1  Determinism   pass     same bytes on two compilations, same verdict on 3 replays (1 trace, 1 target)
L2  Fidelity      pass     recorded traces replay as observed, and an instrumented system receives their actions and oracles in order, and nothing else (1 trace, 1 target)
L3  Traceability  pass     every step has one range, inside the file, with no overlap (1 trace, 1 target)
L4  No model      partial  no artifact imports a known model SDK; this run did not have the network closed
L5  State         pass     state identical after restore (1 trace)
L6  Safe repair   partial  a new action for one step leaves the text of the other steps (4 patches); that a behaviour change comes back as a failed oracle is not checked yet
L7  No secret     pass     1 secret value searched in traces and artifacts, none found
```

"partial" と "skipped" は合格ではありません。キットがまだ証明できないこと、またはこの実行で証明できなかったことを示します。L4 はコマンドの周りでネットワークを遮断したときに合格します。CI はループバックだけを持つネットワーク名前空間で `pnpm conformance --network-closed` を実行します。

1 つの例で 3 つのステップを見るには、次の 2 つのファイルを並べて読んでください：

- 探索が記録したトレース：[`anna-first-item.trace.json`](../../../packages/adapter-fixture/examples/anna-first-item.trace.json)
- それがコンパイルされたテスト：[`anna-first-item.test.mjs`](../../../packages/adapter-fixture/examples/anna-first-item.test.mjs)。このプロジェクトから何もインポートせず、パラメーターの名前だけを持ち、値は決して持ちません。

モバイルアプリでも同じです：[トレース](../../../packages/adapter-maestro/examples/anna-first-item-mobile.trace.json)と、それがコンパイルされた [Maestro フロー](../../../packages/adapter-maestro/examples/anna-first-item-mobile.flow.yaml)。

デバイス上で、モデルなしで、mobile-agent-testers のデモアプリとそこに仕込まれたバグに対して：

```text
pass  tiny-todo-first-task (maestro, 61927 ms)
bug   tiny-todo-one-tasks (maestro, 65996 ms)
      oracle_failed  step search  oracle counter-singular: Assertion is false: "1 task" is visible
      This oracle was recorded as a bug, and the bug is still there. The steps after it did not run.
```

2 つ目のトレースはバグをチェックとして持っています。カウンターが "1 tasks" と表示するバグです。どちらのトレースも今のところ手書きで、[`packages/adapter-maestro/device`](../../../packages/adapter-maestro/device) にあります。

テストは、そのファイルをシステムの 2 つの変更版に対して再生します。新しい振る舞いは失敗したチェックとして返ってきます。移動した対象は、そのステップの `target_not_found` として返ってきます。

## 検証、コンパイル、再生

今のところこのリポジトリから実行します。コンパイルと再生はモデルを呼びません。

```sh
TRACE=packages/adapter-fixture/examples/anna-first-item.trace.json
ADAPTER=packages/adapter-fixture/src/index.ts

pnpm ecr validate $TRACE --adapter $ADAPTER          # schema, then the adapter's vocabularies
pnpm ecr compile $TRACE --adapter $ADAPTER --check   # is the compiled file up to date? For CI

export ECR_PARAM_ITEM_TITLE="Buy bread" ECR_PARAM_PRIVATE_NOTE="Door code 4821"
pnpm ecr replay $TRACE --adapter $ADAPTER            # pass  anna-first-item (node-test, 80 ms)
pnpm ecr conformance $TRACE --adapter $ADAPTER       # the report above, for any adapter
```

トレースはパラメーターの名前を保存します。値はテスト実行時に環境変数 `ECR_PARAM_<NAME>` から読まれます。

再生が安定しているかを見るには、何度か実行してすべての結果を残します：

```text
$ pnpm ecr replay $TRACE --adapter $ADAPTER --times 3 --report replays.json
pass  anna-first-item  replay 1 of 3 (81 ms)
pass  anna-first-item  replay 2 of 3 (62 ms)
pass  anna-first-item  replay 3 of 3 (60 ms)
      anna-first-item: 3 pass on 3 replays (node-test)
wrote  replays.json
```

レポートは、トレースごとにそのファイルとコンパイル済みファイルの SHA-256 を、再生ごとに結果、所要時間、止まった場所（種類、ステップ、チェック）を持ちます。システムのメッセージもパラメーターの値も含まないので、公開できます。

振る舞いが変わったシステムに対して再生すると、ステップとチェックを示して失敗します：

```text
$ pnpm ecr replay $TRACE --adapter packages/adapter-fixture/test/systems/drifted-adapter.ts
FAIL  anna-first-item (node-test, 95 ms)
      oracle_failed  step s1  oracle not-done-yet: Expected values to be strictly equal: true !== false
      A failed oracle is never repaired: it is a regression or an intended change, and a person decides.
```

## 範囲の決まった修復

項目をタイトルで見つけられなくなったシステムに対して再生すると、チェックではなくステップで壊れます：

```text
$ pnpm ecr replay $TRACE --adapter packages/adapter-fixture/test/systems/moved-adapter.ts
FAIL  anna-first-item (node-test, 92 ms)
      target_not_found  step s3: No item titled "Buy bread"
```

エージェントかあなたがシステムを見て、そのステップの別の操作を提案します。判断するのは `ecr repair` です。まず再生して、どのステップがずれたかを確かめます。それ以外のステップへのパッチは拒否します。パッチを当てたトレースをコンパイルし、ほかのステップのテキストが変わっていれば拒否します。それから再生し、すべてのチェックがトレースの記録どおりの結果になった場合だけ受け入れます。

```text
$ pnpm ecr repair $TRACE --adapter packages/adapter-fixture/test/systems/moved-adapter.ts --step s3 --action '{"kind":"toggleAt","index":0}'
repaired  anna-first-item  step s3 (node-test)
      was: target_not_found  step s3: No item titled "Buy bread"
```

パッチは 1 つのステップと 1 つの操作だけを持ちます。チェックを名指しする方法がないので、チェックを削除したり弱めたりできません。間違った項目にチェックを入れる（`"index": 1`）とステップは通りますが、チェック `done` が壊れ、拒否されます。そして再生がチェックで壊れたときは、何も受け入れられません：

```text
$ pnpm ecr repair $TRACE --adapter packages/adapter-fixture/test/systems/drifted-adapter.ts --step s1 --action '{"kind":"add","title":"x"}'
REFUSED  anna-first-item  step s1 (oracle_failed)
      Oracle not-done-yet failed. A failed oracle is never repaired: it is a regression or an intended change, and a person decides
```

<a name="a-bug-is-a-test-too"></a>

## バグもテストになる

探索するエージェントはバグを見つけます。レポートはそれを説明します。トレースはそれをチェックとして持てます。

チェック（オラクル）は何が成り立つべきかを示します。探索中にそれが偽だった場合は、`"observed": "failed"` として記録されます：

```json
{ "id": "not-done-yet", "check": { "kind": "done", "title": "Bread", "equals": false }, "observed": "failed" }
```

コンパイルされたファイルはほかのチェックと同じようにそれを確かめるので、バグが直るまでテストは赤のままです。誰でも実行できる再現手順です：[トレース](../../../packages/adapter-fixture/examples/anna-new-item-ticked.trace.json)、[テスト](../../../packages/adapter-fixture/examples/anna-new-item-ticked.test.mjs)。

`ecr replay` はトレースが何を記録したかを知っており、4 つの結果のいずれかを返します。コマンドを失敗させるのは `FAIL` だけです。

| 結果 | 意味 |
|---|---|
| `pass` | すべてのチェックが成り立つ。トレースはバグを記録していない |
| `bug` | 再生がトレースに記録されたバグで止まり、それ以外では止まらない。バグはまだある |
| `fixed` | バグとして記録されたチェックが今は成り立つ。`"observed": "failed"` を外すと、それはガードになる |
| `FAIL` | それ以外すべて：あるステップがずれた、または成り立っていたチェックが成り立たなくなった |

```text
$ pnpm ecr replay packages/adapter-fixture/examples/anna-new-item-ticked.trace.json --adapter packages/adapter-fixture/test/systems/buggy-adapter.ts
bug   anna-new-item-ticked (node-test, 90 ms)
      oracle_failed  step s1  oracle not-done-yet: Expected values to be strictly equal: true !== false
      This oracle was recorded as a bug, and the bug is still there. The steps after it did not run.
```

制限が 2 つあります。再生は最初のバグで止まるので、バグが直るまでトレースのそれ以降の部分は確かめられません。また、バグになれるのはステップのチェックポイントだけで、インバリアントは決してなれません。
