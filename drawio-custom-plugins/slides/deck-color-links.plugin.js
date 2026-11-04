// Draws each use of a color that links to a color of the setting "drawioSlides.colors" of the deck
// in the current value of that color, in the draw.io editor of VS Code, and takes the link out of
// a use whose color another option of draw.io sets.
//
// A key of a style that holds a color links to a color of the deck through a key beside it, as
// fillColor=#B20000;deckFillColor=red links the fill to red.  An element of the HTML of a label
// links the color of its text through the attribute data-deck-color, as
// <span data-deck-color="red" style="color: #B20000;">, while the element has a color of its own.
// The section Deck colors of deck-colors-section.plugin.js sets the links, and the hex value beside
// a link is the color that a draw.io without the extension draws.
//
// The plugin wraps postProcessCellStyle of the graph, which draw.io calls on the style of a cell
// before it draws the cell, as deck-pictures.plugin.js does, and gives the drawn style the value
// of each linked color.  It wraps getLabel of the graph in the same way for the linked texts of a
// label.  The model keeps the hex values, so a change of a color reaches every open drawing
// without an edit of the drawing, and the editor draws again after each change of the colors.
// The extension writes the new values, names and removals into the files of the deck itself.
//
// A change of a style through the model takes the link out when the change gives the linked key
// another value and leaves the link as it was, as the color options and the swatches of draw.io,
// the dialog Edit Style and a change of the fill to none do.  Every merge of the file is exempt,
// because the extension sends a merge for each change of the text document, and the merge of a
// new value may arrive before the new colors.  A change that sets a link to a known color gives
// the linked key the value of the color.  A cell added to the drawing, as by a paste or an import
// from another deck, gives each linked key and each linked text of a known color the value of the
// color, in the same undo step as the addition.  The setting of the color of selected text,
// Graph.setTextColor, takes the link out of each element whose color it changes, and the removal
// of the colors of a label, Graph.removeTextColors, out of each element that it leaves without a
// color.  draw.io keeps the attribute data-deck-color in a label because the plugin adds it to the
// attributes that Graph.sanitizeHtml keeps.
//
// draw.io keeps a merge of the file out of its undo history.  An undo of an edit made before a new
// name or a removal of a color would give the cells of that edit the old name back, so the plugin
// clears the undo history of the editor when the colors lose a name.
//
// The VS Code extension yujunhuang.drawio-slides gives the plugin the colors in
// window.drawioSlidesSettings.colors, a list of names and values #RRGGBB, and the keys of the
// links in window.drawioSlidesSettings.colorLinks, keys of the color keys of a style to their
// link keys, and textAttribute, the attribute of a linked text.  It sends the colors again after
// a change through slide-settings.js.  It loads the plugin from its own folder
// drawio-custom-plugins/slides/ after slide-settings.js, for every drawing whose setting
// "drawioSlides.slides" is true, without asking.
Draw.loadPlugin(function (ui) {
  var graph = ui.editor.graph;
  var settings = window.drawioSlidesSettings;

  if (typeof onSlideSettingsChange != 'function' || settings == null || settings.colorLinks == null) {
    return;
  }

  var linkKeys = settings.colorLinks.keys;
  var textAttribute = settings.colorLinks.textAttribute;
  var colorKeys = Object.keys(linkKeys);
  var isMergingFile = false;

  if (window.DOM_PURIFY_CONFIG != null) {
    window.DOM_PURIFY_CONFIG.ADD_ATTR = (window.DOM_PURIFY_CONFIG.ADD_ATTR || []).concat([textAttribute]);
  }

  // The value #RRGGBB of a color of the deck, or null for a name that the colors do not define.
  function colorValue(name) {
    var colors = window.drawioSlidesSettings.colors || [];

    for (var index = 0; index < colors.length; index++) {
      if (colors[index].name == name) {
        return colors[index].value;
      }
    }

    return null;
  }

  // The value of a key of a style of draw.io, or null.
  function styleValue(style, key) {
    var entries = (style || '').split(';');

    for (var index = 0; index < entries.length; index++) {
      if (entries[index].substring(0, key.length + 1) == key + '=') {
        return entries[index].substring(key.length + 1);
      }
    }

    return null;
  }

  // The color that an element of the HTML of a label gives its text itself, or null.
  function ownColor(element) {
    var given = null;

    try {
      given = JSON.parse(element.getAttribute(Graph.backupStyleAttribute) || '{}').color;
    } catch (error) {
      given = null;
    }

    return element.getAttribute('color') || (element.style != null && element.style.color) ||
      given || null;
  }

  // Takes the link out of each linked element of the node without a color of its own, and
  // unwraps such an element when it is left without attributes.
  function removeLinksWithoutColor(node) {
    Array.prototype.slice.call(node.querySelectorAll('[' + textAttribute + ']'))
      .forEach(function (element) {
        if (ownColor(element) == null) {
          element.removeAttribute(textAttribute);

          if ((element.nodeName == 'SPAN' || element.nodeName == 'FONT') &&
            element.attributes.length == 0 && element.parentNode != null) {
            while (element.firstChild != null) {
              element.parentNode.insertBefore(element.firstChild, element);
            }

            element.parentNode.removeChild(element);
          }
        }
      });
  }

  graph.postProcessCellStyle = (function (postProcessCellStyle) {
    return function (cell, style) {
      var drawnStyle = postProcessCellStyle.apply(this, arguments);

      if (drawnStyle != null) {
        colorKeys.forEach(function (key) {
          var value = colorValue(drawnStyle[linkKeys[key]]);

          if (value != null) {
            drawnStyle[key] = value;
          }
        });
      }

      return drawnStyle;
    };
  })(graph.postProcessCellStyle);

  // The HTML of a label with each linked element of a known color given the value of the color,
  // and whether a color changed.  A document of its own loads no picture and runs no script of the
  // label.
  function labelWithLinkedColors(label) {
    var body = new DOMParser().parseFromString(label, 'text/html').body;
    var isChanged = false;

    body.querySelectorAll('[' + textAttribute + ']').forEach(function (element) {
      var value = colorValue(element.getAttribute(textAttribute));

      if (value != null) {
        var before = element.getAttribute('color') + ' ' + element.style.color;

        if (element.getAttribute('color') != null) {
          element.setAttribute('color', value);
        }

        if (element.style.color != '') {
          element.style.color = value;
        }

        isChanged = isChanged || before != element.getAttribute('color') + ' ' + element.style.color;
      }
    });

    return {html: body.innerHTML, isChanged: isChanged};
  }

  graph.getLabel = (function (getLabel) {
    return function (cell) {
      var label = getLabel.apply(this, arguments);

      if (typeof label != 'string' || label.indexOf(textAttribute) < 0 || !this.isHtmlLabel(cell)) {
        return label;
      }

      return labelWithLinkedColors(label).html;
    };
  })(graph.getLabel);

  var model = graph.getModel();

  // The style that a change through the model sets: a linked key whose value the change replaces
  // loses its link, and a new link to a known color gives its key the value of the color.
  function styleWithLinksKept(style, previous) {
    return colorKeys.reduce(function (current, key) {
      var link = linkKeys[key];
      var name = styleValue(current, link);

      if (name != null && name == styleValue(previous, link)) {
        return styleValue(current, key) != styleValue(previous, key) ?
          mxUtils.setStyle(current, link, null) : current;
      }

      return name != null && colorValue(name) != null ?
        mxUtils.setStyle(current, key, colorValue(name)) : current;
    }, style);
  }

  // The style with each linked key of a known color given the value of the color.
  function styleWithLinkedValues(style) {
    return colorKeys.reduce(function (current, key) {
      var value = colorValue(styleValue(current, linkKeys[key]));
      var written = styleValue(current, key);

      return value != null && (written == null || written.toUpperCase() != value.toUpperCase()) ?
        mxUtils.setStyle(current, key, value) : current;
    }, style);
  }

  var setStyleOfModel = model.setStyle;

  model.setStyle = function (cell, style) {
    return setStyleOfModel.call(this, cell, !isMergingFile && typeof style == 'string' ?
      styleWithLinksKept(style, this.getStyle(cell)) : style);
  };

  // Gives a cell added to the drawing, and each cell inside it, the values of the known colors that
  // its links name, inside the model update of the addition.
  function giveLinkedValues(cell) {
    model.getDescendants(cell).forEach(function (added) {
      var style = model.getStyle(added);
      var linkedStyle = styleWithLinkedValues(style);

      if (typeof style == 'string' && linkedStyle != style) {
        setStyleOfModel.call(model, added, linkedStyle);
      }

      var value = model.getValue(added);
      var label = mxUtils.isNode(value) ? value.getAttribute('label') : value;

      if (typeof label == 'string' && label.indexOf(textAttribute) >= 0 && graph.isHtmlLabel(added)) {
        var linkedLabel = labelWithLinkedColors(label);

        if (linkedLabel.isChanged) {
          if (mxUtils.isNode(value)) {
            var linkedValue = value.cloneNode(true);

            linkedValue.setAttribute('label', linkedLabel.html);
            model.setValue(added, linkedValue);
          } else {
            model.setValue(added, linkedLabel.html);
          }
        }
      }
    });
  }

  graph.addListener(mxEvent.CELLS_ADDED, function (sender, evt) {
    if (!isMergingFile) {
      (evt.getProperty('cells') || []).forEach(giveLinkedValues);
    }
  });

  DrawioFile.prototype.mergeFile = (function (mergeFile) {
    return function () {
      isMergingFile = true;

      try {
        return mergeFile.apply(this, arguments);
      } finally {
        isMergingFile = false;
      }
    };
  })(DrawioFile.prototype.mergeFile);

  Graph.setTextColor = (function (setTextColor) {
    return function (node, color, isForeground) {
      if (!isForeground) {
        return setTextColor.apply(this, arguments);
      }

      var linked = Array.prototype.slice.call(node.querySelectorAll('[' + textAttribute + ']'))
        .map(function (element) {
          return {element: element, color: ownColor(element)};
        });
      var result = setTextColor.apply(this, arguments);

      linked.forEach(function (entry) {
        if (ownColor(entry.element) != entry.color) {
          entry.element.removeAttribute(textAttribute);
        }
      });
      removeLinksWithoutColor(node);

      return result;
    };
  })(Graph.setTextColor);

  Graph.removeTextColors = (function (removeTextColors) {
    return function (node, isForeground) {
      var result = removeTextColors.apply(this, arguments);

      if (isForeground) {
        removeLinksWithoutColor(node);
      }

      return result;
    };
  })(Graph.removeTextColors);

  // The colors drawn last, so that a change of the list styles alone draws nothing again.
  var drawnColors = settings.colors || [];

  onSlideSettingsChange(function (changed) {
    var colors = changed.colors || [];

    if (JSON.stringify(colors) != JSON.stringify(drawnColors)) {
      var names = colors.map(function (color) {
        return color.name;
      });
      var isNameGone = drawnColors.some(function (color) {
        return names.indexOf(color.name) < 0;
      });

      drawnColors = colors;

      if (isNameGone) {
        ui.editor.undoManager.clear();
      }

      graph.refresh();
    }
  });

  graph.refresh();
});
