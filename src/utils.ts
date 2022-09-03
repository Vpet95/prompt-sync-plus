import { GenericObject } from "./types.js";

// returns a merged object with the left-hand side as the basis
// only overwrites left-hand values if undefined
export const mergeLeft = (a?: GenericObject, b?: GenericObject) => {
  return a
    ? b
      ? Object.keys(a)
          .map((key) => ({ [key]: a[key] ?? b[key] }))
          .reduce((accumulator: GenericObject, value: GenericObject, _) => ({
            ...accumulator,
            ...value,
          }))
      : a
    : b;
};
