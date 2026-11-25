/** The mobile adapter, as a module the `ecr` command can load with `--adapter`. */
import { createMaestroAdapter } from "./adapter.ts";

export * from "./adapter.ts";
export default createMaestroAdapter();
