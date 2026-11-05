// The address of a file of a deck in the page of the draw.io editor, for the slide plugins of the
// VS Code extension yujunhuang.drawslidescode.
//
// The extension serves every file of an open folder at its absolute path under the origin of the
// page's own files, and a page opened from the disk reads the file at its file: address.  The
// folder is given apart from the path below it, or as null for an absolute path, and is encoded
// name by name, so a # or a ? in the name of a folder stays part of the path, and the path below
// it keeps a query or a hash that the source writes.
//
// The extension loads this file before deck-pictures.plugin.js, language-check.plugin.js and
// media.plugin.js, and the script defines the one global function deckFileAddress.
function deckFileAddress(folder, path) {
  var encoded = (folder == null) ? encodeURI(path)
    : folder.split('/').map(encodeURIComponent).join('/') + '/' + encodeURI(path);

  if (location.protocol == 'file:') {
    return 'file://' + encoded;
  }

  return new URL(document.baseURI).origin + encoded;
}
