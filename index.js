'use strict'

var fs = require('fs');
var stripAnsi = require('strip-ansi');
var t = require('table')
var term = 13; // carriage return
var autocompleteStrategies = ['cycle', 'suggest'];

// credit to kennebec, et. al. 
// https://stackoverflow.com/a/1917041/3578493
function commonStartingSubstring(autocompleteMatches) {
  var sorted = autocompleteMatches.concat().sort();
  var first = sorted[0];
  var last = sorted[sorted.length - 1];
  var charIndex = 0;

  while(charIndex < first.length && first.charAt(i)=== last.charAt(i)) 
    charIndex++;
  
  return first.substring(0, charIndex);
}

// takes a list of auto-complete matches and converts them into an [n x 3] table 
// of strings 
function tablify(autocompleteMatches) {
  var result = [];
  var currentRow = [];

  for (var i = 0; i < autocompleteMatches.length; ++i) {
    currentRow.push(autocompleteMatches[i]);

    if(currentRow.length === 3) {
      result.push(currentRow);
      currentRow = [];
    }
  }

  if(currentRow.length > 0) {
    // fill in any missing cells - table requires consistent cell counts per row 
    for(var emptyCells = 3 - currentRow.length; emptyCells > 0; --emptyCells) {
      currentRow.push("");
    }

    result.push(currentRow);
  }

  return {
    output: t.table(result, {
      border: t.getBorderCharacters('void'),
      columnDefault: {
          paddingLeft: 2,
          paddingRight: 2
      },
      drawHorizontalLine: () => false
    }),
    rowCount: result.length
  };
}

function saveCursorPosition() {
  process.stdout.write('\u001b[s');
}

function restoreCursorPosition() {
  process.stdout.write('\u001B[u');
}

/**
 * create -- sync function for reading user input from stdin
 * @param   {Object} config {
 *   sigint: {Boolean} exit on ^C
 *   autocomplete: {StringArray} function({String})
 *   completeType: {String} determines the behavior of autocomplete, can be "cycle" or "suggest"
 *                 default behavior is "cycle" for backwards compatibility 
 *   history: {String} a history control object (see `prompt-sync-history`)
 * }
 * @returns {Function} prompt function
 */

 // for ANSI escape codes reference see https://en.wikipedia.org/wiki/ANSI_escape_code

