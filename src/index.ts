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
  eraseCharacter,
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

let TERM_COLS = process.stdout.columns;
let INITIAL_CURSOR_POSITION: CursorPosition = { row: 0, col: 0 };
let lastPromptOutput: string | null = null;

// keep track of size so we can calculate cursor positioning and output clearing properly
// todo - this doesn't seem to work since we're waiting on input synchronously and blocking the thread...
// right now I don't see another solution for this
process.stdout.on("resize", () => {
  TERM_COLS = process.stdout.columns;
  console.log(`resizing, new cols: ${TERM_COLS}`);
});

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

    // the index of the next position to insert a user-entered character on the current line
    let insertPosition = 0;
    // insert position stored during history up/down arrow actions
    let savedInsertPosition = 0;
    // number of autocomplete suggestion rows generated during the last autocomplete execution
    let numRowsToClear = 0;
    // a temporary storage buffer for entered input; used to determine the type of input
    // e.g. whether an escape sequence was entered
    let buf = Buffer.alloc(3);

    let userInput = "";
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
      ask = ask.split(/\r?\n/).pop();
    }

    let autocompleteCycleIndex = 0;

    function storeInput(newChar: number) {
      userInput =
        userInput.slice(0, insertPosition) +
        String.fromCharCode(newChar) +
        userInput.slice(insertPosition);

      insertPosition++;
    }

    function autocompleteCycle() {
      // first TAB hit, save off original input
      if (cycleSearchTerm.length === 0) cycleSearchTerm = userInput;

      const searchResults = promptConfig.autocomplete.searchFn(cycleSearchTerm);

      if (searchResults.length === 0) {
        userInput += "\t";
        insertPosition = userInput.length;
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
      insertPosition = userInput.length;
    }

    function autocompleteSuggest(isBackspace: boolean) {
      const searchResults = promptConfig.autocomplete.searchFn(userInput);

      if (searchResults.length === 0) {
        if (promptConfig.autocomplete.sticky) {
          process.stdout.write(concat("\r", eraseLine(), ask, userInput));
        } else {
          userInput += "\t";
          insertPosition = userInput.length;
          process.stdout.write("\t");
        }

        return 0;
      } else if (searchResults.length === 1 && !isBackspace) {
        userInput = searchResults[0];
        insertPosition = userInput.length;
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

      insertPosition = userInput.length;
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
        insertPosition = userInput.length;
        process.stdout.write("\t");
        return 0;
      } else if (searchResults.length === 1) {
        userInput = searchResults[0];
        insertPosition = userInput.length;
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
      insertPosition = userInput.length;

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
              savedInsertPosition = insertPosition;
            }
            userInput = history.prev();
            insertPosition = userInput.length;
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
              insertPosition = savedInsertPosition;
              history.next();
            } else {
              userInput = history.next();
              insertPosition = userInput.length;
            }

            process.stdout.write(
              concat(
                eraseLine(LineErasureMethod.ENTIRE),
                moveCursorToColumn(0),
                ask,
                userInput,
                moveCursorToColumn(insertPosition + ask.length + 1)
              )
            );
            break;
          case move().left.sequence.escaped:
            // todo - needs to be updated to handle multi-line strings
            if (promptConfig.echo !== undefined) break;
            const before = insertPosition;
            insertPosition = --insertPosition < 0 ? 0 : insertPosition;
            if (before - insertPosition) move().left.exec();
            break;
          case move().right.sequence.escaped:
            // todo - needs to be updated to handle multi-line strings
            if (promptConfig.echo !== undefined) break;
            insertPosition =
              ++insertPosition > userInput.length
                ? userInput.length
                : insertPosition;
            moveCursorToColumn(insertPosition + ask.length + 1).exec();
            break;
          default:
            if (buf.toString()) {
              userInput = userInput + stripAnsi(buf.toString());
              userInput = userInput.replace(/\0/g, "");
              insertPosition = userInput.length;
              promptPrint(ask, userInput, false, promptConfig.echo);
              moveCursorToColumn(insertPosition + ask.length + 1).exec();
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
        if (!insertPosition) continue;

        userInput =
          userInput.slice(0, insertPosition - 1) +
          userInput.slice(insertPosition);
        insertPosition--;
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

      promptPrint(ask, userInput, isBackspace, promptConfig.echo);

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

  function clearOutput(output: string, isBackspace: boolean) {
    const numRowsToDelete =
      Math.ceil(output.length / TERM_COLS) +
      (isBackspace &&
      (output.length % TERM_COLS === 0 || (output.length + 1) % TERM_COLS === 0)
        ? 1
        : 0);

    moveCursorTo(INITIAL_CURSOR_POSITION.row, 0).exec();
    if (numRowsToDelete > 1) move(numRowsToDelete - 1).down.exec();

    eraseLine(LineErasureMethod.ENTIRE).exec();

    for (let i = 1; i < numRowsToDelete; ++i) {
      move().up.exec();
      eraseLine(LineErasureMethod.ENTIRE).exec();
    }

    return numRowsToDelete;
  }

  // todo - there is still a cursor positioning bug related to using the arrow keys and ending the middle of a multi-line
  // string

  // todo - this method of cursor positioning (using getCursor position) fundamentally won't work with the automated tests I have now
  function promptPrint(
    ask: string,
    str: string,
    isBackspace: boolean,
    echo?: string
  ) {
    const currentOutput = `${ask}${
      echo === undefined ? str : echo.repeat(str.length)
    }`;

    if (isBackspace) {
      move().left.exec();
      deleteCharacter().exec();
    } else {
      if (lastPromptOutput === null) {
        lastPromptOutput = currentOutput;
        moveCursorTo(INITIAL_CURSOR_POSITION.row, 0).exec();
        process.stdout.write(currentOutput);
      } else {
        // output only from the character that changed, outward
        // this avoids a perceptible flicker in the terminal window
        const newOutput = currentOutput.substring(
          diffIndex(lastPromptOutput, currentOutput)
        );
        process.stdout.write(newOutput);
        lastPromptOutput = currentOutput;
      }
    }
  }

  return prompt;
}
