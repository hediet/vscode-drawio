// Defines the colours and the commands of a deck for every page of every drawing the draw.io
// editor opens, and starts every new page with mathematical typesetting on.
//
// The VS Code extension yujunhuang.drawio-slides gives the definitions in
// window.drawioSlidesSettings.mathDefinitions: every \definecolor of the files of the setting
// "drawioSlides.colorDefinitions", then the commands of mathjax-commands.tex beside this plugin,
// which MathJax lacks.  The MathJax of draw.io reads the colour models rgb, RGB, gray and HTML,
// and the extension warns of a definition in another model and leaves it out.
//
// The VS Code extension yujunhuang.drawio-slides loads the plugin from its own folder
// drawio-custom-plugins/slides/ for every drawing whose setting "drawioSlides.slides" is true,
// without asking.
Draw.loadPlugin(function (ui) {
  var DEFINITIONS = (window.drawioSlidesSettings || {}).mathDefinitions || '';
  var graph = ui.editor.graph;

  // A page the editor creates takes this value, and a page read from a file keeps its own.
  // Switching mathematics on a page copies the switch into the default, so the default is put
  // back, and an empty file is read as a model whose page carries no switch, so it is given one.
  graph.defaultMathEnabled = true;
  var setMathEnabled = ui.setMathEnabled;
  ui.setMathEnabled = function (value) {
    setMathEnabled.apply(this, arguments);
    this.editor.graph.defaultMathEnabled = true;
  };
  if (typeof ui.emptyDiagramXml === 'string') {
    ui.emptyDiagramXml = ui.emptyDiagramXml.replace('<mxGraphModel>', '<mxGraphModel math="1">');
  }

  // The definitions go through draw.io's own queue of typesetting, in a hidden element, the way
  // draw.io typesets a label.  The queue runs one typesetting at a time, and MathJax loads parts
  // of TeX input on demand, so a typesetting of its own beside draw.io's would race it and leave
  // a command half loaded.  Once the element is typeset, the definitions are in the TeX input
  // that every label is typeset with, and the page is drawn again, so that a label typeset
  // before them shows its colours.
  var tries = 0;
  function define() {
    if (typeof Editor === 'undefined' || typeof Editor.MathJaxRender !== 'function') {
      if (tries++ < 600) window.setTimeout(define, 100);
      return;
    }
    var holder = document.createElement('div');
    holder.style.cssText = 'position:absolute;left:-10000px;top:0;visibility:hidden';
    holder.textContent = '\\(' + DEFINITIONS + '\\)';
    document.body.appendChild(holder);
    var previous = Editor.onMathJaxDone;
    var hook = function () {
      previous.apply(this, arguments);
      finish();
    };
    var finish = function () {
      if (holder.parentNode == null || holder.querySelector('mjx-container') == null) return;
      // A listener that hooked in after this one calls this one, so this one leaves only when
      // it is the last.
      if (Editor.onMathJaxDone === hook) Editor.onMathJaxDone = previous;
      holder.parentNode.removeChild(holder);
      // No file of the editor reads this flag.  A headless check of the definitions reads it to
      // know that they are loaded.
      window.__deckDefinitionsLoaded = true;
      graph.refresh();
    };
    Editor.onMathJaxDone = hook;
    Editor.MathJaxRender(holder);
    finish();
  }
  define();
});
