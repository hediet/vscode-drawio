// Adds the section Deck styles to the Format panel of the draw.io editor, which lists the styles
// of the setting "drawSlidesCode.deckStyles" of the deck, gives the selection a style of the list,
// saves a style from a selected cell, updates a style from a changed cell, and renames and removes
// a style.
//
// A style belongs to a kind of geometry, rectangles or wires, and the section shows a list per
// kind, as the Format panel of Keynote shows the styles of the kind of object selected.  The
// section sits in the Style tab after the section Deck colors and before the sections Fill and
// Line.  With a selection it shows the lists of the kinds of the selected cells, and with nothing
// selected it shows every list in the Style tab of the diagram, where it renames and removes alone.
//
// Each list is a grid of tiles, and each tile holds a preview of the style, which draw.io draws as
// it draws a shape of the sidebar, its name in a text field, and a button × that removes the style.
// A click on the preview gives the style to each selected cell of its kind, a group giving it to
// the cells in it, in one edit, which one Undo takes back.  The tile of the style that the selected
// cells link to has a frame.  When one selected cell links to a style and differs from it, a line
// under the grid names the keys that differ, with the button Update, which redefines the style from
// the cell and updates every cell of the deck linked to it, as Redefine Style from Selection of
// Keynote does, and the button Revert, which gives the cell the style again.  The button New style
// from selection at the end of a list saves the style of the one selected cell of its kind, with the
// first free name of rectangle1, rectangle2 and so on, or of wire1, wire2 and so on, and links the
// cell to it.  A new name in the text field renames the style.
//
// deck-style-rules.js, loaded before this plugin, holds the rules: which keys a style holds, what a
// give and an update write, and which keys of a cell differ from its style.  An update writes the
// change into the linked cells of the current page in one edit of the model, and the extension
// writes it into the drawing files of the deck.  A cell keeps a key in which it differed from the
// style before the update.
//
// draw.io merges a change of the file from the extension as the change from the file as it was
// loaded, so a cell linked since then would keep its old link or its old keys.  After each edit of
// the styles that it writes, the extension therefore sends every open drawing of the deck the edit
// of the linked cells, as the action drawSlidesCodeStyleUse, and the plugin applies it to every page
// of the drawing: to the current page in one edit of the model, and to the cells of the other pages,
// which draw.io keeps in each page.  The edit gives an already edited cell no further change, so the
// merge and the action agree in either order.
//
// The VS Code extension yujunhuang.drawslidescode gives the plugin the styles in
// window.drawSlidesCodeSettings.styles, a list of names and style strings per kind in the order of
// the setting, and the keys of the links to the colors of the deck in
// window.drawSlidesCodeSettings.colorLinks.  The plugin sends an edit of the styles to the extension
// as the event drawSlidesCodeEditStyle with the operation set, rename or remove, and the extension
// writes it into the .vscode/settings.json of the workspace folder of the drawing and into the cells
// linked to the style in the drawing files of the deck.  Before a removal, the extension asks in a
// dialog of VS Code that counts the linked cells.  The extension then sends the styles again through
// slide-settings.js, and the section shows the new lists.  The extension refuses an edit with a
// message in VS Code, such as a name that another style has, and the section then shows the lists
// as they were.  An undo of an edit made before a style lost its name would give the cells of that
// edit a link to the old name, so the plugin clears the undo history of the editor when the styles
// lose a name.
//
// The VS Code extension yujunhuang.drawslidescode loads the plugin from its own folder
// drawio-custom-plugins/slides/ after slide-settings.js and deck-style-rules.js, for every drawing
// whose setting "drawSlidesCode.slides" is true, without asking.
Draw.loadPlugin(function (ui) {
  var graph = ui.editor.graph;
  var sectionTitle = 'Deck styles';
  if (typeof onSlideSettingsChange != 'function' || window.drawSlidesCodeSettings == null ||
    typeof deckStyleRules != 'function') {
    return;
  }

  var rules = deckStyleRules((window.drawSlidesCodeSettings.colorLinks || {}).keys);
  var kindTitles = {rectangles: 'Rectangles', wires: 'Wires'};
  var kindNouns = {rectangles: 'rectangle', wires: 'wire'};

  function stylesOf(kind) {
    // slide-settings.js gives window.drawSlidesCodeSettings a new object at each change.
    return ((window.drawSlidesCodeSettings.styles || {})[kind]) || [];
  }

  function styleNamed(name) {
    var found = null;

    rules.kinds.forEach(function (kind) {
      stylesOf(kind).forEach(function (style) {
        if (style.name == name) {
          found = {kind: kind, name: style.name, style: style.style};
        }
      });
    });

    return found;
  }

  function allNames() {
    return rules.kinds.reduce(function (names, kind) {
      return names.concat(stylesOf(kind).map(function (style) {
        return style.name;
      }));
    }, []);
  }

  function freeName(kind) {
    var names = allNames();

    for (var count = 1; ; count++) {
      if (names.indexOf(kindNouns[kind] + count) < 0) {
        return kindNouns[kind] + count;
      }
    }
  }

  // Sends the edit to the extension, and draws the lists as they are until the extension sends
  // the styles again.
  function sendEdit(edit) {
    window.opener.postMessage(JSON.stringify(Object.assign({event: 'drawSlidesCodeEditStyle'},
      edit)), '*');

    if (ui.format != null) {
      ui.format.refresh();
    }
  }

  function kindOfCell(cell) {
    return rules.kindOf(graph.getModel().getStyle(cell), graph.getModel().isEdge(cell));
  }

  // The selected cells, with each group of draw.io replaced by the cells in it.
  function selectedCells() {
    var expanded = function (cells) {
      return cells.reduce(function (result, cell) {
        var names = (typeof cell.style == 'string') ? cell.style.split(';') : [];

        return result.concat((names.indexOf('group') >= 0) ?
          expanded(graph.getModel().getChildren(cell) || []) : [cell]);
      }, []);
    };

    return expanded(graph.getSelectionCells());
  }

  function selectedCellsOf(kind) {
    return selectedCells().filter(function (cell) {
      return kindOfCell(cell) == kind;
    });
  }

  // Sets the style string of each cell to the one that styleOf gives it, in one edit.
  function setStyles(cells, styleOf) {
    var model = graph.getModel();

    model.beginUpdate();

    try {
      cells.forEach(function (cell) {
        var style = styleOf(model.getStyle(cell) || '');

        if (style != model.getStyle(cell)) {
          model.setStyle(cell, style);
        }
      });
    } finally {
      model.endUpdate();
    }
  }

  function give(style, cells) {
    setStyles(cells, function (cellStyle) {
      return rules.given(cellStyle, style.name, style.style);
    });
  }

  // The cells of the current page linked to the style.
  function linkedCells(name) {
    var model = graph.getModel();

    return Object.keys(model.cells).map(function (id) {
      return model.cells[id];
    }).filter(function (cell) {
      return rules.linkOf(model.getStyle(cell)) == name;
    });
  }

  // Redefines the style from the cell: the cells of the current page linked to it take the change
  // in one edit, and the extension writes the style and the change into the files of the deck.
  function update(style, cell) {
    var after = rules.appearanceOf(graph.getModel().getStyle(cell));

    setStyles(linkedCells(style.name), function (cellStyle) {
      return rules.updated(cellStyle, style.style, after);
    });
    sendEdit({operation: 'set', kind: style.kind, name: style.name, style: after});
  }

  // The style of a cell after the edit of the cells linked to a style, which the extension sends.
  function styleAfterUseEdit(edit, style) {
    if (rules.linkOf(style) != edit.name) {
      return style;
    }

    return (edit.operation == 'update') ? rules.updated(style, edit.before, edit.after) :
      rules.relinked(style, (edit.operation == 'rename') ? edit.newName : null);
  }

  // Applies the edit to every page of the drawing: to the current page in one edit of the model,
  // and to the cells that draw.io keeps for each other page.
  function applyUseEdit(edit) {
    var restyle = function (style) {
      return styleAfterUseEdit(edit, style);
    };

    setStyles(linkedCells(edit.name), restyle);

    (ui.pages || []).forEach(function (page) {
      if (page == ui.currentPage || page.root == null) {
        return;
      }

      var visit = function (cell) {
        if (typeof cell.style == 'string') {
          cell.style = restyle(cell.style);
        }

        (cell.children || []).forEach(visit);
      };

      visit(page.root);
    });
  }

  window.addEventListener('message', function (evt) {
    if (evt.source !== window.opener || typeof evt.data != 'string') {
      return;
    }

    var data = null;

    try {
      data = JSON.parse(evt.data);
    } catch (error) {
      return;
    }

    if (data != null && data.action == 'drawSlidesCodeStyleUse' && data.edit != null) {
      applyUseEdit(data.edit);
    }
  });

  function saveNewStyle(kind, cell) {
    var name = freeName(kind);
    var style = rules.appearanceOf(graph.getModel().getStyle(cell));

    give({name: name, style: style}, [cell]);
    sendEdit({operation: 'set', kind: kind, name: name, style: style});
  }

  // A preview of the style, drawn as the sidebar of draw.io draws a shape, or the name of the kind
  // when the editor has no sidebar.
  function preview(kind, style, parent) {
    if (ui.sidebar == null) {
      mxUtils.write(parent, kindNouns[kind]);
      return;
    }

    var cell = null;

    if (kind == 'wires') {
      cell = new mxCell('', new mxGeometry(0, 0, 0, 0), style.style);
      cell.geometry.relative = true;
      cell.geometry.setTerminalPoint(new mxPoint(0, 20), true);
      cell.geometry.setTerminalPoint(new mxPoint(120, 20), false);
      cell.edge = true;
    } else {
      cell = new mxCell('', new mxGeometry(0, 0, 120, 70), style.style);
      cell.vertex = true;
    }

    ui.sidebar.createThumb([cell], 56, 30, parent, null, false, false);
  }

  function nameField(style) {
    var input = document.createElement('input');
    input.setAttribute('type', 'text');
    input.setAttribute('title', mxResources.get('name'));
    input.value = style.name;
    input.style.width = '100%';
    input.style.boxSizing = 'border-box';
    input.style.fontSize = '10px';
    input.style.textAlign = 'center';

    mxEvent.addListener(input, 'change', function () {
      var name = mxUtils.trim(input.value);

      if (name != style.name) {
        sendEdit({operation: 'rename', name: style.name, newName: name});
        // The tile now stands for the new name, so that a removal before the lists are drawn
        // again names the renamed style.
        style.name = name;
      }
    });

    mxEvent.addListener(input, 'keydown', function (evt) {
      if (evt.keyCode == 13) {
        input.blur();
      } else if (evt.keyCode == 27) {
        input.value = style.name;
        input.blur();
      }
    });

    return input;
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

  // The tile of a style: its preview, which gives the style to the selected cells of its kind, its
  // name, and the button that removes it.
  function tile(kind, styleOfSettings, cells, isLinked) {
    var style = {kind: kind, name: styleOfSettings.name, style: styleOfSettings.style};
    var element = document.createElement('div');
    element.style.width = '64px';
    element.style.position = 'relative';
    element.style.padding = '2px';
    element.style.boxSizing = 'border-box';
    element.style.border = isLinked ? '2px solid #29b6f2' : '2px solid transparent';
    element.style.borderRadius = '4px';
    element.setAttribute('data-deck-style', style.name);

    var thumb = mxUtils.button('', function (evt) {
      if (cells.length > 0) {
        give(style, cells);
      }

      mxEvent.consume(evt);
    });
    thumb.className = 'geColorBtn';
    thumb.style.width = '100%';
    thumb.style.height = '36px';
    thumb.style.padding = '0';
    thumb.style.overflow = 'hidden';
    thumb.setAttribute('title', style.name + '. ' + ((cells.length > 0) ?
      'A click gives the style to each selected ' + kindNouns[kind] + '.' :
      'Select a ' + kindNouns[kind] + ' to give it the style.'));
    preview(kind, style, thumb);
    element.appendChild(thumb);
    element.appendChild(nameField(style));

    var remove = smallButton('×', mxResources.get('remove') + ': ' + style.name, function () {
      sendEdit({operation: 'remove', name: style.name});
    });
    remove.style.position = 'absolute';
    remove.style.top = '0';
    remove.style.right = '0';
    remove.style.lineHeight = '12px';
    remove.style.fontSize = '10px';
    element.appendChild(remove);

    return element;
  }

  // The line under the grid for one selected cell that links to a style of the kind and differs
  // from it, with the buttons Update and Revert, or null.
  function changedLine(kind, cells) {
    if (cells.length != 1) {
      return null;
    }

    var cell = cells[0];
    var cellStyle = graph.getModel().getStyle(cell);
    var style = styleNamed(rules.linkOf(cellStyle));

    if (style == null || style.kind != kind) {
      return null;
    }

    var keys = rules.differingKeys(cellStyle, style.style);

    if (keys.length == 0) {
      return null;
    }

    var line = document.createElement('div');
    line.style.padding = '4px 0 0 0';
    line.style.whiteSpace = 'normal';
    var text = document.createElement('div');
    text.style.opacity = '0.7';
    mxUtils.write(text, 'The ' + kindNouns[kind] + ' differs from ' + style.name + ' in ' +
      keys.join(', ') + '.');
    line.appendChild(text);
    var buttons = document.createElement('div');
    buttons.style.display = 'flex';
    buttons.style.gap = '2px';
    buttons.style.marginTop = '2px';
    buttons.appendChild(smallButton('Update', 'Redefine ' + style.name + ' from the ' +
      kindNouns[kind] + ', and update every ' + kindNouns[kind] + ' of the deck that uses it',
      function () {
        update(style, cell);
      }));
    buttons.appendChild(smallButton('Revert', 'Give the ' + kindNouns[kind] + ' the style ' +
      style.name + ' again', function () {
        give(style, [cell]);
      }));
    line.appendChild(buttons);

    return line;
  }

  function newStyleButton(kind, cells) {
    var button = mxUtils.button('New style from selection', function (evt) {
      if (cells.length == 1) {
        saveNewStyle(kind, cells[0]);
      }

      mxEvent.consume(evt);
    });

    button.className = 'geFullWidthElement';
    button.style.marginTop = '4px';
    button.setAttribute('title', (cells.length == 1) ?
      'Saves the style of the selected ' + kindNouns[kind] + ' under a new name.' :
      'Select one ' + kindNouns[kind] + ' to save its style.');

    if (cells.length != 1) {
      button.setAttribute('disabled', 'disabled');
    }

    return button;
  }

  function kindList(kind, withSelection) {
    var cells = withSelection ? selectedCellsOf(kind) : [];
    var linked = cells.map(function (cell) {
      return rules.linkOf(graph.getModel().getStyle(cell));
    });
    var list = document.createElement('div');
    list.setAttribute('data-deck-style-kind', kind);
    list.style.padding = '2px 0 6px 0';
    var title = document.createElement('div');
    title.style.fontWeight = 'bold';
    title.style.padding = '2px 0';
    mxUtils.write(title, kindTitles[kind]);
    list.appendChild(title);

    var grid = document.createElement('div');
    grid.style.display = 'flex';
    grid.style.flexWrap = 'wrap';
    grid.style.gap = '2px';
    stylesOf(kind).forEach(function (style) {
      grid.appendChild(tile(kind, style, cells, linked.indexOf(style.name) >= 0));
    });
    list.appendChild(grid);

    if (stylesOf(kind).length == 0) {
      var hint = document.createElement('div');
      hint.style.whiteSpace = 'normal';
      hint.style.opacity = '0.7';
      mxUtils.write(hint, 'The deck has no style of ' + kindTitles[kind].toLowerCase() +
        ' yet. A style saved from a ' + kindNouns[kind] + ' is given with a click, and an ' +
        'update of it reaches every ' + kindNouns[kind] + ' that uses it.');
      list.appendChild(hint);
    }

    if (withSelection) {
      var line = changedLine(kind, cells);

      if (line != null) {
        list.appendChild(line);
      }

      list.appendChild(newStyleButton(kind, cells));
    }

    return list;
  }

  // Puts the section after the section Deck colors, or else before the first section of the panel
  // that folds, which is Fill or Line in the Style tab.
  function addSection(panel, withSelection) {
    var kinds = withSelection ? rules.kinds.filter(function (kind) {
      return selectedCellsOf(kind).length > 0;
    }) : rules.kinds;

    if (kinds.length == 0) {
      return;
    }

    var section = panel.createCollapsibleSection(sectionTitle, false);
    var content = panel.createPanel();
    kinds.forEach(function (kind) {
      content.appendChild(kindList(kind, withSelection));
    });
    section.contentDiv.appendChild(content);
    var titles = Array.prototype.slice.call(
      panel.container.querySelectorAll(':scope > .geFormatSection > .geCollapsibleTitle'));
    var colors = titles.filter(function (title) {
      return mxUtils.getTextContent(title).indexOf('Deck colors') >= 0;
    })[0];
    var next = (colors != null) ? colors.parentNode.nextSibling :
      ((titles[0] != null) ? titles[0].parentNode : null);
    panel.container.insertBefore(section.wrapper, next);
  }

  var styleFormatPanelInit = StyleFormatPanel.prototype.init;

  StyleFormatPanel.prototype.init = function () {
    styleFormatPanelInit.apply(this, arguments);
    addSection(this, true);
  };

  var diagramStylePanelInit = DiagramStylePanel.prototype.init;

  DiagramStylePanel.prototype.init = function () {
    diagramStylePanelInit.apply(this, arguments);
    addSection(this, false);
  };

  var names = allNames();

  onSlideSettingsChange(function () {
    var current = allNames();
    var lost = names.some(function (name) {
      return current.indexOf(name) < 0;
    });

    names = current;

    if (lost) {
      ui.editor.undoManager.clear();
    }

    if (ui.format != null) {
      ui.format.refresh();
    }
  });
});
