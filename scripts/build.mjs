// Builds into .next-prod so a production build can never clobber a running `pnpm dev`
// (which owns .next). Cross-platform: no inline env-var syntax.
import { spawn } from "node:child_process";
const child = spawn(
  process.platform === "win32" ? "next.cmd" : "next",
  ["build"],
  { stdio: "inherit", env: { ...process.env, NEXT_DIST_DIR: ".next-prod" }, shell: process.platform === "win32" }
);
child.on("exit", (code) => process.exit(code ?? 1));
