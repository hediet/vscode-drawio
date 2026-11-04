// Keeps the view where it was when a double-click starts editing a label, and puts the caret at
// the point of the double-click instead of selecting the whole label, in the draw.io editor.
//
// While a label is edited, the editor shows the source of its formulas, such as
// `\(\textcolor{dpgreen}{F}\)`, which is far longer than the formula drawn.  draw.io scrolls the
// view to show the whole box of that source, and selects the whole label, which leaves the caret
// at its end.  This plugin runs after draw.io has opened the box: it scrolls the view back and
// puts the caret at the character of the source under the point of the double-click, or at the
// nearest point of the box when the box does not reach the point.  An edit started from the
// keys, such as F2 or Enter or a typed letter, keeps the behaviour of draw.io.
//
// The VS Code extension yujunhuang.drawio-slides loads the plugin from its own folder
// drawio-custom-plugins/slides/ for every drawing whose setting "drawioSlides.slides" is true,
// without asking.
Draw.loadPlugin(function (ui) {
  var graph = ui.editor.graph;
  var cellEditor = graph.cellEditor;
  var startEditing = cellEditor.startEditing;

  // The caret at the point, kept inside the box of the editor.
  function caretAt(box, x, y) {
    var rect = box.getBoundingClientRect();
    var insideX = Math.min(Math.max(x, rect.left + 1), rect.right - 1);
    var insideY = Math.min(Math.max(y, rect.top + 1), rect.bottom - 1);
    var range = document.caretRangeFromPoint ? document.caretRangeFromPoint(insideX, insideY)
      : null;

    if (range == null && document.caretPositionFromPoint) {
      var position = document.caretPositionFromPoint(insideX, insideY);

      if (position != null) {
        range = document.createRange();
        range.setStart(position.offsetNode, position.offset);
      }
    }

    if (range == null || !box.contains(range.startContainer)) {
      range = document.createRange();
      range.selectNodeContents(box);
      range.collapse(true);
    }

    range.collapse(true);
    return range;
  }

  cellEditor.startEditing = function (cell, trigger) {
    var container = graph.container;
    var left = container.scrollLeft;
    var top = container.scrollTop;
    var point = (trigger instanceof MouseEvent) ? { x: trigger.clientX, y: trigger.clientY } : null;
    var result = startEditing.apply(this, arguments);

    if (point != null) {
      // draw.io opens the box in a task of its own, which this task follows.
      window.setTimeout(function () {
        var box = cellEditor.textarea;

        if (cellEditor.editingCell == null || box == null || box.parentNode == null) {
          return;
        }

        container.scrollLeft = left;
        container.scrollTop = top;
        var selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(caretAt(box, point.x, point.y));
      }, 0);
    }

    return result;
  };
});
