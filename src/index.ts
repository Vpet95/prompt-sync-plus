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
  TermInputSequence,
  Direction,
} from "./types.js";
import {
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
  escape,
  diffIndex,
  deleteCharacter,
} from "./utils.js";

// for testing purposes only - allows me to break out of possible infinite loops that arise during development
const MAX_PROMPT_LOOPS = Number.POSITIVE_INFINITY;

type PromptType = {
  (ask: string, value?: string | Config, configOverride?: Config): string;
  history?: PromptSyncHistoryObj;
  hide?: (ask: string) => string;
};

type CursorPosition = {
  row: number;
  col: number;
};

// Utility exports to help users
export { Key, AutocompleteBehavior } from "./types.js";

const TERM_COLS = process.stdout.columns;

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

// this breaks automated tests because it reads from the same file descriptor as the actual input - gobbling
// up characters.
const getCursorPosition = (fileDescriptor: number) => {
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
};

// internal function, moves the cursor once in a given direction
// returns true if the cursor moved, false otherwise
const _moveInternalCursor = (direction: Direction) => {
  let moved = false;

  switch (direction) {
    case Direction.LEFT:
      if (internalCursorPosition.col === 1) {
        if (internalCursorPosition.row >= INITIAL_CURSOR_POSITION.row) {
          internalCursorPosition.col = TERM_COLS;
          internalCursorPosition.row--;
          moved = true;
        }
      } else {
        internalCursorPosition.col--;
        moved = true;
      }
      break;
    case Direction.RIGHT:
      if (internalCursorPosition.col === TERM_COLS) {
        internalCursorPosition.col = 1;
        internalCursorPosition.row++;
        moved = true;
      } else {
        internalCursorPosition.col++;
        moved = true;
      }
      break;
    case Direction.UP:
      if (internalCursorPosition.row > INITIAL_CURSOR_POSITION.row) {
        internalCursorPosition.row--;
        moved = true;
      }
      break;
    case Direction.DOWN:
      // todo - consider moving to end-of-line; sometimes terminals will do that
      if (internalCursorPosition.row < inputEndPosition.row) {
        internalCursorPosition.row++;
        moved = true;
      }
      break;
    default:
      break;
  }

  return moved;
};

