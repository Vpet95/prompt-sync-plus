import fs from "fs";

import { expect } from "chai";
import sinon from "sinon";

import { Key, ExitCode, AutocompleteBehavior } from "../build/types.js";
import utils, { move } from "../build/utils.js";
import promptSyncPlus from "../build/index.js";

import stripAnsi from "strip-ansi";
import promptSyncHistory from "prompt-sync-history";

// A fake cursor row to return for `getCursorPosition()`; increments with every test so
// each test run output remains visible on screen
let TEST_CURSOR_ROW = 3;
const TEST_CURSOR_COL = 1;

function getTestCursorRow() {
  const row = TEST_CURSOR_ROW;

  // each time we grab this, we're likely running a new test, and should increment this
  TEST_CURSOR_ROW++;
  return row;
}

function createCursorStubReturn() {
  return {
    row: getTestCursorRow(),
    col: TEST_CURSOR_COL,
  };
}

function createMessageBuffer(str, specialKey = [Key.ENTER]) {
  return Buffer.from([...str].map((c) => c.charCodeAt(0)).concat(specialKey));
}

function dumpArgs(spy) {
  let output = "";

  for (let i = 0; i < spy.callCount; ++i) {
    output += `Call (${i}): ${spy
      .getCall(i)
      .args.map((arg) => `[${stripAnsi(arg)}]`)
      .join(", ")}\n`;
  }

  process.stdout.write(output);
}

// We only really care to test the visible portion of any output to write
// so we need to manually loop through the calls and look at each argument for the given substring
function wasCalledWithSubstring(spy, sub) {
  for (let i = 0; i < spy.callCount; ++i) {
    if (spy.getCall(i).args.find((arg) => arg.includes(sub)) !== undefined)
      return true;
  }

  return false;
}

// determines whether a function called with the given argument an expected number of times
function wasCalledWithNTimes(spy, sub, n) {
  if (spy.callCount < n) return false;

  let foundCount = 0;

  for (let i = 0; i < spy.callCount; ++i) {
    if (spy.getCall(i).args.find((arg) => arg === sub) !== undefined)
      ++foundCount;
  }

  return foundCount === n;
}

function createReadSyncStub(buf, useLength = false) {
  const stub = sinon.stub(fs, "readSync");

  for (const pair of buf.entries()) {
    stub.onCall(pair[0]).callsFake((_, buffer, __) => {
      if (typeof pair[1] === "number") {
        buffer[0] = pair[1];
        return 1;
      }

      if (useLength) buffer.write(pair[1]);
      else buffer[0] = pair[1];

      return useLength ? pair[1].length : 1;
    });
  }

  return stub;
}

function createSearchFunction(list) {
  return (str) => list.filter((item) => item.indexOf(str) === 0);
}

