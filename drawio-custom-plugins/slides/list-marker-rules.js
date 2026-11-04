// The CSS rules that give the markers of a list the colour and the size of its level, from the
// setting "drawioSlides.listStyles" of the VS Code extension yujunhuang.drawio-slides.
//
// list-styles.plugin.js gives the rules to the page of the editor, and export-pages.mjs of the
// draw.io presentation framework runs the same function on the settings of the deck and copies
// the rules into the SVG of each page with a list, so the editor, the HTML deck and the PDF show
// the markers alike.  A rule of a marker reaches no inline style, so a rule finds a list by the
// marker in its style attribute.  The browser writes a marker of text, such as '-  ', back with
// double quotes, so a marker of text gets a selector for each kind of quote.
//
// The extension loads this file before list-styles.plugin.js, and the script defines the one
// global function listMarkerCss.
function listMarkerCss(listStyles) {
  var rules = [];

  function attribute(value) {
    return '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  }

  function addRules(tag, levels) {
    (levels || []).forEach(function (level) {
      var declarations = [];

      if (level.color) {
        declarations.push('color: ' + level.color + ';');
      }

      if (level.size) {
        declarations.push('font-size: ' + level.size + ';');
      }

      if (declarations.length == 0) {
        return;
      }

      var markers = [level.marker];

      if (level.marker.charAt(0) == "'") {
        markers.push('"' + level.marker.slice(1, -1) + '"');
      }

      var selectors = markers.map(function (marker) {
        return tag + '[style*=' + attribute(marker) + '] > li::marker';
      });
      rules.push(selectors.join(', ') + ' { ' + declarations.join(' ') + ' }');
    });
  }

  addRules('ul', listStyles.bulleted);
  addRules('ol', listStyles.numbered);

  return rules.join('\n');
}
