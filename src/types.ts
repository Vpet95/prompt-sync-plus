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

export enum CompleteOnOption {
  // attempt an auto-completion on every key press
  // NOTE: cannot be set if behavior is set to CYCLE
  ALWAYS = "always",
  // (default) attempt an autocomplete only if a specific key is pressed
  KEYPRESS = "keypress",
}

export enum Key {
  BACKSPACE = 8,
  TAB = 9,
  ENTER = 13,
  SHIFT = 16,
  CTRL = 17,
  ALT = 18,
  PAUSE_BREAK = 19,
  CAPS_LOCK = 20,
  ESCAPE = 27,
  PAGE_UP = 33,
  SPACE = 32,
  PAGE_DOWN = 34,
  END = 35,
  HOME = 36,
  ARROW_LEFT = 37,
  ARROW_UP = 38,
  ARROW_RIGHT = 39,
  ARROW_DOWN = 40,
  PRINT_SCREEN = 44,
  INSERT = 45,
  DELETE = 46,
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
  LEFT_WINDOW_KEY = 91,
  RIGHT_WINDOW_KEY = 92,
  SELECT_KEY = 93,
  NUMPAD_0 = 96,
  NUMPAD_1 = 97,
  NUMPAD_2 = 98,
  NUMPAD_3 = 99,
  NUMPAD_4 = 100,
  NUMPAD_5 = 101,
  NUMPAD_6 = 102,
  NUMPAD_7 = 103,
  NUMPAD_8 = 104,
  NUMPAD_9 = 105,
  MULTIPLY = 106,
  ADD = 107,
  SUBTRACT = 109,
  DECIMAL_POINT = 110,
  DIVIDE = 111,
  F1 = 112,
  F2 = 113,
  F3 = 114,
  F4 = 115,
  F5 = 116,
  F6 = 117,
  F7 = 118,
  F8 = 119,
  F9 = 120,
  F10 = 121,
  F11 = 122,
  F12 = 123,
  NUM_LOCK = 144,
  SCROLL_LOCK = 145,
  MY_COMPUTER_MULTIMEDIA_KEYBOARD = 182,
  MY_CALCULATOR_MULTIMEDIA_KEYBOARD = 183,
  SEMICOLON = 186,
  EQUAL_SIGN = 187,
  COMMA = 188,
  DASH = 189,
  PERIOD = 190,
  FORWARD_SLASH = 191,
  OPEN_BRACKET = 219,
  BACK_SLASH = 220,
  CLOSE_BRAKET = 221,
  SINGLE_QUOTE = 222,
}

export enum ExitCode {
  SIGINT = 130,
}

export const TermEscapeSequence = "\u001b";

// https://man7.org/linux/man-pages/man4/console_codes.4.html
export enum TermInputSequence {
  ARROW_UP = "A",
  ARROW_DOWN = "B",
  ARROW_LEFT = "D",
  ARROW_RIGHT = "C",
  END = "F",
  ERASE_LINE = "K",
  HOME = "H",
  MOVE_CURSOR_TO_COLUMN = "G",
  RESTORE_CURSOR = "U",
  SAVE_CURSOR = "S",
}

export enum LineErasureMethod {
  CURSOR_TO_END = "",
  BEGINNING_TO_CURSOR = "1",
  ENTIRE = "2",
}

type PromptSyncHistoryObj = {
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
    // the search function used to generate a list of possible completions given a query string
    searchFn?: (query: string) => string[];
    // determines how the library responds to the searchFn results
    behavior: AutocompleteBehavior;
    // determines when autocompletion activates
    completeOn: CompleteOnOption;
    // determines which key activates autocompletion
    // defaults to TAB; keycode: 9
    triggerKeyCode: Key;
  };
  // determines which character is output to the terminal on key press
  echo: string;
  // determines behavior of ^D,
  eot: boolean;
  // determines behavior of ^C; (default) false: ^C returns null; true: process exits with code 130
  sigint: boolean;
  // the prompt-sync-history object
  // see https://github.com/davidmarkclements/prompt-sync-history
  history?: PromptSyncHistoryObj;
};

export const ConfigSchema = Joi.object({
  autocomplete: Joi.object({
    searchFn: Joi.function().arity(1),
    behavior: Joi.string()
      .allow(...Object.values(AutocompleteBehavior))
      .insensitive(),
    completeOn: Joi.string()
      .allow(...Object.values(CompleteOnOption))
      .insensitive(),
    triggerKeyCode: Joi.number().allow(...Object.values(Key)),
  }),
  echo: Joi.string(),
  eot: Joi.boolean(),
  sigint: Joi.boolean(),
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
});

export const DEFAULT_CONFIG: Config = {
  autocomplete: {
    searchFn: (_: string) => [],
    behavior: AutocompleteBehavior.CYCLE,
    completeOn: CompleteOnOption.KEYPRESS,
    triggerKeyCode: Key.TAB,
  },
  echo: "",
  eot: false,
  sigint: false,
  history: undefined,
};

export type GenericObject = { [key: string]: any };
