/** The reference adapter, replaying against a system where an item is no longer found by its title. */
import { createFixtureAdapter } from "../../src/adapter.ts";

export default createFixtureAdapter({ system: new URL("./target-moved.ts", import.meta.url).href });
