/**
 * Reference adapter: the smallest adapter that obeys the contract.
 *
 * System: a to-do list in memory (`todo.ts`).
 * Target: a plain `node:test` file that runs with `node` alone.
 *
 * It exists to exercise the contract and the conformance kit, and to be
 * read by people who write a real adapter.
 *
 * Status: draft.
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import {
  defineAdapter,
  type Adapter,
  type Received,
  type ReplayOptions,
  type SnapshotId,
  type SystemDriver,
  type Target,
  type TypedOracle,
  type TypedTrace,
  type Verdict,
} from "../../../spec/contract.ts";
import type { CompiledArtifact, Divergence, ReplayResult, SourceRange } from "../../../spec/schema.ts";
import { hashTrace, isParamRef } from "../../core/src/index.ts";
import { TodoApp, type Todo } from "./todo.ts";

/** A literal, or the name of a parameter supplied at replay time. */
const Text = z.union([z.string(), z.strictObject({ param: z.string().min(1) })]);
type Text = z.infer<typeof Text>;

export const actions = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("add"), title: Text }),
  z.strictObject({ kind: z.literal("toggle"), title: Text }),
  z.strictObject({ kind: z.literal("toggleAt"), index: z.number().int().nonnegative() }),
  z.strictObject({ kind: z.literal("remove"), title: Text }),
]);
export type TodoAction = z.infer<typeof actions>;

export const oracles = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("count"), equals: z.number().int().nonnegative() }),
  z.strictObject({ kind: z.literal("has"), title: Text }),
  z.strictObject({ kind: z.literal("done"), title: Text, equals: z.boolean() }),
]);
export type TodoOracle = z.infer<typeof oracles>;

export type TodoTrace = TypedTrace<TodoAction, TodoOracle>;

function literal(text: Text): string {
  if (isParamRef(text)) throw new Error(`Parameter ${text.param} has no value`);
  return text as string;
}

/** Drives a live to-do list. Used to explore, never to replay. */
export function createTodoDriver(create: () => TodoApp = () => new TodoApp()): SystemDriver<Todo[], TodoAction, TodoOracle> {
  let app = create();
  const snapshots = new Map<string, Todo[]>();

  return {
    capabilities: { snapshot: true },
    async setup() {
      app = create();
      snapshots.clear();
    },
    async teardown() {
      snapshots.clear();
    },
    async observe() {
      return { state: app.state(), stable: true };
    },
    async execute(action) {
      if (action.kind === "toggleAt") return app.toggleAt(action.index);
      const title = literal(action.title);
      if (action.kind === "add") app.add(title);
      else if (action.kind === "toggle") app.toggle(title);
      else app.remove(title);
    },
    async verify(oracle): Promise<Verdict> {
      const items = app.state();
      if (oracle.kind === "count") {
        return items.length === oracle.equals
          ? { ok: true }
          : { ok: false, message: `expected ${oracle.equals} items, found ${items.length}` };
      }
      const title = literal(oracle.title);
      const item = items.find((entry) => entry.title === title);
      if (oracle.kind === "has") {
        return item ? { ok: true } : { ok: false, message: `no item titled "${title}"` };
      }
      return item?.done === oracle.equals
        ? { ok: true }
        : { ok: false, message: `expected "${title}" done to be ${oracle.equals}, found ${item?.done}` };
    },
    async snapshot() {
      const id = `snapshot-${snapshots.size + 1}`;
      snapshots.set(id, app.state());
      return id as SnapshotId;
    },
    async restore(id) {
      const saved = snapshots.get(id);
      if (!saved) throw new Error(`Unknown snapshot ${id}`);
      app.load(saved);
    },
  };
}

/** Name of the environment variable that tells the artifact where the system is. */
export const SYSTEM_VARIABLE = "ECR_FIXTURE_SYSTEM";
/** Prefix of the environment variables that carry parameter values. */
export const PARAM_PREFIX = "ECR_PARAM_";
/** Prefix of the line the artifact writes on stderr when it fails. */
export const DIVERGENCE_MARKER = "ECR_DIVERGENCE ";

function js(text: Text): string {
  return isParamRef(text) ? `params[${JSON.stringify(text.param)}]` : JSON.stringify(text);
}

function paramNames(value: unknown): string[] {
  if (isParamRef(value)) return [value.param];
  if (value !== null && typeof value === "object") return Object.values(value).flatMap(paramNames);
  return [];
}

