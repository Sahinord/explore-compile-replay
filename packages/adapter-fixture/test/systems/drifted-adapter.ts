/** The reference adapter, replaying against a system whose behaviour changed. */
import { createFixtureAdapter } from "../../src/adapter.ts";

export default createFixtureAdapter({ system: new URL("./behaviour-change.ts", import.meta.url).href });
