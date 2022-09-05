import { expect } from "chai";
import sinon from "sinon";

import { TermEscapeSequence, TermInputSequence } from "../dist/types.js";
import { mergeLeft, move } from "../dist/utils.js";

describe("utils", () => {
  describe("#mergeLeft()", () => {
    it("Should return the left or right side if the other is undefined or null", () => {
      const template = { foo: "Hello", bar: 5, baz: true };

      let a = undefined;
      let b = { ...template };

      let result = mergeLeft(a, b);

      expect(result).to.deep.equal(template);

      a = { ...template };
      b = null;

      result = mergeLeft(a, b);

      expect(result).to.deep.equal(template);
    });

    it("Should only overwrite left's fields if they are undefined or null", () => {
      const a = { foo: undefined, bar: 5, baz: null, qux: "Hello" };
      const b = { foo: "Test", bar: 12, baz: false, qux: 3.14 };

      const result = mergeLeft(a, b);

      expect(result).to.deep.equal({
        foo: "Test",
        bar: 5,
        baz: false,
        qux: "Hello",
      });
    });

    it("Should not add any fields to the left side", () => {
      const a = { foo: "Test", bar: undefined, baz: true };
      const b = {
        foo: 5,
        bar: "Hello",
        baz: false,
        qux: 123,
        xyzzy: ["a", "b", "c"],
      };

      const result = mergeLeft(a, b);

      expect(result).to.deep.equal({ foo: "Test", bar: "Hello", baz: true });
    });

    it("Should not error out if right side is missing a key of left side", () => {
      const a = { foo: "Test", bar: undefined, xyzzy: true, waldo: "where?" };
      const b = {
        foo: 5,
        bar: "Hello",
      };

      expect(() => {
        mergeLeft(a, b);
      }).not.to.throw();

      const result = mergeLeft(a, b);

      expect(result).to.deep.equal({
        foo: "Test",
        bar: "Hello",
        xyzzy: true,
        waldo: "where?",
      });
    });
  });

  describe("#move()", () => {
    it("Should generate the correct sequences without a move count parameter", () => {
      const leftResult = move().left.sequence;

      expect(leftResult.raw).to.equal(`[${TermInputSequence.ARROW_LEFT}`);
      expect(leftResult.escaped).to.equal(
        `${TermEscapeSequence}[${TermInputSequence.ARROW_LEFT}`
      );

      const upResult = move().up.sequence;

      expect(upResult.raw).to.equal(`[${TermInputSequence.ARROW_UP}`);
      expect(upResult.escaped).to.equal(
        `${TermEscapeSequence}[${TermInputSequence.ARROW_UP}`
      );

      const rightResult = move().right.sequence;

      expect(rightResult.raw).to.equal(`[${TermInputSequence.ARROW_RIGHT}`);
      expect(rightResult.escaped).to.equal(
        `${TermEscapeSequence}[${TermInputSequence.ARROW_RIGHT}`
      );

      const downResult = move().down.sequence;

      expect(downResult.raw).to.equal(`[${TermInputSequence.ARROW_DOWN}`);
      expect(downResult.escaped).to.equal(
        `${TermEscapeSequence}[${TermInputSequence.ARROW_DOWN}`
      );
    });

    it("Should generate the correct sequences with a move count parameter", () => {
      const leftResult = move(2).left.sequence;

      expect(leftResult.raw).to.equal(`[2${TermInputSequence.ARROW_LEFT}`);
      expect(leftResult.escaped).to.equal(
        `${TermEscapeSequence}[2${TermInputSequence.ARROW_LEFT}`
      );

      const upResult = move(5).up.sequence;

      expect(upResult.raw).to.equal(`[5${TermInputSequence.ARROW_UP}`);
      expect(upResult.escaped).to.equal(
        `${TermEscapeSequence}[5${TermInputSequence.ARROW_UP}`
      );

      const rightResult = move(10).right.sequence;

      expect(rightResult.raw).to.equal(`[10${TermInputSequence.ARROW_RIGHT}`);
      expect(rightResult.escaped).to.equal(
        `${TermEscapeSequence}[10${TermInputSequence.ARROW_RIGHT}`
      );

      const downResult = move(99).down.sequence;

      expect(downResult.raw).to.equal(`[99${TermInputSequence.ARROW_DOWN}`);
      expect(downResult.escaped).to.equal(
        `${TermEscapeSequence}[99${TermInputSequence.ARROW_DOWN}`
      );
    });

    it("Should ignore the move count paramemter if it's <= 1, or not the proper type", () => {
      let result = move(1).left.sequence;

      expect(result.raw).to.equal(`[${TermInputSequence.ARROW_LEFT}`);
      expect(result.escaped).to.equal(
        `${TermEscapeSequence}[${TermInputSequence.ARROW_LEFT}`
      );

      result = move(0).left.sequence;

      expect(result.raw).to.equal(`[${TermInputSequence.ARROW_LEFT}`);
      expect(result.escaped).to.equal(
        `${TermEscapeSequence}[${TermInputSequence.ARROW_LEFT}`
      );

      result = move(-5).left.sequence;

      expect(result.raw).to.equal(`[${TermInputSequence.ARROW_LEFT}`);
      expect(result.escaped).to.equal(
        `${TermEscapeSequence}[${TermInputSequence.ARROW_LEFT}`
      );

      result = move(null).left.sequence;

      expect(result.raw).to.equal(`[${TermInputSequence.ARROW_LEFT}`);
      expect(result.escaped).to.equal(
        `${TermEscapeSequence}[${TermInputSequence.ARROW_LEFT}`
      );
    });

    it("Should actually execute (print) the move if result's exec is called", () => {
      const printStub = sinon.spy(process.stdout, "write");

      const result = move(3).left;
      result.exec();

      const expectedSequence = `${TermEscapeSequence}[3${TermInputSequence.ARROW_LEFT}`;

      expect(result.sequence.escaped).to.equal(expectedSequence);
      expect(printStub.calledWith(expectedSequence)).to.be.true;

      printStub.restore();
    });
  });
});
