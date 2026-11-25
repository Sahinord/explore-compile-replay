/**
 * The `ecr` command.
 *
 *   ecr validate <trace...> [--adapter <module>]
 *   ecr compile <trace...> --adapter <module> [--target <id>] [--out <dir>] [--check]
 *   ecr replay <trace...> --adapter <module> [--target <id>] [--times <n>] [--report <file>]
 *   ecr repair <trace> --adapter <module> --step <id> --action <json> [--target <id>] [--out <dir>]
 *   ecr conformance <trace...> --adapter <module> [--network-closed]
 *
 * No command here calls a model. Exploring is done by an agent, through
 * the MCP server (not written yet). A repair is proposed by an agent or a
 * person: `ecr repair` only decides whether it is accepted.
 *
 * Status: draft.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import type { Adapter, Target, TypedTrace } from "../../../spec/contract.ts";
import { Trace, type Divergence } from "../../../spec/schema.ts";
import { checkAdapter, conforms, formatReport } from "../../conformance/src/index.ts";
import { RepairRefused, TraceError, firstBug, oraclesInOrder, outcomeOf, parseTrace, repair as checkAndApply, type Outcome } from "../../core/src/index.ts";

export interface Io {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly cwd: string;
}

/** 0: all good. 1: a check failed. 2: the command could not run. */
export type ExitCode = 0 | 1 | 2;

/** Prefix of the environment variables that carry parameter values. */
export const PARAM_PREFIX = "ECR_PARAM_";

export const USAGE = `Usage:
  ecr validate <trace...> [--adapter <module>]
      Check traces against the schema, and against an adapter's vocabularies when one is given.
  ecr compile <trace...> --adapter <module> [--target <id>] [--out <dir>] [--check]
      Compile each trace to a test file, next to the trace or in <dir>.
      With --check, write nothing and fail if a file is missing or out of date.
  ecr replay <trace...> --adapter <module> [--target <id>] [--times <n>] [--report <file>]
      Compile each trace and run the result. No model is called.
      pass: every oracle holds. bug: the replay stops on a bug the trace records, and on nothing else.
      fixed: an oracle recorded as a bug now holds. FAIL: anything else, and the only result that fails the command.
      With --times, replay each trace <n> times and say how many replays gave each result.
      With --report, write every replay to <file> as JSON: results, durations, where each one stopped.
      The report holds no message of the system and no parameter value.
  ecr repair <trace> --adapter <module> --step <id> --action <json> [--target <id>] [--out <dir>]
      Give a new action to the step a replay diverged on. The patch is accepted only if the replay
      then gives what the trace recorded. Writes the trace and its compiled file.
      A failed oracle is never repaired: it is a regression or an intended change, and a person decides.
  ecr conformance <trace...> --adapter <module> [--network-closed]
      Check the adapter against the seven laws, with these traces.
      With --network-closed, you state that you closed the network around this command. It is checked,
      and law L4 (no model) can then pass.

  <module> is a file whose default export is an adapter (see spec/contract.ts).
  A parameter NAME of a trace takes its value from the environment variable ${PARAM_PREFIX}NAME.`;

class UsageError extends Error {}

type AnyAdapter = Adapter<unknown, unknown, unknown>;
type AnyTrace = TypedTrace<unknown, unknown>;

async function loadAdapter(io: Io, path: string | undefined): Promise<AnyAdapter> {
  if (path === undefined) throw new UsageError("This command needs --adapter <module>");
  const file = resolve(io.cwd, path);
  if (!existsSync(file)) throw new UsageError(`No adapter module at ${path}`);
  const loaded = ((await import(pathToFileURL(file).href)) as { default?: unknown }).default;
  const adapter = (typeof loaded === "function" ? await loaded() : loaded) as Partial<AnyAdapter> | undefined;
  if (!adapter || typeof adapter.id !== "string" || !adapter.actions || !adapter.oracles || !adapter.driver || !Array.isArray(adapter.targets)) {
    throw new UsageError(`${path} does not export an adapter by default`);
  }
  return adapter as AnyAdapter;
}

function readJson(io: Io, path: string): unknown {
  const file = resolve(io.cwd, path);
  if (!existsSync(file)) throw new UsageError(`No trace at ${path}`);
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new UsageError(`${path} is not valid JSON: ${(error as Error).message}`);
  }
}

