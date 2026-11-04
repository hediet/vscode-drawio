// Adds the section Deck colours to the Format panel of the draw.io editor, which lists the colours
// of the setting "drawioSlides.colors" of the deck, gives the selection a colour of the list, and
// edits the list.
//
// The section sits in the Style tab, after the swatches and before the sections Fill and Line.
// With nothing selected it sits in the Style tab of the diagram and edits the list alone.  While a
// label is edited, it sits in the tab Text, the one tab that draw.io then shows, before the section
// Advanced, and gives the label its font colour.
//
// With no colour in the setting, the section shows a line that says what a colour of the deck is
// for, above the button Add colour.
//
// Each row of the section holds a swatch and the name of a colour on one line, and under them the
// buttons Fill, Line and Font, a button ✎ that changes the value of the colour, and a button × that
// removes the colour.
// A click on the swatch gives the selection the colour.  While a label of formatted text is
// edited, the selected text takes the colour as its font colour, as with the button Font, and
// while a label of plain text is edited, the cell takes it as its font colour.  Otherwise each selected cell
// takes the colour by its kind: a text shape as its font colour, an edge and a shape whose fill
// draw.io does not draw as its line colour, and any other cell as its fill colour.  A group gives
// the colour to the cells in it.  With an empty selection, a click on the swatch leaves the
// drawing as it is.  The tooltip of the swatch says what a click does for the selection.  A click
// on ✎ opens the colour dialog of draw.io, and the colour takes the value chosen.  The name is a
// text field, and a new name renames the colour.  The button Add colour at the end of the section
// opens the colour dialog and adds a colour with the first free name of color1, color2 and so on,
// and with the value chosen, or #000000 when the dialog gives no value #RRGGBB.
//
// The swatch and the buttons Fill, Line and Font set the keys of the style that the colour
// options Fill, Line and Font Color of draw.io set: fillColor, or swimlaneFillColor for a lane of
// a table and imageBackground for an image, strokeColor, or imageBorder for an image, and
// fontColor.  The keys of every selected cell change in one edit, which one Undo takes back.
// While a label of formatted text is edited, the swatch and Font give the selected text the colour
// as the option Font Color of draw.io does, through Graph.setEditingFontColor.  While a label of
// plain text is edited, they give the cell the colour as its font colour.  A cell takes the value #RRGGBB
// of the colour and keeps no link to its name.
//
// The VS Code extension yujunhuang.drawio-slides gives the plugin the colours in
// window.drawioSlidesSettings.colors, a list of names and values #RRGGBB in the order of the
// setting.  The plugin sends an edit of the list to the extension as the event
// drawioSlidesEditColor with the operation set, rename or remove, and the extension writes it into
// the .vscode/settings.json of the workspace folder of the drawing.  The extension then sends the
// colours again through slide-settings.js, and the section shows the new list.  The extension
// refuses an edit with a message in VS Code, such as a name that another colour has or that is not
// letters and digits starting with a letter, and the section then shows the list as it was.
//
// The VS Code extension yujunhuang.drawio-slides loads the plugin from its own folder
// drawio-custom-plugins/slides/ after slide-settings.js, for every drawing whose setting
// "drawioSlides.slides" is true, without asking.
Draw.loadPlugin(function (ui) {
  var graph = ui.editor.graph;
  var sectionTitle = 'Deck colours';

  if (typeof onSlideSettingsChange != 'function' || window.drawioSlidesSettings == null) {
    return;
  }

  function colours() {
    return window.drawioSlidesSettings.colors || [];
  }

  // The colour #RRGGBB that the colour dialog gives, or null for none or another value.
  function hexValue(color) {
    var match = /^#?([0-9A-Fa-f]{6})$/.exec(color);

    return (match != null) ? '#' + match[1].toUpperCase() : null;
  }

  function freeName() {
    var names = colours().map(function (colour) {
      return colour.name;
    });

    for (var count = 1; ; count++) {
      if (names.indexOf('color' + count) < 0) {
        return 'color' + count;
      }
    }
  }

  // Sends the edit to the extension, and draws the list as it is until the extension sends the
  // colours again.
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

  // The key that a click on a swatch sets: the font colour of a text shape, the line colour of an
  // edge, and the fill colour of any other cell whose fill draw.io draws, or else its line colour.
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

  // The cells that a click on a swatch colours: the selected cells, with each group of draw.io
  // replaced by the cells in it, because draw.io draws a group with neither fill nor line.
  function swatchCells(cells) {
    return cells.reduce(function (result, cell) {
      var names = (typeof cell.style == 'string') ? cell.style.split(';') : [];

      return result.concat((names.indexOf('group') >= 0) ?
        swatchCells(graph.getModel().getChildren(cell) || []) : [cell]);
    }, []);
  }

  // Gives each cell the colour under the key of the cell, in one edit, as
  // BaseFormatPanel.createCellColorOption does.  The cells that take a font colour also show their
  // label and lose the colours of its text, as with the option Font Color.
  function setCellColours(keyOf, color, cells) {
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
        graph.setCellStyles(key, color, groups[key]);
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
        ui.fireEvent(new mxEventObject('styleChanged', 'keys', [key], 'values', [color],
          'cells', groups[key]));
      });
    } finally {
      graph.getModel().endUpdate();
    }
  }

  // Gives the selected text of the label being edited the colour, as the option Font Color of the
  // tab Text does while a label is edited.
  function setEditingFontColour(color) {
    var cell = graph.setEditingFontColor(color);

    ui.fireEvent(new mxEventObject('styleChanged', 'keys', [mxConstants.STYLE_FONTCOLOR],
      'values', [color], 'cells', (cell != null) ? [cell] : ui.getSelectionState().cells));
  }

  // The function that gives the label being edited a colour as its font colour: the selected text
  // of a label of formatted text, or the cell of a label of plain text.
  function editingFontColourSetter() {
    return graph.cellEditor.isContentEditing() ? setEditingFontColour : function (color) {
      setCellColours(fontKey, color, ui.getSelectionState().cells);
    };
  }

  // What a click on a swatch does for the selection state: the tooltip after the value of the
  // colour, and the function that gives the selection the colour, or null for an empty selection.
  function swatchAction(selection) {
    if (graph.isEditing()) {
      return {
        tooltip: graph.cellEditor.isContentEditing() ?
          'A click gives the selected text the colour.' :
          'A click gives the label the colour as font colour.',
        apply: editingFontColourSetter()
      };
    } else if (selection.cells.length == 0) {
      return {
        tooltip: 'The selection is empty, so a click leaves the drawing as it is.',
        apply: null
      };
    }

    return {
      tooltip: 'A click gives the colour to each selected text shape as font colour, to each ' +
        'edge and each shape without a fill as line colour, and to each other shape as fill ' +
        'colour, and a selected group gives it to the cells in it.',
      apply: function (color) {
        setCellColours(swatchKey, color, swatchCells(ui.getSelectionState().cells));
      }
    };
  }

  // The buttons of a row that give the selection the colour, for the selection state.
  function applyButtons(selection) {
    if (graph.isEditing()) {
      return [{label: mxResources.get('font'), apply: editingFontColourSetter()}];
    }

    var buttons = [];

    if (selection.fill) {
      buttons.push({label: mxResources.get('fill'), apply: function (color) {
        setCellColours(fillKey, color, ui.getSelectionState().cells);
      }});
    }

    if (!selection.containsLabel) {
      buttons.push({label: mxResources.get('line'), apply: function (color) {
        setCellColours(strokeKey, color, ui.getSelectionState().cells);
      }});
    }

    buttons.push({label: mxResources.get('font'), apply: function (color) {
      setCellColours(fontKey, color, ui.getSelectionState().cells);
    }});

    return buttons;
  }

  // A press on an element outside the label being edited loses the selection of its text.  The
  // function saves that selection at each press of the element, and returns the function that
  // gives it back before a colour is set, as the colour options of draw.io do.
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

  function swatch(colour, action) {
    var restoreTextSelection = null;
    var button = mxUtils.button('', function (evt) {
      if (action.apply != null) {
        restoreTextSelection();
        action.apply(colour.value);
      }

      mxEvent.consume(evt);
    });

    var fill = document.createElement('div');
    fill.style.width = '21px';
    fill.style.height = '12px';
    fill.style.margin = '3px';
    fill.style.border = '1px solid';
    fill.style.backgroundColor = colour.value;
    button.appendChild(fill);
    button.className = 'geColorBtn';
    button.setAttribute('title', colour.name + ' ' + colour.value + '. ' + action.tooltip);
    button.style.flex = '0 0 auto';
    restoreTextSelection = saveTextSelectionOnPress(button);

    return button;
  }

  // Opens the colour dialog of draw.io at the value of the colour, and sends the value chosen.
  function pickColourValue(colour) {
    ui.pickColorModal(colour.value, function (color) {
      var value = hexValue(color);

      if (value != null && value != colour.value) {
        sendEdit({operation: 'set', name: colour.name, value: value});
      }
    }, null, null, true, colour.name);
  }

  function nameField(colour) {
    var input = document.createElement('input');
    input.setAttribute('type', 'text');
    input.setAttribute('title', mxResources.get('name'));
    input.value = colour.name;
    input.style.flex = '1 1 auto';
    input.style.minWidth = '0';
    input.style.textAlign = 'left';

    mxEvent.addListener(input, 'change', function () {
      var name = mxUtils.trim(input.value);

      if (name != colour.name) {
        sendEdit({operation: 'rename', name: colour.name, newName: name});
        // The row now stands for the new name, so that a new value or a removal before the list
        // is drawn again names the renamed colour.
        colour.name = name;
      }
    });

    mxEvent.addListener(input, 'keydown', function (evt) {
      if (evt.keyCode == 13) {
        input.blur();
      } else if (evt.keyCode == 27) {
        input.value = colour.name;
        input.blur();
      }
    });

    return input;
  }

  function colourRow(colourOfSettings, action, buttons) {
    // A copy of the colour of the settings, whose name a rename in the row changes.
    var colour = {name: colourOfSettings.name, value: colourOfSettings.value};
    // The swatch and the name take a line of their own, so that a narrow panel cuts no name, and
    // the buttons follow on a second line under the name.
    var row = document.createElement('div');
    row.style.padding = '2px 0';
    var head = document.createElement('div');
    head.style.display = 'flex';
    head.style.alignItems = 'center';
    head.style.gap = '2px';
    head.appendChild(swatch(colour, action));
    head.appendChild(nameField(colour));
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
      var element = smallButton(button.label, button.label + ': ' + colour.name, function () {
        restoreTextSelection();
        button.apply(colour.value);
      });

      restoreTextSelection = saveTextSelectionOnPress(element);
      controls.appendChild(element);
    });

    controls.appendChild(smallButton('✎', mxResources.get('edit') + ': ' + colour.name, function () {
      pickColourValue(colour);
    }));
    controls.appendChild(smallButton('×', mxResources.get('remove') + ': ' + colour.name,
      function () {
        sendEdit({operation: 'remove', name: colour.name});
      }));

    return row;
  }

  // The line that an empty list shows, which says what a colour of the deck is for.
  function emptyListHint() {
    var hint = document.createElement('div');
    hint.style.padding = '2px 0 4px 0';
    hint.style.whiteSpace = 'normal';
    hint.style.opacity = '0.7';
    mxUtils.write(hint, 'The deck names no colour yet. A named colour can colour formulas, as in ' +
      '\\textcolor{blue}{x}, swatches and list markers, and a click on its swatch applies it.');

    return hint;
  }

  function addButton() {
    var button = mxUtils.button('Add colour', function (evt) {
      ui.pickColorModal('#000000', function (color) {
        sendEdit({operation: 'set', name: freeName(), value: hexValue(color) || '#000000'});
      }, null, null, true, 'Add colour');
      mxEvent.consume(evt);
    });

    button.className = 'geFullWidthElement';
    button.style.marginTop = '4px';

    return button;
  }

  // Puts the section before the first section of the panel that folds, which is Fill or Line in
  // the Style tab and Advanced, after the font colour, in the tab Text, or at the end of a panel
  // without such a section.
  function addSection(panel, buttons) {
    var section = panel.createCollapsibleSection(sectionTitle, false);
    var content = panel.createPanel();
    var action = swatchAction(panel.editorUi.getSelectionState());

    colours().forEach(function (colour) {
      content.appendChild(colourRow(colour, action, buttons));
    });

    if (colours().length == 0) {
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
