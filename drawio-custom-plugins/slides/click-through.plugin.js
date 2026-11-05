// Lets a click on the empty inside of a shape or a text box without fill reach the cell behind it,
// in the draw.io editor.
//
// draw.io selects a vertex on a click anywhere inside its bounds, also where it has no fill, so
// a text box larger than its text hides the shape behind it from the mouse.  The style key
// pointerEvents=0 turns that off for a shape whose fill is none: its border, and the text of its
// label, still select it.  This plugin gives every vertex whose fill is none that value, unless
// its own style sets pointerEvents, so the files stay as they are and every page behaves alike.
// The build reads no pointer events, so the slides do not change.
//
// The VS Code extension yujunhuang.drawslidescode loads the plugin from its own folder
// drawio-custom-plugins/slides/ for every drawing whose setting "drawSlidesCode.slides" is true,
// without asking.
Draw.loadPlugin(function (ui) {
  var graph = ui.editor.graph;
  var getCellStyle = graph.getCellStyle;

  graph.getCellStyle = function (cell) {
    var style = getCellStyle.apply(this, arguments);

    // The style that the editor computes leaves out a fill of none, so a missing fill is no fill.
    if (style != null && cell != null && this.model.isVertex(cell) &&
        style[mxConstants.STYLE_POINTER_EVENTS] == null &&
        (style[mxConstants.STYLE_FILLCOLOR] == null ||
         style[mxConstants.STYLE_FILLCOLOR] == mxConstants.NONE)) {
      style[mxConstants.STYLE_POINTER_EVENTS] = '0';
    }

    return style;
  };

  graph.refresh();
});
