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
} from "./types.js";
import {
  concat,
  eraseLine,
  getCommonStartingSubstring,
  mergeLeft,
  move,
  moveCursorToColumn,
  restoreCursorPosition,
  saveCursorPosition,
  tablify,
} from "./utils.js";

type PromptType = {
  (ask: string, value?: string | Config, configOverride?: Config): string;
  history?: PromptSyncHistoryObj;
  hide?: (ask: string) => string;
};

export default function PromptSyncPlus(config: Config | undefined) {
  const globalConfig = config
    ? mergeLeft(mergeLeft(EMPTY_CONFIG, config), DEFAULT_CONFIG)
    : DEFAULT_CONFIG;

  ConfigSchema.validate(globalConfig);

  const prompt = <PromptType>((
    ask: string,
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

    const masked = promptConfig.echo !== undefined;

    const fileDescriptor =
      process.platform === "win32"
        ? process.stdin.fd
        : fs.openSync("/dev/tty", "rs");

    const wasRaw = process.stdin.isRaw;
    if (!wasRaw) {
      process.stdin.setRawMode && process.stdin.setRawMode(true);
    }

    // write out the passed-in prompt
    process.stdout.write(ask);

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

        move(process.stdout.columns).left.exec();

        for (let moveCount = 0; moveCount < countRows; ++moveCount) {
          move().down.exec();
          eraseLine().exec();
        }

        restoreCursorPosition().exec();
      }
    }

    while (true) {
      const countBytesRead = fs.readSync(fileDescriptor, buf, 0, 3, null);

      if (countBytesRead > 1) {
        // received a control sequence
        const sequence = buf.toString();

        switch (sequence) {
          case move().up.sequence.escaped:
            if (masked) break;
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
            if (masked) break;
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
            if (masked) break;
            const before = insertPosition;
            insertPosition = --insertPosition < 0 ? 0 : insertPosition;
            if (before - insertPosition) move().left.exec();
            break;
          case move().right.sequence.escaped:
            if (masked) break;
            insertPosition =
              ++insertPosition > userInput.length
                ? userInput.length
                : insertPosition;
            moveCursorToColumn(insertPosition + ask.length + 1).exec();
            break;
          default:
            if (buf.toString()) {
              userInput = userInput + buf.toString();
              userInput = userInput.replace(/\0/g, "");
              insertPosition = userInput.length;
              promptPrint(
                masked,
                ask,
                promptConfig.echo,
                userInput,
                insertPosition
              );
              moveCursorToColumn(insertPosition + ask.length + 1).exec();
              buf = Buffer.alloc(3);
            }
        }

        continue; // any other 3 character sequence is ignored
      }

      // if it is not a control character seq, assume only one character is read
      firstCharOfInput = buf[countBytesRead - 1];

      const isAutocompleteTrigger =
        firstCharOfInput === promptConfig.autocomplete?.triggerKeyCode;
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
        if (!masked && userInput.length) history.push(userInput);
        history.reset();
        break;
      }

      if (isBackspace) {
        if (!insertPosition) continue;

        userInput =
          userInput.slice(0, insertPosition - 1) +
          userInput.slice(insertPosition);
        insertPosition--;

        move().left.exec();
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

      promptPrint(masked, ask, promptConfig.echo, userInput, insertPosition);
    }

    process.stdout.write("\n");
    process.stdin.setRawMode && process.stdin.setRawMode(wasRaw);

    return userInput || defaultValue || "";
  });

  prompt.hide = (ask: string) =>
    prompt(ask, mergeLeft({ echo: "" }, EMPTY_CONFIG) as Config);

  function promptPrint(
    masked: boolean,
    ask: string,
    echo: string,
    str: string,
    insertPosition: number
  ) {
    if (masked) {
      process.stdout.write(
        concat(
          eraseLine(LineErasureMethod.ENTIRE),
          moveCursorToColumn(0),
          ask,
          echo.repeat(str.length)
        )
      );
    } else {
      saveCursorPosition().exec();

      if (insertPosition === str.length) {
        process.stdout.write(
          concat(
            eraseLine(LineErasureMethod.ENTIRE),
            moveCursorToColumn(0),
            ask,
            str
          )
        );
      } else {
        if (ask) {
          process.stdout.write(
            concat(
              eraseLine(LineErasureMethod.ENTIRE),
              moveCursorToColumn(0),
              ask,
              str
            )
          );
        } else {
          process.stdout.write(
            concat(
              eraseLine(LineErasureMethod.ENTIRE),
              moveCursorToColumn(0),
              str,
              move(str.length - insertPosition).left
            )
          );
        }
      }

      // Reposition the cursor to the right of the insertion point
      const askLength = stripAnsi(ask).length;
      moveCursorToColumn(askLength + 1 + insertPosition).exec();
    }
  }

  return prompt;
}