function pickTarget(adapter: AnyAdapter, id: string | undefined): Target<unknown, unknown> {
  const ids = adapter.targets.map((target) => target.id);
  const target = id === undefined ? adapter.targets[0] : adapter.targets.find((entry) => entry.id === id);
  if (!target) throw new UsageError(id === undefined ? `Adapter ${adapter.id} has no target` : `Adapter ${adapter.id} has no target "${id}". It has: ${ids.join(", ")}`);
  return target;
}

/** Values of the parameters a trace declares, read from the environment. */
function paramValues(io: Io, trace: AnyTrace): Record<string, string> {
  const values: Record<string, string> = {};
  const missing: string[] = [];
  for (const param of trace.params) {
    const value = io.env[PARAM_PREFIX + param.name];
    if (value === undefined) missing.push(PARAM_PREFIX + param.name);
    else values[param.name] = value;
  }
  if (missing.length > 0) throw new UsageError(`Trace ${trace.id} needs these environment variables: ${missing.join(", ")}`);
  return values;
}

/** Reads the traces, and reports the ones that are not valid. */
function loadTraces(io: Io, adapter: AnyAdapter, paths: readonly string[]): { path: string; trace: AnyTrace }[] | undefined {
  const traces: { path: string; trace: AnyTrace }[] = [];
  let invalid = false;
  for (const path of paths) {
    try {
      traces.push({ path, trace: parseTrace(adapter, readJson(io, path)) });
    } catch (error) {
      if (!(error instanceof TraceError)) throw error;
      invalid = true;
      io.err(`FAIL  ${path}`);
      for (const issue of error.issues) io.err(`      ${issue}`);
    }
  }
  return invalid ? undefined : traces;
}

function describe(divergence: Divergence): string {
  const where = divergence.stepId === undefined ? "" : `  step ${divergence.stepId}`;
  const oracle = divergence.type === "oracle_failed" ? `  oracle ${divergence.oracleId}` : "";
  const text = (divergence.message ?? "").split("\n").map((line) => line.trim()).filter(Boolean).join(" ");
  const message = text === "" ? "" : `: ${text.length > 200 ? `${text.slice(0, 200)}...` : text}`;
  return `${divergence.type}${where}${oracle}${message}`;
}

async function validate(io: Io, paths: readonly string[], adapterPath: string | undefined): Promise<ExitCode> {
  if (adapterPath !== undefined) {
    const traces = loadTraces(io, await loadAdapter(io, adapterPath), paths);
    if (!traces) return 1;
    for (const { path, trace } of traces) io.out(`ok    ${path} (${trace.steps.length} steps)`);
    return 0;
  }
  let failed = false;
  for (const path of paths) {
    const result = Trace.safeParse(readJson(io, path));
    if (result.success) {
      io.out(`ok    ${path} (${result.data.steps.length} steps, vocabularies not checked: no --adapter)`);
    } else {
      failed = true;
      io.err(`FAIL  ${path}`);
      for (const issue of result.error.issues) io.err(`      ${issue.path.join(".")}: ${issue.message}`);
    }
  }
  return failed ? 1 : 0;
}

async function compile(io: Io, paths: readonly string[], options: { adapter?: string; target?: string; out?: string; check: boolean }): Promise<ExitCode> {
  const adapter = await loadAdapter(io, options.adapter);
  const target = pickTarget(adapter, options.target);
  const traces = loadTraces(io, adapter, paths);
  if (!traces) return 1;

  let stale = false;
  for (const { path, trace } of traces) {
    const artifact = target.compile(trace);
    const dir = resolve(io.cwd, options.out ?? dirname(path));
    const file = join(dir, artifact.path);
    const shown = join(options.out ?? dirname(path), artifact.path);
    if (options.check) {
      const current = existsSync(file) ? readFileSync(file, "utf8") : undefined;
      if (current === artifact.content) {
        io.out(`ok     ${shown}`);
      } else {
        stale = true;
        io.err(`${current === undefined ? "MISSING" : "STALE  "} ${shown} (compile ${path} again)`);
      }
    } else {
      mkdirSync(dir, { recursive: true });
      writeFileSync(file, artifact.content);
      io.out(`wrote  ${shown} (${target.id}, ${artifact.sourceMap.length} steps)`);
    }
  }
  return stale ? 1 : 0;
}

/** What `ecr replay --report` writes. Types, ids, numbers and hashes only. */
export const REPORT_SCHEMA = "ecr.replays/0";

const LABEL: Record<Outcome, string> = { pass: "pass", known_bug: "bug", fixed: "fixed", fail: "FAIL" };

function sha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

