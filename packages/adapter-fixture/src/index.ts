/** The reference adapter, as a module the `ecr` command can load with `--adapter`. */
import { createFixtureAdapter } from "./adapter.ts";

export * from "./adapter.ts";
export default createFixtureAdapter();
