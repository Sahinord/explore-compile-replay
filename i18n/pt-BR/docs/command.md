# O comando `ecr`

[English](../../../docs/command.md) · [简体中文](../../zh-CN/docs/command.md) · [日本語](../../ja/docs/command.md) · [Español](../../es/docs/command.md) · Português · [Tiếng Việt](../../vi/docs/command.md) · [Türkçe](../../tr/docs/command.md)

Tudo aqui roda a partir de um clone deste repositório, com Node 22.18 ou mais recente e pnpm. Compilar e reexecutar não chamam nenhum modelo.

<a name="check-your-clone"></a>

## Confira o seu clone

```sh
pnpm install
pnpm check        # types, schema, examples, links, tests, conformance
pnpm conformance  # the report alone
```

O relatório do adaptador de referência:

```text
L1  Determinism   pass     same bytes on two compilations, same verdict on 3 replays (1 trace, 1 target)
L2  Fidelity      pass     recorded traces replay as observed, and an instrumented system receives their actions and oracles in order, and nothing else (1 trace, 1 target)
L3  Traceability  pass     every step has one range, inside the file, with no overlap (1 trace, 1 target)
L4  No model      partial  no artifact imports a known model SDK; this run did not have the network closed
L5  State         pass     state identical after restore (1 trace)
L6  Safe repair   partial  a new action for one step leaves the text of the other steps (4 patches); that a behaviour change comes back as a failed oracle is not checked yet
L7  No secret     pass     1 secret value searched in traces and artifacts, none found
```

"partial" e "skipped" não são aprovações. Eles marcam o que o kit ainda não consegue provar, ou não conseguiu provar nesta execução. A L4 passa quando a rede está fechada em volta do comando: o CI roda `pnpm conformance --network-closed` em um namespace de rede que só tem o loopback.

Para ver as três etapas em um exemplo, leia estes dois arquivos lado a lado:

- o trace que uma exploração gravou: [`anna-first-item.trace.json`](../../../packages/adapter-fixture/examples/anna-first-item.trace.json)
- o teste para o qual ele compila: [`anna-first-item.test.mjs`](../../../packages/adapter-fixture/examples/anna-first-item.test.mjs). Ele não importa nada deste projeto e guarda os nomes dos parâmetros, nunca os valores.

O mesmo para um app móvel: [um trace](../../../packages/adapter-maestro/examples/anna-first-item-mobile.trace.json) e [o fluxo do Maestro](../../../packages/adapter-maestro/examples/anna-first-item-mobile.flow.yaml) para o qual ele compila.

Em um dispositivo, sem modelo, contra o app de demonstração do mobile-agent-testers e os bugs plantados nele:

```text
pass  tiny-todo-first-task (maestro, 61927 ms)
bug   tiny-todo-one-tasks (maestro, 65996 ms)
      oracle_failed  step search  oracle counter-singular: Assertion is false: "1 task" is visible
      This oracle was recorded as a bug, and the bug is still there. The steps after it did not run.
```

O segundo trace guarda um bug como verificação: o contador diz "1 tasks". Por enquanto os dois traces são escritos à mão, em [`packages/adapter-maestro/device`](../../../packages/adapter-maestro/device).

Os testes reexecutam esse arquivo contra duas versões modificadas do sistema. Um comportamento novo volta como uma verificação que falhou. Um alvo que mudou de lugar volta como `target_not_found` no seu passo.

## Validar, compilar, reexecutar

Por enquanto roda a partir deste repositório. Compilar e reexecutar não chamam nenhum modelo.

```sh
TRACE=packages/adapter-fixture/examples/anna-first-item.trace.json
ADAPTER=packages/adapter-fixture/src/index.ts

pnpm ecr validate $TRACE --adapter $ADAPTER          # schema, then the adapter's vocabularies
pnpm ecr compile $TRACE --adapter $ADAPTER --check   # is the compiled file up to date? For CI

export ECR_PARAM_ITEM_TITLE="Buy bread" ECR_PARAM_PRIVATE_NOTE="Door code 4821"
pnpm ecr replay $TRACE --adapter $ADAPTER            # pass  anna-first-item (node-test, 80 ms)
pnpm ecr conformance $TRACE --adapter $ADAPTER       # the report above, for any adapter
```

Um trace guarda os nomes dos seus parâmetros. Os valores vêm do ambiente quando o teste roda, como `ECR_PARAM_<NAME>`.

Para saber se uma reexecução é estável, rode-a várias vezes e guarde cada resultado:

```text
$ pnpm ecr replay $TRACE --adapter $ADAPTER --times 3 --report replays.json
pass  anna-first-item  replay 1 of 3 (81 ms)
pass  anna-first-item  replay 2 of 3 (62 ms)
pass  anna-first-item  replay 3 of 3 (60 ms)
      anna-first-item: 3 pass on 3 replays (node-test)
wrote  replays.json
```

