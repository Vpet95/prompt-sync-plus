import fs from "fs";

import { expect } from "chai";
import sinon from "sinon";

import { Key, ExitCode } from "../dist/types.js";
import promptSync from "../dist/index.js";

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

describe("Prompt Sync Plus", () => {
  let openerStub = null;
  let closerStub = null;

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
    const outputSpy = sinon.spy(process.stdout, "write");

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

    expect(outputSpy.called).to.be.true;
    expect(outputSpy.calledWith(expectedMessage)).to.be.true;

    outputSpy.resetHistory();
    outputSpy.restore();
  });

  it("Should handle sigint behavior correctly, depending on whether the sigint setting was passed in", () => {
    const exitStub = sinon.stub(process, "exit").returns(0);
    const outputSpy = sinon.spy(process.stdout, "write");

    const msg = "Good";
    // simulates terminal interrupt signal
    const msgBuff = createMessageBuffer(msg, 3);
    readerStub = createReadSyncStub(msgBuff);

    const prompt = promptSync();

    let result = prompt("How are you? ");

    // default behavior
    expect(result).to.be.null;
    expect(outputSpy.calledWith("^C\n")).to.be.true;
    expect(closerStub.called).to.be.true;
    expect(exitStub.called).to.be.false;

    outputSpy.resetHistory();
    closerStub.resetHistory();
    readerStub.resetHistory();

    result = prompt("How are you? ", null, { sigint: true });

    expect(result).to.be.null;
    expect(outputSpy.calledWith("^C\n")).to.be.true;
    expect(closerStub.called).to.be.true;
    expect(exitStub.calledWith(ExitCode.SIGINT)).to.be.true;

    outputSpy.restore();
    exitStub.restore();
  });
});
