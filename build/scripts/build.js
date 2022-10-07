import { exec } from "child_process";
import { writeFileSync, readdirSync, unlinkSync, renameSync } from "fs";
import { makeBadge } from "badge-maker";
import { __dirname, EXIT_SUCCESS, EXIT_FAILURE } from "./shared.js";
import { rollup } from "rollup";
import dts from "rollup-plugin-dts";

const buildBadgeOptions = {
  label: "build",
  message: "passing",
  color: "brightgreen",
};

console.log("Running TypeScript compiler...");
let exitStatus = EXIT_SUCCESS;

const root = `${__dirname}/../../`;

async function bundle(inputFile, outputFile, outputFormat) {
  try {
    const bundle = await rollup({
      input: inputFile,
      plugins: [...(inputFile.includes(".d.ts") ? [dts()] : [])],
    });

    try {
      await bundle.write({
        file: outputFile,
        format: outputFormat,
      });
    } catch (writeError) {
      console.error(`Failed to write to ${outputFile}:\n${writeError}`);
      exitStatus = EXIT_FAILURE;
    }
  } catch (e) {
    console.error(`Failed to bundle ${inputFile}:\n${e}`);
    exitStatus = EXIT_FAILURE;
  }

  if (exitStatus === EXIT_FAILURE) {
    buildBadgeOptions.message = "failing";
    buildBadgeOptions.color = "red";

    writeFileSync("./status/build.svg", makeBadge(buildBadgeOptions));
    process.exit(exitStatus);
  }
}

exec("tsc", { cwd: root }, async (buildError, _, __) => {
  if (buildError) {
    console.log(`TypeScript build failed:\n${buildError}`);
    buildBadgeOptions.message = "failing";
    buildBadgeOptions.color = "red";

    writeFileSync("./status/build.svg", makeBadge(buildBadgeOptions));

    process.exit(EXIT_FAILURE);
  }

  console.log("Bundling...");

  await bundle(`${root}/build/index.js`, `${root}/dist/index.js`, "es");
  await bundle(`${root}/build/dts/index.d.ts`, `${root}/dist/index.d.ts`, "es");

  writeFileSync("./status/build.svg", makeBadge(buildBadgeOptions));
  process.exit(EXIT_SUCCESS);
});
