import fs from "fs";
import stripAnsi from "strip-ansi";
import {
  AutocompleteBehavior,
  Config,
  ConfigSchema,
  DEFAULT_CONFIG,
  EMPTY_CONFIG,
  ExitCode,
  Key,
  LineErasureMethod,
  PromptSyncHistoryObj,
  Direction,
} from "./types.js";
import utils, {
  concat,
  eraseLine,
  getCommonStartingSubstring,
  mergeLeft,
  move,
  moveCursorToColumn,
  moveCursorTo,
  restoreCursorPosition,
  saveCursorPosition,
  tablify,
  eraseCharacter,
  truncateSuggestions,
} from "./utils.js";

// for testing purposes only - allows me to break out of possible infinite loops that arise during development
const MAX_PROMPT_LOOPS = Number.POSITIVE_INFINITY;

type PromptType = {
  (ask: string, value?: string | Config, configOverride?: Config): string;
  history?: PromptSyncHistoryObj;
  hide?: (ask: string) => string;
};

// todo - might be best to just move all cursor logic into a file
// like cursor.ts to clean this up
type CursorPosition = {
  row: number;
  col: number;
};

// Utility exports to help users
export { Key, AutocompleteBehavior } from "./types.js";

let USER_ASK = "";

// default to 80 columns if we can't figure out the terminal column width for some reason
// this tends to happen if you run prompt-sync-plus from another script (e.g. /build/scripts/test.js)
const TERM_COLS = process.stdout.columns ?? 80;
// 55 is arbitrary - just happens to be how many rows my terminal can fit when maximized
const TERM_ROWS = process.stdout.rows ?? 55;

// top left of terminal window - weird it's not 0,0
let INITIAL_CURSOR_POSITION: CursorPosition = { row: 1, col: 1 };

// Keeps track of the current cursor position without using getCursorPosition below.
// The write to/read from the terminal in getCursorPosition breaks our tests and are unintended side effects
let internalCursorPosition: CursorPosition = { row: 1, col: 1 };

// keeps track of where the end of user input is on screen relative to the terminal window
let inputEndPosition: CursorPosition = { row: 1, col: 1 };

// keeps track of the user input insert position relative to the raw string itself, and not the terminal coordinates
let currentInsertPosition = 0;

// keep track of size so we can calculate cursor positioning and output clearing properly
// todo - this doesn't seem to work since we're waiting on input synchronously and blocking the thread...
// right now I don't see another solution for this
// process.stdout.on("resize", () => {
//   TERM_COLS = process.stdout.columns;
//   console.log(`resizing, new cols: ${TERM_COLS}`);
// });

// internal function, moves the cursor once in a given direction
// returns true if the cursor moved, false otherwise
const _moveInternalCursor = (direction: Direction) => {
  const prevPosition = { ...internalCursorPosition };

  switch (direction) {
    case Direction.LEFT:
      if (internalCursorPosition.col === 1) {
        if (internalCursorPosition.row > INITIAL_CURSOR_POSITION.row) {
          internalCursorPosition.col = TERM_COLS;
          internalCursorPosition.row--;
        }
      } else {
        if (internalCursorPosition.row === INITIAL_CURSOR_POSITION.row) {
          if (internalCursorPosition.col > INITIAL_CURSOR_POSITION.col) {
            internalCursorPosition.col--;
          }
        } else {
          internalCursorPosition.col--;
        }
      }
      break;
    case Direction.RIGHT:
      if (internalCursorPosition.row === inputEndPosition.row) {
        if (internalCursorPosition.col < inputEndPosition.col)
          internalCursorPosition.col++;
      } else if (internalCursorPosition.col === TERM_COLS) {
        internalCursorPosition.col = 1;
        internalCursorPosition.row++;
      } else {
        internalCursorPosition.col++;
      }
      break;
    case Direction.UP:
      // todo - consider moving to beginning of line
      if (internalCursorPosition.row > INITIAL_CURSOR_POSITION.row)
        internalCursorPosition.row--;

      break;
    case Direction.DOWN:
      // todo - consider moving to end-of-line; sometimes terminals will do that
      if (internalCursorPosition.row < inputEndPosition.row)
        internalCursorPosition.row++;
      break;
    default:
      break;
  }

  return (
    prevPosition.col !== internalCursorPosition.col ||
    prevPosition.row !== internalCursorPosition.row
  );
};

