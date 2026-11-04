// The bars of controls of a video and of an embedded page, shared by the draw.io editor and the
// HTML deck, so that both show the same bar.
//
// The editor loads this file as a plugin before media.plugin.js, which uses it, and deck_html.py
// writes its text into the HTML deck, whose page html-deck.html uses it.  The file defines
// window.MediaBar and nothing else, and does nothing until a bar is made.
//
// The bar of a video offers: back to the start, back 5 s, play and pause, forward 5 s, a slider of
// the position, the time and the length to the millisecond, the speed, the loop, and the sound.
// The time is a field: it shows the time of the video whenever it does not have the focus, and a
// time typed into it, such as 1:02.5, 62.5 or 1:02:03.250, and Enter jump there.  A value that
// does not parse changes nothing, and a value outside the length of the video jumps to the nearer
// end, and while the length is not known yet only a time at or before the start applies.  Escape
// leaves the field as it was.  A drag of the slider holds the video while it moves
// and plays it again on release, and the arrows of the slider step 0.1 s, or 1 s with Shift.
//
// The bar of a page offers Reload, and Interact where the caller gives one, and says while the
// page loads.
//
// A bar sits centred under the box of its anchor, past `gap` pixels, or over the anchor when the
// visible part of its container has no room below, and follows the anchor once per frame of the
// screen, because the editor may move the drawing by a transform without redrawing a cell.  A
// click on a bar reaches nothing behind it.
//
// The option `focus` of a bar, a value of MediaBar.Focus, says where the focus goes after the
// pointer has used a control.  With RETURNS_TO_PAGE, the default, the focus goes back to the page
// after a click on a button, a drag of the slider and a choice of a speed with the pointer, and
// after Enter or Escape in the field, and a key reaches the page unless a field, the slider or the
// list of speeds has the focus, so that their keys turn no slide.  With STAYS_IN_BAR, the control
// keeps the focus, the bar itself takes it after Enter or Escape in the field, and no key leaves
// the bar.  Tab then goes round the controls of the bar, and a key with which the browser would
// scroll the view, such as an arrow on a button, does nothing unless its control uses it.  The
// caller gives the focus back to the page.
(function (global) {
  'use strict';

  if (global.MediaBar != null) {
    return;
  }

  var JUMP_SECONDS = 5;
  var SPEEDS = [0.25, 0.5, 1, 1.5, 2];
  // The direction of each arrow on the slider.  The up arrow steps as the right arrow and the down
  // arrow as the left, because the browser would move the slider by its step of a millisecond.
  var SLIDER_KEYS = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 };
  var GESTURE_EVENTS = ['pointerdown', 'mousedown', 'touchstart', 'click', 'dblclick', 'contextmenu'];
  var KEY_EVENTS = ['keydown', 'keyup', 'keypress'];
  var CLIPBOARD_EVENTS = ['paste', 'cut', 'copy'];
  // The keys with which the browser scrolls the view when the element that has the focus does not
  // use them.
  var SCROLL_KEYS = [' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown',
    'Home', 'End'];
  var Focus = Object.freeze({
    RETURNS_TO_PAGE: 'returns-to-page',
    STAYS_IN_BAR: 'stays-in-bar',
  });
  var BAR_STYLE = 'position: absolute; z-index: 10; display: flex; align-items: center; ' +
    'gap: 2px; padding: 3px 6px; background: rgba(32, 32, 32, 0.92); color: #fff; ' +
    'border-radius: 6px; font: 12px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", ' +
    'sans-serif; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35); user-select: none; ' +
    'white-space: nowrap; pointer-events: auto;';
  var BUTTON_STYLE = 'background: transparent; color: inherit; border: 0; padding: 2px 5px; ' +
    'font: inherit; cursor: pointer; border-radius: 3px; min-width: 24px;';

  // The time to the millisecond, `m:ss.mmm`, because the videos of a slide are often short.
  function formatTime(seconds) {
    if (!isFinite(seconds)) {
      return '-:--.---';
    }

    var milliseconds = Math.max(0, Math.round(seconds * 1000));
    var minutes = Math.floor(milliseconds / 60000);
    var rest = milliseconds - minutes * 60000;
    var wholeSeconds = Math.floor(rest / 1000);
    var fraction = String(rest - wholeSeconds * 1000);
    return minutes + ':' + (wholeSeconds < 10 ? '0' : '') + wholeSeconds + '.' +
      '000'.slice(fraction.length) + fraction;
  }

  // A typed time in seconds: `s`, `m:s` or `h:m:s`, where the last part may have a decimal part
  // and the others are whole numbers, with an optional minus sign before all.  Any other text
  // gives NaN.
  function parseTime(text) {
    var value = String(text).trim();
    var sign = 1;

    if (value.charAt(0) == '-') {
      sign = -1;
      value = value.slice(1).trim();
    }

    var parts = value.split(':');

    if (value == '' || parts.length > 3) {
      return NaN;
    }

    var seconds = 0;

    for (var i = 0; i < parts.length; i++) {
      var part = parts[i].trim();
      var isLast = i == parts.length - 1;
      var pattern = isLast ? /^(\d+\.?\d*|\.\d+)$/ : /^\d+$/;

      if (!pattern.test(part)) {
        return NaN;
      }

      seconds = seconds * 60 + Number(part);
    }

    return isFinite(seconds) ? sign * seconds : NaN;
  }

  function makeButton(shell, label, title, action) {
    var button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.title = title;
    button.style.cssText = BUTTON_STYLE;
    button.addEventListener('click', function (event) {
      action(event);
      shell.releaseControl(button);
    });
    return button;
  }

  // A field, the slider and the list of speeds use the keys that a button leaves to the page.
  function isTypedInto(control) {
    return control.tagName == 'INPUT' || control.tagName == 'SELECT';
  }

  // Whether a control uses a key of SCROLL_KEYS itself: a field every one, the slider all but the
  // space bar, and a button the space bar, which presses it.
  function usesScrollKey(control, key) {
    if (control.type == 'text') {
      return true;
    }

    return (control.type == 'range') ? key != ' ' : control.tagName == 'BUTTON' && key == ' ';
  }

  // The shell of a bar: its look, the events it keeps from the page, and its place under its anchor.
  // `options.container` gives the element that holds the bar, whose scrolled content the bar is
  // placed in.  `options.onFrame` runs on each frame of the screen while the bar shows.
  // `options.focus` is a value of MediaBar.Focus, as the header says.
  function makeShell(options) {
    var element = document.createElement('div');
    var keepsFocus = options.focus == Focus.STAYS_IN_BAR;
    element.className = options.className;
    element.style.cssText = BAR_STYLE;
    GESTURE_EVENTS.forEach(function (name) {
      element.addEventListener(name, function (event) {
        event.stopPropagation();
      });
    });

    // The controls of the bar that show, in their order on the bar.
    function controls() {
      return Array.prototype.filter.call(element.querySelectorAll('button, input, select'),
        function (control) {
          return control.offsetParent != null && !control.disabled;
        });
    }

    function focusNextControl(step) {
      var all = controls();

      if (all.length == 0) {
        return;
      }

      var index = all.indexOf(document.activeElement);
      var next = (index < 0) ? (step > 0 ? 0 : all.length - 1)
        : (index + step + all.length) % all.length;
      all[next].focus({ preventScroll: true });
    }

    function keepKeyOfControl(event) {
      if (isTypedInto(event.target)) {
        event.stopPropagation();
      }
    }

    function keepEveryKey(event) {
      event.stopPropagation();

      if (event.key == 'Tab') {
        if (event.type == 'keydown') {
          focusNextControl(event.shiftKey ? -1 : 1);
        }

        event.preventDefault();
        return;
      }

      if (SCROLL_KEYS.indexOf(event.key) >= 0 && !usesScrollKey(event.target, event.key)) {
        event.preventDefault();
      }
    }

    if (keepsFocus) {
      element.tabIndex = -1;
      element.style.outline = 'none';
    }

    KEY_EVENTS.forEach(function (name) {
      element.addEventListener(name, keepsFocus ? keepEveryKey : keepKeyOfControl);
    });

    // A paste on a control would reach the editor around the bar, which inserts an image of the
    // clipboard into the drawing.
    if (keepsFocus) {
      CLIPBOARD_EVENTS.forEach(function (name) {
        element.addEventListener(name, function (event) {
          event.stopPropagation();
        });
      });
    }

    var gap = (options.gap != null) ? options.gap : 12;
    var shell = { element: element, anchor: null, following: null, placed: null };

    // After the pointer has used a button, the slider or the list of speeds.
    shell.releaseControl = function (control) {
      if (!keepsFocus) {
        control.blur();
      }
    };

    // After Enter or Escape in a field, which then shows the time of the video again.
    shell.leaveField = function (field) {
      if (keepsFocus) {
        element.focus({ preventScroll: true });
      } else {
        field.blur();
      }
    };

    function placeUnder(anchor) {
      var container = options.container();
      var anchorBox = anchor.getBoundingClientRect();
      var containerBox = container.getBoundingClientRect();
      var width = element.offsetWidth;
      var height = element.offsetHeight;
      var visibleTop = container.scrollTop + 4;
      var visibleBottom = container.scrollTop + container.clientHeight - height - 4;
      var left = anchorBox.left + anchorBox.width / 2 - width / 2 - containerBox.left +
        container.scrollLeft;
      var below = anchorBox.bottom - containerBox.top + container.scrollTop + gap;
      var above = anchorBox.top - containerBox.top + container.scrollTop - gap - height;
      var top = (below <= visibleBottom) ? below
        : (above >= visibleTop) ? above : Math.max(visibleTop, visibleBottom);
      var maxLeft = container.scrollLeft + container.clientWidth - width - 4;
      var place = Math.round(Math.max(container.scrollLeft + 4, Math.min(maxLeft, left))) + 'px ' +
        Math.round(top) + 'px';

      if (place != shell.placed) {
        shell.placed = place;
        element.style.left = place.split(' ')[0];
        element.style.top = place.split(' ')[1];
      }
    }

    shell.show = function (anchor) {
      shell.anchor = anchor;
      var container = options.container();

      if (element.parentNode != container) {
        container.appendChild(element);
      }

      if (shell.following == null) {
        var follow = function () {
          if (shell.anchor != null && shell.anchor.isConnected) {
            placeUnder(shell.anchor);

            if (options.onFrame != null) {
              options.onFrame();
            }
          }

          shell.following = requestAnimationFrame(follow);
        };
        shell.following = requestAnimationFrame(follow);
      }
    };

    shell.hide = function () {
      cancelAnimationFrame(shell.following);
      shell.following = null;
      shell.anchor = null;
      shell.placed = null;
      element.remove();
    };

    shell.isShown = function () {
      return element.parentNode != null;
    };

    return shell;
  }

  // The bar of a video.  `video.loadProblem`, a text, marks a video that did not load, and the
  // event `mediapluginproblem` on the video announces it.  `video.pausedByUser` records a pause
  // from the bar, and `video.heldBySlider` a video that a drag of the slider holds, for a caller
  // that starts its videos again on its own.
  function makeVideoBar(options) {
    var self = { video: null, anchor: null, dragging: false, playAfterDrag: false };
    var shell = makeShell({
      className: options.className || 'media-plugin-bar',
      container: options.container,
      gap: options.gap,
      focus: options.focus,
      onFrame: function () {
        if (self.video != null && (!self.video.paused || self.dragging)) {
          show();
        }
      },
    });
    var element = shell.element;

    // A time is clamped to the video, and a video whose length is not known yet goes to its start
    // alone, since its other end is not known.
    function jumpTo(seconds) {
      var video = self.video;

      if (!isFinite(seconds)) {
        return;
      }

      if (isFinite(video.duration)) {
        video.currentTime = Math.max(0, Math.min(video.duration, seconds));
      } else if (seconds <= 0) {
        video.currentTime = 0;
      }

      show();
    }

    function jump(seconds) {
      jumpTo(self.video.currentTime + seconds);
    }

    var restart = makeButton(shell, '\u23EE', 'Back to the start', function () {
      jumpTo(0);
    });
    var back = makeButton(shell, '\u00AB' + JUMP_SECONDS, 'Back ' + JUMP_SECONDS + ' s',
      function () {
        jump(-JUMP_SECONDS);
      });
    var play = makeButton(shell, '\u25B6', 'Play or pause', function () {
      var video = self.video;

      if (video.paused) {
        video.pausedByUser = false;
        video.play().catch(function () {});
      } else {
        video.pausedByUser = true;
        video.pause();
      }
    });
    var forward = makeButton(shell, JUMP_SECONDS + '\u00BB', 'Forward ' + JUMP_SECONDS + ' s',
      function () {
        jump(JUMP_SECONDS);
      });
    var slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '0';
    slider.step = '0.001';
    slider.value = '0';
    slider.title = 'Position';
    slider.style.cssText = 'width: 160px; margin: 0 4px; cursor: pointer;';

    function endDrag() {
      if (!self.dragging) {
        return;
      }

      self.dragging = false;
      shell.releaseControl(slider);

      if (self.video != null) {
        self.video.heldBySlider = false;

        if (self.playAfterDrag) {
          self.video.play().catch(function () {});
        }
      }

      self.playAfterDrag = false;
      show();
    }

    slider.addEventListener('pointerdown', function () {
      self.dragging = true;
      self.playAfterDrag = !self.video.paused;
      self.video.heldBySlider = true;
      self.video.pause();
      window.addEventListener('pointerup', endDrag, { once: true });
      window.addEventListener('pointercancel', endDrag, { once: true });
    });
    slider.addEventListener('input', function () {
      self.video.currentTime = Number(slider.value);
      show();
    });
    slider.addEventListener('change', function () {
      if (self.dragging) {
        endDrag();
      }
    });
    slider.addEventListener('keydown', function (event) {
      if (SLIDER_KEYS[event.key] != null) {
        jump((event.shiftKey ? 1 : 0.1) * SLIDER_KEYS[event.key]);
        event.preventDefault();
      }
    });

    // The field of the time: the time of the video while the field has no focus, and a typed time
    // that Enter applies.
    var time = document.createElement('input');
    time.type = 'text';
    time.spellcheck = false;
    time.autocomplete = 'off';
    time.title = 'The time.  Type a time such as 1:02.5 or 62.5, ' +
      'and press Enter to go there.';
    time.style.cssText = 'width: 64px; padding: 1px 2px; margin: 0; border: 0; ' +
      'border-bottom: 1px solid rgba(255, 255, 255, 0.35); background: transparent; color: inherit; ' +
      'font: inherit; font-variant-numeric: tabular-nums; text-align: right; outline: none;';
    time.addEventListener('focus', function () {
      time.select();
    });
    time.addEventListener('keydown', function (event) {
      if (event.key == 'Enter') {
        var seconds = parseTime(time.value);

        if (!isNaN(seconds) && self.video != null) {
          jumpTo(seconds);
        }

        shell.leaveField(time);
        event.preventDefault();
      } else if (event.key == 'Escape') {
        shell.leaveField(time);
        event.preventDefault();
      }
    });
    time.addEventListener('blur', function () {
      show();
    });
    var length = document.createElement('span');
    length.style.cssText = 'min-width: 64px; padding-left: 3px; font-variant-numeric: tabular-nums;';
    var status = document.createElement('span');
    status.style.cssText = 'padding: 0 4px; color: #ffb3b3;';
    var speed = document.createElement('select');
    speed.title = 'Speed';
    speed.style.cssText = 'background: #444; color: #fff; border: 0; border-radius: 3px; ' +
      'font: inherit; margin: 0 2px;';
    SPEEDS.forEach(function (rate) {
      var option = document.createElement('option');
      option.value = String(rate);
      option.textContent = rate + '\u00D7';
      speed.appendChild(option);
    });
    var speedByPointer = false;
    speed.addEventListener('pointerdown', function () {
      speedByPointer = true;
    });
    speed.addEventListener('change', function () {
      self.video.playbackRate = Number(speed.value);

      if (speedByPointer) {
        speedByPointer = false;
        shell.releaseControl(speed);
      }
    });
    var loop = makeButton(shell, '\u21BB', 'Loop', function () {
      self.video.loop = !self.video.loop;
      show();
    });
    var sound = makeButton(shell, '\uD83D\uDD07', 'Sound on or off', function () {
      self.video.muted = !self.video.muted;
    });
    [restart, back, play, forward, slider, time, length, status, speed, loop, sound].forEach(
      function (child) {
        element.appendChild(child);
      });

    function show() {
      var video = self.video;

      if (video == null) {
        return;
      }

      var duration = isFinite(video.duration) ? video.duration : 0;
      element.title = video.loadProblem || '';
      status.textContent = video.loadProblem ? 'not playable' : '';
      play.textContent = video.paused ? '\u25B6' : '\u275A\u275A';
      slider.max = String(duration);

      if (!self.dragging) {
        slider.value = String(video.currentTime);
      }

      if (document.activeElement != time) {
        time.value = formatTime(self.dragging ? Number(slider.value) : video.currentTime);
      }

      length.textContent = '/ ' + formatTime(video.duration);
      speed.value = String(video.playbackRate);
      loop.style.opacity = video.loop ? '1' : '0.45';
      sound.textContent = video.muted ? '\uD83D\uDD07' : '\uD83D\uDD0A';
    }

    var VIDEO_EVENTS = ['timeupdate', 'play', 'pause', 'ratechange', 'volumechange',
      'durationchange', 'loadedmetadata', 'seeked', 'error', 'mediapluginproblem'];

    self.attach = function (video, anchor) {
      if (self.video != video) {
        self.detach();
        self.video = video;
        VIDEO_EVENTS.forEach(function (name) {
          video.addEventListener(name, show);
        });
      }

      self.anchor = anchor;
      show();
      shell.show(anchor);
    };

    self.detach = function () {
      if (self.video != null) {
        VIDEO_EVENTS.forEach(function (name) {
          self.video.removeEventListener(name, show);
        });

        if (self.dragging) {
          self.video.heldBySlider = false;
        }
      }

      self.video = null;
      self.anchor = null;
      self.dragging = false;
      self.playAfterDrag = false;
      shell.hide();
    };

    // Whether a control of the bar has the focus or the slider is held, so that a caller that hides
    // the bar when the pointer leaves keeps it while it is in use.
    self.isInUse = function () {
      return self.dragging || element.contains(document.activeElement);
    };

    self.element = element;
    self.isShown = shell.isShown;
    return self;
  }

  // The bar of a page.  `options.reload(target)` loads the page of the target again.
  // `options.interact`, when given, has `isOn(target)` and `set(target, on)`.
  // `options.problem(target)` gives the text of a page that did not load.
  // `options.loading(target)`, when given, says whether the page is loading.
  // `options.content(target)` gives the element that announces a change of the problem by the
  // event `mediapluginproblem` and a change of the loading by the event `mediapluginload`.
  function makePageBar(options) {
    var self = { target: null, anchor: null };
    var shell = makeShell({
      className: (options.className || 'media-plugin-bar') + ' media-plugin-page-bar',
      container: options.container,
      gap: options.gap,
      focus: options.focus,
    });
    var element = shell.element;
    var label = document.createElement('span');
    label.textContent = 'Page';
    label.style.cssText = 'padding: 0 4px; opacity: 0.7;';
    var interact = null;

    if (options.interact != null) {
      var hint = 'Let the pointer act on the page, such as to turn a plot, instead of selecting ' +
        'and moving the shape; a double-click on the shape does the same';
      interact = makeButton(shell, '\u2610 Interact', hint, function () {
        options.interact.set(self.target, !options.interact.isOn(self.target));
        show();
      });
    }

    var reload = makeButton(shell, '\u27F3 Reload', 'Load the page again', function () {
      options.reload(self.target);
      show();
    });
    var status = document.createElement('span');
    status.style.cssText = 'padding: 0 4px; color: #ffb3b3;';
    [label, interact, reload, status].forEach(function (child) {
      if (child != null) {
        element.appendChild(child);
      }
    });

    function show() {
      if (self.target == null) {
        return;
      }

      if (interact != null) {
        interact.textContent = (options.interact.isOn(self.target) ? '\u2611' : '\u2610') + ' Interact';
      }

      var problem = options.problem(self.target);
      var loading = !problem && options.loading != null && options.loading(self.target);
      element.title = problem || '';
      status.textContent = problem ? 'not loaded' : (loading ? 'loading' : '');
      status.style.opacity = loading ? '0.7' : '';
      status.style.color = loading ? 'inherit' : '#ffb3b3';
    }

    self.attach = function (target, anchor) {
      if (self.target != target) {
        self.detach();
        self.target = target;
        options.content(target).addEventListener('mediapluginproblem', show);
        options.content(target).addEventListener('mediapluginload', show);
      }

      self.anchor = anchor;
      show();
      shell.show(anchor);
    };

    // A new element for the same page, such as the frame that a reload has swapped in, takes the
    // bar without hiding it.
    self.retarget = function (target) {
      if (self.target == null || self.target == target) {
        return;
      }

      options.content(self.target).removeEventListener('mediapluginproblem', show);
      options.content(self.target).removeEventListener('mediapluginload', show);
      self.target = target;
      options.content(target).addEventListener('mediapluginproblem', show);
      options.content(target).addEventListener('mediapluginload', show);
      show();
    };

    self.detach = function () {
      if (self.target != null) {
        options.content(self.target).removeEventListener('mediapluginproblem', show);
        options.content(self.target).removeEventListener('mediapluginload', show);

        if (options.onDetach != null) {
          options.onDetach(self.target);
        }
      }

      self.target = null;
      self.anchor = null;
      shell.hide();
    };

    self.isInUse = function () {
      return element.contains(document.activeElement);
    };

    self.element = element;
    self.isShown = shell.isShown;
    return self;
  }

  global.MediaBar = {
    formatTime: formatTime,
    parseTime: parseTime,
    Focus: Focus,
    makeVideoBar: makeVideoBar,
    makePageBar: makePageBar,
  };
})(window);
