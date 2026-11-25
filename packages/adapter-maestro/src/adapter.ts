/**
 * Mobile adapter, first slice: a vocabulary for mobile apps and a target
 * that compiles a trace to a Maestro flow (https://maestro.dev).
 *
 * What is here: the vocabulary and the compiler.
 * What is not: a driver (exploring is done outside, see the README of this
 * package), and typed divergences at replay. `replay` runs `maestro test`
 * and can only tell a pass from a failure for now.
 *
 * Status: draft. The flows are checked for syntax, not yet on a device.
 */
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import {
  defineAdapter,
  type Adapter,
  type ReplayOptions,
  type SystemDriver,
  type Target,
  type TypedTrace,
} from "../../../spec/contract.ts";
import type { CompiledArtifact, ReplayResult, SourceRange } from "../../../spec/schema.ts";
import { hashTrace, isParamRef } from "../../core/src/index.ts";

/** A literal, or the name of a parameter supplied at replay time. */
const Text = z.union([z.string().min(1), z.strictObject({ param: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/) })]);
type Text = z.infer<typeof Text>;

/**
 * How a step finds its target. In order of preference: an accessibility id,
 * a visible text, and as a last resort a point on the screen in percent.
 */
const Selector = z.union([
  z.strictObject({ id: z.string().min(1), index: z.number().int().nonnegative().optional() }),
  z.strictObject({ text: Text, index: z.number().int().nonnegative().optional() }),
  z.strictObject({ point: z.string().regex(/^\d{1,3}%,\d{1,3}%$/) }),
]);
type Selector = z.infer<typeof Selector>;

/** A selector that names an element. A check cannot be made on a point. */
const ElementSelector = z.union([
  z.strictObject({ id: z.string().min(1), index: z.number().int().nonnegative().optional() }),
  z.strictObject({ text: Text, index: z.number().int().nonnegative().optional() }),
]);

export const actions = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("launchApp"), appId: z.string().regex(/^[A-Za-z0-9._-]+$/), clearState: z.boolean().optional() }),
  z.strictObject({ kind: z.literal("tapOn"), target: Selector }),
  z.strictObject({ kind: z.literal("longPressOn"), target: Selector }),
  z.strictObject({ kind: z.literal("inputText"), text: Text }),
  z.strictObject({ kind: z.literal("eraseText"), characters: z.number().int().positive().optional() }),
  z.strictObject({ kind: z.literal("pressKey"), key: z.enum(["Enter", "Backspace", "Home", "Back"]) }),
  z.strictObject({ kind: z.literal("swipe"), direction: z.enum(["UP", "DOWN", "LEFT", "RIGHT"]) }),
  z.strictObject({ kind: z.literal("scrollUntilVisible"), target: ElementSelector, direction: z.enum(["UP", "DOWN", "LEFT", "RIGHT"]).optional() }),
  z.strictObject({ kind: z.literal("hideKeyboard") }),
]);
export type MobileAction = z.infer<typeof actions>;

export const oracles = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("visible"), target: ElementSelector }),
  z.strictObject({ kind: z.literal("notVisible"), target: ElementSelector }),
]);
export type MobileOracle = z.infer<typeof oracles>;

export type MobileTrace = TypedTrace<MobileAction, MobileOracle>;

/** A YAML double-quoted string. JSON strings are valid YAML. */
function quoted(value: string): string {
  return JSON.stringify(value);
}

/** Maestro reads `${...}` as an expression. A literal cannot contain one. */
function literal(value: string, where: string): string {
  if (value.includes("${")) throw new Error(`${where}: a literal text cannot contain "\${". Use a parameter.`);
  return value;
}

/** Text typed as is: a literal, or `${NAME}`, which Maestro replaces at run time. */
function plainText(text: Text, where: string): string {
  return quoted(isParamRef(text) ? `\${${text.param}}` : literal(text as string, where));
}

/** Text matched against the screen. Maestro reads it as a regular expression, so a literal is escaped. */
function matchedText(text: Text, where: string): string {
  if (isParamRef(text)) return quoted(`\${${text.param}}`);
  return quoted(literal(text as string, where).replace(/[\\^$.|?*+()[\]{}]/g, "\\$&"));
}

function selectorLines(selector: Selector, where: string): string[] {
  if ("point" in selector) return [`    point: ${quoted(selector.point)}`];
  const first = "id" in selector ? `    id: ${quoted(literal(selector.id, where))}` : `    text: ${matchedText(selector.text, where)}`;
  return selector.index === undefined ? [first] : [first, `    index: ${selector.index}`];
}

function actionLines(action: MobileAction, where: string): string[] {
  switch (action.kind) {
    case "launchApp":
      return action.clearState === undefined ? ["- launchApp"] : ["- launchApp:", `    clearState: ${action.clearState}`];
    case "tapOn":
    case "longPressOn":
      return [`- ${action.kind}:`, ...selectorLines(action.target, where)];
    case "inputText":
      return [`- inputText: ${plainText(action.text, where)}`];
    case "eraseText":
      return [action.characters === undefined ? "- eraseText" : `- eraseText: ${action.characters}`];
    case "pressKey":
      return [action.key === "Back" ? "- back" : `- pressKey: ${action.key}`];
    case "swipe":
      return ["- swipe:", `    direction: ${action.direction}`];
    case "scrollUntilVisible":
      return [
        "- scrollUntilVisible:",
        "    element:",
        ...selectorLines(action.target, where).map((line) => `  ${line}`),
        ...(action.direction === undefined ? [] : [`    direction: ${action.direction}`]),
      ];
    case "hideKeyboard":
      return ["- hideKeyboard"];
  }
}

