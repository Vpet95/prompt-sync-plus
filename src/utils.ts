import { GenericObject } from "./types.js";
import {
  TermEscapeSequence,
  TermInputSequence,
  LineErasureMethod,
} from "./types.js";

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

type SequenceResponse = {
  sequence: {
    raw: string;
    escaped: string;
  };
  exec: () => void;
};

const generateSequenceResponseObject = (seq: string) => ({
  sequence: {
    raw: seq,
    escaped: escape(seq),
  },
  exec: () => {
    process.stdout.write(escape(seq));
  },
});

// todo - refactor this to be chainable e.g.
// move.down(n).left(m).exec()

// generates a cursor movement object that can either return its own
// escape sequence
export const move = (n?: number) => {
  const moveCount = typeof n === "number" && n > 1 ? `${n}` : "";
  const seqStart = `[${moveCount}`;

  return {
    down: generateSequenceResponseObject(
      `${seqStart}${TermInputSequence.ARROW_DOWN}`
    ),
    left: generateSequenceResponseObject(
      `${seqStart}${TermInputSequence.ARROW_LEFT}`
    ),
    up: generateSequenceResponseObject(
      `${seqStart}${TermInputSequence.ARROW_UP}`
    ),
    right: generateSequenceResponseObject(
      `${seqStart}${TermInputSequence.ARROW_RIGHT}`
    ),
  };
};

export const saveCursorPosition = () =>
  generateSequenceResponseObject(`[${TermInputSequence.SAVE_CURSOR}`);

export const restoreCursorPosition = () =>
  generateSequenceResponseObject(`[${TermInputSequence.RESTORE_CURSOR}`);

export const eraseLine = (
  method: LineErasureMethod = LineErasureMethod.CURSOR_TO_END
) =>
  generateSequenceResponseObject(`[${method}${TermInputSequence.ERASE_LINE}`);

export const moveCursorToColumn = (n: number) =>
  generateSequenceResponseObject(
    `[${n}${TermInputSequence.MOVE_CURSOR_TO_COLUMN}`
  );

export const concat = (...args: Array<SequenceResponse | string>) =>
  args
    .map((arg) => (typeof arg === "string" ? arg : arg.sequence.escaped))
    .reduce((accum, value) => `${accum}${value}`);
