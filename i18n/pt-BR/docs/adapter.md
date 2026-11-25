# Escrever um adaptador

[English](../../../docs/adapter.md) · [简体中文](../../zh-CN/docs/adapter.md) · [日本語](../../ja/docs/adapter.md) · [Español](../../es/docs/adapter.md) · Português · [Tiếng Việt](../../vi/docs/adapter.md) · [Türkçe](../../tr/docs/adapter.md)

Um adaptador conecta o Explore-Compile-Replay a um tipo de sistema. Esta página mostra a forma de um adaptador e as escolhas por trás dele. Os tipos exatos estão em [`spec/contract.ts`](../../../spec/contract.ts), as formas dos dados em [`spec/schema.ts`](../../../spec/schema.ts) e as sete leis em [`spec/laws.md`](../../../spec/laws.md).

## O contrato

Um adaptador conecta o ECR a um tipo de sistema: um app web, um app móvel, uma API. São três peças pequenas, não uma interface grande.

Um esboço de como um adaptador vai ser. Ainda não há nada publicado no npm.

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

Os tipos em rascunho estão em [`spec/contract.ts`](../../../spec/contract.ts) e as formas dos dados em [`spec/schema.ts`](../../../spec/schema.ts). Há um trace de exemplo em [`spec/examples/`](../../../spec/examples/).

## Escolhas de design

- **O artefato é um arquivo padrão.** Se você parar de usar o ECR, seus testes continuam rodando.
- **Sem laço de LLM embutido.** A exploração é feita pelo agente que você já usa, por meio de um servidor MCP e de skills. O ECR grava, valida e compila.
- **O núcleo nunca vai importar um SDK de LLM.** Uma reexecução não pode chamar um modelo por acidente.
- **As verificações são dados.** Qualquer target pode emiti-las, e um reparo pode provar que não removeu nenhuma.
- **Um bug também é um teste.** Quando o agente encontra algo errado, a verificação que deveria valer é registrada como falha. Ela vira um teste que fica vermelho até o bug ser corrigido.