function oracleLines(oracle: MobileOracle, where: string): string[] {
  const command = oracle.kind === "visible" ? "assertVisible" : "assertNotVisible";
  return [`- ${command}:`, ...selectorLines(oracle.target, where)];
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function paramNames(value: unknown): string[] {
  if (isParamRef(value)) return [value.param];
  if (value !== null && typeof value === "object") return Object.values(value).flatMap(paramNames);
  return [];
}

/** Pure: the same trace gives the same bytes. */
export function compileToMaestro(trace: MobileTrace): CompiledArtifact {
  const first = trace.steps[0]?.action;
  if (first?.kind !== "launchApp") throw new Error("The first step of a mobile trace must be launchApp: it names the app");
  const declared = trace.params.map((entry) => entry.name);
  for (const name of paramNames([trace.steps, trace.invariants])) {
    if (!declared.includes(name)) throw new Error(`The trace uses parameter ${name} but does not declare it`);
  }

  const traceHash = hashTrace(trace);
  const lines: string[] = [
    "# Compiled by Explore-Compile-Replay: https://github.com/pierridotite/explore-compile-replay",
    `# Trace: ${oneLine(trace.id)}`,
    `# Trace hash: sha256:${traceHash}`,
    "# Do not edit by hand. Change the trace and compile again.",
    declared.length === 0
      ? "# Run: maestro test <this file>"
      : `# Run: maestro test ${declared.map((name) => `-e ${name}=<value>`).join(" ")} <this file>`,
    `appId: ${first.appId}`,
    `name: ${quoted(oneLine(`${trace.persona.id}: ${trace.persona.goal}`))}`,
    "---",
  ];
  const sourceMap: SourceRange[] = [];

  for (const step of trace.steps) {
    const startLine = lines.length + 1;
    const where = `step ${step.id}`;
    lines.push(`# Step ${oneLine(step.id)}${step.intent === undefined ? "" : `: ${oneLine(step.intent)}`}`);
    lines.push(...actionLines(step.action, where));
    for (const oracle of [...step.checkpoints, ...trace.invariants]) {
      lines.push(`# Oracle ${oneLine(oracle.id)}`);
      lines.push(...oracleLines(oracle.check, `oracle ${oracle.id}`));
    }
    sourceMap.push({ stepId: step.id, startLine, endLine: lines.length });
  }
  lines.push("");

  return {
    target: "maestro",
    path: `${trace.id.replace(/[^A-Za-z0-9._-]/g, "-")}.flow.yaml`,
    content: lines.join("\n"),
    traceHash,
    sourceMap,
  };
}

export interface MaestroTargetOptions {
  /** The Maestro command. Default: `maestro`, found on the PATH. */
  readonly command?: string;
}

export function maestroTarget(options: MaestroTargetOptions = {}): Target<MobileAction, MobileOracle> {
  return {
    id: "maestro",
    compile: compileToMaestro,
    async replay(artifact: CompiledArtifact, replayOptions?: ReplayOptions): Promise<ReplayResult> {
      const dir = await mkdtemp(join(tmpdir(), "ecr-maestro-"));
      const started = performance.now();
      try {
        const file = join(dir, "replay.flow.yaml");
        await writeFile(file, artifact.content);
        // Maestro takes values as `-e NAME=value`. They are visible in the process list while the flow runs.
        const values = Object.entries(replayOptions?.params ?? {}).flatMap(([name, value]) => ["-e", `${name}=${value}`]);
        const run = await new Promise<{ code: number; output: string }>((done, fail) => {
          execFile(options.command ?? "maestro", ["test", ...values, file], { timeout: 15 * 60_000 }, (error, stdout, stderr) => {
            if (error && typeof error.code !== "number") fail(new Error(`Could not run Maestro: ${error.message}`));
            else done({ code: error ? (error.code as number) : 0, output: `${stdout}\n${stderr}` });
          });
        });
        if (run.code === 0) return { verdict: "pass", divergences: [], durationMs: performance.now() - started };
        throw new Error(`The flow failed. Typed divergences are not written yet for Maestro. Its output:\n${run.output}`);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  };
}

const notWritten = async (): Promise<never> => {
  throw new Error("The mobile adapter has no driver yet: explore with your own tool and write the trace (see packages/adapter-maestro/README.md)");
};

/** Exploring through ECR is not written yet for mobile. The trace format is the meeting point. */
const driver: SystemDriver<unknown, MobileAction, MobileOracle> = {
  capabilities: { snapshot: false },
  setup: notWritten,
  teardown: notWritten,
  observe: notWritten,
  execute: notWritten,
  verify: notWritten,
};

export function createMaestroAdapter(options: MaestroTargetOptions = {}): Adapter<unknown, MobileAction, MobileOracle> {
  return defineAdapter({ id: "mobile-maestro", actions, oracles, driver, targets: [maestroTarget(options)] });
}
