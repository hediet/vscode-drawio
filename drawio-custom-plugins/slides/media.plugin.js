// Plays the video of every cell with the property `video`, and shows the HTML page of every cell
// with the property `html`, inside its shape, in the draw.io editor, and gives the one selected
// shape of a video or a page a bar of controls.
//
// The page of the editor does not know the folder of the drawing, so the VS Code extension
// yujunhuang.drawio-slides sets window.mediaPluginDeckFolders to the folder of the deck before it
// loads this plugin, and this plugin reads the folders when a video or a page loads.  The path of a
// file, relative to its deck, is tried in each folder of the list in turn, and the first file that
// loads plays.  deckFileAddress of deck-files.js gives the address of the file in a folder.
//
// A video or a page goes into the group that draws the shape of its cell, cut to the outline of
// the shape and drawn in the place of the cell among the cells, so a cell in front of it covers
// it.  draw.io empties the group when it redraws the shape and moves the group when it orders the
// cells again, so the frame waits in a hidden group meanwhile, and every move of a frame uses
// Element.moveBefore, which keeps a page loaded and a video playing.
//
// A video plays muted and in a loop, fills the shape as the property `fit` says, `contain`,
// `stretch` or `crop`, and lets every click through to the cell, so the slide is edited as
// before.  An MP4 file plays from its address.  A WebM file is fetched whole and appended to a
// MediaSource, because VS Code opens no WebM file from its address, so a WebM file larger than a
// MediaSource holds plays the part that fits.  A WebM file from another server plays only when
// that server allows the page to read it.
//
// A page of the deck is fetched and given to an <iframe> as srcdoc, with a <base> at the folder of
// its file, because only the page of the editor reaches the files of the open folder in VS Code,
// through its service worker.  A page of another server goes to the <iframe> as its address.  A
// page takes no pointer events until the user switches Interact on in its bar, or double-clicks its
// shape, so the shape is selected and moved as before.  The image of the shape of a page, such as a
// still for the PDF, is not drawn, and Reload swaps in the new page once it has drawn, so the
// editor shows only what the page draws, and Interact changes nothing on screen.  A page of another
// server whose address cannot be reached is reported, and one that answers with an error or refuses
// to be framed shows the page of the browser.  A page runs with the rights of the editor, so embed
// only pages you trust.
//
// While the shape of a video or a page is the one selected cell, a bar past the arrows of draw.io
// controls it.  The bars come from media-bar.js, whose header says what they offer and where they
// sit, and the bar of a page here also offers Interact.  After a click on the bar, or in the page
// with Interact on, the bar or the page keeps the focus and takes every key, the arrows, Delete and
// the shortcuts of draw.io among them, until a press of the pointer outside the shape and the bar
// gives the focus back to the drawing.  draw.io takes the focus on each press in the drawing and
// after each change of the selection, and the plugin then gives it back to the bar or the page.  A
// double-click that edits the label of the cell gives the focus to the label.  A key that a page
// does not use, such as an arrow in a page that does not scroll, may still scroll the view of the
// drawing, because the browser passes the scroll on to the page around the frame.
//
// A video keeps its time, pause, speed and sound, and a page its state, through zooms, edits,
// refreshes of the page, and the undo of a move, a resize or a change of style.  When the drawing
// shows another of its pages, a cell of the new page with the id and the file of a cell of the
// page before takes over that video or page as it was, wherever the cell sits.  Every other video
// starts again from the beginning, muted, and every other page loads again, as after the undo of
// the deletion of a cell.  A bar whose video or page did not load says so, and the console names
// the cause.
Draw.loadPlugin(function (ui) {
  var SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
  var MediaKind = Object.freeze({ VIDEO: 'video', PAGE: 'page' });
  var OBJECT_FIT = { contain: 'contain', stretch: 'fill', crop: 'cover' };
  var OUTLINE_TAGS = { path: true, rect: true, ellipse: true, circle: true, polygon: true,
    polyline: true };
  // The codec ids of a WebM header, and the names that a MediaSource type gives them.
  var WEBM_CODECS = [['V_VP9', 'vp9'], ['V_VP8', 'vp8'], ['V_AV1', 'av01.0.08M.08'],
    ['A_OPUS', 'opus'], ['A_VORBIS', 'vorbis']];
  var WEBM_HEADER_BYTES = 262144;
  var APPEND_BYTES = 4194304;
  // The room that draw.io keeps under and over a selected shape for its arrows of cloning.
  var BAR_GAP = 44;
  var graph = ui.editor.graph;
  var renderer = graph.cellRenderer;
  var redraw = renderer.redraw;
  var destroy = renderer.destroy;
  var insertStateAfter = renderer.insertStateAfter;
  var clipCount = 0;
  // The address that loaded for each path, so the next video of the same path tries no other deck.
  var loadedAddress = {};
  var videoBar = null;
  var pageBar = null;
  var parking = null;

  function candidateAddresses(source) {
    if (isRemote(source)) {
      return [source];
    }

    if (source.charAt(0) == '/') {
      return [deckFileAddress(null, source)];
    }

    if (loadedAddress[source] != null) {
      return [loadedAddress[source]];
    }

    var folders = window.mediaPluginDeckFolders || [];

    if (folders.length == 0) {
      console.warn('media.plugin.js: no deck folder is known for ' + source + '.  Load the ' +
        'plugin through the setting drawioSlides.slides of the extension, which gives the deck ' +
        'folder.');
    }

    return folders.map(function (folder) {
      return deckFileAddress(folder, source.replace(/^\.\//, ''));
    });
  }

  // A problem of a video or a page: warned once, kept on the element for its bar, and announced.
  function reportProblem(element, problem) {
    console.warn('media.plugin.js: ' + problem);
    element.loadProblem = problem;
    element.dispatchEvent(new Event('mediapluginproblem', { bubbles: true }));
  }

  function isRemote(source) {
    return /^(https?:)?\/\//i.test(source);
  }

  function isWebm(source) {
    return /\.webm([?#].*)?$/i.test(source);
  }

  function playFromAddress(video, source, addresses) {
    var next = 0;

    function tryNext() {
      if (next >= addresses.length) {
        video.removeEventListener('error', tryNext);
        reportProblem(video, isRemote(source) ? source + ' did not load'
          : 'no deck folder holds ' + source);
        return;
      }

      video.src = addresses[next++];
    }

    video.addEventListener('error', tryNext);
    video.addEventListener('loadeddata', function () {
      loadedAddress[source] = video.currentSrc;
      video.removeEventListener('error', tryNext);
    }, { once: true });
    tryNext();
  }

  function headerText(bytes) {
    var view = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, WEBM_HEADER_BYTES));
    var text = '';

    for (var i = 0; i < view.length; i += 8192) {
      text += String.fromCharCode.apply(null, view.subarray(i, i + 8192));
    }

    return text;
  }

  function webmType(bytes) {
    var header = headerText(bytes);
    var codecs = WEBM_CODECS.filter(function (codec) {
      return header.indexOf(codec[0]) >= 0;
    }).map(function (codec) {
      return codec[1];
    });
    var type = 'video/webm; codecs="' + codecs.join(',') + '"';
    return (codecs.length > 0 && MediaSource.isTypeSupported(type)) ? type : null;
  }

  // The bytes are appended in chunks, each after the one before has been parsed.  A file larger
  // than the buffer of the page stops at the part that fits, and the stream ends there, so that
  // part plays, loops and seeks.  The bytes are let go once the stream has ended.
  function appendToMediaSource(video, source, bytes) {
    var type = (window.MediaSource != null) ? webmType(bytes) : null;

    if (type == null) {
      reportProblem(video, 'this editor plays no codec of ' + source +
        '; encode it as WebM with VP9 or as MP4 with H.264');
      return;
    }

    var mediaSource = new MediaSource();
    mediaSource.addEventListener('sourceopen', function () {
      var buffer = mediaSource.addSourceBuffer(type);
      var offset = 0;

      function finish() {
        buffer.removeEventListener('updateend', appendNext);
        bytes = null;

        if (mediaSource.readyState == 'open' && !buffer.updating) {
          mediaSource.endOfStream();
        }
      }

      function appendNext() {
        if (video.removed || mediaSource.readyState != 'open') {
          buffer.removeEventListener('updateend', appendNext);
          bytes = null;
          return;
        }

        if (offset >= bytes.byteLength) {
          finish();
          return;
        }

        var end = Math.min(offset + APPEND_BYTES, bytes.byteLength);

        try {
          buffer.appendBuffer(bytes.slice(offset, end));
          offset = end;
        } catch (error) {
          if (error.name == 'QuotaExceededError') {
            var held = buffer.buffered.length > 0 ? buffer.buffered.end(0) : 0;
            reportProblem(video, source + ' is larger than the editor holds, so its first ' +
              Math.floor(held) + ' s play; encode it as MP4 with H.264 to play it whole');
          } else {
            reportProblem(video, source + ' stopped loading (' + error.name + ')');
          }

          finish();
        }
      }

      buffer.addEventListener('updateend', appendNext);
      appendNext();
    }, { once: true });
    video.addEventListener('error', function () {
      if (!video.removed && video.error != null) {
        reportProblem(video, source + ' could not be read (' + (video.error.message ||
          'error ' + video.error.code) + ')');
      }
    });
    video.mediaSourceAddress = URL.createObjectURL(mediaSource);
    video.src = video.mediaSourceAddress;
  }

  function streamFromAddress(video, source, addresses, index) {
    if (index >= addresses.length) {
      reportProblem(video, isRemote(source) ? source + ' did not load; a WebM file from another ' +
        'server needs that server to allow the editor to read it, so give it as MP4'
        : 'no deck folder holds ' + source);
      return;
    }

    fetch(addresses[index]).then(function (response) {
      if (!response.ok) {
        throw new Error(response.status + ' ' + addresses[index]);
      }

      return response.arrayBuffer();
    }).then(function (bytes) {
      loadedAddress[source] = addresses[index];

      if (!video.removed) {
        appendToMediaSource(video, source, bytes);
      }
    }, function () {
      streamFromAddress(video, source, addresses, index + 1);
    });
  }

  function loadVideo(video, source) {
    var addresses = candidateAddresses(source);

    if (isWebm(source)) {
      streamFromAddress(video, source, addresses, 0);
    } else {
      playFromAddress(video, source, addresses);
    }
  }

  // The base of a page given as srcdoc, so that its relative files load from the folder of its
  // file.
  function withBase(text, address) {
    var tag = '<base href="' + address.slice(0, address.lastIndexOf('/') + 1).replace(/"/g, '&quot;') +
      '">';

    if (/<head(\s[^>]*)?>/i.test(text)) {
      return text.replace(/<head(\s[^>]*)?>/i, function (head) {
        return head + tag;
      });
    }

    if (/<html[^>]*>/i.test(text)) {
      return text.replace(/<html[^>]*>/i, function (html) {
        return html + '<head>' + tag + '</head>';
      });
    }

    return tag + text;
  }

  // A page is loading from the start of loadPage until its frame fires load for the document
  // that loadPage gave it, and the bar of the page says so.
  function setLoading(iframe, loading) {
    iframe.pageLoading = loading;
    iframe.awaitingLoad = false;
    iframe.dispatchEvent(new Event('mediapluginload', { bubbles: true }));
  }

  function loadPage(iframe, source) {
    iframe.loadProblem = null;
    setLoading(iframe, true);

    // A page of another server loads from its address.  The editor learns that the address could
    // not be reached, and not that the server answered with an error or refused to be framed,
    // which the frame then shows as the page of the browser.
    if (isRemote(source)) {
      iframe.removeAttribute('srcdoc');
      iframe.awaitingLoad = true;
      iframe.src = source;
      fetch(source, { mode: 'no-cors' }).catch(function () {
        if (!iframe.removed) {
          setLoading(iframe, false);
          reportProblem(iframe, source + ' could not be reached');
        }
      });
      return;
    }

    var addresses = candidateAddresses(source);

    function tryAddress(index) {
      if (index >= addresses.length) {
        setLoading(iframe, false);
        reportProblem(iframe, 'no deck folder holds ' + source);
        return;
      }

      fetch(addresses[index]).then(function (response) {
        if (!response.ok) {
          throw new Error(response.status + ' ' + addresses[index]);
        }

        return response.text();
      }).then(function (text) {
        loadedAddress[source] = addresses[index];

        if (!iframe.removed) {
          iframe.awaitingLoad = true;
          iframe.srcdoc = withBase(text, addresses[index]);
        }
      }, function () {
        tryAddress(index + 1);
      });
    }

    tryAddress(0);
  }

  function cellMedia(cell) {
    var value = cell.value;

    if (!mxUtils.isNode(value) || !graph.model.isVertex(cell)) {
      return null;
    }

    var video = (value.getAttribute('video') || '').trim();
    var page = (value.getAttribute('html') || '').trim();

    if (video != '') {
      return { kind: MediaKind.VIDEO, source: video };
    }

    return (page != '') ? { kind: MediaKind.PAGE, source: page } : null;
  }

  function makeVideo(source) {
    var video = document.createElement('video');
    video.muted = true;
    video.loop = true;
    video.autoplay = true;
    video.playsInline = true;
    video.style.display = 'block';
    video.style.width = '100%';
    video.style.height = '100%';
    video.style.pointerEvents = 'none';
    loadVideo(video, source);
    return video;
  }

  function makePage(source) {
    var iframe = document.createElement('iframe');
    iframe.setAttribute('allow', 'fullscreen; autoplay');
    iframe.style.cssText = 'display: block; width: 100%; height: 100%; border: 0; ' +
      'pointer-events: none; background: transparent;';
    // An inserted frame fires load for its empty document too, before loadPage gives it the page.
    iframe.addEventListener('load', function () {
      if (iframe.awaitingLoad) {
        setLoading(iframe, false);
      }
    });
    loadPage(iframe, source);
    return iframe;
  }

  // A frame is a group that carries the clip, around a <foreignObject> that holds the video or the
  // page.  Chromium finds the pointer over the whole of a <foreignObject> inside a clipped group,
  // and over only a part of one that carries the clip itself.
  function makeFrame(media) {
    var frame = document.createElementNS(SVG_NAMESPACE, 'g');
    frame.setAttribute('class', 'media-plugin-frame');
    frame.kind = media.kind;
    frame.mediaSource = media.source;
    frame.box = document.createElementNS(SVG_NAMESPACE, 'foreignObject');
    frame.box.setAttribute('pointer-events', 'none');
    frame.box.style.pointerEvents = 'none';
    frame.content = (media.kind == MediaKind.VIDEO) ? makeVideo(media.source)
      : makePage(media.source);
    frame.box.appendChild(frame.content);
    frame.appendChild(frame.box);
    frame.clip = document.createElementNS(SVG_NAMESPACE, 'clipPath');
    frame.clip.id = 'media-plugin-clip-' + (++clipCount);
    frame.setAttribute('clip-path', 'url(#' + frame.clip.id + ')');
    return frame;
  }

  // Moves a node without reloading the page of an <iframe> inside it, where the browser offers
  // Element.moveBefore and both places are in the document.
  function moveNode(parent, node) {
    if (typeof parent.moveBefore == 'function' && parent.isConnected && node.isConnected) {
      try {
        parent.moveBefore(node, null);
        return;
      } catch (error) {
        // A move that the browser refuses is done by an insertion, which reloads a page.
      }
    }

    parent.appendChild(node);
  }

  // The hidden group where a frame waits while draw.io redraws its shape.  A frame under a group
  // that is not displayed keeps its page loaded and its video playing.
  function parkingGroup() {
    if (parking == null || !parking.isConnected) {
      parking = document.createElementNS(SVG_NAMESPACE, 'g');
      parking.setAttribute('class', 'media-plugin-parking');
      parking.style.display = 'none';
      var pane = graph.view.getOverlayPane() || graph.view.getDrawPane();
      pane.appendChild(parking);
    }

    return parking;
  }

  function park(frame) {
    if (frame.parentNode != parkingGroup()) {
      moveNode(parking, frame);
    }

    frame.clip.remove();
  }

  function unpark(frame, group) {
    group.appendChild(frame.clip);
    moveNode(group, frame);
  }

  // A refresh of the graph destroys every cell state and makes new ones in the same task, as do
  // a toggle of mathematics, a change of the whole model and a change of the page shown.  The
  // frame of a destroyed state waits until the task ends, and a new state of the same cell and
  // the same file takes it, so a video goes on with its time, pause, speed and sound, a page keeps
  // its state, and a WebM file is not read again.
  var retiredFrames = {};

  function retireFrame(state) {
    var frame = state.mediaFrame;

    if (frame == null) {
      return;
    }

    state.mediaFrame = null;
    park(frame);
    var earlier = retiredFrames[state.cell.id];

    if (earlier != null && earlier != frame) {
      disposeFrame(earlier);
    }

    retiredFrames[state.cell.id] = frame;
    setTimeout(function () {
      if (retiredFrames[state.cell.id] == frame) {
        delete retiredFrames[state.cell.id];
        disposeFrame(frame);
      }
    }, 0);
  }

  function reclaimFrame(cell, media) {
    var frame = retiredFrames[cell.id];

    if (frame != null && frame.kind == media.kind && frame.mediaSource == media.source) {
      delete retiredFrames[cell.id];
      return frame;
    }

    return null;
  }

  function removeFrame(state) {
    var frame = state.mediaFrame;

    if (frame != null) {
      state.mediaFrame = null;
      disposeFrame(frame);
    }
  }

  function disposePage(iframe) {
    iframe.removed = true;
    iframe.removeAttribute('srcdoc');
    iframe.src = 'about:blank';
    iframe.remove();
  }

  // Reload loads the page into a second frame, which stays invisible over the first until it has
  // loaded and drawn, so the page shown never goes blank and never shows the image of its shape.
  function reloadPage(frame) {
    if (frame.pending != null) {
      disposePage(frame.pending);
    }

    var next = makePage(frame.mediaSource);
    frame.pending = next;
    sizePage(frame, next);
    next.style.opacity = '0';
    next.style.marginTop = '-' + frame.pageHeight + 'px';
    frame.box.appendChild(next);

    next.addEventListener('mediapluginload', function () {
      if (frame.pending != next || next.pageLoading) {
        return;
      }

      if (next.loadProblem != null) {
        frame.pending = null;
        disposePage(next);
        reportProblem(frame.content, next.loadProblem);
        return;
      }

      // Two frames of the editor after the load, so the page has drawn before it shows.
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          if (frame.pending != next) {
            return;
          }

          var old = frame.content;
          frame.pending = null;
          frame.content = next;
          next.style.opacity = '';
          next.style.marginTop = '';
          setInteractive(frame, !!frame.interactive);
          disposePage(old);
          next.dispatchEvent(new Event('mediapluginload', { bubbles: true }));
        });
      });
    });
  }

  function disposeFrame(frame) {
    var content = frame.content;

    if (frame.pending != null) {
      disposePage(frame.pending);
      frame.pending = null;
    }

    [videoBar, pageBar].forEach(function (bar) {
      if (bar != null && bar.frame == frame) {
        bar.detach();
      }
    });
    content.removed = true;

    if (frame.kind == MediaKind.VIDEO) {
      content.pause();
      content.removeAttribute('src');
      content.load();

      if (content.mediaSourceAddress != null) {
        URL.revokeObjectURL(content.mediaSourceAddress);
      }
    } else {
      disposePage(content);
    }

    frame.remove();
    frame.clip.remove();
  }

  // The box of the outline in the coordinates that the shape draws in, which differ from the
  // coordinates of the cell state when the view applies its offset as a transform of a group.
  function outlineBox(group, state) {
    try {
      var box = group.getBBox();

      if (box.width > 0 && box.height > 0) {
        return box;
      }
    } catch (error) {
      // A group that is not drawn yet has no box, and the state gives one.
    }

    return { x: state.x, y: state.y, width: state.width, height: state.height };
  }

  // A page lays out at the size of its cell on the slide, as in the HTML deck, and is scaled to
  // the zoom, so its text keeps its size against the slide, and a zoom resizes no plot.
  function sizePage(frame, iframe) {
    iframe.style.width = frame.pageWidth + 'px';
    iframe.style.height = frame.pageHeight + 'px';
    iframe.style.transformOrigin = '0 0';
    iframe.style.transform = 'scale(' + frame.pageScale + ')';
  }

  function placeFrame(state) {
    var media = cellMedia(state.cell);
    var group = (state.shape != null) ? state.shape.node : null;

    if (media == null || group == null) {
      removeFrame(state);
      return;
    }

    if (state.mediaFrame != null && (state.mediaFrame.kind != media.kind ||
        state.mediaFrame.mediaSource != media.source)) {
      removeFrame(state);
    }

    var frame = state.mediaFrame || reclaimFrame(state.cell, media) || makeFrame(media);
    state.mediaFrame = frame;

    // The frame waits in the hidden group while the outline is measured and copied.
    park(frame);
    var box = outlineBox(group, state);
    frame.box.setAttribute('x', box.x);
    frame.box.setAttribute('y', box.y);
    frame.box.setAttribute('width', box.width);
    frame.box.setAttribute('height', box.height);

    while (frame.clip.firstChild != null) {
      frame.clip.removeChild(frame.clip.firstChild);
    }

    for (var i = 0; i < group.children.length; i++) {
      if (OUTLINE_TAGS[group.children[i].localName]) {
        frame.clip.appendChild(group.children[i].cloneNode(false));
      }
    }

    if (frame.clip.firstChild == null) {
      var rect = document.createElementNS(SVG_NAMESPACE, 'rect');
      rect.setAttribute('x', box.x);
      rect.setAttribute('y', box.y);
      rect.setAttribute('width', box.width);
      rect.setAttribute('height', box.height);
      frame.clip.appendChild(rect);
    }

    unpark(frame, group);

    if (frame.kind == MediaKind.PAGE) {
      var scale = graph.view.scale || 1;
      frame.pageWidth = box.width / scale;
      frame.pageHeight = box.height / scale;
      frame.pageScale = scale;
      sizePage(frame, frame.content);

      if (frame.pending != null) {
        sizePage(frame, frame.pending);
        frame.pending.style.marginTop = '-' + frame.pageHeight + 'px';
      }

      // The image of the shape, such as a still of the page for the PDF, is not drawn under the
      // page, as in the HTML deck, so the editor shows only what the page draws.  The image keeps
      // taking the pointer, so a click on the image still selects the shape.
      for (var j = 0; j < group.children.length; j++) {
        if (group.children[j].localName == 'image') {
          group.children[j].style.opacity = '0';
        }
      }
    }

    if (frame.kind == MediaKind.VIDEO) {
      var video = frame.content;
      var fit = (state.cell.value.getAttribute('fit') || 'contain').trim().toLowerCase();
      video.style.objectFit = OBJECT_FIT[fit] || 'contain';

      // A video moved before its first frame loses its autoplay, so it is started again, unless
      // the user paused it from the bar.
      if (video.paused && !video.pausedByUser && !video.heldBySlider && video.src) {
        video.play().catch(function () {});
      }
    }

    if (selectedFrame() == frame) {
      updateBars();
    }
  }

  // An embedded page takes the pointer only while Interact is on, and Interact goes off when the
  // shape is no longer selected, so the slide is edited with the page as a shape.
  function setInteractive(frame, interactive) {
    var value = interactive ? 'auto' : 'none';
    frame.interactive = interactive;
    frame.box.setAttribute('pointer-events', interactive ? 'all' : 'none');
    frame.box.style.pointerEvents = value;
    frame.content.style.pointerEvents = value;
  }

  function mediaBar() {
    if (window.MediaBar == null) {
      if (!mediaBar.warned) {
        mediaBar.warned = true;
        console.warn('media.plugin.js: media-bar.js is not loaded, so no bar shows');
      }

      return null;
    }

    return window.MediaBar;
  }

  function editorContainer() {
    return graph.container;
  }

  function makeVideoBar() {
    var bars = mediaBar();
    var bar = bars && bars.makeVideoBar({ container: editorContainer, gap: BAR_GAP,
      focus: bars.Focus.STAYS_IN_BAR });

    return bar && {
      frame: null,
      element: bar.element,
      attach: function (frame) {
        this.frame = frame;
        bar.attach(frame.content, frame);
      },
      detach: function () {
        this.frame = null;
        bar.detach();
      },
    };
  }

  function makePageBar() {
    var bars = mediaBar();
    var bar = bars && bars.makePageBar({
      container: editorContainer,
      gap: BAR_GAP,
      focus: bars.Focus.STAYS_IN_BAR,
      interact: {
        isOn: function (frame) {
          return !!frame.interactive;
        },
        set: setInteractive,
      },
      reload: reloadPage,
      problem: function (frame) {
        return frame.content.loadProblem;
      },
      loading: function (frame) {
        return frame.pending != null || !!frame.content.pageLoading;
      },
      // The events of a page bubble to the box, which holds the page and the one that reloads.
      content: function (frame) {
        return frame.box;
      },
      onDetach: function (frame) {
        if (frame.interactive) {
          setInteractive(frame, false);
        }
      },
    });

    return bar && {
      frame: null,
      element: bar.element,
      attach: function (frame) {
        this.frame = frame;
        bar.attach(frame, frame);
      },
      detach: function () {
        this.frame = null;
        bar.detach();
      },
    };
  }

  function selectedFrame() {
    var cells = graph.getSelectionCells();
    var state = (cells.length == 1) ? graph.view.getState(cells[0]) : null;
    return (state != null) ? state.mediaFrame : null;
  }

  function updateBars() {
    var frame = selectedFrame();

    if ((frame == null || frame.kind != MediaKind.VIDEO) && videoBar != null) {
      videoBar.detach();
    }

    if ((frame == null || frame.kind != MediaKind.PAGE) && pageBar != null) {
      pageBar.detach();
    }

    if (frame != null && frame.kind == MediaKind.VIDEO) {
      videoBar = videoBar || makeVideoBar();

      if (videoBar != null) {
        videoBar.attach(frame);
      }
    } else if (frame != null && frame.kind == MediaKind.PAGE) {
      pageBar = pageBar || makePageBar();

      if (pageBar != null) {
        pageBar.attach(frame);
      }
    }
  }

  // The control of a bar, or the page, that took the focus last, which keeps it as the header says.
  var heldFocus = null;

  // Whether a node belongs to the bar, the frame, the shape or the label of the one selected video
  // or page.
  function isOnSelectedMedia(node) {
    var cells = graph.getSelectionCells();
    var state = (node != null && cells.length == 1) ? graph.view.getState(cells[0]) : null;
    var frame = (state != null) ? state.mediaFrame : null;

    if (frame == null) {
      return false;
    }

    var bar = (frame.kind == MediaKind.VIDEO) ? videoBar : pageBar;

    return (bar != null && bar.frame == frame && bar.element.contains(node)) ||
      frame.contains(node) || (state.shape != null && state.shape.node.contains(node)) ||
      (state.text != null && state.text.node != null && state.text.node.contains(node));
  }

  function releaseFocus() {
    var held = heldFocus;
    heldFocus = null;

    if (held != null && document.activeElement == held) {
      held.blur();
    }
  }

  document.addEventListener('focusin', function (event) {
    if (isOnSelectedMedia(event.target)) {
      heldFocus = event.target;
    } else if (heldFocus != null && heldFocus.isConnected && isOnSelectedMedia(heldFocus) &&
        !graph.isEditing()) {
      heldFocus.focus({ preventScroll: true });
    } else {
      heldFocus = null;
    }
  }, true);

  // A click in a page gives its frame the focus, and the editor learns of it from the blur of its
  // own window.
  window.addEventListener('blur', function () {
    setTimeout(function () {
      if (isOnSelectedMedia(document.activeElement)) {
        heldFocus = document.activeElement;
      }
    }, 0);
  });

  document.addEventListener('pointerdown', function (event) {
    if (heldFocus != null && !isOnSelectedMedia(event.target)) {
      releaseFocus();
    }
  }, true);

  graph.addListener(mxEvent.START_EDITING, releaseFocus);

  renderer.redraw = function (state) {
    if (state.mediaFrame != null) {
      park(state.mediaFrame);
    }

    var result = redraw.apply(this, arguments);
    placeFrame(state);
    return result;
  };

  renderer.destroy = function (state) {
    retireFrame(state);
    return destroy.apply(this, arguments);
  };

  // draw.io moves the group of a shape when it orders the cells again, as To Front, To Back and a
  // change of the shape do, so a page waits in the hidden group while its group moves.
  renderer.insertStateAfter = function (state) {
    var frame = state.mediaFrame;
    var group = (state.shape != null) ? state.shape.node : null;
    var isInGroup = group != null && frame != null && frame.parentNode == group;

    if (isInGroup) {
      park(frame);
    }

    var result = insertStateAfter.apply(this, arguments);

    if (isInGroup && state.mediaFrame == frame && state.shape != null) {
      unpark(frame, state.shape.node);
    }

    return result;
  };

  // A double-click on the shape of a page selects it and switches Interact on, instead of
  // editing its label, so the next drag acts on the page.  Its label is edited from the keys,
  // as with F2 or Enter.
  var dblClick = graph.dblClick;

  graph.dblClick = function (evt, cell) {
    var state = (cell != null) ? this.view.getState(cell) : null;
    var frame = (state != null) ? state.mediaFrame : null;

    if (frame != null && frame.kind == MediaKind.PAGE && this.isEnabled()) {
      this.setSelectionCell(cell);
      setInteractive(frame, true);
      updateBars();
      mxEvent.consume(evt);
      return;
    }

    return dblClick.apply(this, arguments);
  };

  graph.getSelectionModel().addListener(mxEvent.CHANGE, updateBars);
  graph.refresh();
});
