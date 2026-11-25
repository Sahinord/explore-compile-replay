# `ecr` komutu

[English](../../../docs/command.md) · [简体中文](../../zh-CN/docs/command.md) · [日本語](../../ja/docs/command.md) · [Español](../../es/docs/command.md) · [Português](../../pt-BR/docs/command.md) · [Tiếng Việt](../../vi/docs/command.md) · Türkçe

Buradaki her şey bu deponun bir klonundan, Node 22.18 veya üstü ve pnpm ile çalışır. Derleme ve yeniden oynatma hiçbir modeli çağırmaz.

<a name="check-your-clone"></a>

## Klonunuzu kontrol edin

```sh
pnpm install
pnpm check        # types, schema, examples, links, tests, conformance
pnpm conformance  # the report alone
```

Referans adaptörün raporu:

```text
L1  Determinism   pass     same bytes on two compilations, same verdict on 3 replays (1 trace, 1 target)
L2  Fidelity      pass     recorded traces replay as observed, and an instrumented system receives their actions and oracles in order, and nothing else (1 trace, 1 target)
L3  Traceability  pass     every step has one range, inside the file, with no overlap (1 trace, 1 target)
L4  No model      partial  no artifact imports a known model SDK; this run did not have the network closed
L5  State         pass     state identical after restore (1 trace)
L6  Safe repair   partial  a new action for one step leaves the text of the other steps (4 patches); that a behaviour change comes back as a failed oracle is not checked yet
L7  No secret     pass     1 secret value searched in traces and artifacts, none found
```

"partial" ve "skipped" geçti anlamına gelmez. Kitin henüz kanıtlayamadığını ya da bu çalıştırmada kanıtlayamadığını işaretlerler. L4, komutun etrafında ağ kapalıyken geçer: CI, yalnızca loopback'i olan bir ağ ad alanında (network namespace) `pnpm conformance --network-closed` çalıştırır.

Üç adımı tek bir örnekte görmek için şu iki dosyayı yan yana okuyun:

- bir keşfin kaydettiği iz: [`anna-first-item.trace.json`](../../../packages/adapter-fixture/examples/anna-first-item.trace.json)
- derlendiği test: [`anna-first-item.test.mjs`](../../../packages/adapter-fixture/examples/anna-first-item.test.mjs). Bu projeden hiçbir şey içe aktarmaz ve parametrelerinin adlarını tutar, değerlerini asla.

Bir mobil uygulama için aynısı: [bir iz](../../../packages/adapter-maestro/examples/anna-first-item-mobile.trace.json) ve derlendiği [Maestro akışı](../../../packages/adapter-maestro/examples/anna-first-item-mobile.flow.yaml).

Bir cihazda, model olmadan, mobile-agent-testers'ın demo uygulamasına ve içine yerleştirilmiş hatalara karşı:

```text
pass  tiny-todo-first-task (maestro, 61927 ms)
bug   tiny-todo-one-tasks (maestro, 65996 ms)
      oracle_failed  step search  oracle counter-singular: Assertion is false: "1 task" is visible
      This oracle was recorded as a bug, and the bug is still there. The steps after it did not run.
```

İkinci iz bir hatayı kontrol olarak tutar: sayaç "1 tasks" diyor. Şimdilik iki iz de elle yazılmıştır, [`packages/adapter-maestro/device`](../../../packages/adapter-maestro/device) içinde.

Testler bu dosyayı sistemin değiştirilmiş iki sürümüne karşı yeniden oynatır. Yeni bir davranış başarısız bir kontrol olarak geri döner. Yeri değişen bir hedef, kendi adımında `target_not_found` olarak geri döner.

## Doğrula, derle, yeniden oynat

Şimdilik bu depodan çalışır. Derleme ve yeniden oynatma hiçbir modeli çağırmaz.

```sh
TRACE=packages/adapter-fixture/examples/anna-first-item.trace.json
ADAPTER=packages/adapter-fixture/src/index.ts

pnpm ecr validate $TRACE --adapter $ADAPTER          # schema, then the adapter's vocabularies
pnpm ecr compile $TRACE --adapter $ADAPTER --check   # is the compiled file up to date? For CI

export ECR_PARAM_ITEM_TITLE="Buy bread" ECR_PARAM_PRIVATE_NOTE="Door code 4821"
pnpm ecr replay $TRACE --adapter $ADAPTER            # pass  anna-first-item (node-test, 80 ms)
pnpm ecr conformance $TRACE --adapter $ADAPTER       # the report above, for any adapter
```

Bir iz, parametrelerinin adlarını saklar. Değerleri, test çalışırken ortamdan `ECR_PARAM_<NAME>` olarak gelir.

Bir yeniden oynatmanın kararlı olup olmadığını görmek için onu birkaç kez çalıştırın ve her sonucu saklayın:

```text
$ pnpm ecr replay $TRACE --adapter $ADAPTER --times 3 --report replays.json
pass  anna-first-item  replay 1 of 3 (81 ms)
pass  anna-first-item  replay 2 of 3 (62 ms)
pass  anna-first-item  replay 3 of 3 (60 ms)
      anna-first-item: 3 pass on 3 replays (node-test)
wrote  replays.json
```

