// Gives the lists of a label the style of the slide template, and adds a menu List style to the
// Text tab of the Format panel, in the draw.io editor.
//
// The setting "drawioSlides.listStyles" of the VS Code extension gives the style of each level of
// a bulleted and of a numbered list, its indent, its marker and the color and the size of the
// marker, and the gap above each item apart from the first item of a first level.  Its default is
// the style of the lists of the slide template deck-templates/slide-format.drawio.xml of the
// extension.  draw.io's buttons Bulleted List, Numbered List,
// Increase Indent and Decrease Indent, and the key Tab in a list, make lists in the style of the
// browser instead.  After each of them this plugin gives every list of the label that has no
// marker of its own the template's style of its level, so a new list matches the template, and
// gives every item of every list the gap of the template, so an item moved into another list sits
// as the items around it.  A level deeper than the setting gives takes the style of
// the last level of the setting.
//
// The menu List style shows while a label is edited, beside the list buttons, and says the marker
// of the list at the caret, from the markers of the setting "drawioSlides.listMarkers".  Choosing a
// marker sets it on that list, and Template gives the list the style of its level again.  Both
// write inline HTML into the label, so the editor, the HTML deck and the PDF show the same marker.
// A choice in the menu is not in the history of the browser, so Undo inside the label does not take
// it back and takes back the change before it instead.  Undo of the drawing after the edit takes
// back the whole edit, the choice included.
//
// The markers take the color and the size of their level by the rules of listMarkerCss in
// list-marker-rules.js, which this plugin gives the page of the editor and export-pages.mjs copies
// into the SVG of each page.  The color of a level may name a color of the setting
// "drawioSlides.colors", which the extension replaces by its value.  After a change of the list
// styles, of the markers or of the colors, the extension sends them again through
// slide-settings.js, and the plugin takes them for the next list and the next menu and gives the
// markers on the page their new colors and sizes.  A list that has its style already keeps its
// indent and its marker.  In the default, the triangle is #004D80 at 0.7 of the size of the
// text, which covers about the area of the narrower triangle of the Keynote deck of the template,
// and sits on the baseline, and the dash is #004D80.
//
// The VS Code extension yujunhuang.drawio-slides loads the plugin from its own folder
// drawio-custom-plugins/slides/ for every drawing whose setting "drawioSlides.slides" is true,
// without asking.
//
// Yujun Huang grants an additional permission for this file under section 7 of the GNU General
// Public License, version 3, in LICENSE-EXCEPTION.md of Draw.io Slides.
Draw.loadPlugin(function (ui) {
  var graph = ui.editor.graph;
  var cellEditor = graph.cellEditor;
  var settings = window.drawioSlidesSettings || {};
  var listStyles = settings.listStyles;
  // The markers of the menu, as written into list-style-type, with their names.
  var markers = settings.listMarkers || [];

  if (listStyles == null || typeof listMarkerCss != 'function') {
    console.warn('list-styles.plugin.js: the extension gave no list styles, so lists keep the ' +
      'style of the browser');
    return;
  }

  var LIST_INPUTS = { insertOrderedList: true, insertUnorderedList: true, formatIndent: true,
    formatOutdent: true };

  function isList(node) {
    return node != null && node.nodeType == 1 && (node.nodeName == 'UL' || node.nodeName == 'OL');
  }

  // The level of a list inside the box of the editor, 1 for a list in no other list.
  function levelOf(list, box) {
    var level = 1;

    for (var node = list.parentNode; node != null && node != box; node = node.parentNode) {
      if (isList(node)) {
        level++;
      }
    }

    return level;
  }

  function templateLevel(list, level) {
    var levels = (list.nodeName == 'OL') ? listStyles.numbered : listStyles.bulleted;
    return levels[Math.min(level, levels.length) - 1];
  }

  // The gap of the template above each item of a list that has none, apart from the first item
  // of a first level.
  function applyGaps(list, level) {
    for (var i = 0; i < list.children.length; i++) {
      var item = list.children[i];

      if (item.nodeName == 'LI' && !(level == 1 && i == 0) && item.style.marginTop == '') {
        item.style.marginTop = listStyles.itemGap;
      }
    }
  }

  // The template's style of its level for a list and its items.
  function applyTemplate(list, box) {
    var level = levelOf(list, box);
    var style = templateLevel(list, level);
    list.style.margin = '0';
    list.style.paddingLeft = style.indent;
    list.style.listStyleType = style.marker;
    applyGaps(list, level);
  }

  // Every list of the box without a marker of its own takes the template's style of its level,
  // and the items of every other list take the gap of the template.
  function styleNewLists(box) {
    var lists = box.querySelectorAll('ul, ol');

    for (var i = 0; i < lists.length; i++) {
      if (lists[i].style.listStyleType == '') {
        applyTemplate(lists[i], box);
      } else {
        applyGaps(lists[i], levelOf(lists[i], box));
      }
    }
  }

  // The list at the caret of the editor, or null.
  function listAtCaret() {
    var box = cellEditor.textarea;
    var selection = window.getSelection();

    if (box == null || selection.rangeCount == 0 || !box.contains(selection.anchorNode)) {
      return null;
    }

    for (var node = selection.anchorNode; node != null && node != box; node = node.parentNode) {
      if (isList(node)) {
        return node;
      }
    }

    return null;
  }

  function changed() {
    var box = cellEditor.textarea;

    if (box != null) {
      box.dispatchEvent(new Event('input', { bubbles: true }));
    }

    if (cellEditor.editingCell != null) {
      cellEditor.resize();
    }
  }

  var markerStyle = document.createElement('style');
  markerStyle.id = 'list-styles-markers';
  markerStyle.textContent = listMarkerCss(listStyles);
  document.head.appendChild(markerStyle);

  if (typeof onSlideSettingsChange == 'function') {
    onSlideSettingsChange(function (changed) {
      if (changed.listStyles == null) {
        return;
      }

      listStyles = changed.listStyles;
      markers = changed.listMarkers || [];
      markerStyle.textContent = listMarkerCss(listStyles);

      if (ui.format != null) {
        ui.format.refresh();
      }
    });
  }

  var watched = null;

  function watch(box) {
    if (box == null || box == watched) {
      return;
    }

    watched = box;
    box.addEventListener('input', function (evt) {
      if (LIST_INPUTS[evt.inputType]) {
        styleNewLists(box);
      }
    });
  }

  var startEditing = cellEditor.startEditing;

  cellEditor.startEditing = function () {
    var result = startEditing.apply(this, arguments);
    watch(cellEditor.textarea);
    return result;
  };

  // The menus that show, which follow the caret.
  var menus = [];

  function showMarker(select) {
    var list = listAtCaret();
    select.disabled = list == null;

    if (list == null) {
      select.value = 'template';
      return;
    }

    // The browser reads a marker of text back with double quotes, and the markers of the menu
    // hold single ones.
    var marker = list.style.listStyleType.replace(/^"(.*)"$/, "'$1'");
    var style = templateLevel(list, levelOf(list, cellEditor.textarea));
    var known = markers.some(function (entry) {
      return entry[0] == marker;
    });
    select.value = (marker == '' || marker == style.marker || !known) ? 'template' : marker;
  }

  document.addEventListener('selectionchange', function () {
    menus = menus.filter(function (select) {
      return select.isConnected;
    });
    menus.forEach(showMarker);
  });

  function makeMenu() {
    var row = document.createElement('div');
    row.className = 'geFormatEntry';
    row.style.fontWeight = 'bold';
    row.style.marginTop = '6px';
    row.setAttribute('title', 'The marker of the list at the caret');
    mxUtils.write(row, 'List style');
    var select = document.createElement('select');
    select.setAttribute('title', 'The marker of the list at the caret');
    select.style.position = 'absolute';
    select.style.left = '114px';
    select.style.width = '98px';
    select.style.fontWeight = 'normal';

    markers.forEach(function (entry) {
      var option = document.createElement('option');
      option.value = entry[0];
      mxUtils.write(option, entry[1]);
      select.appendChild(option);
    });

    // A press on the menu keeps the caret and the selection of the label.
    select.addEventListener('mousedown', function (evt) {
      evt.stopPropagation();
    });
    select.addEventListener('change', function () {
      var list = listAtCaret();

      if (list != null) {
        if (select.value == 'template') {
          applyTemplate(list, cellEditor.textarea);
        } else {
          list.style.listStyleType = select.value;
        }

        changed();
      }

      cellEditor.textarea.focus();
    });

    row.appendChild(select);
    menus.push(select);
    showMarker(select);
    return row;
  }

  // The menu goes after the row of the list buttons, which the Text tab shows while a label is
  // edited.
  var addFont = TextFormatPanel.prototype.addFont;

  TextFormatPanel.prototype.addFont = function (container) {
    var result = addFont.apply(this, arguments);

    if (graph.cellEditor.isContentEditing()) {
      var button = container.querySelector('[title="' + mxResources.get('bulletedList') + '"]');

      if (button != null && button.parentNode != null) {
        button.parentNode.parentNode.insertBefore(makeMenu(), button.parentNode.nextSibling);
      }
    }

    return result;
  };
});