/**
 * Moves the internal cursor position n times in a given direction, then syncs the system
 * cursor to the internal cursor so the user sees the updated position
 * @returns true if the cursor moved at all, false otherwise
 */
const moveInternalCursor = (direction: Direction, n: number = 1) => {
  let moved = false;
  for (let i = 0; i < n; ++i) {
    // check if the cursor moved, if not, we probably hit a limit and can stop early
    if (!_moveInternalCursor(direction)) break;

    moved = true;
  }

  // we are strongly coupling the cursors here - this will need to change if we discover a scenario
  // where we'll want our cursor and the external cursor positions to be different
  if (moved) syncCursors();

  return moved;
};

/**
 * Moves the current internal cursor position to the desired position, then syncs the system
 * cursor. If the intended cursor position is out of bounds (prior to the initial prompt's row,
 * to the left of the starting column index, or after the end of input), the movement is
 * curtailed to the limits
 */
const moveInternalCursorTo = ({ row, col }: CursorPosition) => {
  // another option here would be to just throw an error - if the program ever
  // attempts to move the cursor out of bounds, it's likely unintneded... but eh
  if (row > inputEndPosition.row) row = inputEndPosition.row;
  else if (row < INITIAL_CURSOR_POSITION.row) row = INITIAL_CURSOR_POSITION.row;

  if (col > TERM_COLS) col = TERM_COLS;
  else if (col < 1) col = 1;

  internalCursorPosition = { row, col };
  syncCursors();
};

// converts the cursor (X, Y) coordinates into a string index representing the new insert position
// for future user input updates. Useful in cases like UP/DOWN arrow behavior, possibly others
const syncInsertPostion = () => {
  const lengthFromRows =
    (internalCursorPosition.row - INITIAL_CURSOR_POSITION.row) * TERM_COLS;

  // minus one because cursor position is always one to the right of the end of the string
  const lengthFromCols = internalCursorPosition.col - USER_ASK.length - 1;

  currentInsertPosition = lengthFromRows + lengthFromCols;
};

/* 
  This is a very important concept: we track the current cursor position internally so we don't need to rely on
  getCursorPosition(), which breaks our tests by introducing the side effect of executing its own write + read to the terminal. 
  
  The move functions in utils.ts move the external/visible cursor the user sees, the moveInternalCursor function updates the 
  cursor we track positions with. This is necessary because the move functions in utils.ts aren't aware of the current cursor position, 
  and aren't capable of repositioning in special cases (like moving right at the end of the terminal row, or left at the beginning of the terminal row)

  This is a bit janky, but seems to be the most efficient way to maintain cursor awareness without introducing side effects and 
  breaking all of our tests.

  This function moves the external/visible cursor to the position of our internal cursor.
*/
const syncCursors = () => {
  moveCursorTo(internalCursorPosition.row, internalCursorPosition.col).exec();
};

const eraseUserInput = () => {
  moveInternalCursorTo(inputEndPosition);

  for (
    let row = internalCursorPosition.row;
    row > INITIAL_CURSOR_POSITION.row;
    --row
  ) {
    eraseLine(LineErasureMethod.ENTIRE).exec();
    moveInternalCursor(Direction.UP);
  }

  // at this point we're on the same line as the initial prompt
  eraseLine(LineErasureMethod.ENTIRE).exec();
  moveInternalCursorTo({ row: INITIAL_CURSOR_POSITION.row, col: 1 });
};

// in an ideal world it'd be best to avoid global state altogether
// alas, this function exists to reset different variables to allow users to run prompt
// multiple times in their programs without issue
const reset = () => {
  USER_ASK = "";
  currentInsertPosition = 0;
  internalCursorPosition = { row: 1, col: 1 };
  inputEndPosition = { row: 1, col: 1 };
};

