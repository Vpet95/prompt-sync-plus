import fs from "fs";

import { expect } from "chai";
import sinon from "sinon";

import { Key, ExitCode, AutocompleteBehavior } from "../dist/types.js";
import promptSync from "../dist/index.js";

import stripAnsi from "strip-ansi";

function createMessageBuffer(str, specialKey = Key.ENTER) {
  return Buffer.from([...str].map((c) => c.charCodeAt(0)).concat(specialKey));
}

function createReadSyncStub(buf) {
  const stub = sinon.stub(fs, "readSync");

  for (const pair of buf.entries()) {
    stub.onCall(pair[0]).callsFake((_, buffer, __) => {
      buffer[0] = pair[1];
      return 1;
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

  // this is ok - Mocha only runs multiple test modules in paralell - tests within
  // individual files are run synchronously
  let readerStub = null;

  before("Sinon setup", () => {
    openerStub = sinon.stub(fs, "openSync").returns(0);
    closerStub = sinon.stub(fs, "closeSync").returns(0);
  });

  beforeEach("Cleanup prior to each test", () => {
    if (readerStub !== null) {
      readerStub.reset(); // clean up behavior and history
      readerStub.restore(); // un-wrap stub
    }
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
  });

  after("Sinon teardown", () => {
    sinon.reset();
  });

  it("Should successfully process a basic prompt without additional settings", () => {
    const msg = "Good";
    const msgBuff = createMessageBuffer(msg);
    readerStub = createReadSyncStub(msgBuff);

    const prompt = promptSync();

    const result = prompt("How are you? ");

    expect(readerStub.called).to.be.true;
    expect(result).to.equal(msg);
  });

  it("Should return the given default value when user's input is empty", () => {
    const enterBuff = createMessageBuffer("");
    readerStub = createReadSyncStub(enterBuff);

    const prompt = promptSync();

    const defaultResponse = "Great!";
    const result = prompt("How are you? ", defaultResponse);

    expect(readerStub.called).to.be.true;
    expect(result).to.equal(defaultResponse);
  });

  it("Should output the given character provided by the echo option", () => {
    writeSpy = sinon.spy(process.stdout, "write");

    const echoChar = "*";
    const msg = "password123";
    const msgBuff = createMessageBuffer(msg);
    readerStub = createReadSyncStub(msgBuff);

    const prompt = promptSync();

    const result = prompt("Enter password: ", null, {
      echo: echoChar,
    });

    expect(readerStub.called).to.be.true;
    expect(result).to.equal(msg);

    const expectedMessage = `\u001b[2K\u001b[0GEnter password: ${echoChar.repeat(
      msg.length
    )}`;

    expect(writeSpy.called).to.be.true;
    expect(writeSpy.calledWith(expectedMessage)).to.be.true;
  });

  it("Should handle sigint behavior correctly, depending on whether the sigint setting was passed in", () => {
    exitStub = sinon.stub(process, "exit").returns(0);
    writeSpy = sinon.spy(process.stdout, "write");

    const msg = "Good";
    // simulates terminal interrupt signal
    const msgBuff = createMessageBuffer(msg, Key.SIGINT);
    readerStub = createReadSyncStub(msgBuff);

    const prompt = promptSync();

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

    const prompt = promptSync();

    let result = prompt("How are you? ");

    // default behavior
    expect(result.length).to.equal(0);
    expect(exitStub.called).to.be.false;

    writeSpy.resetHistory();
    closerStub.resetHistory();
    readerStub.resetHistory();
    readerStub.restore();

    // test case where input is not empty, EOT behavior should not happen
    msgBuff = createMessageBuffer("Good", [4, Key.ENTER]);
    readerStub = createReadSyncStub(msgBuff);

    result = prompt("How are you? ", null, { eot: true });

    expect(result).to.equal(msg);
    expect(exitStub.called).to.be.false;

    writeSpy.resetHistory();
    closerStub.resetHistory();
    readerStub.resetHistory();
    readerStub.restore();

    // ENTER necessary here since we stubbed out process.exit - we need the prompt to return
    msgBuff = createMessageBuffer("", [4, Key.ENTER]);
    readerStub = createReadSyncStub(msgBuff);

    result = prompt("How are you? ", null, { eot: true });

    expect(exitStub.calledWith(0)).to.be.true;
    expect(writeSpy.calledWith("exit\n")).to.be.true;
  });

  // this is common behavior to all autocomplete types, so we need to test them all
  it("Should print tab if no strings match the autocomplete search", () => {
    writeSpy = sinon.spy(process.stdout, "write");

    let msgBuff = createMessageBuffer("C", [Key.TAB, Key.ENTER]);
    readerStub = createReadSyncStub(msgBuff);

    const searchFn = createSearchFunction(["abc", "123", "do re mi"]);

    const prompt = promptSync();

    let result = prompt("Test: ", null, {
      autocomplete: {
        searchFn,
        behavior: AutocompleteBehavior.CYCLE,
      },
    });

    expect(result).to.equal("C\t");
    expect(writeSpy.calledWith("\t")).to.be.true;

    writeSpy.resetHistory();
    readerStub.resetHistory();

    result = prompt("Test: ", null, {
      autocomplete: {
        searchFn,
        behavior: AutocompleteBehavior.SUGGEST,
      },
    });

    expect(result).to.equal("C\t");
    expect(writeSpy.calledWith("\t")).to.be.true;

    writeSpy.resetHistory();
    readerStub.resetHistory();

    result = prompt("Test: ", null, {
      autocomplete: {
        searchFn,
        behavior: AutocompleteBehavior.HYBRID,
      },
    });

    expect(result).to.equal("C\t");
    expect(writeSpy.calledWith("\t")).to.be.true;
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

    const prompt = promptSync();

    let result = prompt("Test: ", null, {
      autocomplete: {
        searchFn,
        behavior: AutocompleteBehavior.CYCLE,
      },
    });

    expect(
      writeSpy.getCall(4).args.find((arg) => arg.includes("CAT")),
      "Should be CAT"
    ).to.not.be.undefined;
    expect(
      writeSpy.getCall(5).args.find((arg) => arg.includes("CRANBERRY")),
      "Should be CRANBERRY"
    ).to.not.be.undefined;
    expect(
      writeSpy.getCall(6).args.find((arg) => arg.includes("CORE")),
      "Should be CORE"
    ).to.not.be.undefined;
    expect(
      writeSpy.getCall(7).args.find((arg) => arg.includes("CAT")),
      "Should be CAT (again)"
    ).to.not.be.undefined;

    // let info = "";
    // for (let i = 0; i < writeSpy.callCount; ++i) {
    //   info += `call ${i + 1}: [${stripAnsi(
    //     writeSpy.getCall(i).args.join(", ")
    //   )}]\n`;
    // }

    // console.log(`Call info:\n${info}`);

    writeSpy.resetHistory();
    readerStub.resetHistory();
  });
});
