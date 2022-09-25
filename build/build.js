import { exec } from "child_process";
import { writeFileSync } from "fs";
import { makeBadge } from "badge-maker";
import { __dirname, EXIT_SUCCESS, EXIT_FAILURE } from "./shared.js";

const buildBadgeOptions = {
  label: "build",
  message: "",
  color: "",
};

exec("tsc", { cwd: __dirname }, (buildError, _, __) => {
  if (buildError) {
    console.log(`TypeScript build failed:\n${buildError}`);
    buildBadgeOptions.message = "failing";
    buildBadgeOptions.color = "red";
  } else {
    console.log("TypeScript build succeeded");
    buildBadgeOptions.message = "passing";
    buildBadgeOptions.color = "brightgreen";
  }

  const buildSVG = makeBadge(buildBadgeOptions);
  writeFileSync("./status/build.svg", buildSVG);

  if (buildError) process.exit(EXIT_FAILURE);

  process.exit(EXIT_SUCCESS);
});
