// The rules of the styles of a deck, the setting "drawSlidesCode.deckStyles" of the VS Code
// extension yujunhuang.drawslidescode, on the style strings of draw.io.
//
// A style of the deck is a style string of a kind of geometry, rectangles or wires, under a name.
// A cell that takes a style holds every key of the style and, beside them, the link
// deckStyle=<name>, so that a draw.io without the extension draws the cell the same, as a hex value
// stays beside the link of a color of the deck.  A style holds the keys of appearance alone: never
// the link itself, nor a key of geometry, which places the ends of a wire or turns a shape.  The
// points, the source, the target and the place of a label sit in the geometry of a cell, outside
// its style, so a style never reaches them either.
//
// A cell keeps the keys in which it differs from its style, its overrides.  A give of a style
// replaces every key of appearance of the cell, so it takes the overrides out.  An update of a
// style writes each key that the update changes into each linked cell that holds the key as the
// style held it before, and leaves a cell that differs from the style in that key as it is.  A key
// beside a link to a color of the deck counts as the same when both link to the same color, whatever
// hex value stands beside the link.
//
// deck-styles-section.plugin.js applies the rules to the cells of the editor, and the extension,
// src/deck/deckStyles.ts, runs the same rules on the text of the drawing files of the deck, so an
// update reaches the open drawing and the files alike.  The extension loads this file before
// deck-styles-section.plugin.js, and the script defines the one global function deckStyleRules,
// which returns the rules given the keys of the links to the colors of the deck, an object of the
// color keys of a style to their link keys.
//
// Yujun Huang grants an additional permission for this file under section 7 of the GNU General
// Public License, version 3, in LICENSE-EXCEPTION.md of DrawSlidesCode.
function deckStyleRules(colorLinkKeys) {
  var LINK = 'deckStyle';
  // The keys of geometry: where the ends of a wire leave and enter their terminals, and the turn of
  // a shape.
  var GEOMETRY_KEYS = ['exitX', 'exitY', 'exitDx', 'exitDy', 'exitPerimeter',
    'entryX', 'entryY', 'entryDx', 'entryDy', 'entryPerimeter',
    'sourcePort', 'targetPort', 'rotation'];
  // The shapes that a style of the kind rectangles covers: a vertex without a shape draws a
  // rectangle, rounded or not.
  var RECTANGLE_SHAPES = ['rect', 'rectangle'];
  var KINDS = ['rectangles', 'wires'];
  var NAME = /^[A-Za-z][A-Za-z0-9]*$/;
  var links = colorLinkKeys || {};

  // The entries of a style string in their order: {key, value} for key=value, and {name} for a
  // name of the stylesheet, such as text or ellipse.
  function entries(style) {
    return (style || '').split(';').filter(function (part) {
      return part.length > 0;
    }).map(function (part) {
      var equals = part.indexOf('=');

      return (equals < 0) ? {name: part} :
        {key: part.substring(0, equals), value: part.substring(equals + 1)};
    });
  }

  function joined(list) {
    return list.map(function (entry) {
      return (entry.key == null) ? entry.name : entry.key + '=' + entry.value;
    }).join(';') + ((list.length > 0) ? ';' : '');
  }

  function valuesOf(list) {
    var values = {};

    list.forEach(function (entry) {
      if (entry.key != null) {
        values[entry.key] = entry.value;
      }
    });

    return values;
  }

  function isAppearanceKey(key) {
    return key != LINK && GEOMETRY_KEYS.indexOf(key) < 0;
  }

  // The kind of geometry of a cell, given its style and whether it is an edge: wires for an edge,
  // rectangles for a vertex that draws a rectangle, and null for any other cell.
  function kindOf(style, isEdge) {
    if (isEdge) {
      return 'wires';
    }

    var list = entries(style);
    var shape = valuesOf(list).shape;
    var named = list.some(function (entry) {
      return entry.key == null;
    });

    return (!named && (shape == null || RECTANGLE_SHAPES.indexOf(shape) >= 0)) ?
      'rectangles' : null;
  }

  // The name of the style that the cell links to, or null.
  function linkOf(style) {
    var name = valuesOf(entries(style))[LINK];

    return (name != null && name.length > 0) ? name : null;
  }

  // The keys of appearance of a style string, as a style of the deck holds them.
  function appearanceOf(style) {
    return joined(entries(style).filter(function (entry) {
      return entry.key != null && isAppearanceKey(entry.key);
    }));
  }

  // Whether two values of a key count as the same in the two sets of values, where a key beside a
  // link to a color of the deck counts as the same when both link to the same color.
  function isSame(key, first, second) {
    var link = links[key];

    if (link != null && first[link] != null && first[link] == second[link]) {
      return true;
    }

    return first[key] == second[key];
  }

  // The keys of appearance in which the cell differs from the style, in the order of the style and
  // then of the cell.
  function differingKeys(cellStyle, style) {
    var cell = valuesOf(entries(appearanceOf(cellStyle)));
    var saved = valuesOf(entries(style));
    var keys = Object.keys(saved).concat(Object.keys(cell).filter(function (key) {
      return !Object.prototype.hasOwnProperty.call(saved, key);
    }));

    return keys.filter(function (key) {
      return !isSame(key, cell, saved);
    });
  }

  // The style of a cell that takes the style of the deck under the name: the names of the
  // stylesheet of the cell, the keys of the style, the keys of geometry of the cell, and the link.
  function given(cellStyle, name, style) {
    var list = entries(cellStyle);
    var names = list.filter(function (entry) {
      return entry.key == null;
    });
    var geometry = list.filter(function (entry) {
      return entry.key != null && entry.key != LINK && !isAppearanceKey(entry.key);
    });

    return joined(names.concat(entries(appearanceOf(style)), geometry,
      [{key: LINK, value: name}]));
  }

  // The style of a linked cell after an update of its style from the style string before to the
  // style string after.  Each key that the update changes takes its new value, or goes, in a cell
  // whose value of the key is the value before, and a cell that differs in the key keeps its own.
  function updated(cellStyle, before, after) {
    var list = entries(cellStyle);
    var cell = valuesOf(list);
    var old = valuesOf(entries(before));
    var next = valuesOf(entries(after));
    var changed = Object.keys(old).concat(Object.keys(next).filter(function (key) {
      return !Object.prototype.hasOwnProperty.call(old, key);
    })).filter(function (key) {
      return isAppearanceKey(key) && !(old[key] == next[key] &&
        (links[key] == null || old[links[key]] == next[links[key]]));
    });
    var written = changed.filter(function (key) {
      return isSame(key, cell, old);
    });

    if (written.length == 0) {
      return cellStyle;
    }

    var result = list.filter(function (entry) {
      return entry.key == null || written.indexOf(entry.key) < 0 || next[entry.key] != null;
    }).map(function (entry) {
      return (entry.key != null && written.indexOf(entry.key) >= 0) ?
        {key: entry.key, value: next[entry.key]} : entry;
    });
    var added = written.filter(function (key) {
      return cell[key] == null && next[key] != null;
    }).map(function (key) {
      return {key: key, value: next[key]};
    });
    var linkAt = result.findIndex(function (entry) {
      return entry.key == LINK;
    });
    var at = (linkAt < 0) ? result.length : linkAt;

    return joined(result.slice(0, at).concat(added, result.slice(at)));
  }

  // The style of a cell with its link renamed, or taken out when newName is null.
  function relinked(cellStyle, newName) {
    return joined(entries(cellStyle).filter(function (entry) {
      return entry.key != LINK || newName != null;
    }).map(function (entry) {
      return (entry.key == LINK) ? {key: LINK, value: newName} : entry;
    }));
  }

  return {
    link: LINK,
    kinds: KINDS,
    geometryKeys: GEOMETRY_KEYS,
    isName: function (name) {
      return typeof name == 'string' && NAME.test(name);
    },
    kindOf: kindOf,
    linkOf: linkOf,
    appearanceOf: appearanceOf,
    differingKeys: differingKeys,
    given: given,
    updated: updated,
    relinked: relinked
  };
}