async function replay(
  io: Io,
  paths: readonly string[],
  options: { adapter?: string; target?: string; times?: string; report?: string },
): Promise<ExitCode> {
  const times = options.times === undefined ? 1 : Number(options.times);
  if (!Number.isInteger(times) || times < 1 || times > 1000) throw new UsageError("--times takes a whole number from 1 to 1000");
  const adapter = await loadAdapter(io, options.adapter);
  const target = pickTarget(adapter, options.target);
  const traces = loadTraces(io, adapter, paths);
  if (!traces) return 1;
  const runs = traces.map(({ path, trace }) => ({ path, trace, params: paramValues(io, trace) }));

  let failed = false;
  const reported: unknown[] = [];
  for (const { path, trace, params } of runs) {
    const artifact = target.compile(trace);
    const replays: { outcome: Outcome; durationMs: number; divergences: { type: string; stepId?: string; oracleId?: string }[] }[] = [];
    for (let nth = 1; nth <= times; nth += 1) {
      const result = await target.replay(artifact, { params });
      const outcome = outcomeOf(trace, result);
      if (outcome === "fail") failed = true;
      replays.push({
        outcome,
        durationMs: Math.round(result.durationMs),
        // The message of a divergence may quote the system: it stays out of the report.
        divergences: result.divergences.map((divergence) => ({
          type: divergence.type,
          ...(divergence.stepId === undefined ? {} : { stepId: divergence.stepId }),
          ...(divergence.type === "oracle_failed" ? { oracleId: divergence.oracleId } : {}),
        })),
      });
      if (times > 1) {
        const where = result.divergences.map((divergence) => `  ${divergence.type}${divergence.stepId === undefined ? "" : ` step ${divergence.stepId}`}`).join("");
        (outcome === "fail" ? io.err : io.out)(`${LABEL[outcome].padEnd(5)} ${trace.id}  replay ${nth} of ${times} (${Math.round(result.durationMs)} ms)${where}`);
        continue;
      }
      const time = `${Math.round(result.durationMs)} ms`;
      if (outcome === "pass") {
        io.out(`pass  ${trace.id} (${target.id}, ${time})`);
      } else if (outcome === "known_bug") {
        io.out(`bug   ${trace.id} (${target.id}, ${time})`);
        for (const divergence of result.divergences) io.out(`      ${describe(divergence)}`);
        io.out("      This oracle was recorded as a bug, and the bug is still there. The steps after it did not run.");
      } else if (outcome === "fixed") {
        const bugs = oraclesInOrder(trace).filter((oracle) => oracle.observed === "failed").map((oracle) => oracle.oracleId);
        io.out(`fixed ${trace.id} (${target.id}, ${time})`);
        io.out(`      Recorded as a bug, and it holds now: ${bugs.join(", ")}. Remove "observed": "failed" from the trace to keep it as a guard.`);
      } else {
        io.err(`FAIL  ${trace.id} (${target.id}, ${time})`);
        for (const divergence of result.divergences) io.err(`      ${describe(divergence)}`);
        if (result.divergences.some((divergence) => divergence.type === "oracle_failed")) {
          io.err("      A failed oracle is never repaired: it is a regression or an intended change, and a person decides.");
        }
      }
    }
    if (times > 1) {
      const counts = (Object.keys(LABEL) as Outcome[])
        .map((outcome) => ({ outcome, count: replays.filter((entry) => entry.outcome === outcome).length }))
        .filter((entry) => entry.count > 0)
        .map((entry) => `${entry.count} ${LABEL[entry.outcome]}`);
      io.out(`      ${trace.id}: ${counts.join(", ")} on ${times} replays (${target.id})`);
    }
    reported.push({
      id: trace.id,
      path,
      sha256: sha256(readFileSync(resolve(io.cwd, path))),
      steps: trace.steps.length,
      oracles: oraclesInOrder(trace).length,
      recorded: firstBug(trace) ? "known_bug" : "pass",
      artifact: { path: artifact.path, sha256: sha256(artifact.content) },
      replays,
    });
  }
  if (options.report !== undefined) {
    const file = resolve(io.cwd, options.report);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify({ schema: REPORT_SCHEMA, adapter: adapter.id, target: target.id, times, traces: reported }, null, 2)}\n`);
    io.out(`wrote  ${options.report}`);
  }
  return failed ? 1 : 0;
}

async function repair(
  io: Io,
  paths: readonly string[],
  options: { adapter?: string; target?: string; out?: string; step?: string; action?: string },
): Promise<ExitCode> {
  const [path, ...others] = paths;
  if (path === undefined || others.length > 0) throw new UsageError("ecr repair takes one trace file");
  if (options.step === undefined || options.action === undefined) throw new UsageError("ecr repair needs --step <id> and --action <json>");
  let action: unknown;
  try {
    action = JSON.parse(options.action);
  } catch (error) {
    throw new UsageError(`--action is not valid JSON: ${(error as Error).message}`);
  }

  const adapter = await loadAdapter(io, options.adapter);
  const target = pickTarget(adapter, options.target);
  const traces = loadTraces(io, adapter, [path]);
  if (!traces) return 1;
  const { trace } = traces[0]!;
  if (!trace.steps.some((step) => step.id === options.step)) throw new UsageError(`Trace ${trace.id} has no step "${options.step}"`);

  try {
    const result = await checkAndApply(adapter, target, trace, { stepId: options.step, action }, { params: paramValues(io, trace) });
    // The file is edited in place, one action replaced, so that the change reads as one hunk.
    const file = readJson(io, path) as { steps: { id: string; action: unknown }[] };
    for (const step of file.steps) if (step.id === options.step) step.action = action;
    writeFileSync(resolve(io.cwd, path), `${JSON.stringify(file, null, 2)}\n`);
    const dir = resolve(io.cwd, options.out ?? dirname(path));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, result.artifact.path), result.artifact.content);

    io.out(`repaired  ${trace.id}  step ${options.step} (${target.id})`);
    io.out(`      was: ${describe(result.repaired)}`);
    io.out(`      wrote ${path}`);
    io.out(`      wrote ${join(options.out ?? dirname(path), result.artifact.path)}`);
    return 0;
  } catch (error) {
    if (!(error instanceof RepairRefused)) throw error;
    io.err(`REFUSED  ${trace.id}  step ${options.step} (${error.reason})`);
    io.err(`      ${error.message}`);
    for (const divergence of error.divergences) io.err(`      ${describe(divergence)}`);
    return 1;
  }
}

async function conformance(io: Io, paths: readonly string[], options: { adapter?: string; networkClosed: boolean }): Promise<ExitCode> {
  const adapter = await loadAdapter(io, options.adapter);
  const traces = loadTraces(io, adapter, paths);
  if (!traces) return 1;
  const cases = traces.map(({ trace }) => ({ trace, params: paramValues(io, trace) }));
  const results = await checkAdapter(adapter, cases, { networkClosed: options.networkClosed });
  io.out(`Conformance of adapter "${adapter.id}"\n`);
  io.out(formatReport(results));
  return conforms(results) ? 0 : 1;
}

export async function run(argv: readonly string[], io: Io): Promise<ExitCode> {
  try {
    const { values, positionals } = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
        adapter: { type: "string" },
        target: { type: "string" },
        out: { type: "string" },
        step: { type: "string" },
        action: { type: "string" },
        times: { type: "string" },
        report: { type: "string" },
        check: { type: "boolean", default: false },
        "network-closed": { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
    });
    const [command, ...paths] = positionals;
    if (values.help || command === undefined || command === "help") {
      io.out(USAGE);
      return command === undefined && !values.help ? 2 : 0;
    }
    if (!["validate", "compile", "replay", "repair", "conformance"].includes(command)) throw new UsageError(`Unknown command "${command}"`);
    if (paths.length === 0) throw new UsageError(`ecr ${command} needs at least one trace file`);

    const options = {
      ...(values.adapter === undefined ? {} : { adapter: values.adapter }),
      ...(values.target === undefined ? {} : { target: values.target }),
      ...(values.out === undefined ? {} : { out: values.out }),
    };
    if (command === "validate") return await validate(io, paths, values.adapter);
    if (command === "compile") return await compile(io, paths, { ...options, check: values.check });
    if (command === "replay") {
      return await replay(io, paths, {
        ...options,
        ...(values.times === undefined ? {} : { times: values.times }),
        ...(values.report === undefined ? {} : { report: values.report }),
      });
    }
    if (command === "repair") {
      return await repair(io, paths, {
        ...options,
        ...(values.step === undefined ? {} : { step: values.step }),
        ...(values.action === undefined ? {} : { action: values.action }),
      });
    }
    return await conformance(io, paths, { ...options, networkClosed: values["network-closed"] });
  } catch (error) {
    if (error instanceof UsageError || (error as { code?: string }).code?.startsWith("ERR_PARSE_ARGS")) {
      io.err(`ecr: ${(error as Error).message}`);
      io.err("Run `ecr --help` for the commands.");
      return 2;
    }
    throw error;
  }
}
