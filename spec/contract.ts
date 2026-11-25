/**
 * Explore-Compile-Replay: adapter contract, draft 0.
 *
 * An adapter connects ECR to one kind of system. It is three small
 * pieces: two typed vocabularies, a driver, and a list of targets.
 *
 * Status: draft. Names and signatures will change before 0.1.
 */
import type { z } from "zod";
import type { CompiledArtifact, Oracle, ReplayResult, Step, Trace } from "./schema.ts";

/** What a driver can do. The conformance kit skips what is not declared. */
export interface Capabilities {
  /** `snapshot()` and `restore()` are implemented (law L5). */
  readonly snapshot: boolean;
}

export interface Observation<State> {
  readonly state: State;
  /** False while the system is still settling. An unstable state never becomes an oracle. */
  readonly stable: boolean;
}

export type Verdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

export type SnapshotId = string & { readonly __brand: "SnapshotId" };

/** A trace whose actions and oracles are narrowed to one adapter's vocabularies. */
export type TypedOracle<O> = Omit<Oracle, "check"> & { check: O };
export type TypedStep<A, O> = Omit<Step, "action" | "checkpoints"> & {
  action: A;
  checkpoints: TypedOracle<O>[];
};
export type TypedTrace<A, O> = Omit<Trace, "steps" | "invariants"> & {
  steps: TypedStep<A, O>[];
  invariants: TypedOracle<O>[];
};

/**
 * Drives the live system. Used to explore and to repair.
 * A replay never uses it: a replay runs the compiled artifact.
 */
export interface SystemDriver<State, A, O> {
  readonly capabilities: Capabilities;
  setup(): Promise<void>;
  teardown(): Promise<void>;
  observe(): Promise<Observation<State>>;
  execute(action: A): Promise<void>;
  /** Deterministic, with no model call. */
  verify(oracle: O): Promise<Verdict>;
  snapshot?(): Promise<SnapshotId>;
  restore?(id: SnapshotId): Promise<void>;
}

export interface ReplayOptions {
  /** Values of the parameters the trace declares, by name. Never stored in the artifact (law L7). */
  readonly params?: Readonly<Record<string, string>>;
}

/** One target per artifact format. It compiles, then runs the native tool. */
export interface Target<A, O> {
  /** "playwright", "maestro". */
  readonly id: string;
  /** Pure: the same trace gives the same bytes (law L1). */
  compile(trace: TypedTrace<A, O>): CompiledArtifact;
  /** Runs the artifact with its own tool and reports typed divergences. */
  replay(artifact: CompiledArtifact, options?: ReplayOptions): Promise<ReplayResult>;
}

export interface Adapter<State, A, O> {
  readonly id: string;
  readonly actions: z.ZodType<A>;
  readonly oracles: z.ZodType<O>;
  readonly driver: SystemDriver<State, A, O>;
  readonly targets: readonly Target<A, O>[];
}

export function defineAdapter<State, A, O>(adapter: Adapter<State, A, O>): Adapter<State, A, O> {
  return adapter;
}
