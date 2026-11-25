# Lệnh `ecr`

[English](../../../docs/command.md) · [简体中文](../../zh-CN/docs/command.md) · [日本語](../../ja/docs/command.md) · [Español](../../es/docs/command.md) · [Português](../../pt-BR/docs/command.md) · Tiếng Việt · [Türkçe](../../tr/docs/command.md)

Mọi thứ ở đây chạy từ một bản clone của repo này, với Node 22.18 trở lên và pnpm. Biên dịch và phát lại không gọi mô hình nào.

<a name="check-your-clone"></a>

## Kiểm tra bản clone của bạn

```sh
pnpm install
pnpm check        # types, schema, examples, links, tests, conformance
pnpm conformance  # the report alone
```

Báo cáo cho adapter tham chiếu:

```text
L1  Determinism   pass     same bytes on two compilations, same verdict on 3 replays (1 trace, 1 target)
L2  Fidelity      pass     recorded traces replay as observed, and an instrumented system receives their actions and oracles in order, and nothing else (1 trace, 1 target)
L3  Traceability  pass     every step has one range, inside the file, with no overlap (1 trace, 1 target)
L4  No model      partial  no artifact imports a known model SDK; this run did not have the network closed
L5  State         pass     state identical after restore (1 trace)
L6  Safe repair   partial  a new action for one step leaves the text of the other steps (4 patches); that a behaviour change comes back as a failed oracle is not checked yet
L7  No secret     pass     1 secret value searched in traces and artifacts, none found
```

"partial" và "skipped" không phải là đạt. Chúng đánh dấu điều bộ kiểm tra chưa chứng minh được, hoặc không chứng minh được trong lần chạy này. L4 đạt khi mạng bị ngắt quanh lệnh: CI chạy `pnpm conformance --network-closed` trong một network namespace chỉ có loopback.

Để xem ba bước trên một ví dụ, hãy đọc hai file này cạnh nhau:

- trace mà một lần khám phá đã ghi: [`anna-first-item.trace.json`](../../../packages/adapter-fixture/examples/anna-first-item.trace.json)
- test mà nó được biên dịch thành: [`anna-first-item.test.mjs`](../../../packages/adapter-fixture/examples/anna-first-item.test.mjs). Nó không import gì từ dự án này, và chỉ giữ tên các tham số, không bao giờ giữ giá trị.

Tương tự cho một ứng dụng di động: [một trace](../../../packages/adapter-maestro/examples/anna-first-item-mobile.trace.json) và [flow Maestro](../../../packages/adapter-maestro/examples/anna-first-item-mobile.flow.yaml) mà nó được biên dịch thành.

Trên thiết bị, không dùng mô hình, với ứng dụng demo của mobile-agent-testers và các lỗi được cài sẵn trong đó:

```text
pass  tiny-todo-first-task (maestro, 61927 ms)
bug   tiny-todo-one-tasks (maestro, 65996 ms)
      oracle_failed  step search  oracle counter-singular: Assertion is false: "1 task" is visible
      This oracle was recorded as a bug, and the bug is still there. The steps after it did not run.
```

Trace thứ hai giữ một lỗi dưới dạng kiểm tra: bộ đếm hiện "1 tasks". Cả hai trace hiện đều viết tay, trong [`packages/adapter-maestro/device`](../../../packages/adapter-maestro/device).

Các test phát lại file đó trên hai phiên bản đã thay đổi của hệ thống. Một hành vi mới trở lại dưới dạng một kiểm tra thất bại. Một mục tiêu đã di chuyển trở lại dưới dạng `target_not_found` ở bước của nó.

## Xác thực, biên dịch, phát lại

Hiện tại nó chạy từ repo này. Biên dịch và phát lại không gọi mô hình nào.

```sh
TRACE=packages/adapter-fixture/examples/anna-first-item.trace.json
ADAPTER=packages/adapter-fixture/src/index.ts

pnpm ecr validate $TRACE --adapter $ADAPTER          # schema, then the adapter's vocabularies
pnpm ecr compile $TRACE --adapter $ADAPTER --check   # is the compiled file up to date? For CI

export ECR_PARAM_ITEM_TITLE="Buy bread" ECR_PARAM_PRIVATE_NOTE="Door code 4821"
pnpm ecr replay $TRACE --adapter $ADAPTER            # pass  anna-first-item (node-test, 80 ms)
pnpm ecr conformance $TRACE --adapter $ADAPTER       # the report above, for any adapter
```

Một trace lưu tên các tham số. Giá trị của chúng đến từ môi trường khi test chạy, dưới dạng `ECR_PARAM_<NAME>`.

Để xem một lần phát lại có ổn định không, hãy chạy nó nhiều lần và giữ mọi kết quả:

```text
$ pnpm ecr replay $TRACE --adapter $ADAPTER --times 3 --report replays.json
pass  anna-first-item  replay 1 of 3 (81 ms)
pass  anna-first-item  replay 2 of 3 (62 ms)
pass  anna-first-item  replay 3 of 3 (60 ms)
      anna-first-item: 3 pass on 3 replays (node-test)
wrote  replays.json
```