export default function PromptSyncPlus(config: Config | undefined) {
  const globalConfig = config
    ? mergeLeft(mergeLeft(EMPTY_CONFIG, config), DEFAULT_CONFIG)
    : DEFAULT_CONFIG;

  ConfigSchema.validate(globalConfig);

  const prompt = <PromptType>((
    ask?: string,
    value?: string | Config,
    configOverride?: Config
  ) => {
    const promptConfig = (
      value
        ? typeof value === "object"
          ? mergeLeft(mergeLeft(EMPTY_CONFIG, value), globalConfig)
          : configOverride
          ? mergeLeft(mergeLeft(EMPTY_CONFIG, configOverride), globalConfig)
          : globalConfig
        : configOverride
        ? mergeLeft(mergeLeft(EMPTY_CONFIG, configOverride), globalConfig)
        : globalConfig
    ) as Config;

    if (promptConfig.history !== undefined)
      prompt.history = promptConfig.history;

    USER_ASK = ask || "";

    const defaultValue =
      value && typeof value === "string" ? value : promptConfig.defaultResponse;

    const { history } = promptConfig;

    ConfigSchema.validate(promptConfig);

    // insert position stored during history up/down arrow actions
    let savedInsertPosition = 0;
    // number of autocomplete suggestion rows generated during the last autocomplete execution
    let numRowsToClear = 0;
    // a temporary storage buffer for entered input; used to determine the type of input
    // e.g. whether an escape sequence was entered
    let buf = Buffer.alloc(3);

    let userInput = "";
    let changedPortionOfInput = "";
    let firstCharOfInput;

    // a temporary buffer to store the user's current input during history scroll
    let savedUserInput = "";
    let cycleSearchTerm = "";

    const fileDescriptor =
      process.platform === "win32"
        ? process.stdin.fd
        : fs.openSync("/dev/tty", "rs");

    const wasRaw = process.stdin.isRaw;
    if (!wasRaw) {
      process.stdin.setRawMode && process.stdin.setRawMode(true);
    }

    if (USER_ASK) {
      process.stdout.write(USER_ASK);
      // support for multi-line asks
      // todo - see if this is still necessary
      USER_ASK = USER_ASK.split(/\r?\n/).pop();
    }

    let autocompleteCycleIndex = 0;

    function updateInputEndPosition() {
      // take into account the fact that echo can be a multi-character string
      const outputLength =
        USER_ASK.length +
        (promptConfig.echo === undefined
          ? userInput.length
          : promptConfig.echo.length * userInput.length) +
        1; // +1 because cursor is always just to the right of the last input

      inputEndPosition.row =
        INITIAL_CURSOR_POSITION.row + (Math.ceil(outputLength / TERM_COLS) - 1);

      const modResult = outputLength % TERM_COLS;
      inputEndPosition.col = modResult === 0 ? TERM_COLS : modResult;
    }

    function storeInput(newChar: number) {
      const inputStart = userInput.slice(0, currentInsertPosition);
      changedPortionOfInput = `${String.fromCharCode(newChar)}${userInput.slice(
        currentInsertPosition
      )}`;

      userInput = `${inputStart}${changedPortionOfInput}`;

      currentInsertPosition++;
      updateInputEndPosition();
    }

    function autocompleteCycle() {
      // first TAB hit, save off original input
      if (cycleSearchTerm.length === 0) cycleSearchTerm = userInput;

      const searchResults = promptConfig.autocomplete.searchFn(cycleSearchTerm);

      if (searchResults.length === 0) return;

      const currentResult = searchResults[autocompleteCycleIndex];

      if (++autocompleteCycleIndex === searchResults.length)
        autocompleteCycleIndex = 0;

      process.stdout.write(concat("\r", eraseLine(), USER_ASK, currentResult));

      userInput = currentResult;
      currentInsertPosition = userInput.length;
      updateInputEndPosition();
      moveInternalCursorTo(inputEndPosition);
    }

    function autocompleteSuggest(isBackspace: boolean) {
      const searchResults = promptConfig.autocomplete.searchFn(userInput);

      if (searchResults.length === 0) {
        if (promptConfig.autocomplete.sticky) {
          process.stdout.write(concat("\r", eraseLine(), USER_ASK, userInput));
        }

        return 0;
      } else if (searchResults.length === 1 && !isBackspace) {
        userInput = searchResults[0];
        currentInsertPosition = userInput.length;
        updateInputEndPosition();
        process.stdout.write(concat("\r", eraseLine(), USER_ASK, userInput));
        moveInternalCursorTo(inputEndPosition);

        return 0;
      }

      const truncated = truncateSuggestions(
        searchResults,
        promptConfig.autocomplete.suggestColCount,
        internalCursorPosition.row,
        TERM_ROWS
      );

      const wasTruncated = truncated.length !== searchResults.length;

      if (!isBackspace && promptConfig.autocomplete.fill) {
        // don't consider the "x more..." content we fill in
        const commonSubstring = getCommonStartingSubstring(
          wasTruncated ? truncated.slice(0, -1) : truncated
        );

        if (commonSubstring && commonSubstring !== userInput) {
          userInput = commonSubstring;
          updateInputEndPosition();
          moveInternalCursorTo(inputEndPosition);
        }
      }

      currentInsertPosition = userInput.length;
      const tableData = tablify(
        truncated,
        promptConfig.autocomplete.suggestColCount
      );

      saveCursorPosition().exec();
      process.stdout.write(
        concat("\r", eraseLine(), USER_ASK, userInput, "\n", tableData.output)
      );
      restoreCursorPosition().exec();

      return tableData.rowCount;
    }

    function autocompleteHybrid() {
      // first TAB hit, save off original input
      if (cycleSearchTerm.length === 0) cycleSearchTerm = userInput;

      const searchResults = promptConfig.autocomplete.searchFn(cycleSearchTerm);
      if (!searchResults.length) return 0;

      if (searchResults.length === 1) {
        userInput = searchResults[0];
        currentInsertPosition = userInput.length;
        updateInputEndPosition();
        process.stdout.write(concat("\r", eraseLine(), USER_ASK, userInput));
        moveInternalCursorTo(inputEndPosition);

        return 0;
      }

      const truncated = truncateSuggestions(
        searchResults,
        promptConfig.autocomplete.suggestColCount,
        internalCursorPosition.row,
        TERM_ROWS
      );
      const wasTruncated = truncated.length !== searchResults.length;

      const currentResult = (wasTruncated ? truncated.slice(0, -1) : truncated)[
        autocompleteCycleIndex
      ];

      if (
        ++autocompleteCycleIndex ===
        truncated.length - (wasTruncated ? 1 : 0)
      )
        autocompleteCycleIndex = 0;

      const tableData = tablify(
        truncated,
        promptConfig.autocomplete.suggestColCount
      );

      userInput = currentResult;
      currentInsertPosition = userInput.length;
      updateInputEndPosition();

      saveCursorPosition().exec();
      process.stdout.write(
        concat("\r", eraseLine(), USER_ASK, userInput, "\n", tableData.output)
      );
      restoreCursorPosition().exec();
      moveInternalCursorTo(inputEndPosition);

      return tableData.rowCount;
    }

    function clearSuggestTable(countRows: number) {
      if (countRows < 1) return;

      for (let moveCount = 0; moveCount < countRows; ++moveCount) {
        // moves the system cursor only
        move().down.exec();
        eraseLine(LineErasureMethod.ENTIRE).exec();
      }

      // restore original cursor position
      syncCursors();
    }

    /**
     * @param direction Whether we are moving UP or DOWN in history
     */
    function scrollHistory(direction: Direction) {
      if (direction === Direction.UP) {
        if (history.atStart()) return;

        if (history.atEnd()) {
          savedUserInput = userInput;
          savedInsertPosition = currentInsertPosition;
        }

        userInput = history.prev();
        currentInsertPosition = userInput.length;
      } else if (direction === Direction.DOWN) {
        if (history.pastEnd()) return;

        if (history.atPenultimate()) {
          userInput = savedUserInput;
          currentInsertPosition = savedInsertPosition;
          history.next();
        } else {
          userInput = history.next();
          currentInsertPosition = userInput.length;
        }
      } else {
        // should never happen, but good to check
        throw new Error(`Unexpected scroll direction; code ${direction}`);
      }

      eraseUserInput();
      process.stdout.write(`${USER_ASK}${userInput}`);

      updateInputEndPosition();
      moveInternalCursorTo(inputEndPosition);

      return;
    }

    function handleMultiByteSequence() {
      // received a control sequence
      const sequence = buf.toString();
      const charSize =
        promptConfig.echo !== undefined ? promptConfig.echo.length : 1;

      switch (sequence) {
        case move().up.sequence.escaped:
          if (promptConfig.echo !== undefined) break;

          if (history) {
            scrollHistory(Direction.UP);
          } else {
            if (moveInternalCursor(Direction.UP)) syncInsertPostion();
          }

          break;
        case move().down.sequence.escaped:
          if (promptConfig.echo !== undefined) break;

          if (history) {
            scrollHistory(Direction.DOWN);
          } else {
            if (moveInternalCursor(Direction.DOWN)) syncInsertPostion();
          }

          break;
        case move().left.sequence.escaped:
          if (moveInternalCursor(Direction.LEFT, charSize)) syncInsertPostion();

          break;
        case move().right.sequence.escaped:
          if (moveInternalCursor(Direction.RIGHT, charSize))
            syncInsertPostion();

          break;
        default:
          // todo - determine what would actually trigger this logic? Could it be
          // multi-byte characters? Chinese symbols? Emojis?
          if (buf.toString()) {
            userInput = userInput + stripAnsi(buf.toString());
            userInput = userInput.replace(/\0/g, "");
            currentInsertPosition = userInput.length;
            promptPrint(changedPortionOfInput, false, promptConfig.echo);
            moveCursorToColumn(
              currentInsertPosition + USER_ASK.length + 1
            ).exec();
            buf = Buffer.alloc(3);
          }
      }
    }

    let loopCount = 0;

    INITIAL_CURSOR_POSITION = utils.getCursorPosition(fileDescriptor);
    internalCursorPosition = Object.assign({}, INITIAL_CURSOR_POSITION);
    inputEndPosition = Object.assign({}, INITIAL_CURSOR_POSITION);

    while (true) {
      const countBytesRead = fs.readSync(fileDescriptor, buf, 0, 3, null);

      if (countBytesRead > 1) {
        handleMultiByteSequence();
        continue;
      }

      // if it is not a control character seq, assume only one character is read
      firstCharOfInput = buf[0];

      const isAutocompleteTrigger =
        firstCharOfInput === promptConfig.autocomplete?.triggerKey;
      const isStickyOnly =
        !isAutocompleteTrigger && promptConfig.autocomplete.sticky;
      const isUnsupportedOrUnknownInput =
        firstCharOfInput != Key.TAB &&
        (firstCharOfInput < Key.SPACE || firstCharOfInput > Key.BACKSPACE);
      const isBackspace =
        firstCharOfInput === Key.BACKSPACE ||
        (process.platform === "win32" &&
          firstCharOfInput === Key.WIN_BACKSPACE);
      const autocompleteBehavior =
        promptConfig.autocomplete?.behavior?.toLowerCase();

      // ^C
      if (firstCharOfInput === Key.SIGINT) {
        // in case we're canceling a prompt that had suggestions, clear them out
        clearSuggestTable(numRowsToClear);

        moveInternalCursorTo(inputEndPosition);
        process.stdout.write("^C\n");

        fs.closeSync(fileDescriptor);

        if (promptConfig.sigint) process.exit(ExitCode.SIGINT);
        process.stdin.setRawMode && process.stdin.setRawMode(wasRaw);

        return null;
      }

      // ^D
      if (firstCharOfInput === Key.EOT) {
        if (userInput.length === 0 && promptConfig.eot) {
          // in case we're canceling a prompt that had suggestions, clear them out
          clearSuggestTable(numRowsToClear);

          moveInternalCursorTo(inputEndPosition);
          process.stdout.write("exit\n");
          process.exit(ExitCode.SUCCESS);
        }
      }

      // catch the terminating character
      if (firstCharOfInput === Key.ENTER) {
        clearSuggestTable(numRowsToClear);

        fs.closeSync(fileDescriptor);
        if (!history) break;
        if (
          promptConfig.echo === undefined &&
          (userInput.length || defaultValue.length)
        )
          history.push(userInput || defaultValue);

        history.reset();
        break;
      }

      if (isBackspace) {
        // todo - possibly move secondary backspace handling logic out of promptPrint() and into here
        // it's confusing having backspace logic in more than one place
        if (currentInsertPosition === 0) continue;

        userInput =
          userInput.slice(0, currentInsertPosition - 1) +
          userInput.slice(currentInsertPosition);
        currentInsertPosition--;

        updateInputEndPosition();
      }

      if (
        promptConfig.autocomplete?.searchFn &&
        (isAutocompleteTrigger ||
          (promptConfig.autocomplete.sticky &&
            autocompleteBehavior === AutocompleteBehavior.SUGGEST))
      ) {
        const currentUserInput = userInput;
        const prevRowsToClear = numRowsToClear;

        if (isStickyOnly) {
          if (!isBackspace) {
            // need to store off current input before we process
            storeInput(firstCharOfInput);
            moveInternalCursor(Direction.RIGHT);
          } else {
            moveInternalCursor(Direction.LEFT);
            eraseCharacter().exec();
          }

          clearSuggestTable(numRowsToClear);
        }

        if (userInput.length === 0) continue;

        switch (autocompleteBehavior) {
          case AutocompleteBehavior.CYCLE:
            autocompleteCycle();
            break;
          case AutocompleteBehavior.SUGGEST:
            numRowsToClear = autocompleteSuggest(isBackspace);

            if (numRowsToClear === 0 && currentUserInput !== userInput)
              clearSuggestTable(prevRowsToClear);

            break;
          case AutocompleteBehavior.HYBRID:
            numRowsToClear = autocompleteHybrid();

            if (numRowsToClear === 0 && currentUserInput !== userInput)
              clearSuggestTable(prevRowsToClear);

            break;
        }

        continue;
      }

      // in case the user picked a wierd key to trigger auto-complete, allow it
      if (isUnsupportedOrUnknownInput && !isAutocompleteTrigger) continue;

      cycleSearchTerm = "";
      autocompleteCycleIndex = 0;
      clearSuggestTable(numRowsToClear);
      numRowsToClear = 0;

      if (!isBackspace) storeInput(firstCharOfInput);

      promptPrint(changedPortionOfInput, isBackspace, promptConfig.echo);

      // this is used to help debug cases where there is an infinite loop
      // by default this has no impact on the logic
      loopCount++;
      if (loopCount === MAX_PROMPT_LOOPS) {
        loopCount = 0;
        moveInternalCursorTo(inputEndPosition);
        return userInput || defaultValue || "";
      }
    }

    // move cursor to the end just before submission - necessary in cases where the user was
    // editing input somewhere in the middle of a multi-line entry
    moveInternalCursorTo(inputEndPosition);
    reset();

    process.stdout.write("\n");
    process.stdin.setRawMode && process.stdin.setRawMode(wasRaw);

    loopCount = 0;

    // todo - write a function to reset global state

    return userInput || defaultValue || "";
  });

  prompt.hide = (USER_ASK: string) =>
    prompt(USER_ASK, mergeLeft({ echo: "" }, EMPTY_CONFIG) as Config);

  function promptPrint(
    changedPortionOfInput: string,
    isBackspace: boolean,
    echo?: string
  ) {
    const masked = echo !== undefined;
    const moveCount = masked ? echo.length : 1;

    if (masked && moveCount === 0) return;

    if (isBackspace) {
      // echo can be set to a string of length > 1
      for (let i = 0; i < moveCount; ++i) {
        moveInternalCursor(Direction.LEFT);
        eraseCharacter().exec();
      }
    } else {
      const output = masked
        ? echo.repeat(changedPortionOfInput.length)
        : changedPortionOfInput;

      process.stdout.write(output);

      // we type one character a time, but if masked, one character may be represented by multiple
      moveInternalCursor(Direction.RIGHT, moveCount);
    }
  }

  return prompt;
}
