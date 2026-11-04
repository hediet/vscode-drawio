// Keeps the page view of the draw.io editor at one page for a slide, whatever the content
// reaches past the page.
//
// The editor draws as many copies of the page as cover the content, so a label or a shape that
// reaches past the edge of a slide adds a page beside it.  The build cuts every slide at the edge
// of its page, so content past the edge is hidden from the slide, and the extra page only gets
// in the way.  This plugin gives the graph a page layout of the one page at the origin when the
// page view is on and the page has the size of a slide of slide-format.drawio.xml, 1920 by 1080.
// Content past the edge stays on the grey canvas, where it can still be selected and edited.
// Every other page keeps the layout of the editor.
//
// The VS Code extension yujunhuang.drawio-slides loads the plugin from its own folder
// drawio-custom-plugins/slides/ for every drawing whose setting "drawioSlides.slides" is true,
// without asking.
Draw.loadPlugin(function (ui) {
  var graph = ui.editor.graph;
  var getPageLayout = graph.getPageLayout;

  graph.getPageLayout = function () {
    var format = this.pageFormat;

    if (this.pageVisible && format != null && format.width == 1920 && format.height == 1080) {
      return new mxRectangle(0, 0, 1, 1);
    }

    return getPageLayout.apply(this, arguments);
  };

  // Draws the background page again, for a page that the editor showed before the plugin ran.
  graph.refresh();
});