function create(config) {

  config = config || {};
  var sigint = config.sigint;
  var eot = config.eot;
  var autocomplete = config.autocomplete =
    config.autocomplete || function(){return []};
  var completeType = config.completeType = config.completeType ? 
    config.completeType.toLowerCase() : 
    "cycle";
  var history = config.history;
  prompt.history = history || {save: function(){}};
  prompt.hide = function (ask) { return prompt(ask, {echo: ''}) };

  return prompt;


  /**
   * prompt -- sync function for reading user input from stdin
   *  @param {String} ask opening question/statement to prompt for
   *  @param {String} value initial value for the prompt
   *  @param   {Object} opts {
   *   echo: set to a character to be echoed, default is '*'. Use '' for no echo
   *   value: {String} initial value for the prompt
   *   ask: {String} opening question/statement to prompt for, does not override ask param
   *   autocomplete: {StringArray} function({String})
   *   completeType: {String} determines the behavior of autocomplete, can be "cycle" or "suggest"
   *                 default behavior is "cycle" for backwards compatibility 
   * }
   *
   * @returns {string} Returns the string input or (if sigint === false)
   *                   null if user terminates with a ^C
   */


  function prompt(ask, value, opts) {
    var insert = 0, savedinsert = 0, res, i, savedstr;
    opts = opts || {};
    var numRowsToClear = 0;


    if (Object(ask) === ask) {
      opts = ask;
      ask = opts.ask;
    } else if (Object(value) === value) {
      opts = value;
      value = opts.value;
    }
    ask = ask || '';
    var echo = opts.echo;
    var masked = 'echo' in opts;
    autocomplete = opts.autocomplete || autocomplete;
    completeType = opts.completeType ? 
      opts.completeType.toLowerCase() : 
      completeType;

    if (!autocompleteStrategies.includes(completeType))
      throw new Error(
        "value provided for completeType '" +
          completeType +
          "' is invalid. Expecting one of [" +
          autocompleteStrategies.join(", ") + 
          "]"
      );
    
    var fd = (process.platform === 'win32') ?
      process.stdin.fd :
      fs.openSync('/dev/tty', 'rs');

    var wasRaw = process.stdin.isRaw;
    if (!wasRaw) { process.stdin.setRawMode && process.stdin.setRawMode(true); }

    var buf = Buffer.alloc(3);
    var str = '', character, read;
    var autoCompleteSearchTerm;

    savedstr = '';

    if (ask) {
      process.stdout.write(ask);
    }

    var cycle = 0;

    function autocompleteCycle() {
      // first TAB hit, save off original input 
      if(autoCompleteSearchTerm === undefined)
        autoCompleteSearchTerm = str;

      res = autocomplete(autoCompleteSearchTerm);

      if (res.length == 0) {
        process.stdout.write('\t');
        return;
      }

      var item = res[cycle++] || res[cycle = 0, cycle++];

      if (item) {
        process.stdout.write('\r\u001b[K' + ask + item);
        str = item;

        insert = item.length;
      }
    }

    function autocompleteSuggest() {
      res = autocomplete(str);

      if (res.length == 0) {
        process.stdout.write('\t');
        return;
      }

      insert = str.length;
      var tableData = tablify(res);
      numRowsToClear = tableData.rowCount;

      saveCursorPosition();
      process.stdout.write('\r\u001b[K' + ask + str + "\n" + tableData.output);
      restoreCursorPosition();
    }

    function clearSuggestTable() {
      if(numRowsToClear) {
        saveCursorPosition();

        // position as far left as we can 
        process.stdout.write('\u001B[' + process.stdout.columns + 'D');

        for(var moveCount = 0; moveCount < numRowsToClear; ++moveCount) {
          process.stdout.write('\u001B[1B');
          process.stdout.write('\u001b[K');
        }
        
        restoreCursorPosition();
      }
    }

    while (true) {
      read = fs.readSync(fd, buf, 0, 3);
      if (read > 1) { // received a control sequence
        switch(buf.toString()) {
          case '\u001b[A':  //up arrow
            if (masked) break;
            if (!history) break;
            if (history.atStart()) break;

            if (history.atEnd()) {
              savedstr = str;
              savedinsert = insert;
            }
            str = history.prev();
            insert = str.length;
            process.stdout.write('\u001b[2K\u001b[0G' + ask + str);
            break;
          case '\u001b[B':  //down arrow
            if (masked) break;
            if (!history) break;
            if (history.pastEnd()) break;

            if (history.atPenultimate()) {
              str = savedstr;
              insert = savedinsert;
              history.next();
            } else {
              str = history.next();
              insert = str.length;
            }
            process.stdout.write('\u001b[2K\u001b[0G'+ ask + str + '\u001b['+(insert+ask.length+1)+'G');
            break;
          case '\u001b[D': //left arrow
            if (masked) break;
            var before = insert;
            insert = (--insert < 0) ? 0 : insert;
            if (before - insert)
              process.stdout.write('\u001b[1D');
            break;
          case '\u001b[C': //right arrow
            if (masked) break;
            insert = (++insert > str.length) ? str.length : insert;
            process.stdout.write('\u001b[' + (insert+ask.length+1) + 'G');
            break;
          default:
            if (buf.toString()) {
              str = str + buf.toString();
              str = str.replace(/\0/g, '');
              insert = str.length;
              promptPrint(masked, ask, echo, str, insert);
              process.stdout.write('\u001b[' + (insert+ask.length+1) + 'G');
              buf = Buffer.alloc(3);
            }
        }
        continue; // any other 3 character sequence is ignored
      }

      // if it is not a control character seq, assume only one character is read
      character = buf[read-1];

      // catch a ^C and return null
      if (character == 3){
        process.stdout.write('^C\n');
        fs.closeSync(fd);

        if (sigint) process.exit(130);

        process.stdin.setRawMode && process.stdin.setRawMode(wasRaw);

        return null;
      }

      // catch a ^D and exit
      if (character == 4) {
        if (str.length == 0 && eot) {
          process.stdout.write('exit\n');
          process.exit(0);
        }
      }

      // catch the terminating character
      if (character == term) {
        clearSuggestTable();
        
        fs.closeSync(fd);
        if (!history) break;
        if (!masked && str.length) history.push(str);
        history.reset();
        break;
      }

      // catch a TAB and implement autocomplete
      if (character == 9) { // TAB
        switch(completeType) {
          case "cycle":
            autocompleteCycle();
            break;
          case "suggest":
            autocompleteSuggest();
            break;
        }
      } else {
        // user entered anything other than TAB; reset from last use of autocomplete 
        autoCompleteSearchTerm = undefined; 
        // reset cycle - next time user hits tab might yield a different result list 
        cycle = 0;

        clearSuggestTable();
      }

      if (character == 127 || (process.platform == 'win32' && character == 8)) { //backspace
        if (!insert) continue;
        str = str.slice(0, insert-1) + str.slice(insert);
        insert--;
        process.stdout.write('\u001b[2D');
      } else {
        if ((character < 32 ) || (character > 126))
            continue;
        str = str.slice(0, insert) + String.fromCharCode(character) + str.slice(insert);
        insert++;
      };

      promptPrint(masked, ask, echo, str, insert);

    }

    process.stdout.write('\n')

    process.stdin.setRawMode && process.stdin.setRawMode(wasRaw);

    return str || value || '';
  };


  function promptPrint(masked, ask, echo, str, insert) {
    if (masked) {
        process.stdout.write('\u001b[2K\u001b[0G' + ask + Array(str.length+1).join(echo));
    } else {
      process.stdout.write('\u001b[s');
      if (insert == str.length) {
          process.stdout.write('\u001b[2K\u001b[0G'+ ask + str);
      } else {
        if (ask) {
          process.stdout.write('\u001b[2K\u001b[0G'+ ask + str);
        } else {
          process.stdout.write('\u001b[2K\u001b[0G'+ str + '\u001b[' + (str.length - insert) + 'D');
        }
      }

      // Reposition the cursor to the right of the insertion point
      var askLength = stripAnsi(ask).length;
      process.stdout.write(`\u001b[${askLength+1+(echo==''? 0:insert)}G`);
    }
  }
};

module.exports = create;
