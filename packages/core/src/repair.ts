/**
 * Repair, the bounded part (law L6).
 *
 * When a system changes, a replay can break on a step that no longer
 * finds its target. Someone, an agent or a person, looks at the system
 * and proposes a new action for that step. This module decides whether
 * the proposal is accepted. It calls no model.
 *
 * A proposal holds one step id and one action, and nothing else. So it
 * cannot remove or weaken an oracle: it has no way to name one. It is
 * accepted only if the replay then gives what the trace recorded.
 *
 * Status: draft.
 */
import type { Adapter, ReplayOptions, Target, TypedTrace } from "../../../spec/contract.ts";
import type { CompiledArtifact, Divergence, ReplayResult } from "../../../spec/schema.ts";
import { firstBug, outcomeOf, type Outcome } from "./index.ts";

/** A new action for the step that diverged. */
export interface RepairProposal<A> {
  readonly stepId: string;
  readonly action: A;
}

export type RefusalReason =
  /** The replay already gives what the trace recorded. */
  | "nothing_to_repair"
  /** An oracle failed: a regression or an intended change. A person decides. */
  | "oracle_failed"
  /** The proposal is for another step than the one that diverged. */
  | "wrong_step"
  /** The action is not in the vocabulary of the adapter, or cannot be compiled. */
  | "invalid_action"
  /** The compiled file changed outside the range of the step. */
  | "not_local"
  /** With the new action, the replay still does not give what the trace recorded. */
  | "still_diverges";

export class RepairRefused extends Error {
  override name = "RepairRefused";
  readonly reason: RefusalReason;
  /** What the replay reported: before the patch, or after it for `still_diverges`. */
  readonly divergences: readonly Divergence[];

  constructor(reason: RefusalReason, message: string, divergences: readonly Divergence[] = []) {
    super(message);
    this.reason = reason;
    this.divergences = divergences;
  }
}

export interface Repair<A, O> {
  /** The trace with the new action. Everything else is the same object as before. */
  readonly trace: TypedTrace<A, O>;
  readonly artifact: CompiledArtifact;
  /** The divergence the patch answers. */
  readonly repaired: Divergence;
  /** The replay of the patched artifact. */
  readonly after: ReplayResult;
}

function rangeText(artifact: CompiledArtifact, stepId: string): string | undefined {
  const range = artifact.sourceMap.find((entry) => entry.stepId === stepId);
  if (!range) return undefined;
  return artifact.content.split("\n").slice(range.startLine - 1, range.endLine).join("\n");
}

/**
 * Law L6, on the compiled files: a patch to one step leaves the text of
 * every other step as it was. Returns the problems, empty when it does.
 * Lines outside every range (the header, with the hash of the trace) may change.
 */
export function checkPatchLocality(before: CompiledArtifact, after: CompiledArtifact, stepId: string): string[] {
  const problems: string[] = [];
  const stepsBefore = before.sourceMap.map((range) => range.stepId);
  const stepsAfter = after.sourceMap.map((range) => range.stepId);
  if (stepsBefore.join("\n") !== stepsAfter.join("\n")) {
    return ["the patched file does not have the same steps, in the same order"];
  }
  for (const other of stepsBefore) {
    if (other !== stepId && rangeText(before, other) !== rangeText(after, other)) {
      problems.push(`the patch to step ${stepId} changed the text of step ${other}`);
    }
  }
  return problems;
}

function withAction<A, O>(trace: TypedTrace<A, O>, proposal: RepairProposal<A>): TypedTrace<A, O> {
  return {
    ...trace,
    steps: trace.steps.map((step) => (step.id === proposal.stepId ? { ...step, action: proposal.action } : step)),
  };
}

/** What a replay of this trace must give to match what was recorded. */
function recorded<A, O>(trace: TypedTrace<A, O>): Outcome {
  return firstBug(trace) ? "known_bug" : "pass";
}

/**
 * Checks a proposal and applies it. Throws `RepairRefused` with the reason
 * when the proposal is not accepted. Nothing is written: the caller keeps
 * the trace and the artifact that come back.
 */
export async function repair<State, A, O>(
  adapter: Adapter<State, A, O>,
  target: Target<A, O>,
  trace: TypedTrace<A, O>,
  proposal: RepairProposal<A>,
  options: ReplayOptions = {},
): Promise<Repair<A, O>> {
  const expected = recorded(trace);
  const before = target.compile(trace);
  const broken = await target.replay(before, options);
  const outcome = outcomeOf(trace, broken);
  if (outcome === expected) {
    throw new RepairRefused("nothing_to_repair", `The replay of ${trace.id} gives what the trace recorded: there is nothing to repair`);
  }
  if (outcome === "fixed") {
    throw new RepairRefused("nothing_to_repair", `Every oracle of ${trace.id} holds, including the ones recorded as bugs: there is nothing to repair`);
  }

  const failedOracle = broken.divergences.find((divergence) => divergence.type === "oracle_failed");
  if (failedOracle) {
    throw new RepairRefused(
      "oracle_failed",
      `Oracle ${failedOracle.oracleId} failed. A failed oracle is never repaired: it is a regression or an intended change, and a person decides`,
      broken.divergences,
    );
  }
  const divergence = broken.divergences[0];
  if (!divergence || divergence.stepId === undefined) {
    throw new RepairRefused("still_diverges", "The replay failed and reported no step: there is nothing a patch can aim at", broken.divergences);
  }
  if (divergence.stepId !== proposal.stepId) {
    throw new RepairRefused(
      "wrong_step",
      `The replay diverged on step ${divergence.stepId}. A patch for step ${proposal.stepId} is outside of it`,
      broken.divergences,
    );
  }

  const parsed = adapter.actions.safeParse(proposal.action);
  if (!parsed.success) {
    throw new RepairRefused("invalid_action", `The proposed action is not in the vocabulary of ${adapter.id}: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`);
  }
  const patched = withAction(trace, proposal);
  let after: CompiledArtifact;
  try {
    after = target.compile(patched);
  } catch (error) {
    throw new RepairRefused("invalid_action", `The proposed action cannot be compiled: ${(error as Error).message}`);
  }

  const problems = checkPatchLocality(before, after, proposal.stepId);
  if (problems.length > 0) throw new RepairRefused("not_local", problems.join("; "));

  const result = await target.replay(after, options);
  if (outcomeOf(patched, result) !== expected) {
    throw new RepairRefused(
      "still_diverges",
      result.verdict === "pass"
        ? "With the new action, an oracle that was recorded as a bug holds. A repair does not fix a bug: check the action, or the trace"
        : "With the new action, the replay still does not give what the trace recorded",
      result.divergences,
    );
  }
  return { trace: patched, artifact: after, repaired: divergence, after: result };
}
