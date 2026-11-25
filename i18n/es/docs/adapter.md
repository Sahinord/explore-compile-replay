# Escribir un adaptador

[English](../../../docs/adapter.md) · [简体中文](../../zh-CN/docs/adapter.md) · [日本語](../../ja/docs/adapter.md) · Español · [Português](../../pt-BR/docs/adapter.md) · [Tiếng Việt](../../vi/docs/adapter.md) · [Türkçe](../../tr/docs/adapter.md)

Un adaptador conecta Explore-Compile-Replay con un tipo de sistema. Esta página muestra la forma de un adaptador y las decisiones que hay detrás. Los tipos exactos están en [`spec/contract.ts`](../../../spec/contract.ts), las formas de los datos en [`spec/schema.ts`](../../../spec/schema.ts) y las siete leyes en [`spec/laws.md`](../../../spec/laws.md).

## El contrato

Un adaptador conecta ECR con un tipo de sistema: una app web, una app móvil, una API. Son tres piezas pequeñas, no una interfaz grande.

Un esbozo de cómo será un adaptador. Aún no hay nada publicado en npm.

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

Los tipos en borrador están en [`spec/contract.ts`](../../../spec/contract.ts) y las formas de los datos en [`spec/schema.ts`](../../../spec/schema.ts). Hay una traza de ejemplo en [`spec/examples/`](../../../spec/examples/).

## Decisiones de diseño

- **El artefacto es un archivo estándar.** Si dejas de usar ECR, tus tests siguen funcionando.
- **Sin bucle de LLM integrado.** La exploración la hace el agente que ya usas, a través de un servidor MCP y de skills. ECR graba, valida y compila.
- **El núcleo nunca importará un SDK de LLM.** Una reproducción no puede llamar a un modelo por accidente.
- **Las comprobaciones son datos.** Cualquier target puede emitirlas, y una reparación puede demostrar que no eliminó ninguna.
- **Un bug también es un test.** Cuando el agente encuentra algo mal, la comprobación que debería cumplirse se registra como fallida. Se compila en un test que queda en rojo hasta que el bug se corrige.
