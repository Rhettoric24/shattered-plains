// Bundle analysis code in memory; the CLI only writes local reports.
import { build } from "esbuild";
const result = await build({
  entryPoints: ["./combat-balance/run.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  tsconfigRaw: { compilerOptions: { target: "ES2022" } },
});
await import(
  "data:text/javascript;base64," +
    Buffer.from(result.outputFiles[0].contents).toString("base64")
).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
