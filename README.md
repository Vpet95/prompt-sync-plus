# prompt-sync-plus

An easy-to-use, synchronous prompt for Node.js based on the widely-adopted [prompt-sync](https://github.com/heapwolf/prompt-sync). The intent behind this project is to expand upon the original work of heapwolf, et. al., clean up, modernize, and patch the library to fix several existing issues and add some additional features. This library should be a 1:1 drop-in for the original and should at minimum require only an install and replacement of existing imports.

Changes include:

- A port to ES6 and TypeScript
- Addition of unit tests with ~90%+ code coverage
- Some fixes to existing autocomplete behavior
- Addition of new autocomplete behaviors and configuration options
- Improved documentation + examples

## Installation

Install via NPM:

```
npm install --save prompt-sync-plus
```

## Features & Examples

### Basic Example

At minimum, you need to import the library and instantiate the prompt. The entered text is returned directly:

```js
import prompSyncPlus from "prompt-sync-plus";

const prompt = prompSyncPlus();
const result = prompt("How are you?");

console.log(`You responded with ${result}`);
```

<todo - gif>

### Configuration

Prompt settings can be supplied via JSON object globally and/or on a prompt-by-prompt basis. Global settings are supplied when the prompt is instantiated:

```js
import prompSyncPlus from "prompt-sync-plus";

const prompt = prompSyncPlus({
  /* your settings here */
});
```

Prompt-specific settings can be supplied either as the second or third argument to the prompt invocation.

```js
const result = prompt("How are you?", {
  /* your settings here */
});
```

Or with a default response supplied:

```js
const result = prompt("How are you?", "Good", {
  /* your settings here */
});
```

Prompt-specific settings override global settings wherever there is overlap:

```js
import prompSyncPlus from "prompt-sync-plus";

const prompt = prompSyncPlus({ sigint: true });

// overrides sigint behavior established by global setting above
const result = prompt("How are you?", { sigint: false });
```

Both methods of configuration take the same JSON schema. See [API]() for a full listing of available settings, or keep scrolling to see examples of various settings in action.

### Supply a default value

A global default value can be supplied via the `defaultResponse` field:

```js
const prompt = promptSyncPlus({ defaultResponse: "No response" });
const result = prompt("Some question");

console.log(result): // No response
```

A prompt-specific default value can be supplied as a second argument to the prompt:

```js
const result = prompt("How are you?", "Good");

console.log(`You responded with ${result}`); // You responded with Good
```

<todo - gif>

### Handling sensitive input

For password entry, etc. character input can be obscured via the `echo` field:

```js
const result = prompt("Password: ", { echo: "*" });
```

To omit output entirely, supply the empty string to `echo`:

```js
const result = prompt("Sensitive info: ", { echo: "" });
```

Prompt-sync-plus exposes a helpful shorthand for the syntax above:

```js
const result = prompt.hide("Sensitive info: ");
```

<todo - gif>

### Handling SIGINT

Handling of SIGINT (Ctrl+C) is configured via the `sigint` boolean field. It determines whether to kill the process and return code 130 (`true`) or gobble up the signal and immediately return `null` from the prompt (`false`). The latter is the default.

```js
const result = prompt("Enter something or CTRL+C to quit: ", {
  sigint: true,
});
```

<todo - gif>

### Handling end-of-transmission

Handling end-of-transmission (CTRL+D) is configured via the `eot` boolean field. It determines whether to kill the process and return code 0 (`true`) or gobble up the signal and continue prompting (`false`). The latter is the default behavior.

```js
const result = prompt("Enter something or CTRL+D to kill process:", {
  eot: true,
});
```

<todo - gif>

### Autocompletion

Prompt-sync-plus supports a few different methods for providing users with autocomplete output. Note that this is an area where major changes were made to the original approach of prompt-sync, so your code will likely need some adjustments to use prompt-sync-plus.

At minimum, a search function needs to be passed in to the configuration to enable autocomplete - prompt-sync-plus handles the display and selection of results, but it is up to the caller to decide selection criteria with their own code:

```js
const listOfWords = [
  "interspecies",
  "interstelar",
  "interstate",
  "interesting",
  "interoperating",
  "intolerant",
  "introversion",
  "introspection",
  "interrogation",
];

const findWordStart = (str) =>
  listOfWords.filter((word) => word.indexOf(str) === 0);

// a simple autocomplete algorithm - find word starts
const result = prompt("Enter a word: ", {
  autocomplete: {
    searchFn: findWordStart,
  },
});
```

In the example above, autocomplete can be initiated from the prompt with a TAB key press. There are a few different prompting behaviors outlined below:

#### Cycle

This is the default autocompletion behavior, but can also be configured explicitly via the `behavior` field:

```js
const result = prompt("Enter a word: ", {
  autocomplete: {
    searchFn: findWordStart,
    behavior: AutocompleteBehavior.CYCLE,
  },
});
```

This behavior cycles through each of the autocomplete results and replaces the input string at the cursor location. At the end of the autocomplete result list, cycle loops around to the start of the list.

<todo - gif>

#### Suggest

This behavior leaves input intact but outputs columns of suggested words made from the list of autocomplete results.

```js
const result = prompt("Enter a word: ", {
  autocomplete: {
    searchFn: findWordStart,
    behavior: AutocompleteBehavior.SUGGEST,
  },
});
```

<todo - gif>

Autocomplete SUGGEST supports some additional configuration:

##### Resulting column count

Determine how many columns are displayed in the resulting output with the `suggestColCount` field:

```js
const result = prompt("Enter a word: ", {
  autocomplete: {
    searchFn: findWordStart,
    behavior: AutocompleteBehavior.SUGGEST,
    suggestColCount: 5,
  },
});
```

The default value is `3`.
This setting has no impact on the CYCLE behavior.

<todo - gif>

##### Fill

Determine whether prompt-sync-plus fills user input up to the common starting substring of the results with the `fill` field:

```js
const result = prompt("Enter a word: ", {
  autocomplete: {
    searchFn: findWordStart,
    behavior: AutocompleteBehavior.SUGGEST,
    fill: true,
  },
});
```

The default value is `false`.
This setting has no impact on other autocomplete behaviors.

##### Sticky

Determine whether, for the duration of the current prompt execution, autocomplete executes on every key stroke, or only on the configured key (TAB, by default) via the `sticky` field:

```js
const result = prompt("Enter a word: ", {
  autocomplete: {
    searchFn: findWordStart,
    behavior: AutocompleteBehavior.SUGGEST,
    sticky: true,
  },
});
```

The default value is `false` - i.e. autocomplete only triggers on TAB (or whichever key is configured to trigger autocomplete; see [additional settings]()).

#### Hybrid

This behavior is a hybrid of CYCLE and SUGGEST. Prompt-sync-plus will output columns of suggested words based on the autocomplete search results, in addition to filling the input line with each successive word in the list.

```js
const result = prompt("Enter a word: ", {
  autocomplete: {
    searchFn: findWordStart,
    behavior: AutocompleteBehavior.HYBRID,
  },
});
```

#### Autocomplete trigger

By default, autocomplete triggers on the TAB key, but this is configurable with the `triggerKeyCode` field:

```js
const result = prompt("Enter a word: ", {
  autocomplete: {
    searchFn: findWordStart,
    triggerKeyCode: 192, // back tick
  },
});
```

[This tool](https://www.toptal.com/developers/keycode) is incredibly helpful for key code discovery, however this library also provides a helpful utility for specifying key codes by name:

```js
import promptSyncPlus, { Key } from "prompt-sync-plus";

const findWordStart = /* etc */

const prompt = promptSyncPlus({
  autocomplete: {
    searchFn: findWordStart,
    triggerKeyCode: Key.BACK_TICK
  }
});
```

### History

The line history interface hasn't changed from prompt-sync and can be used in the same way:

```js
import promptSyncPlus from "prompt-sync-plus";
import promptSyncHistory from "prompt-sync-history";

const prompt = promptSyncPlus({
  history: promptSyncHistory(),
});

prompt("Question 1: ");
prompt("Question 2: ");
prompt("Question 3: ");

/* user can choose to up or down arrow to scroll through past responses */

// or persist responses to disk
result.history.save();
```

See [prompt-sync-history](https://github.com/davidmarkclements/prompt-sync-history) to learn more about the expected interface and the resulting API.

## Contributing

Contributions are welcome and encouraged! Feel free to:

- [Open an issue](https://github.com/Vpet95/prompt-sync-plus/issues) to report bugs and request features/enhancements
- [Open a Pull Request](https://github.com/Vpet95/prompt-sync-plus/pulls) - for major changes, please open an issue first to discuss what you would like to change
- Spread the word - ⭐️ this repo and let others know about prompt-sync-plus

## Development

To work on prompt-sync-plus:

- Clone the repo locally
- Run `npm install` to pull down dependencies
- Run `npm run build` to compile the TypeScript
- Run `npm run test` to run unit tests or `npm run test-coverage` to run tests and output a test coverage report

In general: prompt-sync-plus development follows the [Git Feature Branch](https://www.atlassian.com/git/tutorials/comparing-workflows/feature-branch-workflow) workflow - new feature work or bug fixes should be done in a dedicated branch.

Attempt to add tests to the test suite whenever possible.

## Roadmap

Like any open source project, this one's a work in progress. Additional work includes, but is not limited to:

- Improving the infrastructure of this project including
  - Git hooks to run code linter, formatter ([Prettier](https://prettier.io/)), and unit tests prior to push
  - Github actions for automated building, testing, commit squashing, etc.
- Workflow standardization - branch names, PR and issue formatting, etc.
- Unit test organization and cleanup
- Continued development to address other pain points of prompt-sync
- Development to expand the concept to add more utility:
  - `prompt.yesno()`
  - `prompt.yesnomaybe()`
  - `prompt.choose(list)`
  - etc.

## License

This project is licensed under the [MIT](https://github.com/Vpet95/prompt-sync-plus/blob/develop/LICENSE) license. In general, behave in the spirit of the [DBaD](https://dbad-license.org/) license.