function actionLine(action: TodoAction): string {
  if (action.kind === "toggleAt") return `app.toggleAt(${action.index});`;
  return `app.${action.kind}(${js(action.title)});`;
}

function oracleLine(oracle: TodoOracle): string {
  if (oracle.kind === "count") return `assert.equal(app.state().length, ${oracle.equals});`;
  if (oracle.kind === "has") return `assert.ok(app.state().some((item) => item.title === ${js(oracle.title)}));`;
  return `assert.equal(app.state().find((item) => item.title === ${js(oracle.title)})?.done, ${oracle.equals});`;
}

/** Written above an oracle that was recorded as a bug. */
const BUG_COMMENT = "// Known bug: this check was false when the trace was recorded. It fails until the bug is fixed.";

/** One line, so that a comment cannot break the file or its source map. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Pure: the same trace gives the same bytes. Nothing here reads a clock, a path or the environment. */
export function compileToNodeTest(trace: TodoTrace): CompiledArtifact {
  const declared = trace.params.map((entry) => entry.name);
  for (const name of paramNames([trace.steps, trace.invariants])) {
    if (!declared.includes(name)) throw new Error(`The trace uses parameter ${name} but does not declare it`);
  }
  const traceHash = hashTrace(trace);
  const lines: string[] = [
    "// Compiled by Explore-Compile-Replay: https://github.com/pierridotite/explore-compile-replay",
    `// Trace: ${oneLine(trace.id)}`,
    `// Trace hash: sha256:${traceHash}`,
    "// Do not edit by hand. Change the trace and compile again.",
    `// Run: ${SYSTEM_VARIABLE}=<URL of the module that exports TodoApp> node <this file>`,
    'import assert from "node:assert/strict";',
    'import { test } from "node:test";',
    "",
    `const { TodoApp } = await import(process.env.${SYSTEM_VARIABLE});`,
    "",
    "// Values supplied when the test runs. They are never written in this file.",
    "function param(name) {",
    `  const value = process.env[${JSON.stringify(PARAM_PREFIX)} + name];`,
    '  if (value === undefined) throw new Error("Missing value for parameter " + name);',
    "  return value;",
    "}",
    `const params = {${declared.map((name) => `${JSON.stringify(name)}: param(${JSON.stringify(name)})`).join(", ")}};`,
    "",
    `test(${JSON.stringify(oneLine(`${trace.persona.id}: ${trace.persona.goal}`))}, () => {`,
    "  const app = new TodoApp();",
    "  let at = null;",
    "  try {",
  ];
  const sourceMap: SourceRange[] = [];

  const emitOracle = (stepId: string, oracle: TypedOracle<TodoOracle>): void => {
    lines.push(`    at = ${JSON.stringify({ kind: "oracle", stepId, oracleId: oracle.id })};`);
    if (oracle.observed === "failed") lines.push(`    ${BUG_COMMENT}`);
    lines.push(`    ${oracleLine(oracle.check)}`);
  };

  for (const step of trace.steps) {
    const startLine = lines.length + 1;
    lines.push(`    // Step ${oneLine(step.id)}${step.intent === undefined ? "" : `: ${oneLine(step.intent)}`}`);
    lines.push(`    at = ${JSON.stringify({ kind: "step", stepId: step.id })};`);
    lines.push(`    ${actionLine(step.action)}`);
    for (const oracle of step.checkpoints) emitOracle(step.id, oracle);
    for (const oracle of trace.invariants) emitOracle(step.id, oracle);
    sourceMap.push({ stepId: step.id, startLine, endLine: lines.length });
  }

  lines.push(
    "  } catch (error) {",
    `    console.error(${JSON.stringify(DIVERGENCE_MARKER)} + JSON.stringify({ ...at, name: error?.name, message: error?.message }));`,
    "    throw error;",
    "  }",
    "});",
    "",
  );

  return {
    target: "node-test",
    path: `${trace.id.replace(/[^A-Za-z0-9._-]/g, "-")}.test.mjs`,
    content: lines.join("\n"),
    traceHash,
    sourceMap,
  };
}

interface Marker {
  readonly kind?: "step" | "oracle";
  readonly stepId?: string;
  readonly oracleId?: string;
  readonly name?: string;
  readonly message?: string;
}

