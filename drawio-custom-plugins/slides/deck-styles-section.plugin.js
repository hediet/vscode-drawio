// Adds the section Deck styles to the Format panel of the draw.io editor, which lists the styles
// of the setting "drawSlidesCode.deckStyles" of the deck, gives the selection a style of the list,
// saves a style from a selected cell, updates a style from a changed cell, and renames and removes
// a style.
//
// A style belongs to a kind of geometry, such as wire, rectangle or ellipse, as deck-style-rules.js
// decides it from the style of a cell, and the section shows one list per kind, as the Format
// panel of Keynote shows the styles of the kind of object selected.  The section sits in the Style
// tab after the section Deck colors and before the sections Fill and Line.  With a selection it
// shows the lists of the kinds of the selected cells, and with nothing selected it shows the list
// of every kind that has a style in the Style tab of the diagram, where it renames and removes
// alone.
//
// Each list is a grid of tiles.  A tile holds a preview of the style, which draw.io draws as it
// draws a shape of the sidebar, the name of the style under the preview, and under the name the
// buttons ✎, which renames the style in the rename dialog of draw.io, and ×, which removes it.  A
// click on the preview gives the style to each selected cell of its kind, a group giving it to the
// cells in it, in one edit, which one Undo takes back.  The tile of the style that the selected
// cells link to has a frame.  When one selected cell links to a style and differs from it, a line
// under the grid names the keys that differ, with the button Update, which redefines the style from
// the cell and updates every cell of the deck linked to it, as Redefine Style from Selection of
// Keynote does, and the button Revert, which gives the cell the style again.  The button New style
// from selection at the end of a list saves the style of the one selected cell of its kind under the
// first free name of the kind and a number, such as ellipse1, and links the cell to it.
//
// deck-style-rules.js, loaded before this plugin, holds the rules: the kind of a cell, which keys a
// style holds, what a give and an update write, and which keys of a cell differ from its style.  An
// update writes the change into the linked cells of the current page in one edit of the model, and
// the extension writes it into the drawing files of the deck.  A cell keeps a key in which it
// differed from the style before the update.
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
// window.drawSlidesCodeSettings.styles, a list of kinds, names and style strings in the order of the
// setting, and the keys of the links to the colors of the deck in
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

  // slide-settings.js gives window.drawSlidesCodeSettings a new object at each change.
  function styles() {
    return window.drawSlidesCodeSettings.styles || [];
  }

  function stylesOf(kind) {
    return styles().filter(function (style) {
      return style.kind == kind;
    });
  }

  function styleNamed(name) {
    return styles().filter(function (style) {
      return style.name == name;
    })[0] || null;
  }

  function unique(list) {
    return list.filter(function (item, index) {
      return item != null && list.indexOf(item) == index;
    });
  }

  // The word for a kind, the last part of a name such as mxgraph.flowchart.decision.
  function kindWord(kind) {
    return kind.substring(kind.lastIndexOf('.') + 1);
  }

  function kindTitle(kind) {
    var word = kindWord(kind);

    return word.charAt(0).toUpperCase() + word.substring(1);
  }

  // The first free name of the letters and digits of the kind and a number, such as ellipse1.
  function freeName(kind) {
    var stem = kindWord(kind).replace(/[^A-Za-z0-9]/g, '').replace(/^[0-9]+/, '') || 'style';
    var names = styles().map(function (style) {
      return style.name;
    });

    for (var count = 1; ; count++) {
      if (names.indexOf(stem + count) < 0) {
        return stem + count;
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

  function saveNewStyle(kind, cell) {
    var style = {kind: kind, name: freeName(kind),
      style: rules.appearanceOf(graph.getModel().getStyle(cell))};

    give(style, [cell]);
    sendEdit({operation: 'set', kind: kind, name: style.name, style: style.style});
  }

  // Applies the edit of the linked cells that the extension sends to every page of the drawing: to
  // the current page in one edit of the model, and to the cells that draw.io keeps for each other
  // page.
  function applyUseEdit(edit) {
    var restyle = function (style) {
      return rules.afterUseEdit(style, edit);
    };

    setStyles(linkedCells(edit.name), restyle);

    (ui.pages || []).forEach(function (page) {
      var visit = function (cell) {
        if (typeof cell.style == 'string') {
          cell.style = restyle(cell.style);
        }

        (cell.children || []).forEach(visit);
      };

      if (page != ui.currentPage && page.root != null) {
        visit(page.root);
      }
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

  // A preview of the style on a cell of its kind, with the label Aa on a vertex, drawn as the sidebar
  // of draw.io draws a shape, or the word of the kind when the editor has no sidebar.  A style holds no key of its kind, so the
  // cell of the preview names the kind first: as a name of the stylesheet, such as ellipse, or else
  // as its shape, such as shape=mxgraph.flowchart.decision.
  function preview(style, parent) {
    if (ui.sidebar == null) {
      mxUtils.write(parent, kindWord(style.kind));
      return;
    }

    var cell = null;

    if (style.kind == rules.kindOf('', true)) {
      cell = new mxCell('', new mxGeometry(0, 0, 0, 0), style.style);
      cell.geometry.relative = true;
      cell.geometry.setTerminalPoint(new mxPoint(0, 20), true);
      cell.geometry.setTerminalPoint(new mxPoint(120, 20), false);
      cell.edge = true;
    } else {
      var kindStyle = (rules.kindOf('', false) == style.kind) ? '' :
        ((graph.getStylesheet().styles[style.kind] != null) ? style.kind + ';' :
          'shape=' + style.kind + ';');
      // A label shows the font of the style, also for a text, which draws no fill and no line.
      cell = new mxCell('Aa', new mxGeometry(0, 0, 120, 70), kindStyle + style.style);
      cell.vertex = true;
    }

    ui.sidebar.createThumb([cell], 56, 30, parent, null, true, false);
  }

  function rename(style) {
    var dlg = new FilenameDialog(ui, style.name, mxResources.get('rename'), function (name) {
      name = (name != null) ? mxUtils.trim(name) : '';

      if (name.length > 0 && name != style.name) {
        sendEdit({operation: 'rename', name: style.name, newName: name});
      }
    }, mxResources.get('rename'));

    ui.showDialog(dlg.container, 300, 80, true, true);
    dlg.init();
  }

  function smallButton(label, tooltip, onClick) {
    var button = mxUtils.button(label, function (evt) {
      onClick();
      mxEvent.consume(evt);
    });

    button.setAttribute('title', tooltip);
    button.style.padding = '0 4px';
    button.style.margin = '0';
    button.style.height = '18px';
    button.style.lineHeight = '16px';
    button.style.flex = '0 0 auto';

    return button;
  }

  // The tile of a style: its preview, which gives the style to the selected cells of its kind, its
  // name under the preview, and the buttons that rename and remove it under the name.
  function tile(style, cells, isLinked) {
    var word = kindWord(style.kind);
    var element = document.createElement('div');
    element.setAttribute('data-deck-style', style.name);
    element.style.display = 'flex';
    element.style.flexDirection = 'column';
    element.style.alignItems = 'stretch';
    element.style.gap = '2px';
    element.style.width = '68px';
    element.style.padding = '2px';
    element.style.boxSizing = 'border-box';
    element.style.border = isLinked ? '2px solid #29b6f2' : '2px solid transparent';
    element.style.borderRadius = '4px';

    var thumb = mxUtils.button('', function (evt) {
      if (cells.length > 0) {
        give(style, cells);
      }

      mxEvent.consume(evt);
    });
    thumb.className = 'geColorBtn';
    thumb.style.width = '100%';
    thumb.style.height = '36px';
    thumb.style.margin = '0';
    thumb.style.padding = '0';
    thumb.style.overflow = 'hidden';
    thumb.setAttribute('title', style.name + '. ' + ((cells.length > 0) ?
      'A click gives the style to each selected ' + word + '.' :
      'Select a ' + word + ' to give it the style.'));
    preview(style, thumb);
    element.appendChild(thumb);

    var name = document.createElement('div');
    name.className = 'deckStyleName';
    name.setAttribute('title', style.name);
    name.style.fontSize = '11px';
    name.style.textAlign = 'center';
    name.style.whiteSpace = 'nowrap';
    name.style.overflow = 'hidden';
    name.style.textOverflow = 'ellipsis';
    mxUtils.write(name, style.name);
    element.appendChild(name);

    var buttons = document.createElement('div');
    buttons.style.display = 'flex';
    buttons.style.justifyContent = 'center';
    buttons.style.gap = '2px';
    buttons.appendChild(smallButton('✎', mxResources.get('rename') + ': ' + style.name,
      function () {
        rename(style);
      }));
    buttons.appendChild(smallButton('×', mxResources.get('remove') + ': ' + style.name,
      function () {
        sendEdit({operation: 'remove', name: style.name});
      }));
    element.appendChild(buttons);

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

    var word = kindWord(kind);
    var line = document.createElement('div');
    line.style.padding = '4px 0 0 0';
    line.style.whiteSpace = 'normal';
    var text = document.createElement('div');
    text.style.opacity = '0.7';
    mxUtils.write(text, 'The ' + word + ' differs from ' + style.name + ' in ' +
      keys.join(', ') + '.');
    line.appendChild(text);
    var buttons = document.createElement('div');
    buttons.style.display = 'flex';
    buttons.style.gap = '2px';
    buttons.style.marginTop = '2px';
    buttons.appendChild(smallButton('Update', 'Redefine ' + style.name + ' from the ' + word +
      ', and update every ' + word + ' of the deck that uses it', function () {
      update(style, cell);
    }));
    buttons.appendChild(smallButton('Revert', 'Give the ' + word + ' the style ' + style.name +
      ' again', function () {
      give(style, [cell]);
    }));
    line.appendChild(buttons);

    return line;
  }

  function newStyleButton(kind, cells) {
    var word = kindWord(kind);
    var button = mxUtils.button('New style from selection', function (evt) {
      if (cells.length == 1) {
        saveNewStyle(kind, cells[0]);
      }

      mxEvent.consume(evt);
    });

    button.className = 'geFullWidthElement';
    button.style.marginTop = '4px';
    button.setAttribute('title', (cells.length == 1) ?
      'Saves the style of the selected ' + word + ' under a new name.' :
      'Select one ' + word + ' to save its style.');

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
    mxUtils.write(title, kindTitle(kind));
    list.appendChild(title);

    var grid = document.createElement('div');
    grid.style.display = 'flex';
    grid.style.flexWrap = 'wrap';
    grid.style.gap = '4px';
    stylesOf(kind).forEach(function (style) {
      grid.appendChild(tile(style, cells, linked.indexOf(style.name) >= 0));
    });
    list.appendChild(grid);

    if (stylesOf(kind).length == 0) {
      var word = kindWord(kind);
      var hint = document.createElement('div');
      hint.style.whiteSpace = 'normal';
      hint.style.opacity = '0.7';
      mxUtils.write(hint, 'The deck has no style of the kind ' + word + ' yet. A style saved ' +
        'from a ' + word + ' is given with a click, and an update of it reaches every ' + word +
        ' that uses it.');
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
    var kinds = withSelection ? unique(selectedCells().map(kindOfCell)) :
      unique(styles().map(function (style) {
        return style.kind;
      }));

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

  function allNames() {
    return styles().map(function (style) {
      return style.name;
    });
  }

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
