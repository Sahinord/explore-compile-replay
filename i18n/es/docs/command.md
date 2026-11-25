# El comando `ecr`

[English](../../../docs/command.md) · [简体中文](../../zh-CN/docs/command.md) · [日本語](../../ja/docs/command.md) · Español · [Português](../../pt-BR/docs/command.md) · [Tiếng Việt](../../vi/docs/command.md) · [Türkçe](../../tr/docs/command.md)

Todo lo que hay aquí se ejecuta desde un clon de este repositorio, con Node 22.18 o posterior y pnpm. Compilar y reproducir no llaman a ningún modelo.

<a name="check-your-clone"></a>

## Comprueba tu clon

```sh
pnpm install
pnpm check        # types, schema, examples, links, tests, conformance
pnpm conformance  # the report alone
```

El informe del adaptador de referencia:

```text
L1  Determinism   pass     same bytes on two compilations, same verdict on 3 replays (1 trace, 1 target)
L2  Fidelity      pass     recorded traces replay as observed, and an instrumented system receives their actions and oracles in order, and nothing else (1 trace, 1 target)
L3  Traceability  pass     every step has one range, inside the file, with no overlap (1 trace, 1 target)
L4  No model      partial  no artifact imports a known model SDK; this run did not have the network closed
L5  State         pass     state identical after restore (1 trace)
L6  Safe repair   partial  a new action for one step leaves the text of the other steps (4 patches); that a behaviour change comes back as a failed oracle is not checked yet
L7  No secret     pass     1 secret value searched in traces and artifacts, none found
```

"partial" y "skipped" no son aprobados. Marcan lo que el kit todavía no puede demostrar, o no pudo demostrar en esta ejecución. L4 se aprueba cuando la red está cerrada alrededor del comando: el CI ejecuta `pnpm conformance --network-closed` en un espacio de nombres de red que solo tiene el loopback.

Para ver los tres pasos en un ejemplo, lee estos dos archivos uno al lado del otro:

- la traza que grabó una exploración: [`anna-first-item.trace.json`](../../../packages/adapter-fixture/examples/anna-first-item.trace.json)
- el test al que compila: [`anna-first-item.test.mjs`](../../../packages/adapter-fixture/examples/anna-first-item.test.mjs). No importa nada de este proyecto, y guarda los nombres de sus parámetros, nunca sus valores.

Lo mismo para una app móvil: [una traza](../../../packages/adapter-maestro/examples/anna-first-item-mobile.trace.json) y [el flujo de Maestro](../../../packages/adapter-maestro/examples/anna-first-item-mobile.flow.yaml) al que compila.

En un dispositivo, sin modelo, contra la app de demostración de mobile-agent-testers y sus bugs plantados:

```text
pass  tiny-todo-first-task (maestro, 61927 ms)
bug   tiny-todo-one-tasks (maestro, 65996 ms)
      oracle_failed  step search  oracle counter-singular: Assertion is false: "1 task" is visible
      This oracle was recorded as a bug, and the bug is still there. The steps after it did not run.
```

La segunda traza guarda un bug como comprobación: el contador dice "1 tasks". Por ahora ambas trazas están escritas a mano, en [`packages/adapter-maestro/device`](../../../packages/adapter-maestro/device).

Los tests reproducen ese archivo contra dos versiones modificadas del sistema. Un comportamiento nuevo vuelve como una comprobación fallida. Un objetivo que se movió vuelve como `target_not_found` en su paso.

## Validar, compilar, reproducir

Por ahora se ejecuta desde este repositorio. Compilar y reproducir no llaman a ningún modelo.

```sh
TRACE=packages/adapter-fixture/examples/anna-first-item.trace.json
ADAPTER=packages/adapter-fixture/src/index.ts

pnpm ecr validate $TRACE --adapter $ADAPTER          # schema, then the adapter's vocabularies
pnpm ecr compile $TRACE --adapter $ADAPTER --check   # is the compiled file up to date? For CI

export ECR_PARAM_ITEM_TITLE="Buy bread" ECR_PARAM_PRIVATE_NOTE="Door code 4821"
pnpm ecr replay $TRACE --adapter $ADAPTER            # pass  anna-first-item (node-test, 80 ms)
pnpm ecr conformance $TRACE --adapter $ADAPTER       # the report above, for any adapter
```

Una traza guarda los nombres de sus parámetros. Sus valores vienen del entorno cuando se ejecuta el test, como `ECR_PARAM_<NAME>`.

Para saber si una reproducción es estable, ejecútala varias veces y guarda cada resultado:

```text
$ pnpm ecr replay $TRACE --adapter $ADAPTER --times 3 --report replays.json
pass  anna-first-item  replay 1 of 3 (81 ms)
pass  anna-first-item  replay 2 of 3 (62 ms)
pass  anna-first-item  replay 3 of 3 (60 ms)
      anna-first-item: 3 pass on 3 replays (node-test)
wrote  replays.json
```

