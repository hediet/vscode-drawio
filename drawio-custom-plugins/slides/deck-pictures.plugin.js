// Draws a picture whose style names a file of the deck, such as `image=assets/plot.png`, in the
// draw.io editor of VS Code.
//
// draw.io resolves such a name against the folder of its own web application, where the file is
// not.  The extension yujunhuang.drawio-slides sets window.mediaPluginDeckFolders to the folder of
// the deck before it loads this plugin, and serves every file of an open folder at its absolute
// path under the origin of the page.  The plugin wraps postProcessCellStyle of the graph, which
// draw.io calls on the style of a cell before it draws the cell, and gives the drawn style the
// address of the file in the first folder of the list, from deckFileAddress of deck-files.js.  The
// model keeps the name, so the saved file and the build see `assets/plot.png` as before.
//
// The VS Code extension yujunhuang.drawio-slides loads the plugin from its own folder
// drawio-custom-plugins/slides/ for every drawing whose setting "drawioSlides.slides" is true,
// without asking.
Draw.loadPlugin(function (ui) {
  var graph = ui.editor.graph;
  var postProcessCellStyle = graph.postProcessCellStyle;

  function isDeckPath(name) {
    return typeof name == 'string' && name.length > 0 && name.charAt(0) != '/' &&
      !/^[a-z][a-z0-9+.-]*:/i.test(name);
  }

  function deckAddress(name) {
    var folders = window.mediaPluginDeckFolders || [];

    if (folders.length == 0) {
      return null;
    }

    return deckFileAddress(folders[0], name.replace(/^\.\//, ''));
  }

  graph.postProcessCellStyle = function (cell, style) {
    var drawnStyle = postProcessCellStyle.apply(this, arguments);
    var name = (drawnStyle != null) ? drawnStyle[mxConstants.STYLE_IMAGE] : null;

    if (isDeckPath(name)) {
      var address = deckAddress(name);

      if (address != null) {
        drawnStyle[mxConstants.STYLE_IMAGE] = address;
      }
    }

    return drawnStyle;
  };

  graph.refresh();
});
