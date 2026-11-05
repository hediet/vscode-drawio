// Gives the color picker and the swatches of the Style tab of the Format panel of the draw.io
// editor the colors of a deck again after a change of the settings, without a reload.
//
// When the editor loads, the VS Code extension yujunhuang.drawslidescode gives draw.io the presets
// and the names of the color picker and the swatches in its configuration: the settings
// "drawSlidesCode.presetColors" and "drawSlidesCode.colorNames" with every color of the setting
// "drawSlidesCode.colors" added, and the swatches of the setting "drawSlidesCode.customColorSchemes"
// with each name of a color replaced by its value.  draw.io puts the swatches of the
// configuration before its own.  The extension gives the same values in
// window.drawSlidesCodeSettings as presetColors, colorNames and colorSchemes, and sends them again
// through slide-settings.js after a change.  The plugin then sets the presets, the names and the
// swatches of draw.io, keeps the swatches of draw.io after those of the settings, and draws the
// Format panel again.  A color dialog that is open keeps the presets it opened with.
//
// The VS Code extension yujunhuang.drawslidescode loads the plugin from its own folder
// drawio-custom-plugins/slides/ for every drawing whose setting "drawSlidesCode.slides" is true,
// without asking.
Draw.loadPlugin(function (ui) {
  var settings = window.drawSlidesCodeSettings || {};

  if (typeof onSlideSettingsChange != 'function' || settings.colorSchemes == null) {
    return;
  }

  // The swatches of draw.io itself, which follow those of the configuration.
  var drawioSchemes = StyleFormatPanel.prototype.defaultColorSchemes
    .slice(settings.colorSchemes.length);

  onSlideSettingsChange(function (changed) {
    ColorDialog.prototype.presetColors = changed.presetColors;
    ColorDialog.prototype.colorNames = changed.colorNames;
    StyleFormatPanel.prototype.defaultColorSchemes = changed.colorSchemes.concat(drawioSchemes);

    if (ui.format != null) {
      var count = StyleFormatPanel.prototype.defaultColorSchemes.length;

      if (ui.format.currentScheme != null && ui.format.currentScheme >= count) {
        ui.format.currentScheme = 0;
      }

      ui.format.refresh();
    }
  });
});
