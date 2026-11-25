/** Entry point of the `ecr` command. Run: pnpm ecr <command> */
import { run } from "./run.ts";

process.exitCode = await run(process.argv.slice(2), {
  out: (line) => console.log(line),
  err: (line) => console.error(line),
  env: process.env,
  cwd: process.cwd(),
});
