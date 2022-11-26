import fs from "fs";
import { getBorderCharacters, table } from "table";
import {
  GenericObject,
  TermEscapeSequence,
  TermInputSequence,
  LineErasureMethod,
} from "./types.js";

// returns a merged object with the left-hand side as the basis
// only overwrites left-hand values if undefined
export const mergeLeft = (
  a?: GenericObject,
  b?: GenericObject
): GenericObject => {
  return a !== undefined && a !== null
    ? b !== undefined && b !== null
      ? Object.keys(a)
          .map((key) => ({
            [key]:
              typeof a[key] === "object" || typeof b[key] === "object"
                ? mergeLeft(a[key], b[key])
                : a[key] ?? b[key],
          }))
          .reduce((accumulator: GenericObject, value: GenericObject, _) => ({
            ...accumulator,
            ...value,
          }))
      : a
    : b;
};

/* sigh - I wish I knew of the ansi-escapes package sooner - oh well, in too deep */

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

export const eraseCharacter = (n: number = 1) =>
  generateSequenceResponseObject(`[${n}${TermInputSequence.ERASE_CHARACTER}`);

export const deleteCharacter = (n: number = 1) =>
  generateSequenceResponseObject(`[${n}${TermInputSequence.DELETE_CHARACTER}`);

export const moveCursorToColumn = (n: number) =>
  generateSequenceResponseObject(
    `[${n}${TermInputSequence.MOVE_CURSOR_TO_COLUMN}`
  );

export const moveCursorToRow = (n: number) =>
  generateSequenceResponseObject(
    `[${n}${TermInputSequence.MOVE_CURSOR_TO_ROW}`
  );

export const moveCursorTo = (row: number, column: number) =>
  generateSequenceResponseObject(
    `[${row};${column}${TermInputSequence.MOVE_CURSOR_TO_ROW_COLUMN}`
  );

export const concat = (...args: Array<SequenceResponse | string>) =>
  args
    .map((arg) => (typeof arg === "string" ? arg : arg.sequence.escaped))
    .reduce((accum, value) => `${accum}${value}`);

// takes a list of auto-complete matches and converts them into an [n x 3] table
// of strings
export const tablify = (autocompleteMatches: string[], colCount: number) => {
  const result: string[][] = [];
  const currentRow: string[] = [];

  if (autocompleteMatches.length == 0) return { output: "", rowCount: 0 };

  autocompleteMatches.forEach((str) => {
    currentRow.push(str);

    if (currentRow.length === colCount) {
      result.push(currentRow.concat());
      currentRow.length = 0;
    }
  });

  if (currentRow.length) {
    // fill in any missing cells - table requires consistent cell counts per row
    for (
      let emptyCells = colCount - currentRow.length;
      emptyCells > 0;
      --emptyCells
    )
      currentRow.push("");

    result.push(currentRow.concat());
  }

  return {
    output: table(result, {
      border: getBorderCharacters("void"),
      columnDefault: {
        paddingLeft: 2,
        paddingRight: 2,
      },
      drawHorizontalLine: () => false,
    }),
    rowCount: result.length,
  };
};

// credit to kennebec, et. al.
// https://stackoverflow.com/a/1917041/3578493
export const getCommonStartingSubstring = (list: string[]) => {
  if (list.length === 0) return null;
  if (list.length === 1) return list[0];

  const sortedMatches = list.concat().sort();
  const first = sortedMatches[0];
  const last = sortedMatches.slice(-1)[0];
  const minLength = Math.min(first.length, last.length);

  const result = [];

  for (let i = 0; i < minLength; ++i) {
    if (first[i] === last[i]) result.push(first[i]);
    else return result.length ? result.join("") : null;
  }

  return result.join("");
};

export const diffIndex = (strA: string, strB: string) => {
  let i = 0;
  for (; i < Math.min(strA.length, strB.length); i++) {
    // implies they differ somewhere not at the end
    if (strA[i] !== strB[i]) return i;
  }

  // implies the longer string differs than the shorter string
  // at the index past the end of the shorter string
  return i;
};

/* sinon can't stub modules, so we need to export this function as a property of an object to
avoid running this code in our unit tests. This code tends to break the order in which
the tests expect to see fs.readSync calls, and tends to output escape sequences to the terminal
where the test output should be.

Todo - at some point I might want to just export all of the utilies like this for consistency

*/
export default {
  getCursorPosition: (fileDescriptor: number) => {
    process.stdout.write(escape(`[${TermInputSequence.GET_CURSOR_POSITION}`));

    const buf = Buffer.alloc(10);
    fs.readSync(fileDescriptor, buf);

    const asString = buf.toString(); // "\u001b[<row>;<col>R"
    const coordSections = asString.substring(asString.indexOf("[")).split(";");

    const pos = {
      row: parseInt(coordSections[0].substring(1)),
      col: parseInt(coordSections[1]),
    };

    return pos;
  },
};
