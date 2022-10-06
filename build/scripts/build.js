import { exec } from "child_process";
import { writeFileSync, readdirSync, unlinkSync, renameSync } from "fs";
import { makeBadge } from "badge-maker";
import { __dirname, EXIT_SUCCESS, EXIT_FAILURE } from "./shared.js";
import { rollup } from "rollup";

const buildBadgeOptions = {
  label: "build",
  message: "passing",
  color: "brightgreen",
};

console.log("Running TypeScript compiler...");
let exitStatus = EXIT_SUCCESS;

const root = `${__dirname}/../../`;

exec("tsc", { cwd: root }, async (buildError, _, __) => {
  if (buildError) {
    console.log(`TypeScript build failed:\n${buildError}`);
    buildBadgeOptions.message = "failing";
    buildBadgeOptions.color = "red";

    writeFileSync("./status/build.svg", makeBadge(buildBadgeOptions));

    process.exit(EXIT_FAILURE);
  }

  console.log("Bundling...");

  try {
    const bundle = await rollup({ input: `${root}/build/index.js` });

    try {
      await bundle.write({
        file: `${root}/dist/index.js`,
        format: "es",
      });
    } catch (writeError) {
      console.log(`Could not persist bundle to disk:\n${writeError}`);
      exitStatus = EXIT_FAILURE;
    }
  } catch (e) {
    console.error(`Module bundling failed:\n${e}`);
    exitStatus = EXIT_FAILURE;
  }

  if (exitStatus === EXIT_FAILURE) {
    buildBadgeOptions.message = "failing";
    buildBadgeOptions.color = "red";
  } else {
    console.log("BUILD SUCCEEDED");
  }

  writeFileSync("./status/build.svg", makeBadge(buildBadgeOptions));

  // if (exitStatus === EXIT_FAILURE) process.exit(exitStatus);

  // const distPath = `${root}/dist`;
  // const fNamePattern = /[.]js$/;

  // console.log("Cleaning up...");
  // readdirSync(distPath)
  //   .filter((fileName) => fNamePattern.test(fileName))
  //   .map((fileName) => unlinkSync(`${distPath}/${fileName}`));

  // renameSync(`${distPath}/bundle`, `${distPath}/index.js`);

  process.exit(EXIT_SUCCESS);
});
