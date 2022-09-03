import { expect } from "chai";
import { mergeLeft } from "../dist/utils.js";

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
});
