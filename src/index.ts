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
} from "./types.js";
import {
  concat,
  eraseLine,
  mergeLeft,
  move,
  moveCursorToColumn,
  restoreCursorPosition,
  saveCursorPosition,
  tablify,
  getCommonStartingSubstring,
} from "./utils.js";

export default function PromptSync(config: Config | undefined) {
  const globalConfig = config
    ? mergeLeft(mergeLeft(EMPTY_CONFIG, config), DEFAULT_CONFIG)
    : DEFAULT_CONFIG;

  ConfigSchema.validate(globalConfig);

  const prompt = (
    ask: string,
    value?: string | Config,
    configOverride?: Config
  ) => {
    const defaultValue = typeof value === "string" && value;
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

    const masked = Boolean(promptConfig.echo);

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

    function autocompleteCycle() {
      // first TAB hit, save off original input
      if (cycleSearchTerm.length === 0) cycleSearchTerm = userInput;

      const searchResults = promptConfig.autocomplete.searchFn(cycleSearchTerm);

      if (searchResults.length === 0) {
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

    function autocompleteSuggest() {
      const searchResults = promptConfig.autocomplete.searchFn(userInput);

      if (searchResults.length === 0) {
        process.stdout.write("\t");
        return 0;
      } else if (searchResults.length === 1) {
        userInput = searchResults[0];
        insertPosition = userInput.length;
        process.stdout.write(concat("\r", eraseLine(), ask, userInput));
        moveCursorToColumn(ask.length + userInput.length + 1).exec();

        return 0;
      }

      if (promptConfig.autocomplete.fillCommonSubstring) {
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
      // todo
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
        switch (buf.toString()) {
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
            var before = insertPosition;
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

      if (
        promptConfig.autocomplete?.searchFn &&
        firstCharOfInput === promptConfig.autocomplete?.triggerKeyCode
      ) {
        switch (promptConfig.autocomplete?.behavior?.toLowerCase()) {
          case AutocompleteBehavior.CYCLE:
            autocompleteCycle();
            break;
          case AutocompleteBehavior.SUGGEST:
            const currentUserInput = userInput;
            const prevRowsToClear = numRowsToClear;
            numRowsToClear = autocompleteSuggest();

            if (numRowsToClear === 0 && currentUserInput !== userInput)
              clearSuggestTable(prevRowsToClear);

            break;
          case AutocompleteBehavior.HYBRID:
            // todo - implement
            break;
        }
      } else {
        // user entered anything other than TAB; reset from last use of autocomplete
        cycleSearchTerm = "";
        // reset cycle - next time user hits tab might yield a different result list
        autocompleteCycleIndex = 0;

        clearSuggestTable(numRowsToClear);
      }

      if (
        firstCharOfInput === Key.BACKSPACE ||
        (process.platform === "win32" && firstCharOfInput === Key.WIN_BACKSPACE)
      ) {
        if (!insertPosition) continue;

        userInput =
          userInput.slice(0, insertPosition - 1) +
          userInput.slice(insertPosition);
        insertPosition--;

        move(2).left.exec();
      } else {
        if (firstCharOfInput < Key.SPACE || firstCharOfInput >= Key.BACKSPACE)
          continue;

        userInput =
          userInput.slice(0, insertPosition) +
          String.fromCharCode(firstCharOfInput) +
          userInput.slice(insertPosition);

        insertPosition++;
      }

      promptPrint(masked, ask, promptConfig.echo, userInput, insertPosition);
    }

    process.stdout.write("\n");
    process.stdin.setRawMode && process.stdin.setRawMode(wasRaw);

    return userInput || defaultValue || "";
  };

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
