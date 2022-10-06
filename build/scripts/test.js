import { exec } from "child_process";
import { writeFileSync } from "fs";
import { makeBadge } from "badge-maker";
import { __dirname, EXIT_SUCCESS, EXIT_FAILURE } from "./shared.js";

const MIN_COVERAGE = 95;

const testBadgeOptions = {
  label: "tests",
  message: "",
  color: "",
};

const coverageBadgeOptions = {
  label: "coverage",
  message: "",
  color: "",
};

const parseTestOutput = (output) => {
  const passingRegex = /(?<passingCount>\d+) passing/;
  const failingRegex = /(?<failingCount>\d+) failing/;
  const coverageRegex = /\|[ ]+(?<coveragePercentage>\d+(.\d+)?)[ ]+\|/;

  const passing = output.match(passingRegex);
  const failing = output.match(failingRegex);
  const coverage = output.match(coverageRegex);

  return {
    passing:
      passing === null ? 0 : Number.parseInt(passing.groups.passingCount, 10),
    failing:
      failing === null ? 0 : Number.parseInt(failing.groups.failingCount, 10),
    coverage: Number.parseFloat(coverage.groups.coveragePercentage),
  };
};

const root = `${__dirname}/../../`;

exec(
  `./node_modules/c8/bin/c8.js mocha`,
  { cwd: `${root}` },
  (testError, stdout, ___) => {
    console.log(testError);
    const { passing, failing, coverage } = parseTestOutput(stdout);

    testBadgeOptions.message = `${passing} passing, ${failing} failing`;
    testBadgeOptions.color = failing > 0 ? "red" : "brightgreen";

    const testSVG = makeBadge(testBadgeOptions);
    writeFileSync("./status/test.svg", testSVG);

    coverageBadgeOptions.color =
      coverage < MIN_COVERAGE
        ? "red"
        : coverage < 100
        ? "green"
        : "brightgreen";

    coverageBadgeOptions.message = `${Math.floor(coverage)}%`;

    const coverageSVG = makeBadge(coverageBadgeOptions);
    writeFileSync("./status/coverage.svg", coverageSVG);

    console.log(stdout);
    process.exit(
      testError || coverage < MIN_COVERAGE ? EXIT_FAILURE : EXIT_SUCCESS
    );
  }
);
