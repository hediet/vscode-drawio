// Leaves the position of the view out of every page that the draw.io editor saves.
//
// The editor writes the scroll offset of the view into the attributes dx and dy of the
// <mxGraphModel> of the current page, so a scroll alone changes a section file, and git shows the
// file as modified.  The editor reads the two attributes only to scroll back to the same place
// when the file opens again, and without them it opens the page at its default view.  The build
// reads neither.  This plugin removes both attributes from the XML that getGraphXml of the editor
// returns, which is the one place that writes them.  A page that the session never shows keeps
// the XML of its file, so a file is cleaned of the two attributes once, by hand.
//
// The VS Code extension yujunhuang.drawslidescode loads the plugin from its own folder
// drawio-custom-plugins/slides/ for every drawing whose setting "drawSlidesCode.slides" is true,
// without asking.
Draw.loadPlugin(function (ui) {
  var editor = ui.editor;
  var getGraphXml = editor.getGraphXml;

  editor.getGraphXml = function () {
    var node = getGraphXml.apply(this, arguments);
    node.removeAttribute('dx');
    node.removeAttribute('dy');

    return node;
  };
});
