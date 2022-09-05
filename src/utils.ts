import { GenericObject } from "./types.js";
import { TermEscapeSequence, TermInputSequence } from "./types.js";

// returns a merged object with the left-hand side as the basis
// only overwrites left-hand values if undefined
export const mergeLeft = (a?: GenericObject, b?: GenericObject) => {
  return a
    ? b
      ? Object.keys(a)
          .map((key) => ({ [key]: a[key] ?? b[key] }))
          .reduce((accumulator: GenericObject, value: GenericObject, _) => ({
            ...accumulator,
            ...value,
          }))
      : a
    : b;
};

export const escape = (str: string) => `${TermEscapeSequence}${str}`;

const generateMoveObj = (inputSequence: string, n?: number) => {
  // runtime type check just in case; caller might not be using TS
  const moveCount = typeof n === "number" && n > 1 ? `${n}` : "";
  const seq = `[${moveCount}${inputSequence}`;

  return {
    sequence: {
      raw: seq,
      escaped: escape(seq),
    },
    exec: () => process.stdout.write(escape(seq)),
  };
};

// generates a cursor movement object that can either return its own
// escape sequence
export const move = (n?: number) => ({
  down: generateMoveObj(TermInputSequence.ARROW_DOWN, n),
  left: generateMoveObj(TermInputSequence.ARROW_LEFT, n),
  up: generateMoveObj(TermInputSequence.ARROW_UP, n),
  right: generateMoveObj(TermInputSequence.ARROW_RIGHT, n),
});