Rapor, her iz için iz dosyasının ve derlenmiş dosyanın SHA-256 değerini, her yeniden oynatma için de sonucunu, süresini ve nerede durduğunu tutar: bir tür, bir adım, bir kontrol. Sistemden hiçbir mesaj ve hiçbir parametre değeri içermez, bu yüzden yayımlanabilir.

Yeniden oynatmayı davranışı değişmiş bir sisteme yöneltin. Adımı ve kontrolü belirterek başarısız olur:

```text
$ pnpm ecr replay $TRACE --adapter packages/adapter-fixture/test/systems/drifted-adapter.ts
FAIL  anna-first-item (node-test, 95 ms)
      oracle_failed  step s1  oracle not-done-yet: Expected values to be strictly equal: true !== false
      A failed oracle is never repaired: it is a regression or an intended change, and a person decides.
```

## Onarım, sınırlar içinde

Yeniden oynatmayı bir öğenin artık başlığıyla bulunamadığı bir sisteme yöneltin. Bir kontrolde değil, bir adımda kırılır:

```text
$ pnpm ecr replay $TRACE --adapter packages/adapter-fixture/test/systems/moved-adapter.ts
FAIL  anna-first-item (node-test, 92 ms)
      target_not_found  step s3: No item titled "Buy bread"
```

Sisteme bir ajan ya da siz bakıp o adım için başka bir eylem önerirsiniz. Kararı `ecr repair` verir. Hangi adımın saptığını bilmek için önce yeniden oynatır. Başka herhangi bir adım için gelen yamayı reddeder. Yamalı izi derler ve başka bir adımın metni değiştiyse onu reddeder. Sonra yeniden oynatır ve yalnızca her kontrol izin kaydettiği sonucu verirse kabul eder.

```text
$ pnpm ecr repair $TRACE --adapter packages/adapter-fixture/test/systems/moved-adapter.ts --step s3 --action '{"kind":"toggleAt","index":0}'
repaired  anna-first-item  step s3 (node-test)
      was: target_not_found  step s3: No item titled "Buy bread"
```

Bir yama bir adım ve bir eylem içerir. Bir kontrolü silemez ya da zayıflatamaz, çünkü bir kontrolü adlandırmanın hiçbir yolu yoktur. Yanlış öğeyi işaretlemek (`"index": 1`) adımı geçer, `done` kontrolünü bozar ve reddedilir. Yeniden oynatma bir kontrolde kırıldığında ise hiçbir şey kabul edilmez:

```text
$ pnpm ecr repair $TRACE --adapter packages/adapter-fixture/test/systems/drifted-adapter.ts --step s1 --action '{"kind":"add","title":"x"}'
REFUSED  anna-first-item  step s1 (oracle_failed)
      Oracle not-done-yet failed. A failed oracle is never repaired: it is a regression or an intended change, and a person decides
```

<a name="a-bug-is-a-test-too"></a>

## Hata da bir testtir

Keşfeden bir ajan hatalar bulur. Bir rapor onları anlatır. Bir iz onları kontrol olarak tutabilir.

Bir kontrol (oracle) neyin doğru olması gerektiğini söyler. Keşif sırasında yanlış çıktıysa `"observed": "failed"` ile kaydedilir:

```json
{ "id": "not-done-yet", "check": { "kind": "done", "title": "Bread", "equals": false }, "observed": "failed" }
```

Derlenmiş dosya onu diğer her kontrol gibi denetler, bu yüzden test hata düzeltilene kadar kırmızı kalır. Herkesin çalıştırabileceği bir yeniden üretimdir: [iz](../../../packages/adapter-fixture/examples/anna-new-item-ticked.trace.json), [test](../../../packages/adapter-fixture/examples/anna-new-item-ticked.test.mjs).

`ecr replay` izin neyi kaydettiğini bilir ve dört sonuçtan birini verir. Komutu yalnızca `FAIL` başarısız kılar.

| Sonuç | Anlamı |
|---|---|
| `pass` | Tüm kontroller tutuyor. İz hiçbir hata kaydetmiyor |
| `bug` | Yeniden oynatma, izin kaydettiği hatada duruyor ve başka hiçbir yerde durmuyor. Hata hâlâ orada |
| `fixed` | Hata olarak kaydedilen kontrol artık tutuyor. `"observed": "failed"` kısmını kaldırın, bir korumaya dönüşür |
| `FAIL` | Diğer her şey: bir adım saptı ya da tutan bir kontrol artık tutmuyor |

```text
$ pnpm ecr replay packages/adapter-fixture/examples/anna-new-item-ticked.trace.json --adapter packages/adapter-fixture/test/systems/buggy-adapter.ts
bug   anna-new-item-ticked (node-test, 90 ms)
      oracle_failed  step s1  oracle not-done-yet: Expected values to be strictly equal: true !== false
      This oracle was recorded as a bug, and the bug is still there. The steps after it did not run.
```

İki sınır var. Bir yeniden oynatma ilk hatada durur, bu yüzden izde ondan sonra gelenler hata düzeltilene kadar kontrol edilmez. Ve yalnızca bir adımın kontrol noktası bir hata olabilir, bir değişmez (invariant) asla.
