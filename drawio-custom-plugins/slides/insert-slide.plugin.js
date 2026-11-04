// Adds the submenu Insert slide to the menus Insert and Pages of the draw.io editor, with one entry
// per page of each template of the deck, which inserts a copy of that page after the current one.
//
// A template is an ordinary multi-page draw.io file, such as templates/slides.drawio.xml of a deck,
// whose pages are the layouts of the slides, each named by its layout, such as title-and-body-1.
// The setting "drawioSlides.templates" of the VS Code extension yujunhuang.drawio-slides lists the
// files.  The extension reads them and gives this plugin their pages in
// window.drawioSlidesSettings.templates, as a list of files, each with its name and its pages, and
// each page with its name and the XML of its <diagram>.  The extension watches the files and sends
// the pages again in the action drawioSlidesTemplates after a template changes, so the submenu
// shows the template as it was last saved, without a reload of the editor.
//
// The copy takes the name of its layout without the number of the step and a new number after the
// word new, such as title-and-body-new-1, which no other page of the drawing has, so the build of
// the framework counts it as a slide of its own until the page is renamed.
//
// The VS Code extension yujunhuang.drawio-slides loads the plugin from its own folder
// drawio-custom-plugins/slides/ for every drawing whose setting "drawioSlides.slides" is true,
// without asking.
Draw.loadPlugin(function (ui) {
  var templates = (window.drawioSlidesSettings || {}).templates || [];

  window.addEventListener('message', function (evt) {
    if (evt.source !== window.opener || typeof evt.data != 'string') {
      return;
    }

    var data;

    try {
      data = JSON.parse(evt.data);
    } catch (error) {
      return;
    }

    if (data != null && data.action == 'drawioSlidesTemplates') {
      templates = data.templates || [];
    }
  });

  function pageNames() {
    return (ui.pages || []).map(function (page) {
      return page.getName();
    });
  }

  // The name of a copy of a layout: its name without the step, then new and a free number.
  function copyName(layout) {
    var base = layout.replace(/-\d+$/, '');
    var names = pageNames();

    for (var count = 1; ; count++) {
      var name = base + '-new' + (count == 1 ? '' : count) + '-1';

      if (names.indexOf(name) < 0) {
        return name;
      }
    }
  }

  // Inserts a copy of a layout after the current page, as draw.io inserts the pages of an
  // imported file: a page made from the <diagram> without its id, whose root and view state
  // updatePageRoot reads from the model, so the page keeps the size, the grid, the mathematics
  // and the background of the layout.
  function insertLayout(layout) {
    var diagram = mxUtils.parseXml(layout.xml).documentElement;
    diagram.removeAttribute('id');
    var page = ui.updatePageRoot(new DiagramPage(diagram));
    page.setName(copyName(layout.name));
    ui.selectPage(ui.insertPage(page, ui.getSelectedPageIndex() + 1));
  }

  function addSlideMenu(menu, parent) {
    var submenu = menu.addItem('Insert slide', null, null, parent, null,
      templates.length > 0);

    templates.forEach(function (template, index) {
      if (index > 0) {
        menu.addSeparator(submenu);
      }

      template.pages.forEach(function (layout) {
        var label = (templates.length > 1) ? template.name + ' › ' + layout.name : layout.name;
        menu.addItem(label, null, function () {
          insertLayout(layout);
        }, submenu);
      });
    });
  }

  ['insert', 'pages'].forEach(function (name) {
    var menu = ui.menus.get(name);

    if (menu == null) {
      return;
    }

    var funct = menu.funct;
    menu.funct = function (popup, parent) {
      funct.apply(this, arguments);

      if (ui.editor.graph.isEnabled()) {
        popup.addSeparator(parent);
        addSlideMenu(popup, parent);
      }
    };
  });
});