const moveInternalCursor = (direction: Direction, n: number = 1) => {
  for (let i = 0; i < n; ++i) {
    // check if the cursor moved, if not, we probably hit a limit and can stop early
    if (!_moveInternalCursor(direction)) break;
  }

  // we are strongly coupling the cursors here - this will need to change if we discover a scenario
  // where we'll want our cursor and the external cursor positions to be different
  syncCursors();

  return;
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

    ask = ask || "";

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

    // a temporary buffer to store the user's current input during history UP/DOWN arrow actions
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

    if (ask) {
      process.stdout.write(ask);
      // support for multi-line asks
      // todo - see if this is still necessary
      ask = ask.split(/\r?\n/).pop();
    }

    let autocompleteCycleIndex = 0;

    function updateInputEndPosition() {
      // take into account the fact that echo can be a multi-character string
      const outputLength =
        ask.length +
        (promptConfig.echo === undefined
          ? userInput.length
          : promptConfig.echo.length * userInput.length);

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

      if (searchResults.length === 0) {
        userInput += "\t";
        currentInsertPosition = userInput.length;
        process.stdout.write("\t");
        return;
      }

      const currentResult = searchResults[autocompleteCycleIndex];

      autocompleteCycleIndex =
        autocompleteCycleIndex >= searchResults.length - 1
          ? 0
          : autocompleteCycleIndex + 1;

      process.stdout.write(concat("\r", eraseLine(), ask, currentResult));

      userInput = currentResult;
      currentInsertPosition = userInput.length;
    }

    function autocompleteSuggest(isBackspace: boolean) {
      const searchResults = promptConfig.autocomplete.searchFn(userInput);

      if (searchResults.length === 0) {
        if (promptConfig.autocomplete.sticky) {
          process.stdout.write(concat("\r", eraseLine(), ask, userInput));
        } else {
          userInput += "\t";
          currentInsertPosition = userInput.length;
          process.stdout.write("\t");
        }

        return 0;
      } else if (searchResults.length === 1 && !isBackspace) {
        userInput = searchResults[0];
        currentInsertPosition = userInput.length;
        process.stdout.write(concat("\r", eraseLine(), ask, userInput));
        moveCursorToColumn(ask.length + userInput.length + 1).exec();

        return 0;
      }

      if (!isBackspace && promptConfig.autocomplete.fill) {
        const commonSubstring = getCommonStartingSubstring(searchResults);

        if (commonSubstring && commonSubstring !== userInput) {
          userInput = commonSubstring;
          moveCursorToColumn(ask.length + userInput.length + 1).exec();
        }
      }

      currentInsertPosition = userInput.length;
      const tableData = tablify(
        searchResults,
        promptConfig.autocomplete.suggestColCount
      );

      saveCursorPosition().exec();
      process.stdout.write(
        concat("\r", eraseLine(), ask, userInput, "\n", tableData.output)
      );
      restoreCursorPosition().exec();

      return tableData.rowCount;
    }

    function autocompleteHybrid() {
      // first TAB hit, save off original input
      if (cycleSearchTerm.length === 0) cycleSearchTerm = userInput;

      const searchResults = promptConfig.autocomplete.searchFn(cycleSearchTerm);

      if (searchResults.length === 0) {
        userInput += "\t";
        currentInsertPosition = userInput.length;
        process.stdout.write("\t");
        return 0;
      } else if (searchResults.length === 1) {
        userInput = searchResults[0];
        currentInsertPosition = userInput.length;
        process.stdout.write(concat("\r", eraseLine(), ask, userInput));
        moveCursorToColumn(ask.length + userInput.length + 1).exec();

        return 0;
      }

      const currentResult = searchResults[autocompleteCycleIndex];

      autocompleteCycleIndex =
        autocompleteCycleIndex >= searchResults.length - 1
          ? 0
          : autocompleteCycleIndex + 1;

      const tableData = tablify(
        searchResults,
        promptConfig.autocomplete.suggestColCount
      );

      userInput = currentResult;
      currentInsertPosition = userInput.length;

      saveCursorPosition().exec();
      process.stdout.write(
        concat("\r", eraseLine(), ask, userInput, "\n", tableData.output)
      );
      restoreCursorPosition().exec();
      moveCursorToColumn(ask.length + userInput.length + 1).exec();

      return tableData.rowCount;
    }

    function clearSuggestTable(countRows: number) {
      if (countRows) {
        saveCursorPosition().exec();

        move(TERM_COLS).left.exec();

        for (let moveCount = 0; moveCount < countRows; ++moveCount) {
          move().down.exec();
          eraseLine().exec();
        }

        restoreCursorPosition().exec();
      }
    }

    let loopCount = 0;

    INITIAL_CURSOR_POSITION = getCursorPosition(fileDescriptor);
    internalCursorPosition = Object.assign({}, INITIAL_CURSOR_POSITION);
    inputEndPosition = Object.assign({}, INITIAL_CURSOR_POSITION);

    while (true) {
      const countBytesRead = fs.readSync(fileDescriptor, buf, 0, 3, null);

      if (countBytesRead > 1) {
        // received a control sequence
        const sequence = buf.toString();

        switch (sequence) {
          case move().up.sequence.escaped:
            if (promptConfig.echo !== undefined) break;
            if (!history) break;
            if (history.atStart()) break;

            if (history.atEnd()) {
              savedUserInput = userInput;
              savedInsertPosition = currentInsertPosition;
            }
            userInput = history.prev();
            currentInsertPosition = userInput.length;
            process.stdout.write(
              concat(
                eraseLine(LineErasureMethod.ENTIRE),
                moveCursorToColumn(0),
                ask,
                userInput
              )
            );
            break;
          case move().down.sequence.escaped:
            if (promptConfig.echo !== undefined) break;
            if (!history) break;
            if (history.pastEnd()) break;

            if (history.atPenultimate()) {
              userInput = savedUserInput;
              currentInsertPosition = savedInsertPosition;
              history.next();
            } else {
              userInput = history.next();
              currentInsertPosition = userInput.length;
            }

            process.stdout.write(
              concat(
                eraseLine(LineErasureMethod.ENTIRE),
                moveCursorToColumn(0),
                ask,
                userInput,
                moveCursorToColumn(currentInsertPosition + ask.length + 1)
              )
            );
            break;
          case move().left.sequence.escaped:
            // todo - needs to be updated to handle multi-line strings
            if (promptConfig.echo !== undefined) break;

            const priorInsertPosition = currentInsertPosition;
            currentInsertPosition =
              --currentInsertPosition < 0 ? 0 : currentInsertPosition;
            if (priorInsertPosition - currentInsertPosition)
              moveInternalCursor(Direction.LEFT);

            break;
          case move().right.sequence.escaped:
            // todo - needs to be updated to handle multi-line strings
            if (promptConfig.echo !== undefined) break;

            currentInsertPosition =
              ++currentInsertPosition > userInput.length
                ? userInput.length
                : currentInsertPosition;
            moveInternalCursor(Direction.RIGHT);

            break;
          default:
            if (buf.toString()) {
              userInput = userInput + stripAnsi(buf.toString());
              userInput = userInput.replace(/\0/g, "");
              currentInsertPosition = userInput.length;
              promptPrint(
                ask,
                userInput,
                changedPortionOfInput,
                false,
                promptConfig.echo
              );
              moveCursorToColumn(currentInsertPosition + ask.length + 1).exec();
              buf = Buffer.alloc(3);
            }
        }

        continue; // any other 3 character sequence is ignored
      }

      // if it is not a control character seq, assume only one character is read
      firstCharOfInput = buf[countBytesRead - 1];

      const isAutocompleteTrigger =
        firstCharOfInput === promptConfig.autocomplete?.triggerKey;
      const isStickyOnly =
        !isAutocompleteTrigger && promptConfig.autocomplete.sticky;
      const isOutOfBounds =
        firstCharOfInput != Key.TAB &&
        (firstCharOfInput < Key.SPACE || firstCharOfInput > Key.BACKSPACE);

      const isBackspace =
        firstCharOfInput === Key.BACKSPACE ||
        (process.platform === "win32" &&
          firstCharOfInput === Key.WIN_BACKSPACE);

      // ^C
      if (firstCharOfInput === Key.SIGINT) {
        process.stdout.write("^C\n");
        fs.closeSync(fileDescriptor);

        if (promptConfig.sigint) process.exit(ExitCode.SIGINT);

        process.stdin.setRawMode && process.stdin.setRawMode(wasRaw);

        return null;
      }

      // ^D
      if (firstCharOfInput === Key.EOT) {
        if (userInput.length === 0 && promptConfig.eot) {
          process.stdout.write("exit\n");
          process.exit(ExitCode.SUCCESS);
        }
      }

      // catch the terminating character
      if (firstCharOfInput === Key.ENTER) {
        clearSuggestTable(numRowsToClear);

        fs.closeSync(fileDescriptor);
        if (!history) break;
        if (promptConfig.echo === undefined && userInput.length)
          history.push(userInput);
        history.reset();
        break;
      }

      if (isBackspace) {
        if (!currentInsertPosition) continue;

        userInput =
          userInput.slice(0, currentInsertPosition - 1) +
          userInput.slice(currentInsertPosition);
        currentInsertPosition--;

        updateInputEndPosition();
      }

      if (isOutOfBounds) continue;

      if (
        promptConfig.autocomplete?.searchFn &&
        (isAutocompleteTrigger || promptConfig.autocomplete.sticky)
      ) {
        const currentUserInput = userInput;
        const prevRowsToClear = numRowsToClear;

        if (isStickyOnly) {
          if (!isBackspace) {
            // need to store off current input before we process
            storeInput(firstCharOfInput);
            move().right.exec();
          }

          clearSuggestTable(numRowsToClear);
        }

        if (userInput.length === 0) continue;

        switch (promptConfig.autocomplete?.behavior?.toLowerCase()) {
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

      cycleSearchTerm = "";
      autocompleteCycleIndex = 0;
      clearSuggestTable(numRowsToClear);

      if (!isBackspace) storeInput(firstCharOfInput);

      promptPrint(
        ask,
        userInput,
        changedPortionOfInput,
        isBackspace,
        promptConfig.echo
      );

      loopCount++;
      if (loopCount === MAX_PROMPT_LOOPS)
        return userInput || defaultValue || "";
    }

    process.stdout.write("\n");
    process.stdin.setRawMode && process.stdin.setRawMode(wasRaw);

    return userInput || defaultValue || "";
  });

  prompt.hide = (ask: string) =>
    prompt(ask, mergeLeft({ echo: "" }, EMPTY_CONFIG) as Config);

  function promptPrint(
    ask: string,
    userInput: string,
    changedPortionOfInput: string,
    isBackspace: boolean,
    echo?: string
  ) {
    const masked = echo !== undefined;

    if (isBackspace) {
      if (masked) {
        // echo can be set to a string of length > 1
        for (let i = 0; i < echo.length; ++i) {
          moveInternalCursor(Direction.LEFT);
          deleteCharacter().exec();
        }
      } else {
        moveInternalCursor(Direction.LEFT);
        deleteCharacter().exec();
      }
    } else {
      if (masked && echo.length === 0) return;

      const output = masked
        ? echo.repeat(changedPortionOfInput.length)
        : changedPortionOfInput;

      process.stdout.write(output);

      // we type one character a time, but if masked, one character may be represented by multiple
      moveInternalCursor(Direction.RIGHT, masked ? echo.length : 1);
    }
  }

  return prompt;
}
