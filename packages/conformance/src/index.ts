/**
 * Conformance kit, first slice: checks an adapter against the seven laws
 * of `spec/laws.md`.
 *
 * It is honest about what it cannot check yet. A law that is only partly
 * covered is reported as "partial", and a law with no check is "skipped".
 * Neither counts as a pass.
 *
 * Status: draft.
 */
import { connect } from "node:net";
import type { Adapter, Received, Target, TypedTrace } from "../../../spec/contract.ts";
import type { ReplayResult } from "../../../spec/schema.ts";
import { canonicalJson, checkPatchLocality, checkSourceMap, firstBug, hashTrace, outcomeOf, resolveParams } from "../../core/src/index.ts";

export type LawId = "L1" | "L2" | "L3" | "L4" | "L5" | "L6" | "L7";
export type LawStatus = "pass" | "fail" | "partial" | "skipped";

export interface LawResult {
  readonly law: LawId;
  readonly title: string;
  readonly status: LawStatus;
  readonly detail: string;
}

/**
 * A trace recorded on the system the targets replay against. Its replay must
 * give what was observed: green, or stopped on the first bug the trace records.
 */
export interface ConformanceCase<A, O> {
  readonly trace: TypedTrace<A, O>;
  /** Values of the parameters the trace declares. */
  readonly params?: Readonly<Record<string, string>>;
}

export interface ConformanceOptions {
  /** How many times each artifact is replayed for law L1. Default: 3. */
  readonly replays?: number;
  /**
   * Set when the caller has closed the network around this run: a network
   * namespace, a firewall. The kit checks that it is closed. Every compile
   * and replay of the run then counts for law L4.
   */
  readonly networkClosed?: boolean;
  /** How the kit checks it: resolves to the address it could reach, or to nothing. Default: `reachableAddress`. */
  readonly probe?: () => Promise<string | undefined>;
}

/** Public addresses that answer on port 443. Literal, so that no name has to be resolved. */
const PROBES = ["1.1.1.1", "8.8.8.8", "9.9.9.9"];

/** The first public address a TCP connection reaches within the delay, or nothing when the network is closed. */
export async function reachableAddress(timeoutMs = 1500): Promise<string | undefined> {
  const attempts = PROBES.map(
    (host) =>
      new Promise<string | undefined>((done) => {
        const socket = connect({ host, port: 443 });
        const finish = (reached: boolean): void => {
          socket.destroy();
          done(reached ? `${host}:443` : undefined);
        };
        socket.setTimeout(timeoutMs, () => finish(false));
        socket.once("connect", () => finish(true));
        socket.once("error", () => finish(false));
      }),
  );
  return (await Promise.all(attempts)).find((address) => address !== undefined);
}

const TITLES: Record<LawId, string> = {
  L1: "Determinism",
  L2: "Fidelity",
  L3: "Traceability",
  L4: "No model",
  L5: "State",
  L6: "Safe repair",
  L7: "No secret",
};

/** Packages whose import in an artifact means a replay could call a model. */
const MODEL_SDKS = [
  "openai",
  "@anthropic-ai/sdk",
  "@google/genai",
  "@google/generative-ai",
  "@mistralai/mistralai",
  "cohere-ai",
  "ollama",
  "langchain",
  "@langchain/core",
  "ai",
];

function result(law: LawId, status: LawStatus, detail: string): LawResult {
  return { law, title: TITLES[law], status, detail };
}

/** What two replays must agree on: everything but the time they took. */
function outcome(replay: ReplayResult): string {
  return canonicalJson({ verdict: replay.verdict, divergences: replay.divergences });
}

function label<A, O>(target: Target<A, O>, testCase: ConformanceCase<A, O>): string {
  return `${target.id}/${testCase.trace.id}`;
}

/** Where what the system received leaves what the trace planned, or nothing when they agree. */
function firstDifference(planned: readonly Received[], received: readonly Received[]): string | undefined {
  for (let index = 0; index < Math.max(planned.length, received.length); index += 1) {
    const want = planned[index];
    const got = received[index];
    const place = `call ${index + 1} of ${planned.length}`;
    if (!want) return `the system received more than the trace holds: ${canonicalJson(got)} after the last planned call`;
    if (!got) return `the system did not receive ${place}: ${canonicalJson(want)}`;
    if (want.kind !== got.kind) return `${place}: the trace plans an ${want.kind}, the system received an ${got.kind}`;
    if (want.kind === "action" && got.kind === "action" && canonicalJson(want.action) !== canonicalJson(got.action)) {
      return `${place}: the trace plans ${canonicalJson(want.action)}, the system received ${canonicalJson(got.action)}`;
    }
    if (want.kind === "oracle" && got.kind === "oracle" && got.check !== undefined && canonicalJson(want.check) !== canonicalJson(got.check)) {
      return `${place}: the trace plans the check ${canonicalJson(want.check)}, the system received ${canonicalJson(got.check)}`;
    }
  }
  return undefined;
}