El informe guarda, para cada traza, el SHA-256 de su archivo y del archivo compilado, y para cada reproducción su resultado, su duración y dónde se detuvo: un tipo, un paso, una comprobación. No guarda ningún mensaje del sistema ni ningún valor de parámetro, así que se puede publicar.

Apunta la reproducción a un sistema cuyo comportamiento cambió, y falla con el paso y la comprobación:

```text
$ pnpm ecr replay $TRACE --adapter packages/adapter-fixture/test/systems/drifted-adapter.ts
FAIL  anna-first-item (node-test, 95 ms)
      oracle_failed  step s1  oracle not-done-yet: Expected values to be strictly equal: true !== false
      A failed oracle is never repaired: it is a regression or an intended change, and a person decides.
```

## Reparar, con límites

Apunta la reproducción a un sistema donde un elemento ya no se encuentra por su título, y se rompe en un paso, no en una comprobación:

```text
$ pnpm ecr replay $TRACE --adapter packages/adapter-fixture/test/systems/moved-adapter.ts
FAIL  anna-first-item (node-test, 92 ms)
      target_not_found  step s3: No item titled "Buy bread"
```

Un agente, o tú, mira el sistema y propone otra acción para ese paso. `ecr repair` decide. Primero reproduce, para saber qué paso se desvió. Rechaza un parche para cualquier otro paso. Compila la traza parcheada y la rechaza si cambió el texto de otro paso. Después reproduce, y acepta solo si cada comprobación da lo que registró la traza.

```text
$ pnpm ecr repair $TRACE --adapter packages/adapter-fixture/test/systems/moved-adapter.ts --step s3 --action '{"kind":"toggleAt","index":0}'
repaired  anna-first-item  step s3 (node-test)
      was: target_not_found  step s3: No item titled "Buy bread"
```

Un parche contiene un paso y una acción. No puede eliminar ni debilitar una comprobación, porque no tiene forma de nombrar ninguna. Marcar el elemento equivocado (`"index": 1`) supera el paso, rompe la comprobación `done` y se rechaza. Y cuando la reproducción se rompe en una comprobación, no se acepta nada en absoluto:

```text
$ pnpm ecr repair $TRACE --adapter packages/adapter-fixture/test/systems/drifted-adapter.ts --step s1 --action '{"kind":"add","title":"x"}'
REFUSED  anna-first-item  step s1 (oracle_failed)
      Oracle not-done-yet failed. A failed oracle is never repaired: it is a regression or an intended change, and a person decides
```

<a name="a-bug-is-a-test-too"></a>

## Un bug también es un test

Un agente que explora encuentra bugs. Un informe los describe. Una traza puede guardarlos como comprobaciones.

Una comprobación (oracle) dice qué debería ser cierto. Cuando fue falsa durante la exploración, se registra con `"observed": "failed"`:

```json
{ "id": "not-done-yet", "check": { "kind": "done", "title": "Bread", "equals": false }, "observed": "failed" }
```

El archivo compilado la comprueba como cualquier otra, así que el test queda en rojo hasta que el bug se corrige. Es una reproducción que cualquiera puede ejecutar: [la traza](../../../packages/adapter-fixture/examples/anna-new-item-ticked.trace.json), [el test](../../../packages/adapter-fixture/examples/anna-new-item-ticked.test.mjs).

`ecr replay` sabe lo que registró la traza, y da uno de cuatro resultados. Solo `FAIL` hace fallar el comando.

| Resultado | Significado |
|---|---|
| `pass` | Todas las comprobaciones se cumplen. La traza no registra ningún bug |
| `bug` | La reproducción se detiene en el bug que registra la traza, y en nada más. El bug sigue ahí |
| `fixed` | La comprobación registrada como bug ahora se cumple. Quita `"observed": "failed"` y pasa a ser una protección |
| `FAIL` | Cualquier otra cosa: un paso se desvió, o una comprobación que se cumplía ya no se cumple |

```text
$ pnpm ecr replay packages/adapter-fixture/examples/anna-new-item-ticked.trace.json --adapter packages/adapter-fixture/test/systems/buggy-adapter.ts
bug   anna-new-item-ticked (node-test, 90 ms)
      oracle_failed  step s1  oracle not-done-yet: Expected values to be strictly equal: true !== false
      This oracle was recorded as a bug, and the bug is still there. The steps after it did not run.
```

Dos límites. Una reproducción se detiene en el primer bug, así que lo que viene después en la traza no se comprueba hasta que el bug se corrige. Y solo un punto de control de un paso puede ser un bug, nunca un invariante.
