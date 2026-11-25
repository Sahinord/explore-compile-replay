/**
 * Explore-Compile-Replay: core, first slice.
 *
 * What is here: recording a trace through a driver, hashing a trace,
 * resolving parameters, checking a source map. No model is called here,
 * and no LLM SDK is imported.
 *
 * Status: draft.
 */
import { createHash } from "node:crypto";
import type { Adapter, TypedOracle, TypedTrace } from "../../../spec/contract.ts";
import { TRACE_SCHEMA, Trace, type CompiledArtifact, type Param, type Persona } from "../../../spec/schema.ts";

/** JSON with sorted object keys, so that equal values give equal bytes. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) sorted[key] = sortKeys(source[key]);
    return sorted;
  }
  return value;
}

/** SHA-256 of the canonical JSON of a trace. */
export function hashTrace(trace: unknown): string {
  return createHash("sha256").update(canonicalJson(trace)).digest("hex");
}

/** A value supplied at replay time, written `{ "param": "NAME" }` in a trace. */
export interface ParamRef {
  readonly param: string;
}

export function isParamRef(value: unknown): value is ParamRef {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === 1 && keys[0] === "param" && typeof (value as ParamRef).param === "string";
}

/** Replaces every parameter reference by its value. Fails on a missing value. */
export function resolveParams<T>(value: T, values: Readonly<Record<string, string>>): T {
  return resolve(value, values) as T;
}

function resolve(value: unknown, values: Readonly<Record<string, string>>): unknown {
  if (isParamRef(value)) {
    const found = values[value.param];
    if (found === undefined) throw new Error(`Missing value for parameter ${value.param}`);
    return found;
  }
  if (Array.isArray(value)) return value.map((entry) => resolve(entry, values));
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) result[key] = resolve(entry, values);
    return result;
  }
  return value;
}

/**
 * Law L3: each step maps to one distinct range of the artifact.
 * Returns the list of problems, empty when the source map is valid.
 */
export function checkSourceMap(artifact: CompiledArtifact, stepIds: readonly string[]): string[] {
  const problems: string[] = [];
  const lineCount = artifact.content.split("\n").length;
  const seen = new Map<string, number>();
  for (const range of artifact.sourceMap) seen.set(range.stepId, (seen.get(range.stepId) ?? 0) + 1);

  for (const stepId of stepIds) {
    const count = seen.get(stepId) ?? 0;
    if (count === 0) problems.push(`step ${stepId} has no range`);
    if (count > 1) problems.push(`step ${stepId} has ${count} ranges`);
  }
  for (const range of artifact.sourceMap) {
    if (!stepIds.includes(range.stepId)) problems.push(`range for unknown step ${range.stepId}`);
    if (range.startLine > range.endLine) problems.push(`step ${range.stepId} ends before it starts`);
    if (range.endLine > lineCount) problems.push(`step ${range.stepId} ends after the last line`);
  }
  const ordered = [...artifact.sourceMap].sort((a, b) => a.startLine - b.startLine);
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    if (previous && current && current.startLine <= previous.endLine) {
      problems.push(`steps ${previous.stepId} and ${current.stepId} overlap`);
    }
  }
  return problems;
}

export class ExplorationError extends Error {
  override name = "ExplorationError";
}

export interface RecordStep<A, O> {
  readonly id: string;
  readonly intent?: string;
  readonly action: A;
  readonly checkpoints?: readonly TypedOracle<O>[];
}

export interface RecordInput<A, O> {
  readonly id: string;
  readonly persona: Persona;
  readonly steps: readonly RecordStep<A, O>[];
  readonly invariants?: readonly TypedOracle<O>[];
  /** Declared parameters. The trace keeps their names, never their values. */
  readonly params?: readonly Param[];
  /** Values used while exploring. They are not written to the trace. */
  readonly values?: Readonly<Record<string, string>>;
  /** Who or what explored: an agent name, "hand-written". */
  readonly agent?: string;
  readonly now?: () => Date;
  /** How long to wait for a stable observation after each step. */
  readonly settle?: { readonly attempts: number; readonly delayMs: number };
}