function importsModelSdk(content: string): string | undefined {
  return MODEL_SDKS.find((name) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
    return new RegExp(`(?:from\\s*|import\\s*\\(?\\s*|require\\s*\\(\\s*)["']${escaped}(?:/[^"']*)?["']`).test(content);
  });
}

export async function checkAdapter<State, A, O>(
  adapter: Adapter<State, A, O>,
  cases: readonly ConformanceCase<A, O>[],
  options: ConformanceOptions = {},
): Promise<LawResult[]> {
  if (cases.length === 0) throw new Error("The conformance kit needs at least one trace");
  if (adapter.targets.length === 0) throw new Error("The adapter declares no target");
  const replays = options.replays ?? 3;
  // Checked first, so that a network that is open by mistake is seen before anything runs.
  const reached = options.networkClosed ? await (options.probe ?? reachableAddress)() : undefined;

  const determinism: string[] = [];
  const fidelity: string[] = [];
  const traceability: string[] = [];
  const noModel: string[] = [];
  const noSecret: string[] = [];
  let secretsChecked = 0;
  let instrumented = 0;
  const safeRepair: string[] = [];
  let patchesChecked = 0;

  for (const target of adapter.targets) {
    for (const testCase of cases) {
      const name = label(target, testCase);
      const artifact = target.compile(testCase.trace);

      // L1, compile: the same trace gives the same bytes.
      if (canonicalJson(target.compile(testCase.trace)) !== canonicalJson(artifact)) {
        determinism.push(`${name}: two compilations differ`);
      }
      if (artifact.traceHash !== hashTrace(testCase.trace)) {
        determinism.push(`${name}: traceHash is not the hash of the trace`);
      }

      // L1, replay: the same artifact gives the same verdict. L2: a recorded trace replays as it was observed.
      const runs: ReplayResult[] = [];
      for (let run = 0; run < replays; run += 1) {
        runs.push(await target.replay(artifact, testCase.params ? { params: testCase.params } : {}));
      }
      const first = runs[0];
      if (first && runs.some((run) => outcome(run) !== outcome(first))) {
        determinism.push(`${name}: ${replays} replays gave different verdicts`);
      }
      const expected = firstBug(testCase.trace) ? "known_bug" : "pass";
      if (first && outcomeOf(testCase.trace, first) !== expected) {
        fidelity.push(
          expected === "pass"
            ? `${name}: the replay of a recorded trace failed (${outcome(first)})`
            : `${name}: the replay did not stop on the bug the trace records (${outcome(first)})`,
        );
      }

      // L2, order: an instrumented system receives the actions and the oracles of the trace, in order,
      // and nothing else. A trace that records a bug stops on it.
      if (target.replayInstrumented) {
        instrumented += 1;
        const values = testCase.params ?? {};
        const bug = firstBug(testCase.trace);
        const planned: Received[] = [];
        plan: for (const step of testCase.trace.steps) {
          planned.push({ kind: "action", action: resolveParams(step.action, values) });
          for (const oracle of [...step.checkpoints, ...testCase.trace.invariants]) {
            planned.push({ kind: "oracle", check: resolveParams(oracle.check, values) });
            if (bug && bug.stepId === step.id && bug.oracleId === oracle.id) break plan;
          }
        }
        const seen = await target.replayInstrumented(artifact, testCase.params ? { params: testCase.params } : {});
        if (outcomeOf(testCase.trace, seen.result) !== expected) {
          fidelity.push(`${name}: on the instrumented system, the replay did not give what the trace records (${outcome(seen.result)})`);
        } else {
          const problem = firstDifference(planned, seen.received);
          if (problem !== undefined) fidelity.push(`${name}: ${problem}`);
        }
      }

      // L3: each step maps to one distinct range.
      const steps = testCase.trace.steps.map((step) => step.id);
      for (const problem of checkSourceMap(artifact, steps)) traceability.push(`${name}: ${problem}`);

      // L6, compile: a new action for one step changes the text of that step only.
      // The kit cannot invent an action, so it gives each step the action of another step.
      for (const step of testCase.trace.steps) {
        const donor = testCase.trace.steps.find((other) => canonicalJson(other.action) !== canonicalJson(step.action));
        if (!donor) continue;
        let patched;
        try {
          patched = target.compile({
            ...testCase.trace,
            steps: testCase.trace.steps.map((entry) => (entry.id === step.id ? { ...entry, action: donor.action } : entry)),
          });
        } catch {
          // The target refuses this action at this place (a first step that must open the app, for example).
          continue;
        }
        patchesChecked += 1;
        for (const problem of checkPatchLocality(artifact, patched, step.id)) safeRepair.push(`${name}: ${problem}`);
      }

      // L4: the artifact imports no known model SDK.
      const sdk = importsModelSdk(artifact.content);
      if (sdk !== undefined) noModel.push(`${name}: the artifact imports ${sdk}`);

      // L7: no secret value in the trace or in the artifact.
      const stored = JSON.stringify(testCase.trace);
      for (const param of testCase.trace.params) {
        const value = testCase.params?.[param.name];
        if (!param.secret || value === undefined || value === "") continue;
        secretsChecked += 1;
        if (stored.includes(value)) noSecret.push(`${name}: the trace contains the value of ${param.name}`);
        if (artifact.content.includes(value)) noSecret.push(`${name}: the artifact contains the value of ${param.name}`);
      }
    }
  }

  const count = `${cases.length} trace${cases.length === 1 ? "" : "s"}, ${adapter.targets.length} target${adapter.targets.length === 1 ? "" : "s"}`;

  return [
    determinism.length > 0
      ? result("L1", "fail", determinism.join("; "))
      : result("L1", "pass", `same bytes on two compilations, same verdict on ${replays} replays (${count})`),
    fidelity.length > 0
      ? result("L2", "fail", fidelity.join("; "))
      : instrumented < adapter.targets.length * cases.length
        ? result("L2", "partial", "recorded traces replay as observed; no target replays against an instrumented system, so the order of what it receives is not checked")
        : result("L2", "pass", `recorded traces replay as observed, and an instrumented system receives their actions and oracles in order, and nothing else (${count})`),
    traceability.length > 0
      ? result("L3", "fail", traceability.join("; "))
      : result("L3", "pass", `every step has one range, inside the file, with no overlap (${count})`),
    noModel.length > 0
      ? result("L4", "fail", noModel.join("; "))
      : !options.networkClosed
        ? result("L4", "partial", "no artifact imports a known model SDK; this run did not have the network closed")
        : reached !== undefined
          ? result("L4", "fail", `the network was declared closed, but a connection to ${reached} went through`)
          : result("L4", "pass", `no artifact imports a known model SDK, and every compile and replay ran with the network closed (${count})`),
    await checkState(adapter, cases),
    safeRepair.length > 0
      ? result("L6", "fail", [...new Set(safeRepair)].join("; "))
      : patchesChecked === 0
        ? result("L6", "skipped", "no trace has two different actions to exchange")
        : result(
            "L6",
            "partial",
            `a new action for one step leaves the text of the other steps (${patchesChecked} patch${patchesChecked === 1 ? "" : "es"}); that a behaviour change comes back as a failed oracle is not checked yet`,
          ),
    noSecret.length > 0
      ? result("L7", "fail", noSecret.join("; "))
      : secretsChecked === 0
        ? result("L7", "skipped", "no trace declares a secret parameter with a value")
        : result("L7", "pass", `${secretsChecked} secret value${secretsChecked === 1 ? "" : "s"} searched in traces and artifacts, none found`),
  ];
}

