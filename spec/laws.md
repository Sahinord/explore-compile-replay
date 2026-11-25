# The seven laws

Status: draft. The wording will change before 0.1.

An adapter is correct when it obeys these laws. Each law has an identifier, a statement, and the way the conformance kit checks it. A first slice of the kit is in [`packages/conformance`](../packages/conformance/src/index.ts): it covers L1, L3, L5 and L7, and part of L2, L4 and L6. The checks below are its specification.

Words used here are defined in [`schema.ts`](schema.ts) (trace, step, oracle, artifact, divergence) and in [`contract.ts`](contract.ts) (driver, target).

## L1. Determinism

The same trace compiles to the same bytes. The same artifact, run against the same system state, gives the same verdict.

**Check.** Compile each example trace twice and compare the bytes. Replay each artifact several times from a fresh setup and compare the verdicts.

## L2. Fidelity

The artifact runs the actions of the trace and checks its oracles, in the same order. It adds none and drops none.

An oracle recorded as a bug (`observed: "failed"`) is checked like any other. On the system where it was recorded, the replay stops on that oracle and on nothing before it.

**Check.** Replay the artifact against an instrumented system and compare the sequence it receives with the sequence in the trace.

## L3. Traceability

Each step of the trace maps to one distinct range of the artifact, through the source map. Ranges do not overlap.

**Check.** Validate the source map of each artifact: every step has a range, every range is inside the file, no two ranges overlap.

## L4. No model

Compiling and replaying call no model.

**Check.** Run compile and replay with the network closed, and verify that the core and the targets import no LLM SDK.

## L5. State

When a driver declares the `snapshot` capability, `restore(snapshot())` brings the system back to a state that is observed as identical.

**Check.** Observe, take a snapshot, execute actions, restore, observe again, and compare the two observations. Skipped when the capability is not declared.

## L6. Safe repair

A repair patch stays inside the range of the step that diverged. It removes no oracle and weakens none. A failed oracle is never repaired: it is a regression or an intended change, and a person decides.

A patch is one step and one new action. It is accepted only if the replay of the patched artifact gives what the trace recorded. ECR proposes no patch: an agent or a person does.

**Check.** Inject each kind of divergence, run the repair, and verify that the patch touches only the range of the failing step and that the set of oracles is unchanged. Inject a behaviour change and verify that no patch is accepted.

Today the kit checks the first half on the compiled files: it gives each step the action of another step, and verifies that the text of every other step is unchanged. The second half is checked by the tests of the core on the reference adapter, not yet for every adapter.

## L7. No secret

Neither the trace nor the artifact contains a secret value. A secret appears by name only, and its value is supplied at replay time.

**Check.** Explore with marked secret values, then search the trace and the artifact for them.