Báo cáo giữ, cho mỗi trace, SHA-256 của file trace và của file đã biên dịch, và cho mỗi lần phát lại thì kết quả, thời gian và chỗ dừng: một loại, một bước, một kiểm tra. Nó không chứa thông báo nào của hệ thống và không chứa giá trị tham số nào, nên có thể công khai.

Cho phát lại trên một hệ thống có hành vi đã thay đổi, và nó thất bại kèm bước và kiểm tra:

```text
$ pnpm ecr replay $TRACE --adapter packages/adapter-fixture/test/systems/drifted-adapter.ts
FAIL  anna-first-item (node-test, 95 ms)
      oracle_failed  step s1  oracle not-done-yet: Expected values to be strictly equal: true !== false
      A failed oracle is never repaired: it is a regression or an intended change, and a person decides.
```

## Sửa, có giới hạn

Cho phát lại trên một hệ thống mà một mục không còn được tìm thấy theo tiêu đề, và nó hỏng ở một bước, không phải ở một kiểm tra:

```text
$ pnpm ecr replay $TRACE --adapter packages/adapter-fixture/test/systems/moved-adapter.ts
FAIL  anna-first-item (node-test, 92 ms)
      target_not_found  step s3: No item titled "Buy bread"
```

Một agent, hoặc chính bạn, xem hệ thống và đề xuất một hành động khác cho bước đó. `ecr repair` quyết định. Nó phát lại trước để biết bước nào bị lệch. Nó từ chối bản vá cho bất kỳ bước nào khác. Nó biên dịch trace đã vá và từ chối nếu văn bản của bước khác bị thay đổi. Sau đó nó phát lại, và chỉ chấp nhận khi mọi kiểm tra cho đúng kết quả mà trace đã ghi.

```text
$ pnpm ecr repair $TRACE --adapter packages/adapter-fixture/test/systems/moved-adapter.ts --step s3 --action '{"kind":"toggleAt","index":0}'
repaired  anna-first-item  step s3 (node-test)
      was: target_not_found  step s3: No item titled "Buy bread"
```

Một bản vá chứa một bước và một hành động. Nó không thể xóa hay làm yếu một kiểm tra, vì nó không có cách nào để gọi tên một kiểm tra. Đánh dấu nhầm mục (`"index": 1`) vượt qua được bước, làm hỏng kiểm tra `done`, và bị từ chối. Và khi lần phát lại hỏng ở một kiểm tra, không có gì được chấp nhận cả:

```text
$ pnpm ecr repair $TRACE --adapter packages/adapter-fixture/test/systems/drifted-adapter.ts --step s1 --action '{"kind":"add","title":"x"}'
REFUSED  anna-first-item  step s1 (oracle_failed)
      Oracle not-done-yet failed. A failed oracle is never repaired: it is a regression or an intended change, and a person decides
```

<a name="a-bug-is-a-test-too"></a>

## Lỗi cũng là một bài test

Một agent khám phá sẽ tìm ra lỗi. Một báo cáo mô tả chúng. Một trace có thể giữ chúng dưới dạng kiểm tra.

Một kiểm tra (oracle) nói điều gì lẽ ra phải đúng. Khi nó sai trong lúc khám phá, nó được ghi với `"observed": "failed"`:

```json
{ "id": "not-done-yet", "check": { "kind": "done", "title": "Bread", "equals": false }, "observed": "failed" }
```

File đã biên dịch kiểm tra nó như mọi kiểm tra khác, nên test luôn đỏ cho đến khi lỗi được sửa. Đây là một bản tái hiện mà ai cũng chạy được: [trace](../../../packages/adapter-fixture/examples/anna-new-item-ticked.trace.json), [test](../../../packages/adapter-fixture/examples/anna-new-item-ticked.test.mjs).

`ecr replay` biết trace đã ghi gì, và cho một trong bốn kết quả. Chỉ `FAIL` làm lệnh thất bại.

| Kết quả | Ý nghĩa |
|---|---|
| `pass` | Mọi kiểm tra đều đúng. Trace không ghi lỗi nào |
| `bug` | Lần phát lại dừng ở đúng lỗi mà trace ghi lại, và không dừng ở chỗ nào khác. Lỗi vẫn còn |
| `fixed` | Kiểm tra từng được ghi là lỗi giờ đã đúng. Bỏ `"observed": "failed"` đi và nó trở thành một lớp bảo vệ |
| `FAIL` | Mọi trường hợp khác: một bước bị lệch, hoặc một kiểm tra từng đúng nay không còn đúng |

```text
$ pnpm ecr replay packages/adapter-fixture/examples/anna-new-item-ticked.trace.json --adapter packages/adapter-fixture/test/systems/buggy-adapter.ts
bug   anna-new-item-ticked (node-test, 90 ms)
      oracle_failed  step s1  oracle not-done-yet: Expected values to be strictly equal: true !== false
      This oracle was recorded as a bug, and the bug is still there. The steps after it did not run.
```

Có hai giới hạn. Lần phát lại dừng ở lỗi đầu tiên, nên phần sau đó trong trace không được kiểm tra cho đến khi lỗi được sửa. Và chỉ một điểm kiểm tra của một bước mới có thể là lỗi, không bao giờ là một bất biến.
