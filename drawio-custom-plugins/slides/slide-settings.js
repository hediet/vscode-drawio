// The settings of a deck that the slide plugins follow without a reload of the draw.io editor, for
// the slide plugins of the VS Code extension yujunhuang.drawio-slides.
//
// The extension gives the plugins the settings in window.drawioSlidesSettings when the editor
// loads.  After a change of the settings "drawioSlides.colors", "drawioSlides.listStyles",
// "drawioSlides.listMarkers", "drawioSlides.customColorSchemes", "drawioSlides.presetColors" or
// "drawioSlides.colorNames" of the drawing, the extension sends the action drawioSlidesSettings,
// whose settings are colors, listStyles, listMarkers, mathDefinitions, presetColors, colorNames and
// colorSchemes, with each name of a color in listStyles and colorSchemes replaced by its value.
// The script copies them into window.drawioSlidesSettings and calls every listener with them, in
// the order of registration.
//
// The extension loads this file before math-definitions.plugin.js, deck-colors.plugin.js,
// deck-colors-section.plugin.js and list-styles.plugin.js, and the script defines the one global
// function onSlideSettingsChange.
var onSlideSettingsChange = (function () {
  var listeners = [];

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

    if (data == null || data.action != 'drawioSlidesSettings' || data.settings == null) {
      return;
    }

    window.drawioSlidesSettings = Object.assign({}, window.drawioSlidesSettings, data.settings);
    listeners.forEach(function (listener) {
      try {
        listener(data.settings);
      } catch (error) {
        console.error('slide-settings.js: a listener failed on the new settings', error);
      }
    });
  });

  return function (listener) {
    listeners.push(listener);
  };
})();