/**
 * Runs the steps through the driver and returns a validated trace.
 *
 * This is the recording half of "explore". Choosing the steps is the job
 * of an agent or a person. An oracle that fails while exploring is never
 * recorded: the exploration stops with an error.
 */
export async function record<State, A, O>(
  adapter: Adapter<State, A, O>,
  input: RecordInput<A, O>,
): Promise<TypedTrace<A, O>> {
  const values = input.values ?? {};
  const invariants = input.invariants ?? [];
  const settle = input.settle ?? { attempts: 20, delayMs: 50 };
  const { driver } = adapter;

  for (const step of input.steps) adapter.actions.parse(step.action);
  for (const oracle of [...invariants, ...input.steps.flatMap((step) => step.checkpoints ?? [])]) {
    adapter.oracles.parse(oracle.check);
  }

  await driver.setup();
  try {
    for (const step of input.steps) {
      await driver.execute(resolveParams(step.action, values));

      let stable = false;
      for (let attempt = 0; attempt < settle.attempts && !stable; attempt += 1) {
        stable = (await driver.observe()).stable;
        if (!stable) await new Promise((done) => setTimeout(done, settle.delayMs));
      }
      if (!stable) throw new ExplorationError(`The system did not settle after step ${step.id}`);

      for (const oracle of [...(step.checkpoints ?? []), ...invariants]) {
        const verdict = await driver.verify(resolveParams(oracle.check, values));
        if (!verdict.ok) {
          throw new ExplorationError(`Oracle ${oracle.id} failed after step ${step.id}: ${verdict.message}`);
        }
      }
    }
  } finally {
    await driver.teardown();
  }

  const trace = Trace.parse({
    schema: TRACE_SCHEMA,
    id: input.id,
    adapter: { id: adapter.id },
    persona: input.persona,
    params: input.params ?? [],
    invariants,
    steps: input.steps.map((step) => ({
      id: step.id,
      ...(step.intent === undefined ? {} : { intent: step.intent }),
      action: step.action,
      checkpoints: step.checkpoints ?? [],
    })),
    provenance: {
      exploredAt: (input.now ?? (() => new Date()))().toISOString(),
      ...(input.agent === undefined ? {} : { agent: input.agent }),
    },
  });
  return trace as unknown as TypedTrace<A, O>;
}

/** A trace that does not fit the schema, or the vocabularies of its adapter. */
export class TraceError extends Error {
  override name = "TraceError";
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(issues.join("\n"));
    this.issues = issues;
  }
}

function issuesOf(error: { issues: readonly { path: PropertyKey[]; message: string }[] }, prefix: string): string[] {
  return error.issues.map((issue) => `${[prefix, ...issue.path.map(String)].filter(Boolean).join(".")}: ${issue.message}`);
}

/**
 * Checks a value read from a file against the trace schema, then against
 * the vocabularies of the adapter. Throws a `TraceError` that lists every problem.
 */
export function parseTrace<State, A, O>(adapter: Adapter<State, A, O>, value: unknown): TypedTrace<A, O> {
  const parsed = Trace.safeParse(value);
  if (!parsed.success) throw new TraceError(issuesOf(parsed.error, ""));
  const trace = parsed.data;

  const issues: string[] = [];
  if (trace.adapter.id !== adapter.id) {
    issues.push(`adapter.id: the trace was recorded with "${trace.adapter.id}", not "${adapter.id}"`);
  }
  const checkOracles = (oracles: readonly { check: unknown }[], prefix: string): void => {
    oracles.forEach((oracle, index) => {
      const result = adapter.oracles.safeParse(oracle.check);
      if (!result.success) issues.push(...issuesOf(result.error, `${prefix}.${index}.check`));
    });
  };
  checkOracles(trace.invariants, "invariants");
  trace.steps.forEach((step, index) => {
    const result = adapter.actions.safeParse(step.action);
    if (!result.success) issues.push(...issuesOf(result.error, `steps.${index}.action`));
    checkOracles(step.checkpoints, `steps.${index}.checkpoints`);
  });
  if (issues.length > 0) throw new TraceError(issues);
  return trace as unknown as TypedTrace<A, O>;
}