describe("Prompt Sync Plus", () => {
  let openerStub = null;
  let closerStub = null;
  let writeSpy = null;
  let exitStub = null;
  let readFileStub = null;
  let writeFileStub = null;
  let cursorPositionStub = null;

  // this is ok - Mocha only runs multiple test modules in paralell - tests within
  // individual files are run synchronously
  let readerStub = null;

  before("Sinon setup", () => {});

  beforeEach("Cleanup prior to each test", () => {
    if (readerStub !== null) {
      readerStub.reset(); // clean up behavior and history
      readerStub.restore(); // un-wrap stub
    }

    openerStub = sinon.stub(fs, "openSync").returns(0);
    closerStub = sinon.stub(fs, "closeSync").returns(0);

    cursorPositionStub = sinon
      .stub(utils, "getCursorPosition")
      .returns(createCursorStubReturn());
  });

  afterEach(() => {
    if (writeSpy !== null) {
      writeSpy.resetHistory();
      writeSpy.restore();
    }

    if (exitStub !== null) {
      exitStub.resetHistory();
      exitStub.restore();
    }

    if (readFileStub !== null) {
      readFileStub.resetHistory();
      readFileStub.restore();
    }

    if (writeFileStub !== null) {
      writeFileStub.resetHistory();
      writeFileStub.restore();
    }

    if (openerStub !== null) {
      openerStub.resetHistory();
      openerStub.restore();
    }

    if (closerStub !== null) {
      closerStub.resetHistory();
      closerStub.restore();
    }

    if (cursorPositionStub !== null) {
      cursorPositionStub.resetHistory();
      cursorPositionStub.restore();
    }
  });

  after("Sinon teardown", () => {
    sinon.reset();
  });

  it("Should successfully process a basic prompt without additional settings", () => {
    const msg = "Good";
    const msgBuff = createMessageBuffer(msg);
    readerStub = createReadSyncStub(msgBuff);

    const prompt = promptSyncPlus();

    const result = prompt("How are you? ");

    expect(readerStub.called).to.be.true;
    expect(result).to.equal(msg);
  });

  it("Should return the given global default response when the user's input is empty", () => {
    const enterBuff = createMessageBuffer("");
    readerStub = createReadSyncStub(enterBuff);

    const defaultResponse = "global default";
    const prompt = promptSyncPlus({ defaultResponse });

    const result = prompt("Test prompt: ");

    expect(readerStub.called).to.be.true;
    expect(result).to.equal(defaultResponse);
  });

  it("Should return the given prompt-specific default value when user's input is empty", () => {
    const enterBuff = createMessageBuffer("");
    readerStub = createReadSyncStub(enterBuff);

    const prompt = promptSyncPlus();

    const defaultResponse = "prompt-specific default";
    const result = prompt("Test prompt: ", defaultResponse);

    expect(readerStub.called).to.be.true;
    expect(result).to.equal(defaultResponse);
  });

  it("Should overwrite the global default response with the prompt-specific response", () => {
    const enterBuff = createMessageBuffer("");
    readerStub = createReadSyncStub(enterBuff);

    const global = "global default";
    const specific = "prompt-specific default";

    const prompt = promptSyncPlus({ defaultResponse: global });

    let result = prompt("Test prompt: ", specific);

    expect(readerStub.called).to.be.true;
    expect(result).to.equal(specific);

    readerStub.resetHistory();
    readerStub.restore();
    readerStub = createReadSyncStub(enterBuff);

    // make sure the global default sticks around even if the local was used
    result = prompt("Another test prompt: ");

    expect(result).to.equal(global);
  });

  it("Should output the given character provided by the echo option", () => {
    writeSpy = sinon.spy(process.stdout, "write");

    const echoChar = "*";
    const msg = "password123";
    const msgBuff = createMessageBuffer(msg);
    readerStub = createReadSyncStub(msgBuff);

    const prompt = promptSyncPlus();

    const result = prompt("Enter password: ", null, {
      echo: echoChar,
    });

    expect(readerStub.called, "Reader stub should be called").to.be.true;
    expect(result, "Result should equal the expected message").to.equal(msg);

    const expectedMessage = `Enter password: ${echoChar.repeat(msg.length)}`;

    expect(writeSpy.called, "Write spy should have been called").to.be.true;
    expect(
      wasCalledWithNTimes(writeSpy, echoChar, msg.length),
      "Write spy should have been called with the echo character the same number of times as the length of the masked message"
    ).to.be.true;
  });

  it("Should hide output when echo is passed an empty string", () => {
    writeSpy = sinon.spy(process.stdout, "write");

    const echoChar = "";
    const msg = "password123";
    const msgBuff = createMessageBuffer(msg);
    readerStub = createReadSyncStub(msgBuff);

    const prompt = promptSyncPlus();

    const result = prompt("Enter password: ", null, {
      echo: echoChar,
    });

    expect(readerStub.called).to.be.true;
    expect(result).to.equal(msg);

    // the message should never have been displayed in the terminal
    expect(wasCalledWithSubstring(writeSpy, msg)).to.be.false;
  });

  it("Should expose a helpful shorthand for echo: ''", () => {
    writeSpy = sinon.spy(process.stdout, "write");

    const msg = "123456789";
    const msgBuff = createMessageBuffer(msg);
    readerStub = createReadSyncStub(msgBuff);

    const prompt = promptSyncPlus();
    const result = prompt.hide("Enter SSN: ");

    expect(readerStub.called).to.be.true;
    expect(result).to.equal(msg);

    // the message should never have been displayed in the terminal
    expect(wasCalledWithSubstring(writeSpy, msg)).to.be.false;
  });

  it("Should handle sigint behavior correctly, depending on whether the sigint setting was passed in", () => {
    exitStub = sinon.stub(process, "exit").returns(0);
    writeSpy = sinon.spy(process.stdout, "write");

    const msg = "Good";
    // simulates terminal interrupt signal
    const msgBuff = createMessageBuffer(msg, Key.SIGINT);
    readerStub = createReadSyncStub(msgBuff);

    const prompt = promptSyncPlus();

    let result = prompt("How are you? ");

    // default behavior
    expect(result).to.be.null;
    expect(writeSpy.calledWith("^C\n")).to.be.true;
    expect(closerStub.called).to.be.true;
    expect(exitStub.called).to.be.false;

    writeSpy.resetHistory();
    closerStub.resetHistory();
    readerStub.resetHistory();

    result = prompt("How are you? ", null, { sigint: true });

    expect(result).to.be.null;
    expect(writeSpy.calledWith("^C\n")).to.be.true;
    expect(closerStub.called).to.be.true;
    expect(exitStub.calledWith(ExitCode.SIGINT)).to.be.true;
  });

  it("Should handle End-of-Transmission character correctly, depending on whether the eot setting was passed in", () => {
    exitStub = sinon.stub(process, "exit").returns(0);
    writeSpy = sinon.spy(process.stdout, "write");

    const msg = "Good";
    // Enter necessary to exit prompt
    let msgBuff = createMessageBuffer("", [Key.EOT, Key.ENTER]);
    readerStub = createReadSyncStub(msgBuff);

    const prompt = promptSyncPlus();

    let result = prompt("How are you? ");

    // default behavior; eot logic skipped, next iteration of prompt loop runs,
    // sees enter, exits with empty string
    expect(result.length).to.equal(0);
    expect(exitStub.called).to.be.false;

    writeSpy.resetHistory();
    closerStub.resetHistory();
    readerStub.resetHistory();
    readerStub.restore();

    // test case where input is not empty, EOT behavior should not happen
    msgBuff = createMessageBuffer("Good", [Key.EOT, Key.ENTER]);
    readerStub = createReadSyncStub(msgBuff);

    result = prompt("How are you? ", null, { eot: true });

    expect(result).to.equal(msg);
    expect(exitStub.called).to.be.false;

    writeSpy.resetHistory();
    closerStub.resetHistory();
    readerStub.resetHistory();
    readerStub.restore();

    // ENTER necessary here since we stubbed out process.exit - we need the prompt to return
    msgBuff = createMessageBuffer("", [Key.EOT, Key.ENTER]);
    readerStub = createReadSyncStub(msgBuff);

    result = prompt("How are you? ", null, { eot: true });

    expect(exitStub.calledWith(0)).to.be.true;
    expect(writeSpy.calledWith("exit\n")).to.be.true;
  });

  // this is common behavior to all autocomplete types, so we need to test them all
  it("Should do nothing if no strings match the autocomplete search", () => {
    writeSpy = sinon.spy(process.stdout, "write");

    let msgBuff = createMessageBuffer("C", [Key.TAB, Key.ENTER]);
    readerStub = createReadSyncStub(msgBuff);

    const searchFn = createSearchFunction(["abc", "123", "do re mi"]);

    const prompt = promptSyncPlus();

    let result = prompt("Test: ", null, {
      autocomplete: {
        searchFn,
        behavior: AutocompleteBehavior.CYCLE,
      },
    });

    expect(result).to.equal("C");

    writeSpy.resetHistory();
    readerStub.resetHistory();

    result = prompt("Test: ", null, {
      autocomplete: {
        searchFn,
        behavior: AutocompleteBehavior.SUGGEST,
      },
    });

    expect(result).to.equal("C");

    writeSpy.resetHistory();
    readerStub.resetHistory();

    result = prompt("Test: ", null, {
      autocomplete: {
        searchFn,
        behavior: AutocompleteBehavior.HYBRID,
      },
    });

    expect(result).to.equal("C");
  });

  it("Should cycle through all of the matching results", () => {
    writeSpy = sinon.spy(process.stdout, "write");

    let msgBuff = createMessageBuffer("C", [
      Key.TAB,
      Key.TAB,
      Key.TAB,
      Key.TAB,
      Key.ENTER,
    ]);
    readerStub = createReadSyncStub(msgBuff);

    const searchFn = createSearchFunction([
      "CAT",
      "CRANBERRY",
      "FOO",
      "BAR",
      "CORE",
    ]);

    const prompt = promptSyncPlus();

    let result = prompt("Test: ", null, {
      autocomplete: {
        searchFn,
        behavior: AutocompleteBehavior.CYCLE,
      },
    });

    expect(
      writeSpy.getCall(3).args.find((arg) => arg.includes("CAT")),
      "Write spy should have been called with CAT"
    ).to.not.be.undefined;
    expect(
      writeSpy.getCall(5).args.find((arg) => arg.includes("CRANBERRY")),
      "Write spy should have been called with CRANBERRY"
    ).to.not.be.undefined;
    expect(
      writeSpy.getCall(7).args.find((arg) => arg.includes("CORE")),
      "Write spy should have been called with CORE"
    ).to.not.be.undefined;
    expect(
      writeSpy.getCall(9).args.find((arg) => arg.includes("CAT")),
      "Write spy should have been called with (again)"
    ).to.not.be.undefined;

    expect(result).to.equal("CAT");

    writeSpy.resetHistory();
    readerStub.resetHistory();
  });

  it("Should consistently return the only matching string on multiple TAB presses", () => {
    writeSpy = sinon.spy(process.stdout, "write");
    const ask = "Test: ";
    const expectedResult = "CAT";

    let msgBuff = createMessageBuffer("C", [
      Key.TAB,
      Key.TAB,
      Key.TAB,
      Key.TAB,
      Key.ENTER,
    ]);
    readerStub = createReadSyncStub(msgBuff);

    const searchFn = createSearchFunction(["CAT", "BAT", "MAT", "RAT"]);

    const prompt = promptSyncPlus();

    let result = prompt(ask, null, {
      autocomplete: {
        searchFn,
        behavior: AutocompleteBehavior.CYCLE,
      },
    });

    expect(wasCalledWithNTimes(writeSpy, `${ask}${expectedResult}`, 4));
    expect(result).to.equal(expectedResult);
  });

  it("Should display a list of autocomplete suggestions when behavior is set to SUGGEST", () => {
    writeSpy = sinon.spy(process.stdout, "write");

    let msgBuff = createMessageBuffer("C", [Key.TAB, Key.ENTER]);
    readerStub = createReadSyncStub(msgBuff);

    const searchFn = createSearchFunction([
      "CAT",
      "CRANBERRY",
      "FOO",
      "BAR",
      "CORE",
    ]);

    const prompt = promptSyncPlus();

    let result = prompt("Test: ", null, {
      autocomplete: {
        searchFn,
        behavior: AutocompleteBehavior.SUGGEST,
      },
    });

    // SUGGEST doesn't auto-fill anything
    expect(result).to.equal("C");
    expect(wasCalledWithSubstring(writeSpy, "Test: C\n"));
    expect(wasCalledWithSubstring(writeSpy, "CAT    CRANBERRY    CORE"));
  });

  it("Should fill the input line with a common substring, in addition to displaying a list of suggestions", () => {
    writeSpy = sinon.spy(process.stdout, "write");

    let msgBuff = createMessageBuffer("i", [
      Key.TAB, // should fill to 'int'
      "e".charCodeAt(0),
      Key.TAB, // should fill to 'inter'
      Key.ENTER,
    ]);
    readerStub = createReadSyncStub(msgBuff);

    const searchFn = createSearchFunction([
      "interspecies",
      "interstelar",
      "interstate",
      "interesting",
      "interoperating",
      "intolerant",
    ]);

    const prompt = promptSyncPlus();

    let result = prompt("Test: ", null, {
      autocomplete: {
        searchFn,
        behavior: AutocompleteBehavior.SUGGEST,
        fill: true,
      },
    });

    expect(result).to.equal("inter");
    expect(wasCalledWithSubstring(writeSpy, "Test: int\n"));
    expect(wasCalledWithSubstring(writeSpy, "Test: inter\n"));
    expect(
      wasCalledWithSubstring(
        writeSpy,
        "interspecies    interstelar       interstate"
      )
    );
    expect(
      wasCalledWithSubstring(
        writeSpy,
        "interesting     interoperating                \n"
      )
    );
  });

  it("Should fill in the entire result string if it's the only result", () => {
    writeSpy = sinon.spy(process.stdout, "write");

    let msgBuff = createMessageBuffer("i", [
      Key.TAB, // should fill to 'int'
      "o".charCodeAt(0),
      Key.TAB, // should fill to 'intolerant'
      Key.ENTER,
    ]);
    readerStub = createReadSyncStub(msgBuff);

    const searchFn = createSearchFunction([
      "interspecies",
      "interstelar",
      "interstate",
      "interesting",
      "interoperating",
      "intolerant",
    ]);

    const prompt = promptSyncPlus();

    let result = prompt("Test: ", null, {
      autocomplete: {
        searchFn,
        behavior: AutocompleteBehavior.SUGGEST,
        fill: true,
      },
    });

    // SUGGEST doesn't auto-fill anything
    expect(result).to.equal("intolerant");
    expect(wasCalledWithSubstring(writeSpy, "Test: int\n"));
    expect(wasCalledWithSubstring(writeSpy, "Test: intolerant\n"));
  });

  it("Should activate autocomplete suggestions on any keystroke if sticky activated", () => {
    writeSpy = sinon.spy(process.stdout, "write");

    let msgBuff = createMessageBuffer("ieo", [Key.ENTER]);
    readerStub = createReadSyncStub(msgBuff);

    const searchFn = createSearchFunction([
      "interspecies",
      "interstelar",
      "interstate",
      "interesting",
      "interoperating",
      "intolerant",
    ]);

    const prompt = promptSyncPlus();

    let result = prompt("Test: ", null, {
      autocomplete: {
        searchFn,
        behavior: AutocompleteBehavior.SUGGEST,
        fill: true,
        sticky: true,
      },
    });

    expect(result).to.equal("interoperating");
    expect(wasCalledWithSubstring(writeSpy, "Test: int\n"));
    expect(wasCalledWithSubstring(writeSpy, "Test: inter\n"));
    expect(wasCalledWithSubstring(writeSpy, "Test: interoperating\n"));
    expect(
      wasCalledWithSubstring(
        writeSpy,
        "interesting     interoperating    intolerant\n"
      )
    );
    expect(
      wasCalledWithSubstring(
        writeSpy,
        "interesting     interoperating                \n"
      )
    );
  });

  it("Should display autocomplete suggestions as well as cycle through them", () => {
    writeSpy = sinon.spy(process.stdout, "write");

    let msgBuff = createMessageBuffer("i", [
      Key.TAB,
      Key.TAB,
      Key.TAB,
      Key.ENTER,
    ]);
    readerStub = createReadSyncStub(msgBuff);

    const searchFn = createSearchFunction([
      "interspecies",
      "interstelar",
      "interstate",
      "interesting",
      "interoperating",
      "intolerant",
    ]);

    const prompt = promptSyncPlus();

    let result = prompt("Test: ", null, {
      autocomplete: {
        searchFn,
        behavior: AutocompleteBehavior.HYBRID,
      },
    });

    expect(result).to.equal("interstate");
    expect(wasCalledWithSubstring(writeSpy, "Test: interspecies\n"));
    expect(wasCalledWithSubstring(writeSpy, "Test: interstelar\n"));
    expect(wasCalledWithSubstring(writeSpy, "Test: interstate\n"));
    expect(
      wasCalledWithSubstring(
        writeSpy,
        "interspecies    interstelar       interstate"
      )
    );
    expect(
      wasCalledWithSubstring(
        writeSpy,
        "interesting     interoperating    intolerant"
      )
    );
  });

  // todo - add tests to prove multi-line editing works (e.g. to test arrow key functionality)
  // they likely won't look good in the terminal output, but should still result in the correct
  // prompt output

  it("Should save input history and be able to cycle through it on up and down arrow keys", () => {
    readFileStub = sinon.stub(fs, "readFileSync").throws(); // file doesn't exist
    writeFileStub = sinon.stub(fs, "writeFileSync");

    writeSpy = sinon.spy(process.stdout, "write");

    let msgBuff = createMessageBuffer("Good", [Key.ENTER]);
    readerStub = createReadSyncStub(msgBuff);

    const history = promptSyncHistory("test-hist-file.txt");

    const prompt = promptSyncPlus({
      history,
    });

    let result = prompt("How are you? ");

    expect(result, "Result should be 'Good' (no history search yet)").to.equal(
      "Good"
    );
    readerStub.resetHistory();
    readerStub.restore();

    msgBuff = createMessageBuffer("Yes");
    readerStub = createReadSyncStub(msgBuff);

    result = prompt("Are you sure? ");

    expect(result, "Result should be 'Yes' (no history search yet)").to.equal(
      "Yes"
    );
    readerStub.resetHistory();
    readerStub.restore();

    const up = move().up.sequence.escaped;
    const down = move().down.sequence.escaped;

    const customMsg = [
      ..."Definitely".split(""),
      up, // "Yes"
      up, // "Good"
      up, // Repeat "Good"
      down, // "Yes"
      String.fromCharCode(Key.ENTER),
    ];

    readerStub = sinon.stub(fs, "readSync");
    customMsg.forEach((str, index) => {
      readerStub.onCall(index).callsFake((_, buffer, __) => {
        if (str.length === 0) {
          buffer[0] = str.charCodeAt(0);
          return 1;
        } else {
          buffer.write(str);
          return str.length;
        }
      });
    });

    result = prompt("Are reeeeeaaallly sure?? ");

    expect(result, "Result should be 'Yes' (after history search)").to.equal(
      "Yes"
    );
    expect(wasCalledWithSubstring(writeSpy, "Are reeeeeaaallly sure?? Yes"));
    expect(wasCalledWithSubstring(writeSpy, "Are reeeeeaaallly sure?? Good"));
    expect(
      wasCalledWithSubstring(writeSpy, "Are reeeeeaaallly sure?? Definitely")
    );

    expect(writeFileStub.called).to.be.false;
    history.save();
    expect(writeFileStub.called).to.be.true;
  });

  // a bit tedious, but all necessary to establish history before save
  it("Should expose the stored history object", () => {
    readFileStub = sinon.stub(fs, "readFileSync").throws(); // file doesn't exist
    writeFileStub = sinon.stub(fs, "writeFileSync");

    writeSpy = sinon.spy(process.stdout, "write");

    let msgBuff = createMessageBuffer("Good", [Key.ENTER]);
    readerStub = createReadSyncStub(msgBuff);

    const prompt = promptSyncPlus({
      history: promptSyncHistory("test-exposed-file.txt"),
    });

    let result = prompt("How are you? ");

    expect(result).to.equal("Good");
    readerStub.resetHistory();
    readerStub.restore();

    msgBuff = createMessageBuffer("Yes");
    readerStub = createReadSyncStub(msgBuff);

    result = prompt("Are you sure? ");

    expect(result).to.equal("Yes");

    expect(writeFileStub.called).to.be.false;
    prompt.history.save();
    expect(writeFileStub.called).to.be.true;
  });

  it("Should handle left and right arrow keys", () => {
    readerStub = sinon.stub(fs, "readSync");
    const l = move().left.sequence.escaped;
    const r = move().right.sequence.escaped;

    const customMsg = [
      "a",
      "b",
      "c",
      l,
      l,
      l,
      "x",
      "y",
      "z",
      r,
      r,
      r,
      "1",
      "2",
      "3",
      String.fromCharCode(Key.ENTER),
    ];

    customMsg.forEach((str, index) => {
      readerStub.onCall(index).callsFake((_, buffer, __) => {
        if (str.length === 1) {
          buffer[0] = str.charCodeAt(0);
          return 1;
        } else {
          buffer.write(str);
          return str.length;
        }
      });
    });

    const prompt = promptSyncPlus();
    // zero-length ask necessary here since syncInsertPostion relies
    // on the internal cursor positon (which we are mocking)
    const result = prompt("");

    expect(result).to.equal("xyzabc123");
  });
});