/** L5: `restore(snapshot())` brings back a state that is observed as identical. */
async function checkState<State, A, O>(
  adapter: Adapter<State, A, O>,
  cases: readonly ConformanceCase<A, O>[],
): Promise<LawResult> {
  const { driver } = adapter;
  if (!driver.capabilities.snapshot) return result("L5", "skipped", "the driver does not declare the snapshot capability");
  if (!driver.snapshot || !driver.restore) {
    return result("L5", "fail", "the driver declares the snapshot capability but does not implement snapshot and restore");
  }

  const problems: string[] = [];
  for (const testCase of cases) {
    const values = testCase.params ?? {};
    const steps = testCase.trace.steps;
    // Take the snapshot in the middle of the trace, so that the state is not empty.
    const middle = Math.floor(steps.length / 2);
    await driver.setup();
    try {
      for (const step of steps.slice(0, middle)) await driver.execute(resolveParams(step.action, values));
      const before = canonicalJson((await driver.observe()).state);
      const id = await driver.snapshot();
      for (const step of steps.slice(middle)) await driver.execute(resolveParams(step.action, values));
      await driver.restore(id);
      const after = canonicalJson((await driver.observe()).state);
      if (before !== after) problems.push(`${testCase.trace.id}: the state after restore differs from the state at the snapshot`);
    } finally {
      await driver.teardown();
    }
  }
  return problems.length > 0
    ? result("L5", "fail", problems.join("; "))
    : result("L5", "pass", `state identical after restore (${cases.length} trace${cases.length === 1 ? "" : "s"})`);
}

/** True when no law failed. "partial" and "skipped" are not failures, and not passes either. */
export function conforms(results: readonly LawResult[]): boolean {
  return results.every((entry) => entry.status !== "fail");
}

export function formatReport(results: readonly LawResult[]): string {
  return results
    .map((entry) => `${entry.law}  ${entry.title.padEnd(13)} ${entry.status.padEnd(8)} ${entry.detail}`)
    .join("\n");
}