function toDivergence(marker: Marker): Divergence {
  const message = marker.message === undefined ? {} : { message: marker.message };
  if (marker.kind === "oracle" && marker.oracleId !== undefined) {
    return {
      type: "oracle_failed",
      oracleId: marker.oracleId,
      ...(marker.stepId === undefined ? {} : { stepId: marker.stepId }),
      ...message,
    };
  }
  if (marker.kind === "step" && marker.stepId !== undefined) {
    const type = marker.name === "TargetNotFound" ? "target_not_found" : "action_failed";
    return { type, stepId: marker.stepId, ...message };
  }
  throw new Error(`The artifact failed outside of a step: ${marker.message ?? "no message"}`);
}

export interface NodeTestTargetOptions {
  /** URL of the module that exports `TodoApp`: the system the artifact runs against. */
  readonly system: string;
}

/**
 * Compiles a trace to a `node:test` file, and replays it with `node` alone.
 * The replay starts a new process: it shares no state with the driver.
 */
export function nodeTestTarget(options: NodeTestTargetOptions): Target<TodoAction, TodoOracle> {
  /** Runs the artifact in a new process, against the system at `system`. */
  async function run(
    artifact: CompiledArtifact,
    replayOptions: ReplayOptions | undefined,
    system: string,
    more: (dir: string) => NodeJS.ProcessEnv = () => ({}),
    after: (dir: string) => Promise<void> = async () => undefined,
  ): Promise<ReplayResult> {
    const dir = await mkdtemp(join(tmpdir(), "ecr-replay-"));
    const env: NodeJS.ProcessEnv = { ...process.env, [SYSTEM_VARIABLE]: system, ...more(dir) };
    // A replay started from inside a test run must not report to that run.
    delete env.NODE_TEST_CONTEXT;
    for (const [name, value] of Object.entries(replayOptions?.params ?? {})) env[PARAM_PREFIX + name] = value;

    const started = performance.now();
    try {
      const file = join(dir, "replay.test.mjs");
      await writeFile(file, artifact.content);
      const done = await new Promise<{ code: number; stderr: string }>((resolve, fail) => {
        execFile(process.execPath, [file], { env, timeout: 30_000 }, (error, _stdout, stderr) => {
          if (error && typeof error.code !== "number") fail(error);
          else resolve({ code: error ? (error.code as number) : 0, stderr });
        });
      });
      const durationMs = performance.now() - started;
      await after(dir);
      if (done.code === 0) return { verdict: "pass", divergences: [], durationMs };

      const markers = done.stderr
        .split("\n")
        .filter((line) => line.startsWith(DIVERGENCE_MARKER))
        .map((line) => JSON.parse(line.slice(DIVERGENCE_MARKER.length)) as Marker);
      if (markers.length === 0) throw new Error(`The artifact could not run:\n${done.stderr}`);
      return { verdict: "fail", divergences: markers.map(toDivergence), durationMs };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  return {
    id: "node-test",
    compile: compileToNodeTest,
    replay: (artifact, replayOptions) => run(artifact, replayOptions, options.system),
    // Law L2: the same file, against the same system wrapped in one that notes each call.
    async replayInstrumented(artifact, replayOptions) {
      let received: Received[] = [];
      const result = await run(
        artifact,
        replayOptions,
        INSTRUMENTED_SYSTEM,
        (dir) => ({ ECR_FIXTURE_INNER: options.system, ECR_FIXTURE_NOTES: join(dir, "notes.jsonl") }),
        async (dir) => {
          const notes = await readFile(join(dir, "notes.jsonl"), "utf8").catch(() => "");
          received = notes.split("\n").filter(Boolean).map((line) => JSON.parse(line) as Received);
        },
      );
      return { result, received };
    },
  };
}

/** URL of the system that wraps another one and notes what it receives. */
export const INSTRUMENTED_SYSTEM = new URL("./instrumented.ts", import.meta.url).href;

/** URL of the reference system. A replay can point at another one to simulate drift. */
export const REFERENCE_SYSTEM = new URL("./todo.ts", import.meta.url).href;

export interface FixtureOptions {
  /** The system artifacts replay against. Default: the reference to-do list. */
  readonly system?: string;
  /** The system the driver explores. Default: the reference to-do list. */
  readonly create?: () => TodoApp;
}

export function createFixtureAdapter(options: FixtureOptions = {}): Adapter<Todo[], TodoAction, TodoOracle> {
  return defineAdapter({
    id: "fixture-todo",
    actions,
    oracles,
    driver: createTodoDriver(options.create),
    targets: [nodeTestTarget({ system: options.system ?? REFERENCE_SYSTEM })],
  });
}
