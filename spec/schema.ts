/**
 * Explore-Compile-Replay: data schema, draft 0.
 *
 * Source of truth for every shape that crosses a boundary: what an
 * exploration records, what a target compiles, what a replay reports.
 * A JSON Schema will be generated from this file and checked in CI.
 *
 * Status: draft. Names and fields will change before 0.1.
 */
import { z } from "zod";

export const TRACE_SCHEMA = "ecr.trace/0" as const;

/**
 * An entry of an adapter's vocabulary: an action ("tap", "fill", "call")
 * or an oracle ("visible", "equals", "status"). The schema only requires
 * `kind`. Each adapter narrows the rest with its own types.
 */
export const VocabularyEntry = z.looseObject({ kind: z.string().min(1) });
export type VocabularyEntry = z.infer<typeof VocabularyEntry>;

/**
 * A value supplied at replay time. A trace stores the name, never the
 * value, so that no secret reaches the repository (law L7).
 */
export const Param = z.object({
  name: z.string().min(1),
  secret: z.boolean().default(false),
  description: z.string().optional(),
});
export type Param = z.infer<typeof Param>;

/** Who explores, and what they are trying to do. */
export const Persona = z.object({
  id: z.string().min(1),
  profile: z.string(),
  goal: z.string(),
  locale: z.string().optional(),
  /** Adapter-specific setup: device, viewport, text size, permissions. */
  context: z.record(z.string(), z.unknown()).optional(),
});
export type Persona = z.infer<typeof Persona>;

/**
 * A deterministic check, stored as data. Because oracles are data, every
 * target can emit them and a repair can prove it removed none (law L6).
 */
export const Oracle = z.object({
  id: z.string().min(1),
  check: VocabularyEntry,
});
export type Oracle = z.infer<typeof Oracle>;

export const Step = z.object({
  /** Stable id. The source map of an artifact points back to it (law L3). */
  id: z.string().min(1),
  /** Why the persona did this, in plain words. Never used at replay. */
  intent: z.string().optional(),
  action: VocabularyEntry,
  /** Oracles that must hold right after this step. */
  checkpoints: z.array(Oracle).default([]),
});
export type Step = z.infer<typeof Step>;

export const Trace = z.object({
  schema: z.literal(TRACE_SCHEMA),
  id: z.string().min(1),
  adapter: z.object({ id: z.string().min(1), version: z.string().optional() }),
  persona: Persona,
  params: z.array(Param).default([]),
  /** Oracles that must hold after every step. */
  invariants: z.array(Oracle).default([]),
  steps: z.array(Step).min(1),
  /** How the trace was produced. Kept for audit, never used at replay. */
  provenance: z.object({
    exploredAt: z.iso.datetime(),
    agent: z.string().optional(),
    model: z.string().optional(),
  }),
});
export type Trace = z.infer<typeof Trace>;

/** One step of the trace maps to one distinct range of the artifact (law L3). */
export const SourceRange = z.object({
  stepId: z.string().min(1),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
});
export type SourceRange = z.infer<typeof SourceRange>;

/**
 * What a target produces: a standard file (a Playwright test, a Maestro
 * flow) that runs without ECR installed.
 */
export const CompiledArtifact = z.object({
  target: z.string().min(1),
  path: z.string().min(1),
  content: z.string(),
  /** Hash of the trace this file was compiled from. `ecr compile --check` compares it. */
  traceHash: z.string().min(1),
  sourceMap: z.array(SourceRange),
});
export type CompiledArtifact = z.infer<typeof CompiledArtifact>;

/**
 * How a replay can differ from its trace. The type decides what happens
 * next: a repair may be proposed for the first four, never for
 * `oracle_failed`, which is a regression or an intended change and is
 * decided by a person.
 */
export const Divergence = z.discriminatedUnion("type", [
  z.object({ type: z.literal("target_not_found"), stepId: z.string(), message: z.string().optional() }),
  z.object({ type: z.literal("action_failed"), stepId: z.string(), message: z.string().optional() }),
  z.object({ type: z.literal("unexpected_state"), stepId: z.string(), message: z.string().optional() }),
  z.object({ type: z.literal("timeout"), stepId: z.string(), message: z.string().optional() }),
  z.object({
    type: z.literal("oracle_failed"),
    oracleId: z.string(),
    /** Absent when an invariant failed outside of a step. */
    stepId: z.string().optional(),
    message: z.string().optional(),
  }),
]);
export type Divergence = z.infer<typeof Divergence>;

export const ReplayResult = z.object({
  verdict: z.enum(["pass", "fail"]),
  divergences: z.array(Divergence),
  durationMs: z.number().nonnegative(),
});
export type ReplayResult = z.infer<typeof ReplayResult>;
