import Joi from "joi";

export enum AutocompleteBehavior {
  // completes the input by cycling through possible completions on each TAB hit
  CYCLE = "cycle",
  // completes the input only up to the longest shared substring among all possible
  // completions, and prints a suggestion table
  HYBRID = "hybrid",
  // leaves input as-is and displays a table of suggestions
  SUGGEST = "suggest",
}

export enum Key {
  SIGINT = 3,
  EOT = 4,
  WIN_BACKSPACE = 8,
  TAB = 9,
  ENTER = 13,
  SHIFT = 16,
  CTRL = 17,
  ALT = 18,
  PAUSE_BREAK = 19,
  CAPS_LOCK = 20,
  ESCAPE = 27,
  EXCLAMATION_POINT = 33,
  SPACE = 32,
  DOUBLE_QUOTE = 34,
  POUND = 35,
  DOLLAR = 36,
  PERCENT = 37,
  AMPERSAND = 38,
  SINGLE_QUOTE = 39,
  LEFT_PAREN = 40,
  RIGHT_PAREN = 41,
  ASTERISK = 42,
  PLUS_SIGN = 43,
  COMMA = 44,
  HYPHEN = 45,
  PERIOD = 46,
  FORWARD_SLASH = 47,
  NUM_0 = 48,
  NUM_1 = 49,
  NUM_2 = 50,
  NUM_3 = 51,
  NUM_4 = 52,
  NUM_5 = 53,
  NUM_6 = 54,
  NUM_7 = 55,
  NUM_8 = 56,
  NUM_9 = 57,
  COLON = 58,
  SEMI_COLON = 59,
  LEFT_CARET = 60,
  EQUAL_SIGN = 61,
  RIGHT_CARET = 62,
  QUESTION_MARK = 63,
  AT = 64,
  A = 65,
  B = 66,
  C = 67,
  D = 68,
  E = 69,
  F = 70,
  G = 71,
  H = 72,
  I = 73,
  J = 74,
  K = 75,
  L = 76,
  M = 77,
  N = 78,
  O = 79,
  P = 80,
  Q = 81,
  R = 82,
  S = 83,
  T = 84,
  U = 85,
  V = 86,
  W = 87,
  X = 88,
  Y = 89,
  Z = 90,
  LEFT_BRACKET = 91,
  BACK_SLASH = 92,
  RIGHT_BRACKET = 93,
  CIRCUMFLEX = 94,
  UNDERSCORE = 95,
  BACK_TICK = 96,
  a = 97,
  b = 98,
  c = 99,
  d = 100,
  e = 101,
  f = 102,
  g = 103,
  h = 104,
  i = 105,
  j = 106,
  k = 107,
  l = 108,
  m = 109,
  n = 110,
  o = 111,
  p = 112,
  q = 113,
  r = 114,
  s = 115,
  t = 116,
  u = 117,
  v = 118,
  w = 119,
  x = 120,
  y = 121,
  z = 122,
  LEFT_BRACE = 123,
  VERTICAL_BAR = 124,
  RIGHT_BRACE = 125,
  TILDE = 126,
  BACKSPACE = 127,
}

export enum ExitCode {
  SUCCESS = 0,
  SIGINT = 130,
}

export const TermEscapeSequence = "\u001b";

// https://man7.org/linux/man-pages/man4/console_codes.4.html
export enum TermInputSequence {
  ARROW_UP = "A",
  ARROW_DOWN = "B",
  ARROW_LEFT = "D",
  ARROW_RIGHT = "C",
  DELETE_CHARACTER = "P",
  END = "F",
  ERASE_CHARACTER = "X",
  ERASE_LINE = "K",
  GET_CURSOR_POSITION = "6n",
  HOME = "H",
  MOVE_CURSOR_TO_COLUMN = "G",
  MOVE_CURSOR_TO_ROW = "d",
  MOVE_CURSOR_TO_ROW_COLUMN = "H",
  RESTORE_CURSOR = "u",
  SAVE_CURSOR = "s",
}

export enum LineErasureMethod {
  CURSOR_TO_END = "",
  BEGINNING_TO_CURSOR = "1",
  ENTIRE = "2",
}

export type PromptSyncHistoryObj = {
  atStart: () => boolean;
  atPenultimate: () => boolean;
  pastEnd: () => boolean;
  atEnd: () => boolean;
  prev: () => string;
  next: () => string;
  reset: () => void;
  push: (line: string) => void;
  save: () => void;
};

export type Config = {
  autocomplete: {
    // determines how the library responds to the searchFn results
    behavior: AutocompleteBehavior;
    // determines whether the behavior of autocomplete SUGGEST should fill the given input with the common substring of results
    fill: boolean;
    // the search function used to generate a list of possible completions given a query string
    searchFn?: (query: string) => string[];
    // determines whether autocomplete is 'sticky' - i.e. whether autocomplete occurs on every
    // key stroke or only when triggerKey is hit
    sticky: boolean;
    // number of columns to display autocomplete suggestions in (if behavior is SUGGEST or HYBRID)
    suggestColCount: number;
    // determines which key activates autocompletion
    // defaults to TAB; keycode: 9
    triggerKey: Key;
  };
  // determines which character is output to the terminal on key press
  echo: string;
  // determines behavior of ^D,
  eot: boolean;
  // a globally default response to return on any prompt that takes no input
  defaultResponse: string;
  // the prompt-sync-history object
  // see https://github.com/davidmarkclements/prompt-sync-history
  history?: PromptSyncHistoryObj;
  // determines behavior of ^C; (default) false: ^C returns null; true: process exits with code 130
  sigint: boolean;
};

export const ConfigSchema = Joi.object({
  autocomplete: Joi.object({
    behavior: Joi.string()
      .allow(...Object.values(AutocompleteBehavior))
      .insensitive(),
    fill: Joi.boolean(),
    searchFn: Joi.function().arity(1),
    sticky: Joi.boolean(),
    suggestColCount: Joi.number().min(1),
    triggerKey: Joi.number().allow(...Object.values(Key)),
  }),
  defaultResponse: Joi.string(),
  echo: Joi.string(),
  eot: Joi.boolean(),
  history: Joi.object({
    atStart: Joi.function().arity(0),
    atPenultimate: Joi.function().arity(0),
    pastEnd: Joi.function().arity(0),
    atEnd: Joi.function().arity(0),
    prev: Joi.function().arity(0),
    next: Joi.function().arity(0),
    reset: Joi.function().arity(0),
    push: Joi.function().arity(1),
    save: Joi.function(),
  }),
  sigint: Joi.boolean(),
});

export const DEFAULT_CONFIG: Config = {
  autocomplete: {
    behavior: AutocompleteBehavior.CYCLE,
    fill: false,
    searchFn: (_: string) => [],
    sticky: false,
    suggestColCount: 3,
    triggerKey: Key.TAB,
  },
  defaultResponse: "",
  echo: undefined,
  eot: false,
  history: undefined,
  sigint: false,
};

export const EMPTY_CONFIG: Config = {
  autocomplete: {
    behavior: undefined,
    fill: undefined,
    searchFn: undefined,
    sticky: undefined,
    suggestColCount: undefined,
    triggerKey: undefined,
  },
  defaultResponse: undefined,
  echo: undefined,
  eot: undefined,
  history: undefined,
  sigint: undefined,
};

export type GenericObject = { [key: string]: any };