O relatório guarda, para cada trace, o SHA-256 do arquivo e do arquivo compilado, e para cada reexecução o resultado, a duração e onde ela parou: um tipo, um passo, uma verificação. Não guarda nenhuma mensagem do sistema nem valor de parâmetro, então pode ser publicado.

Aponte a reexecução para um sistema cujo comportamento mudou, e ela falha indicando o passo e a verificação:

```text
$ pnpm ecr replay $TRACE --adapter packages/adapter-fixture/test/systems/drifted-adapter.ts
FAIL  anna-first-item (node-test, 95 ms)
      oracle_failed  step s1  oracle not-done-yet: Expected values to be strictly equal: true !== false
      A failed oracle is never repaired: it is a regression or an intended change, and a person decides.
```

## Reparar, com limites

Aponte a reexecução para um sistema onde um item não é mais encontrado pelo título, e ela quebra em um passo, não em uma verificação:

```text
$ pnpm ecr replay $TRACE --adapter packages/adapter-fixture/test/systems/moved-adapter.ts
FAIL  anna-first-item (node-test, 92 ms)
      target_not_found  step s3: No item titled "Buy bread"
```

Um agente, ou você, olha o sistema e propõe outra ação para esse passo. Quem decide é o `ecr repair`. Primeiro ele reexecuta, para saber qual passo divergiu. Recusa um patch para qualquer outro passo. Compila o trace com o patch e o recusa se o texto de outro passo mudou. Depois reexecuta, e só aceita se cada verificação der o que o trace registrou.

```text
$ pnpm ecr repair $TRACE --adapter packages/adapter-fixture/test/systems/moved-adapter.ts --step s3 --action '{"kind":"toggleAt","index":0}'
repaired  anna-first-item  step s3 (node-test)
      was: target_not_found  step s3: No item titled "Buy bread"
```

Um patch tem um passo e uma ação. Ele não pode remover nem enfraquecer uma verificação, porque não tem como nomear nenhuma. Marcar o item errado (`"index": 1`) passa pelo passo, quebra a verificação `done` e é recusado. E quando a reexecução quebra em uma verificação, nada é aceito:

```text
$ pnpm ecr repair $TRACE --adapter packages/adapter-fixture/test/systems/drifted-adapter.ts --step s1 --action '{"kind":"add","title":"x"}'
REFUSED  anna-first-item  step s1 (oracle_failed)
      Oracle not-done-yet failed. A failed oracle is never repaired: it is a regression or an intended change, and a person decides
```

<a name="a-bug-is-a-test-too"></a>

## Um bug também é um teste

Um agente que explora encontra bugs. Um relatório os descreve. Um trace pode guardá-los como verificações.

Uma verificação (oracle) diz o que deveria ser verdade. Quando ela foi falsa durante a exploração, é registrada com `"observed": "failed"`:

```json
{ "id": "not-done-yet", "check": { "kind": "done", "title": "Bread", "equals": false }, "observed": "failed" }
```

O arquivo compilado a verifica como qualquer outra, então o teste fica vermelho até o bug ser corrigido. É uma reprodução que qualquer pessoa pode rodar: [o trace](../../../packages/adapter-fixture/examples/anna-new-item-ticked.trace.json), [o teste](../../../packages/adapter-fixture/examples/anna-new-item-ticked.test.mjs).

O `ecr replay` sabe o que o trace registrou e dá um de quatro resultados. Só `FAIL` faz o comando falhar.

| Resultado | Significado |
|---|---|
| `pass` | Todas as verificações valem. O trace não registra nenhum bug |
| `bug` | A reexecução para no bug que o trace registra, e em nada mais. O bug continua lá |
| `fixed` | A verificação registrada como bug agora vale. Tire `"observed": "failed"` e ela vira uma proteção |
| `FAIL` | Qualquer outra coisa: um passo divergiu, ou uma verificação que valia não vale mais |

```text
$ pnpm ecr replay packages/adapter-fixture/examples/anna-new-item-ticked.trace.json --adapter packages/adapter-fixture/test/systems/buggy-adapter.ts
bug   anna-new-item-ticked (node-test, 90 ms)
      oracle_failed  step s1  oracle not-done-yet: Expected values to be strictly equal: true !== false
      This oracle was recorded as a bug, and the bug is still there. The steps after it did not run.
```

Dois limites. Uma reexecução para no primeiro bug, então o que vem depois dele no trace só é verificado quando o bug for corrigido. E só um ponto de verificação de um passo pode ser um bug, nunca um invariante.
