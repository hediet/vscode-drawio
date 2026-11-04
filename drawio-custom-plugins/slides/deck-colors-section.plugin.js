// Adds the section Deck colors to the Format panel of the draw.io editor, which lists the colors
// of the setting "drawioSlides.colors" of the deck, gives the selection a color of the list, and
// edits the list.
//
// The section sits in the Style tab, after the swatches and before the sections Fill and Line.
// With nothing selected it sits in the Style tab of the diagram and edits the list alone.  While a
// label is edited, it sits in the tab Text, the one tab that draw.io then shows, before the section
// Advanced, and gives the label its font color.
//
// With no color in the setting, the section shows a line that says what a color of the deck is
// for, above the button Add color.
//
// Each row of the section holds a swatch and the name of a color on one line, and under them the
// buttons Fill, Line and Font, a button ✎ that changes the value of the color, and a button × that
// removes the color.
// A click on the swatch gives the selection the color.  While a label of formatted text is
// edited, the selected text takes the color as its font color, as with the button Font, and
// while a label of plain text is edited, the cell takes it as its font color.  Otherwise each selected cell
// takes the color by its kind: a text shape as its font color, an edge and a shape whose fill
// draw.io does not draw as its line color, and any other cell as its fill color.  A group gives
// the color to the cells in it.  With an empty selection, a click on the swatch leaves the
// drawing as it is.  The tooltip of the swatch says what a click does for the selection.  A click
// on ✎ opens the color dialog of draw.io, and the color takes the value chosen.  The name is a
// text field, and a new name renames the color.  The button Add color at the end of the section
// opens the color dialog and adds a color with the first free name of color1, color2 and so on,
// and with the value chosen, or #000000 when the dialog gives no value #RRGGBB.
//
// The swatch and the buttons Fill, Line and Font set the keys of the style that the color
// options Fill, Line and Font Color of draw.io set: fillColor, or swimlaneFillColor for a lane of
// a table and imageBackground for an image, strokeColor, or imageBorder for an image, and
// fontColor.  Each key takes the value #RRGGBB of the color and, beside it, the link to the name
// of the color under the key that window.drawioSlidesSettings.colorLinks gives it, such as
// deckFillColor=red, which deck-color-links.plugin.js draws.  The keys of every selected cell
// change in one edit, which one Undo takes back.  While a label of formatted text is edited, the
// swatch and Font give the selected text the color as the option Font Color of draw.io does,
// through Graph.setEditingFontColor, and give each element that takes the color the attribute
// data-deck-color with the name of the color, in the same edit.  When the selected text is the
// whole label, draw.io gives the cell the font color instead, and the cell takes the link.  While
// a label of plain text is edited, they give the cell the color as its font color.
//
// The VS Code extension yujunhuang.drawio-slides gives the plugin the colors in
// window.drawioSlidesSettings.colors, a list of names and values #RRGGBB in the order of the
// setting.  The plugin sends an edit of the list to the extension as the event
// drawioSlidesEditColor with the operation set, rename or remove, and the extension writes it into
// the .vscode/settings.json of the workspace folder of the drawing, and into the uses of the color
// in the drawing files of the deck.  Before a removal, the extension asks in a dialog of VS Code.
// The extension then sends the colors again through slide-settings.js, and the section shows the
// new list.  The extension refuses an edit with a message in VS Code, such as a name that another
// color has or that is not letters and digits starting with a letter, and the section then shows
// the list as it was, as it does when the removal is cancelled.
//
// The VS Code extension yujunhuang.drawio-slides loads the plugin from its own folder
// drawio-custom-plugins/slides/ after slide-settings.js, for every drawing whose setting
// "drawioSlides.slides" is true, without asking.
Draw.loadPlugin(function (ui) {
  var graph = ui.editor.graph;
  var sectionTitle = 'Deck colors';

  if (typeof onSlideSettingsChange != 'function' || window.drawioSlidesSettings == null) {
    return;
  }

  function colors() {
    return window.drawioSlidesSettings.colors || [];
  }

  // The keys of the links of the color keys of a style, and the attribute of a linked text, or
  // none when the extension gives no links.
  var colorLinks = window.drawioSlidesSettings.colorLinks || {keys: {}, textAttribute: null};

  // The color #RRGGBB that the color dialog gives, or null for none or another value.
  function hexValue(color) {
    var match = /^#?([0-9A-Fa-f]{6})$/.exec(color);

    return (match != null) ? '#' + match[1].toUpperCase() : null;
  }

  function freeName() {
    var names = colors().map(function (color) {
      return color.name;
    });

    for (var count = 1; ; count++) {
      if (names.indexOf('color' + count) < 0) {
        return 'color' + count;
      }
    }
  }

  // Sends the edit to the extension, and draws the list as it is until the extension sends the
  // colors again.
  function sendEdit(edit) {
    window.opener.postMessage(JSON.stringify(Object.assign({event: 'drawioSlidesEditColor'},
      edit)), '*');

    if (ui.format != null) {
      ui.format.refresh();
    }
  }

  function fillKey(cell) {
    return (graph.getCurrentCellStyle(cell)[mxConstants.STYLE_SHAPE] == 'image') ?
      mxConstants.STYLE_IMAGE_BACKGROUND : graph.getFillColorKey(cell);
  }

  function strokeKey(cell) {
    return (graph.getCurrentCellStyle(cell)[mxConstants.STYLE_SHAPE] == 'image') ?
      mxConstants.STYLE_IMAGE_BORDER : mxConstants.STYLE_STROKECOLOR;
  }

  function fontKey() {
    return mxConstants.STYLE_FONTCOLOR;
  }

  // A text shape is a cell whose style names text, or edgeLabel, which styles/default.xml derives
  // from text, or a vertex in an edge without a width or a height, as Graph.isEdgeLabelCell
  // decides.
  function isTextShape(cell) {
    var names = (typeof cell.style == 'string') ? cell.style.split(';') : [];

    return names.indexOf('text') >= 0 || names.indexOf('edgeLabel') >= 0 ||
      graph.isEdgeLabelCell(cell);
  }

  // The key that a click on a swatch sets: the font color of a text shape, the line color of an
  // edge, and the fill color of any other cell whose fill draw.io draws, or else its line color.
  function swatchKey(cell) {
    if (isTextShape(cell)) {
      return fontKey();
    }

    if (graph.getModel().isEdge(cell)) {
      return strokeKey(cell);
    }

    var state = graph.view.getState(cell);

    return (state == null || graph.isFillState(state)) ? fillKey(cell) : strokeKey(cell);
  }

  // The cells that a click on a swatch colors: the selected cells, with each group of draw.io
  // replaced by the cells in it, because draw.io draws a group with neither fill nor line.
  function swatchCells(cells) {
    return cells.reduce(function (result, cell) {
      var names = (typeof cell.style == 'string') ? cell.style.split(';') : [];

      return result.concat((names.indexOf('group') >= 0) ?
        swatchCells(graph.getModel().getChildren(cell) || []) : [cell]);
    }, []);
  }

  // Gives each cell the value of the color under the key of the cell and the name of the color
  // under the link of that key, in one edit, as BaseFormatPanel.createCellColorOption does.  The
  // cells that take a font color also show their label and lose the colors of its text, as with
  // the option Font Color.
  function setCellColors(keyOf, color, cells) {
    var keys = [];
    var groups = {};

    cells.forEach(function (cell) {
      var key = keyOf(cell);

      if (groups[key] == null) {
        groups[key] = [];
        keys.push(key);
      }

      groups[key].push(cell);
    });

    graph.getModel().beginUpdate();

    try {
      keys.forEach(function (key) {
        graph.setCellStyles(key, color.value, groups[key]);

        if (colorLinks.keys[key] != null) {
          graph.setCellStyles(colorLinks.keys[key], color.name, groups[key]);
        }
      });

      var fontCells = groups[mxConstants.STYLE_FONTCOLOR];

      if (fontCells != null) {
        graph.setCellStyles(mxConstants.STYLE_NOLABEL, null, fontCells);
        graph.updateLabelElements(fontCells, function (elt) {
          elt.removeAttribute('color');
          elt.style.color = null;
        });
      }

      keys.forEach(function (key) {
        ui.fireEvent(new mxEventObject('styleChanged', 'keys', [key], 'values', [color.value],
          'cells', groups[key]));
      });
    } finally {
      graph.getModel().endUpdate();
    }
  }

  // The color that draw.io records as given to an element of the label being edited, which it
  // writes into the style of the element when the editing stops, or null.
  function givenColor(element) {
    try {
      return JSON.parse(element.getAttribute(Graph.backupStyleAttribute) || '{}').color || null;
    } catch (error) {
      return null;
    }
  }

  // Gives the selected text of the label being edited the color, as the option Font Color of the
  // tab Text does while a label is edited, and links each element that takes the color to its
  // name, or the cell when draw.io gives the whole label the color as its font color.
  function setEditingFontColor(color) {
    var textarea = graph.cellEditor.textarea;
    var elements = function () {
      return Array.prototype.slice.call(textarea.getElementsByTagName('*'));
    };
    var before = elements().map(function (element) {
      return {element: element, color: givenColor(element)};
    });
    var wasGiven = function (element) {
      return before.some(function (entry) {
        return entry.element == element && entry.color == givenColor(element);
      });
    };
    var cell = null;

    graph.getModel().beginUpdate();

    try {
      cell = graph.setEditingFontColor(color.value);
      var fontLink = colorLinks.keys[mxConstants.STYLE_FONTCOLOR];

      if (cell != null && fontLink != null) {
        graph.setCellStyles(fontLink, color.name, [cell]);
      } else if (cell == null && colorLinks.textAttribute != null) {
        elements().forEach(function (element) {
          if (givenColor(element) == color.value && !wasGiven(element)) {
            element.setAttribute(colorLinks.textAttribute, color.name);
          }
        });
      }
    } finally {
      graph.getModel().endUpdate();
    }

    ui.fireEvent(new mxEventObject('styleChanged', 'keys', [mxConstants.STYLE_FONTCOLOR],
      'values', [color.value], 'cells', (cell != null) ? [cell] : ui.getSelectionState().cells));
  }

  // The function that gives the label being edited a color as its font color: the selected text
  // of a label of formatted text, or the cell of a label of plain text.
  function editingFontColorSetter() {
    return graph.cellEditor.isContentEditing() ? setEditingFontColor : function (color) {
      setCellColors(fontKey, color, ui.getSelectionState().cells);
    };
  }

  // What a click on a swatch does for the selection state: the tooltip after the value of the
  // color, and the function that gives the selection the color, or null for an empty selection.
  function swatchAction(selection) {
    if (graph.isEditing()) {
      return {
        tooltip: graph.cellEditor.isContentEditing() ?
          'A click gives the selected text the color.' :
          'A click gives the label the color as font color.',
        apply: editingFontColorSetter()
      };
    } else if (selection.cells.length == 0) {
      return {
        tooltip: 'The selection is empty, so a click leaves the drawing as it is.',
        apply: null
      };
    }

    return {
      tooltip: 'A click gives the color to each selected text shape as font color, to each ' +
        'edge and each shape without a fill as line color, and to each other shape as fill ' +
        'color, and a selected group gives it to the cells in it.',
      apply: function (color) {
        setCellColors(swatchKey, color, swatchCells(ui.getSelectionState().cells));
      }
    };
  }

  // The buttons of a row that give the selection the color, for the selection state.
  function applyButtons(selection) {
    if (graph.isEditing()) {
      return [{label: mxResources.get('font'), apply: editingFontColorSetter()}];
    }

    var buttons = [];

    if (selection.fill) {
      buttons.push({label: mxResources.get('fill'), apply: function (color) {
        setCellColors(fillKey, color, ui.getSelectionState().cells);
      }});
    }

    if (!selection.containsLabel) {
      buttons.push({label: mxResources.get('line'), apply: function (color) {
        setCellColors(strokeKey, color, ui.getSelectionState().cells);
      }});
    }

    buttons.push({label: mxResources.get('font'), apply: function (color) {
      setCellColors(fontKey, color, ui.getSelectionState().cells);
    }});

    return buttons;
  }

  // A press on an element outside the label being edited loses the selection of its text.  The
  // function saves that selection at each press of the element, and returns the function that
  // gives it back before a color is set, as the color options of draw.io do.
  function saveTextSelectionOnPress(element) {
    var selectionState = null;

    mxEvent.addGestureListeners(element, function () {
      if (document.activeElement == graph.cellEditor.textarea) {
        selectionState = graph.cellEditor.saveSelection();
      }
    });

    return function () {
      if (selectionState != null) {
        graph.cellEditor.restoreSelection(selectionState);
        selectionState = null;
      }
    };
  }

  function smallButton(label, tooltip, onClick) {
    var button = mxUtils.button(label, function (evt) {
      onClick();
      mxEvent.consume(evt);
    });

    button.setAttribute('title', tooltip);
    button.style.padding = '0 4px';
    button.style.flex = '0 0 auto';

    return button;
  }

  function swatch(color, action) {
    var restoreTextSelection = null;
    var button = mxUtils.button('', function (evt) {
      if (action.apply != null) {
        restoreTextSelection();
        action.apply({name: color.name, value: color.value});
      }

      mxEvent.consume(evt);
    });

    var fill = document.createElement('div');
    fill.style.width = '21px';
    fill.style.height = '12px';
    fill.style.margin = '3px';
    fill.style.border = '1px solid';
    fill.style.backgroundColor = color.value;
    button.appendChild(fill);
    button.className = 'geColorBtn';
    button.setAttribute('title', color.name + ' ' + color.value + '. ' + action.tooltip);
    button.style.flex = '0 0 auto';
    restoreTextSelection = saveTextSelectionOnPress(button);

    return button;
  }

  // Opens the color dialog of draw.io at the value of the color, and sends the value chosen.
  function pickColorValue(color) {
    ui.pickColorModal(color.value, function (chosen) {
      var value = hexValue(chosen);

      if (value != null && value != color.value) {
        sendEdit({operation: 'set', name: color.name, value: value});
      }
    }, null, null, true, color.name);
  }

  function nameField(color) {
    var input = document.createElement('input');
    input.setAttribute('type', 'text');
    input.setAttribute('title', mxResources.get('name'));
    input.value = color.name;
    input.style.flex = '1 1 auto';
    input.style.minWidth = '0';
    input.style.textAlign = 'left';

    mxEvent.addListener(input, 'change', function () {
      var name = mxUtils.trim(input.value);

      if (name != color.name) {
        sendEdit({operation: 'rename', name: color.name, newName: name});
        // The row now stands for the new name, so that a new value or a removal before the list
        // is drawn again names the renamed color.
        color.name = name;
      }
    });

    mxEvent.addListener(input, 'keydown', function (evt) {
      if (evt.keyCode == 13) {
        input.blur();
      } else if (evt.keyCode == 27) {
        input.value = color.name;
        input.blur();
      }
    });

    return input;
  }

  function colorRow(colorOfSettings, action, buttons) {
    // A copy of the color of the settings, whose name a rename in the row changes.
    var color = {name: colorOfSettings.name, value: colorOfSettings.value};
    // The swatch and the name take a line of their own, so that a narrow panel cuts no name, and
    // the buttons follow on a second line under the name.
    var row = document.createElement('div');
    row.style.padding = '2px 0';
    var head = document.createElement('div');
    head.style.display = 'flex';
    head.style.alignItems = 'center';
    head.style.gap = '2px';
    head.appendChild(swatch(color, action));
    head.appendChild(nameField(color));
    row.appendChild(head);
    var controls = document.createElement('div');
    controls.style.display = 'flex';
    controls.style.flexWrap = 'wrap';
    controls.style.gap = '2px';
    controls.style.marginTop = '1px';
    controls.style.paddingLeft = '31px';
    row.appendChild(controls);

    buttons.forEach(function (button) {
      var restoreTextSelection = null;
      var element = smallButton(button.label, button.label + ': ' + color.name, function () {
        restoreTextSelection();
        button.apply({name: color.name, value: color.value});
      });

      restoreTextSelection = saveTextSelectionOnPress(element);
      controls.appendChild(element);
    });

    controls.appendChild(smallButton('✎', mxResources.get('edit') + ': ' + color.name, function () {
      pickColorValue(color);
    }));
    controls.appendChild(smallButton('×', mxResources.get('remove') + ': ' + color.name,
      function () {
        sendEdit({operation: 'remove', name: color.name});
      }));

    return row;
  }

  // The line that an empty list shows, which says what a color of the deck is for.
  function emptyListHint() {
    var hint = document.createElement('div');
    hint.style.padding = '2px 0 4px 0';
    hint.style.whiteSpace = 'normal';
    hint.style.opacity = '0.7';
    mxUtils.write(hint, 'The deck names no color yet. A named color can color formulas, as in ' +
      '\\textcolor{blue}{x}, swatches and list markers, and a click on its swatch applies it.');

    return hint;
  }

  function addButton() {
    var button = mxUtils.button('Add color', function (evt) {
      ui.pickColorModal('#000000', function (color) {
        sendEdit({operation: 'set', name: freeName(), value: hexValue(color) || '#000000'});
      }, null, null, true, 'Add color');
      mxEvent.consume(evt);
    });

    button.className = 'geFullWidthElement';
    button.style.marginTop = '4px';

    return button;
  }

  // Puts the section before the first section of the panel that folds, which is Fill or Line in
  // the Style tab and Advanced, after the font color, in the tab Text, or at the end of a panel
  // without such a section.
  function addSection(panel, buttons) {
    var section = panel.createCollapsibleSection(sectionTitle, false);
    var content = panel.createPanel();
    var action = swatchAction(panel.editorUi.getSelectionState());

    colors().forEach(function (color) {
      content.appendChild(colorRow(color, action, buttons));
    });

    if (colors().length == 0) {
      content.appendChild(emptyListHint());
    }

    content.appendChild(addButton());
    section.contentDiv.appendChild(content);
    var title = panel.container.querySelector(':scope > .geFormatSection > .geCollapsibleTitle');
    panel.container.insertBefore(section.wrapper, (title != null) ? title.parentNode : null);
  }

  var styleFormatPanelInit = StyleFormatPanel.prototype.init;

  StyleFormatPanel.prototype.init = function () {
    styleFormatPanelInit.apply(this, arguments);
    addSection(this, applyButtons(this.editorUi.getSelectionState()));
  };

  var diagramStylePanelInit = DiagramStylePanel.prototype.init;

  DiagramStylePanel.prototype.init = function () {
    diagramStylePanelInit.apply(this, arguments);
    addSection(this, []);
  };

  var textFormatPanelInit = TextFormatPanel.prototype.init;

  TextFormatPanel.prototype.init = function () {
    textFormatPanelInit.apply(this, arguments);

    if (graph.isEditing()) {
      addSection(this, applyButtons(this.editorUi.getSelectionState()));
    }
  };

  onSlideSettingsChange(function () {
    if (ui.format != null) {
      ui.format.refresh();
    }
  });
});
