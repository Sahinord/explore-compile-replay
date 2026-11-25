# アダプターを書く

[English](../../../docs/adapter.md) · [简体中文](../../zh-CN/docs/adapter.md) · 日本語 · [Español](../../es/docs/adapter.md) · [Português](../../pt-BR/docs/adapter.md) · [Tiếng Việt](../../vi/docs/adapter.md) · [Türkçe](../../tr/docs/adapter.md)

アダプターは Explore-Compile-Replay を 1 種類のシステムにつなぎます。このページではアダプターの形と、その背景にある選択を説明します。正確な型は [`spec/contract.ts`](../../../spec/contract.ts)、データの形は [`spec/schema.ts`](../../../spec/schema.ts)、7 つの法則は [`spec/laws.md`](../../../spec/laws.md) にあります。

## 契約

アダプターは ECR を 1 種類のシステム（Web アプリ、モバイルアプリ、API）につなぎます。1 つの大きなインターフェースではなく、3 つの小さな部品です。

アダプターのおおよその姿です。npm にはまだ何も公開していません。

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

型のドラフトは [`spec/contract.ts`](../../../spec/contract.ts)、データの形は [`spec/schema.ts`](../../../spec/schema.ts) にあります。トレースの例は [`spec/examples/`](../../../spec/examples/) にあります。

## 設計上の選択

- **成果物は標準的なファイルです。** ECR を使うのをやめても、テストはそのまま動きます。
- **LLM のループは組み込みません。** 探索は、すでに使っているエージェントが MCP サーバーとスキルを通じて行います。ECR は記録し、検証し、コンパイルします。
- **コアは LLM SDK を決してインポートしません。** 再生が誤ってモデルを呼ぶことはありません。
- **チェック（オラクル）はデータです。** どのターゲットもそれを出力でき、修復はチェックを一つも削除していないことを証明できます。
- **バグもテストになります。** エージェントが問題を見つけると、本来成り立つべきチェックが失敗として記録されます。バグが直るまで赤のままのテストにコンパイルされます。
