# Bir adaptör yazın

[English](../../../docs/adapter.md) · [简体中文](../../zh-CN/docs/adapter.md) · [日本語](../../ja/docs/adapter.md) · [Español](../../es/docs/adapter.md) · [Português](../../pt-BR/docs/adapter.md) · [Tiếng Việt](../../vi/docs/adapter.md) · Türkçe

Bir adaptör, Explore-Compile-Replay'i bir sistem türüne bağlar. Bu sayfa bir adaptörün biçimini ve arkasındaki seçimleri gösterir. Kesin tipler [`spec/contract.ts`](../../../spec/contract.ts) içinde, veri biçimleri [`spec/schema.ts`](../../../spec/schema.ts) içinde ve yedi yasa [`spec/laws.md`](../../../spec/laws.md) içindedir.

## Sözleşme

Bir adaptör, ECR'yi bir sistem türüne bağlar: bir web uygulaması, bir mobil uygulama, bir API. Büyük tek bir arayüz değil, üç küçük parçadır.

Bir adaptörün nasıl görüneceğinin bir taslağı. npm'de henüz hiçbir şey yayımlanmadı.

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

Taslak tipler [`spec/contract.ts`](../../../spec/contract.ts) içinde, veri biçimleri [`spec/schema.ts`](../../../spec/schema.ts) içindedir. Örnek bir iz [`spec/examples/`](../../../spec/examples/) içinde.

## Tasarım seçimleri

- **Ürün standart bir dosyadır.** ECR'yi kullanmayı bırakırsanız testleriniz yine çalışır.
- **Yerleşik bir LLM döngüsü yok.** Keşfi, zaten kullandığınız ajan bir MCP sunucusu ve skill'ler aracılığıyla yapar. ECR kaydeder, doğrular ve derler.
- **Çekirdek asla bir LLM SDK'sı içe aktarmayacak.** Bir yeniden oynatma bir modeli kazara çağıramaz.
- **Kontroller veridir.** Her hedef onları üretebilir ve bir onarım hiçbirini silmediğini kanıtlayabilir.
- **Hata da bir testtir.** Ajan yanlış bir şey bulduğunda, tutması gereken kontrol başarısız olarak kaydedilir. Hata düzeltilene kadar kırmızı kalan bir teste derlenir.
