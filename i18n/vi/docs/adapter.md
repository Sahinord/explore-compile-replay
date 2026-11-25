# Viết một adapter

[English](../../../docs/adapter.md) · [简体中文](../../zh-CN/docs/adapter.md) · [日本語](../../ja/docs/adapter.md) · [Español](../../es/docs/adapter.md) · [Português](../../pt-BR/docs/adapter.md) · Tiếng Việt · [Türkçe](../../tr/docs/adapter.md)

Một adapter nối Explore-Compile-Replay với một loại hệ thống. Trang này trình bày hình dạng của một adapter và những lựa chọn phía sau. Các kiểu chính xác nằm trong [`spec/contract.ts`](../../../spec/contract.ts), cấu trúc dữ liệu trong [`spec/schema.ts`](../../../spec/schema.ts) và bảy định luật trong [`spec/laws.md`](../../../spec/laws.md).

## Hợp đồng

Một adapter nối ECR với một loại hệ thống: ứng dụng web, ứng dụng di động, API. Nó gồm ba phần nhỏ, không phải một giao diện lớn.

Phác thảo một adapter sẽ trông như thế nào. Chưa có gì được công bố trên npm.

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

Các kiểu ở dạng nháp nằm trong [`spec/contract.ts`](../../../spec/contract.ts) và cấu trúc dữ liệu trong [`spec/schema.ts`](../../../spec/schema.ts). Có một trace mẫu trong [`spec/examples/`](../../../spec/examples/).

## Các lựa chọn thiết kế

- **Sản phẩm là một file chuẩn.** Nếu bạn ngừng dùng ECR, test của bạn vẫn chạy.
- **Không có vòng lặp LLM dựng sẵn.** Việc khám phá do agent bạn đang dùng thực hiện, qua một máy chủ MCP và các skill. ECR ghi lại, xác thực và biên dịch.
- **Lõi sẽ không bao giờ import một SDK LLM.** Một lần phát lại không thể vô tình gọi mô hình.
- **Các kiểm tra là dữ liệu.** Mọi target đều xuất được chúng, và một bản sửa có thể chứng minh nó không xóa kiểm tra nào.
- **Lỗi cũng là một bài test.** Khi agent tìm thấy điều gì sai, kiểm tra lẽ ra phải đúng được ghi lại là thất bại. Nó được biên dịch thành một test luôn đỏ cho đến khi lỗi được sửa.
