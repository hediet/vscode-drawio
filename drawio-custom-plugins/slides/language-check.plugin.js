// Checks the spelling and the grammar of the label being edited with LanguageTool, and offers its
// fixes on the right button, in the draw.io editor.
//
// LanguageTool runs on this machine as a server, which Homebrew installs and starts:
//
//     brew install languagetool
//     brew services start languagetool
//
// The server answers at the address of the setting "drawioSlides.languageTool" of the extension,
// http://localhost:8081 by default, which the extension gives in
// window.drawioSlidesSettings.languageTool, and no text leaves the machine.  While a label is edited, the plugin sends its text to the
// server half a second after the last change, and underlines what the server finds: a wavy red
// line under a word that may be misspelt, a wavy blue line under a fault of grammar or of style.
// The lines are highlights of the browser, so the label keeps its HTML as it is.  A formula
// between \( and \) or $$ goes to the server as markup that reads as a noun, so its TeX is not
// checked, and the items of a list and the lines of a label read as paragraphs.
//
// The right button on an underlined word opens a menu of the message and of up to five fixes, and
// a fix replaces the word as typing would, so Undo takes it back.  Ignore hides the issue until the
// label is edited again.  Elsewhere the right button opens the menu of the browser as before.
//
// CHECK holds the language and the rules left out, which suit slides: an item of a list may start
// with a small letter and end without a full stop.  The mode `check` of build-slides.py reads the
// same object from this file and checks every slide of a deck.  A word of the list of the server
// counts as spelled right for every application that checks with the server.  A word of the file language-check-words.txt in
// the folder of the deck, one per line, such as a name, counts as spelled right in that deck
// alone, in both checks.  The plugin reads the file from the folders of
// window.mediaPluginDeckFolders, which the extension sets.  The plugin warns once in the console
// when the server does not answer.
//
// The VS Code extension yujunhuang.drawio-slides loads the plugin from its own folder
// drawio-custom-plugins/slides/ for every drawing whose setting "drawioSlides.slides" is true,
// without asking.  The page of the extension has no content security policy, so it reaches the
// server.
Draw.loadPlugin(function (ui) {
  var graph = ui.editor.graph;
  var cellEditor = graph.cellEditor;
  // The options of a check, which the mode `check` of build-slides.py reads as JSON.
  // A formula reads as the capital B, which LanguageTool takes after both a and an, as a noun and
  // as a subject, where X reads as "ex" and asks for an.
  var CHECK = {
    "language": "en-US",
    "disabledRules": ["UPPERCASE_SENTENCE_START", "PUNCTUATION_PARAGRAPH_END"],
    "formulaReadsAs": "B"
  };
  var WORDS_FILE = 'language-check-words.txt';
  var DELAY = 500;
  var BLOCKS = { DIV: true, P: true, LI: true, UL: true, OL: true, BR: true, TABLE: true, TR: true,
    TD: true, H1: true, H2: true, H3: true };
  var FORMULA = /\\\([\s\S]*?\\\)|\$\$[\s\S]*?\$\$/g;
  var timer = null;
  var version = 0;
  var issues = [];
  var ignored = [];
  var wordsRead = null;
  var warned = false;
  var menu = null;

  function server() {
    return ((window.drawioSlidesSettings || {}).languageTool || '').replace(/\/+$/, '');
  }

  var style = document.createElement('style');
  style.textContent = [
    '::highlight(language-check-spelling) { text-decoration: underline wavy #d0021b; ' +
      'text-decoration-skip-ink: none; text-underline-offset: 3px; }',
    '::highlight(language-check-grammar) { text-decoration: underline wavy #1a6ed8; ' +
      'text-decoration-skip-ink: none; text-underline-offset: 3px; }',
    '.language-check-menu { position: fixed; z-index: 100000; min-width: 160px; max-width: 360px; ' +
      'padding: 4px 0; background: #fff; color: #222; border: 1px solid #c8c8c8; ' +
      'border-radius: 6px; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18); ' +
      'font: 13px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }',
    '.language-check-menu div { padding: 4px 12px; }',
    '.language-check-menu .language-check-message { color: #555; font-size: 12px; ' +
      'border-bottom: 1px solid #eee; margin-bottom: 2px; }',
    '.language-check-menu .language-check-item { cursor: pointer; }',
    '.language-check-menu .language-check-item:hover { background: #e8f0fe; }',
    '.language-check-menu .language-check-fix { font-weight: 600; }'
  ].join('\n');
  document.head.appendChild(style);

  // The words of the deck that count as spelled right, read once from the deck folders.  Every
  // check waits for the same reading, so a check made while the file is on its way misses no word.
  // A folder is encoded name by name, so a # or a ? in the name of a folder stays part of the path.
  function loadWords() {
    if (wordsRead != null) {
      return wordsRead;
    }

    var folders = window.mediaPluginDeckFolders || [];
    var base = (location.protocol == 'file:') ? 'file://' : new URL(document.baseURI).origin;
    var words = {};

    wordsRead = Promise.all(folders.map(function (folder) {
      var address = base + folder.split('/').map(encodeURIComponent).join('/') + '/' + WORDS_FILE;
      return fetch(address).then(function (response) {
        return response.ok ? response.text() : '';
      }).catch(function () {
        return '';
      });
    })).then(function (texts) {
      texts.join('\n').split(/\r?\n/).forEach(function (line) {
        var word = line.trim();

        if (word != '' && word.charAt(0) != '#') {
          words[word.toLowerCase()] = true;
        }
      });

      return words;
    });

    return wordsRead;
  }

  // The text of the box for LanguageTool, as pieces of text and of markup, with the place of each
  // piece of text in the box.
  function readBox(box) {
    var pieces = [];
    var places = [];
    var length = 0;

    function markup(text, reading) {
      pieces.push({ markup: text, interpretAs: reading });
      length += text.length;
    }

    function text(node, from, to) {
      if (to > from) {
        pieces.push({ text: node.data.slice(from, to) });
        places.push({ start: length, end: length + to - from, node: node, offset: from });
        length += to - from;
      }
    }

    function walk(node) {
      if (node.nodeType == 3) {
        var data = node.data;
        var last = 0;
        var match;
        FORMULA.lastIndex = 0;

        while ((match = FORMULA.exec(data)) != null) {
          text(node, last, match.index);
          markup(match[0], CHECK.formulaReadsAs);
          last = match.index + match[0].length;
        }

        text(node, last, data.length);
      } else if (node.nodeType == 1) {
        var block = BLOCKS[node.nodeName];

        if (block) {
          markup('\n', '\n\n');
        }

        for (var child = node.firstChild; child != null; child = child.nextSibling) {
          walk(child);
        }

        if (block && node.nodeName != 'BR') {
          markup('\n', '\n\n');
        }
      }
    }

    walk(box);
    return { pieces: pieces, places: places };
  }

  // The point of the box at an offset of the text, or null inside markup.
  function pointAt(places, offset, atEnd) {
    for (var i = 0; i < places.length; i++) {
      var place = places[i];

      if (offset > place.start && offset < place.end ||
          (!atEnd && offset == place.start) || (atEnd && offset == place.end)) {
        return { node: place.node, offset: place.offset + offset - place.start };
      }
    }

    return null;
  }

  function clearIssues() {
    issues = [];

    if (window.CSS && CSS.highlights) {
      CSS.highlights.delete('language-check-spelling');
      CSS.highlights.delete('language-check-grammar');
    }
  }

  function showIssues() {
    if (!(window.CSS && CSS.highlights && window.Highlight)) {
      return;
    }

    var spelling = new Highlight();
    var grammar = new Highlight();

    issues.forEach(function (issue) {
      (issue.spelling ? spelling : grammar).add(issue.range);
    });

    CSS.highlights.set('language-check-spelling', spelling);
    CSS.highlights.set('language-check-grammar', grammar);
  }

  function isIgnored(issue) {
    return ignored.some(function (other) {
      return other.rule == issue.rule && other.word == issue.word;
    });
  }

  function check() {
    var box = cellEditor.textarea;

    if (cellEditor.editingCell == null || box == null) {
      return;
    }

    var mine = ++version;
    var read = readBox(box);

    if (read.places.length == 0) {
      clearIssues();
      return;
    }

    var body = new URLSearchParams();
    body.set('data', JSON.stringify({ annotation: read.pieces }));
    body.set('language', CHECK.language);
    body.set('disabledRules', CHECK.disabledRules.join(','));

    Promise.all([loadWords(), fetch(server() + '/v2/check', { method: 'POST', body: body })
      .then(function (response) {
        if (!response.ok) {
          throw new Error('the server answered ' + response.status);
        }

        return response.json();
      })]).then(function (results) {
      if (mine != version || cellEditor.textarea != box || cellEditor.editingCell == null) {
        return;
      }

      var known = results[0];
      issues = [];

      results[1].matches.forEach(function (match) {
        var start = pointAt(read.places, match.offset, false);
        var end = pointAt(read.places, match.offset + match.length, true);

        if (start == null || end == null) {
          return;
        }

        var range = document.createRange();
        range.setStart(start.node, start.offset);
        range.setEnd(end.node, end.offset);
        var issue = {
          range: range,
          word: range.toString(),
          rule: match.rule.id,
          // The rule of misspelt words is of the category TYPOS.  A rule such as a or an, which
          // LanguageTool also types as a misspelling, is a fault of grammar here.
          spelling: match.rule.category != null && match.rule.category.id == 'TYPOS',
          message: match.message,
          fixes: match.replacements.slice(0, 5).map(function (fix) {
            return fix.value;
          })
        };

        if (!(issue.spelling && known[issue.word.toLowerCase()]) && !isIgnored(issue)) {
          issues.push(issue);
        }
      });

      showIssues();
    }, function (error) {
      if (!warned) {
        warned = true;
        console.warn('language-check.plugin.js: LanguageTool did not answer at ' + server() +
          ' (' + error.message + ').  Start it with brew services start languagetool.');
      }
    });
  }

  function checkSoon() {
    clearTimeout(timer);
    timer = setTimeout(check, DELAY);
  }

  function closeMenu() {
    if (menu != null) {
      menu.remove();
      menu = null;
    }
  }

  function issueAt(x, y) {
    var point = document.caretRangeFromPoint ? document.caretRangeFromPoint(x, y) : null;

    if (point == null) {
      return null;
    }

    for (var i = 0; i < issues.length; i++) {
      var range = issues[i].range;

      if (range.isPointInRange(point.startContainer, point.startOffset) &&
          range.toString() == issues[i].word) {
        return issues[i];
      }
    }

    return null;
  }

  function item(text, className, action) {
    var element = document.createElement('div');
    element.className = 'language-check-item ' + (className || '');
    element.textContent = text;
    // A press keeps the focus in the label, so the edit goes on.
    element.addEventListener('mousedown', function (evt) {
      evt.preventDefault();
      evt.stopPropagation();
    });
    element.addEventListener('click', function (evt) {
      evt.stopPropagation();
      closeMenu();
      action();
    });
    return element;
  }

  function openMenu(issue, x, y) {
    closeMenu();
    menu = document.createElement('div');
    menu.className = 'language-check-menu';
    var message = document.createElement('div');
    message.className = 'language-check-message';
    message.textContent = issue.message;
    menu.appendChild(message);

    issue.fixes.forEach(function (fix) {
      menu.appendChild(item(fix, 'language-check-fix', function () {
        var selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(issue.range);
        document.execCommand('insertText', false, fix);
        checkSoon();
      }));
    });

    menu.appendChild(item('Ignore', '', function () {
      ignored.push({ rule: issue.rule, word: issue.word });
      issues = issues.filter(function (other) {
        return other != issue;
      });
      showIssues();
    }));

    menu.addEventListener('mousedown', function (evt) {
      evt.preventDefault();
      evt.stopPropagation();
    });
    document.body.appendChild(menu);
    menu.style.left = Math.min(x, window.innerWidth - menu.offsetWidth - 8) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - menu.offsetHeight - 8) + 'px';
  }

  // A press outside the menu closes it, and a press inside it goes on to the item.
  document.addEventListener('mousedown', function (evt) {
    if (menu != null && !menu.contains(evt.target)) {
      closeMenu();
    }
  }, true);
  document.addEventListener('keydown', function (evt) {
    if (evt.key == 'Escape' && menu != null) {
      closeMenu();
      evt.stopPropagation();
    }
  }, true);

  var watched = null;

  function watch(box) {
    if (box == null || box == watched) {
      return;
    }

    watched = box;
    box.addEventListener('input', checkSoon);
    box.addEventListener('contextmenu', function (evt) {
      var issue = issueAt(evt.clientX, evt.clientY);

      if (issue != null) {
        evt.preventDefault();
        evt.stopPropagation();
        openMenu(issue, evt.clientX, evt.clientY);
      }
    }, true);
  }

  var startEditing = cellEditor.startEditing;

  cellEditor.startEditing = function () {
    var result = startEditing.apply(this, arguments);
    ignored = [];
    clearIssues();
    watch(cellEditor.textarea);
    checkSoon();
    return result;
  };

  var stopEditing = cellEditor.stopEditing;

  cellEditor.stopEditing = function () {
    version++;
    clearTimeout(timer);
    closeMenu();
    clearIssues();
    return stopEditing.apply(this, arguments);
  };
});
