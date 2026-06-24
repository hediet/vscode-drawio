/**
 * Preview script that runs inside the VS Code Markdown preview webview.
 *
 * 1. Fenced code blocks: find <code class="language-drawio"> elements,
 *    extract the XML from textContent, replace the <pre> with a
 *    <div class="mxgraph">.
 * 2. HTML comment blocks: find <!-- drawio:start --> comment nodes,
 *    reconstruct XML from the DOM (the HTML parser mangles the XML),
 *    replace with <div class="mxgraph">.
 * 3. Create each GraphViewer instance directly via JS with toolbar-buttons config.
 * 4. Edit button uses vscode:// URI (command: URIs are blocked in the preview).
 * 5. MutationObserver re-processes when VS Code replaces the preview content.
 */
(function ()
{
  'use strict';

  var MXGRAPH_CONFIG = {
    highlight: '#0000ff',
    responsive: true,
    lightbox: false,
    nav: false,
    border: 28
  };

  MXGRAPH_CONFIG['responsive-max-scale'] = 1;
  MXGRAPH_CONFIG['dark-mode'] = 'auto';

  /** Flag to suppress observer callbacks while we modify the DOM. */
  var rendering = false;

  /** The MutationObserver instance (created once in init). */
  var observer = null;

  // ---------------------------------------------------------------------------
  // Tag-name case mapping.
  //
  // The HTML parser lowercases all element names.  We map them back to the
  // correct mxGraph casing so the viewer can recognise the XML.
  // ---------------------------------------------------------------------------

  var TAG_CASE_MAP = {
    'mxfile': 'mxfile',
    'diagram': 'diagram',
    'mxgraphmodel': 'mxGraphModel',
    'root': 'root',
    'mxcell': 'mxCell',
    'mxgeometry': 'mxGeometry',
    'mxpoint': 'mxPoint',
    'array': 'Array',
    'object': 'object',
    'mxrectangle': 'mxRectangle',
  };

  function correctTag(el)
  {
    var lower = el.tagName.toLowerCase();
    return TAG_CASE_MAP[lower] || lower;
  }

  function escAttr(value)
  {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function attrsToString(el)
  {
    var result = '';
    for (var i = 0; i < el.attributes.length; i++)
    {
      var a = el.attributes[i];
      // Skip any VS Code injected attributes
      if (a.name === 'data-line' || a.name === 'class' || a.name === 'dir') continue;
      result += ' ' + a.name + '="' + escAttr(a.value) + '"';
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // Reconstruct valid mxGraph XML from a DOM tree mangled by the HTML parser.
  //
  // Problem:  Self-closing XML tags like <mxCell id="0"/> are treated as
  //           opening tags in HTML (the "/" is ignored for non-void elements).
  //           This causes sibling <mxCell> elements to be deeply nested
  //           instead of flat.
  //
  // Strategy: For <root>, collect ALL descendant <mxcell> elements and emit
  //           them as flat siblings.  For <mxgeometry>, flatten descendant
  //           <mxpoint> elements similarly.  Other elements are serialised
  //           normally.
  // ---------------------------------------------------------------------------

  /**
   * Serialise a mxCell element.  Its direct non-mxcell children (mxGeometry
   * etc.) are included; nested mxcell children are ignored (they will be
   * emitted as siblings by the root serialiser).
   */
  function serializeMxCell(cell, indent)
  {
    var tag = correctTag(cell);
    var attrs = attrsToString(cell);

    var children = [];
    for (var i = 0; i < cell.children.length; i++)
    {
      var ch = cell.children[i];
      if (ch.tagName.toLowerCase() !== 'mxcell'
        && !(ch.classList && ch.classList.contains('code-line')))
      {
        children.push(ch);
      }
    }

    if (children.length === 0)
    {
      return indent + '<' + tag + attrs + '/>';
    }

    var out = indent + '<' + tag + attrs + '>\n';
    for (var j = 0; j < children.length; j++)
    {
      out += serializeGeneric(children[j], indent + '  ') + '\n';
    }
    out += indent + '</' + tag + '>';
    return out;
  }

  /**
   * Generic element serialiser.  Handles mxGeometry (flatten nested mxPoint),
   * and any other elements.
   */
  function serializeGeneric(el, indent)
  {
    if (el.classList && el.classList.contains('code-line')) return '';

    var lower = el.tagName.toLowerCase();
    var tag = correctTag(el);
    var attrs = attrsToString(el);

    // mxGeometry may have nested mxPoint elements that should be flat
    if (lower === 'mxgeometry')
    {
      var points = el.getElementsByTagName('mxpoint');
      if (points.length === 0)
      {
        return indent + '<' + tag + attrs + '/>';
      }
      var out = indent + '<' + tag + attrs + '>\n';
      for (var p = 0; p < points.length; p++)
      {
        out += indent + '  <' + correctTag(points[p]) + attrsToString(points[p]) + '/>\n';
      }
      // Also look for Array elements (used for edge points)
      var arrays = el.getElementsByTagName('array');
      for (var a = 0; a < arrays.length; a++)
      {
        var arrEl = arrays[a];
        var arrPoints = arrEl.getElementsByTagName('mxpoint');
        if (arrPoints.length > 0)
        {
          out += indent + '  <' + correctTag(arrEl) + attrsToString(arrEl) + '>\n';
          for (var ap = 0; ap < arrPoints.length; ap++)
          {
            out += indent + '    <' + correctTag(arrPoints[ap]) + attrsToString(arrPoints[ap]) + '/>\n';
          }
          out += indent + '  </' + correctTag(arrEl) + '>\n';
        }
      }
      out += indent + '</' + tag + '>';
      return out;
    }

    // Leaf element
    var childEls = [];
    for (var i = 0; i < el.children.length; i++)
    {
      if (!(el.children[i].classList && el.children[i].classList.contains('code-line')))
      {
        childEls.push(el.children[i]);
      }
    }

    if (childEls.length === 0)
    {
      return indent + '<' + tag + attrs + '/>';
    }

    var result = indent + '<' + tag + attrs + '>\n';
    for (var c = 0; c < childEls.length; c++)
    {
      result += serializeGeneric(childEls[c], indent + '  ') + '\n';
    }
    result += indent + '</' + tag + '>';
    return result;
  }

  /**
   * Reconstruct valid mxGraph XML from a mangled DOM subtree.
   * @param {Element} mxfileEl  The <mxfile> DOM element
   * @returns {string} Valid mxGraph XML
   */
  function reconstructXml(mxfileEl)
  {
    var tag = correctTag(mxfileEl);
    var attrs = attrsToString(mxfileEl);

    var out = '<' + tag + attrs + '>\n';

    var diagrams = mxfileEl.getElementsByTagName('diagram');
    for (var d = 0; d < diagrams.length; d++)
    {
      var diag = diagrams[d];
      var diagTag = correctTag(diag);
      out += '  <' + diagTag + attrsToString(diag) + '>\n';

      var models = diag.getElementsByTagName('mxgraphmodel');
      for (var m = 0; m < models.length; m++)
      {
        var model = models[m];
        var modelTag = correctTag(model);
        out += '    <' + modelTag + attrsToString(model) + '>\n';

        var roots = model.getElementsByTagName('root');
        for (var r = 0; r < roots.length; r++)
        {
          out += '      <root>\n';

          // FLATTEN: collect ALL descendant mxCell elements as siblings
          var cells = roots[r].getElementsByTagName('mxcell');
          for (var c = 0; c < cells.length; c++)
          {
            out += serializeMxCell(cells[c], '        ') + '\n';
          }

          out += '      </root>\n';
        }

        out += '    </' + modelTag + '>\n';
      }

      out += '  </' + diagTag + '>\n';
    }

    out += '</' + tag + '>';
    return out;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Create a .mxgraph div from raw XML, ready for the viewer.
   * @param {string} xml        Raw mxGraph XML
   * @param {string} [srcLine]  Source-file line number (for command URI)
   * @param {boolean} [locked]  Whether the diagram block is locked
   * @param {string} [docUri]   Encoded document URI from markdownPlugin
   * @param {number} [width]    Explicit width constraint in pixels
   */
  function createMxgraphDiv(xml, srcLine, locked, docUri, width)
  {
    var div = document.createElement('div');
    div.className = 'mxgraph';
    div.setAttribute('data-drawio-managed', 'true');
    var config = JSON.parse(JSON.stringify(MXGRAPH_CONFIG));
    config.xml = xml;
    div.setAttribute('data-mxgraph', JSON.stringify(config));
    if (srcLine) div.setAttribute('data-source-line', srcLine);
    if (locked) div.setAttribute('data-locked', 'true');
    if (docUri) div.setAttribute('data-doc-uri', docUri);
    if (width) div.style.maxWidth = width + 'px';
    return div;
  }

  /**
   * Walk up the DOM from a node to find the nearest data-line attribute.
   * VS Code injects these on elements for source-map / scroll-sync.
   * Returns the attribute value (string) or null.
   */
  function findSourceLine(node)
  {
    var cur = node;
    while (cur && cur !== document.body)
    {
      if (cur.nodeType === Node.ELEMENT_NODE)
      {
        var line = cur.getAttribute('data-line');
        if (line) return line;
      }
      cur = cur.parentNode;
    }

    // Fallback: check previous siblings
    cur = node.previousSibling || (node.parentNode && node.parentNode.previousSibling);
    while (cur)
    {
      if (cur.nodeType === Node.ELEMENT_NODE)
      {
        var line2 = cur.getAttribute('data-line');
        if (line2) return line2;
      }
      cur = cur.previousSibling;
    }

    return null;
  }

  // ---------------------------------------------------------------------------
  // Markdown-it plugin output  (markdownPlugin.js)
  //
  // If VS Code calls extendMarkdownIt(), the fenced blocks arrive as
  //   <div class="drawio-diagram" data-drawio-xml="base64...">
  // We decode the base64 and convert to the .mxgraph format the viewer expects.
  // ---------------------------------------------------------------------------

  function processPluginBlocks()
  {
    var pluginDivs = document.querySelectorAll('.drawio-diagram[data-drawio-xml]');

    for (var i = pluginDivs.length - 1; i >= 0; i--)
    {
      var el = pluginDivs[i];
      if (el.getAttribute('data-drawio-processed')) continue;

      var b64 = el.getAttribute('data-drawio-xml');
      if (!b64) continue;

      try
      {
        var binary = atob(b64);
        var bytes = new Uint8Array(binary.length);
        for (var j = 0; j < binary.length; j++) bytes[j] = binary.charCodeAt(j);
        var xml = new TextDecoder().decode(bytes);
        // Read data-line, data-locked, data-doc-uri from plugin output (set by markdownPlugin.js)
        var srcLine = el.getAttribute('data-line') || findSourceLine(el);
        var isLocked = el.getAttribute('data-locked') === 'true';
        var docUri = el.getAttribute('data-doc-uri') || '';
        var wClass = el.className.match(/\bdrawio-w-(\d+)/);
        var width = wClass ? parseInt(wClass[1], 10) : null;
        var div = createMxgraphDiv(xml, srcLine, isLocked, docUri, width);
        el.parentNode.insertBefore(div, el);
        el.style.display = 'none';
        el.setAttribute('data-drawio-processed', 'true');
      }
      catch (err)
      {
        console.error('[drawio-md] plugin[' + i + '] base64 decode error:', err);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Fenced code blocks
  // ---------------------------------------------------------------------------

  /**
   * Find <pre><code class="...language-drawio..."> blocks and replace
   * the entire <pre> with a .mxgraph div.
   */
  function processFencedBlocks()
  {
    var codeEls = document.querySelectorAll('code[class*="language-drawio"]');

    for (var i = codeEls.length - 1; i >= 0; i--)
    {
      var code = codeEls[i];
      var pre = code.parentElement;
      if (!pre || pre.tagName !== 'PRE') continue;
      if (pre.getAttribute('data-drawio-processed')) continue;

      var xml = code.textContent.trim();
      if (!xml) continue;

      // The markdown-it core rule injects drawio-w-{N} and drawio-locked
      // classes onto the fence token, which end up on the <code> element
      // even if the fence renderer override is not active.
      var isLocked = /\bdrawio-locked\b/.test(code.className) || /\blocked\b/.test(code.className);
      var wClass = code.className.match(/\bdrawio-w-(\d+)/);
      var width = wClass ? parseInt(wClass[1], 10) : null;
      // Capture VS Code's source-line attribute for the command URI
      var srcLine = pre.getAttribute('data-line') || findSourceLine(pre);

      var div = createMxgraphDiv(xml, srcLine, isLocked, null, width);
      pre.parentNode.insertBefore(div, pre);
      pre.style.display = 'none';
      pre.setAttribute('data-drawio-processed', 'true');
    }
  }

  // ---------------------------------------------------------------------------
  // HTML comment blocks
  // ---------------------------------------------------------------------------

  /**
   * Find <!-- drawio:start --> ... <!-- drawio:end --> comment blocks.
   *
   * The XML between the comments is parsed as HTML by the browser, which
   * mangles it (lowercases tag names, breaks self-closing elements).
   * We reconstruct valid XML from the DOM tree.
   */
  function processCommentBlocks()
  {
    var walker = document.createTreeWalker(
      document.body, NodeFilter.SHOW_COMMENT, null, false
    );

    var starts = [];
    var node;
    while ((node = walker.nextNode()))
    {
      if (/^\s*drawio:start(\s|$)/.test(node.textContent))
      {
        // Skip comment nodes inside <pre>/<code> (code blocks showing syntax examples)
        if (node.parentElement && node.parentElement.closest('pre'))
        {
          continue;
        }
        starts.push(node);
      }
    }

    for (var s = 0; s < starts.length; s++)
    {
      var startComment = starts[s];

      // Already processed?
      var prev = startComment.previousSibling;
      if (prev && prev.nodeType === Node.ELEMENT_NODE
        && prev.getAttribute && prev.getAttribute('data-drawio-managed'))
      {
        continue;
      }

      // Collect sibling nodes until <!-- drawio:end -->
      var siblings = [];
      var current = startComment.nextSibling;
      var endComment = null;

      while (current)
      {
        if (current.nodeType === Node.COMMENT_NODE
          && /^\s*drawio:end\s*$/.test(current.textContent))
        {
          endComment = current;
          break;
        }
        siblings.push(current);
        current = current.nextSibling;
      }
      if (!endComment) continue;

      // Find the <mxfile> element among the siblings (or nested inside them,
      // since VS Code may wrap content in tracking divs)
      var mxfileEl = null;
      for (var j = 0; j < siblings.length; j++)
      {
        if (siblings[j].nodeType === Node.ELEMENT_NODE)
        {
          if (siblings[j].tagName.toLowerCase() === 'mxfile')
          {
            mxfileEl = siblings[j];
            break;
          }
          var nested = siblings[j].getElementsByTagName('mxfile');
          if (nested.length > 0)
          {
            mxfileEl = nested[0];
            break;
          }
        }
      }

      if (!mxfileEl)
      {
        console.warn('[drawio-md] comment[' + s + '] no <mxfile> element found');
        continue;
      }

      // Detect locked state and width from the comment text
      var commentText = startComment.textContent;
      var isLocked = /\blocked\b/.test(commentText);
      var widthMatch = commentText.match(/\bwidth=(\d+)/);
      var commentWidth = widthMatch ? parseInt(widthMatch[1], 10) : null;

      // Find nearest source line
      var srcLine = findSourceLine(startComment);

      // Reconstruct valid XML from the mangled DOM
      var xml = reconstructXml(mxfileEl);
      var div = createMxgraphDiv(xml, srcLine, isLocked, null, commentWidth);
      startComment.parentNode.insertBefore(div, startComment);

      // Hide originals
      for (var k = 0; k < siblings.length; k++)
      {
        if (siblings[k].nodeType === Node.ELEMENT_NODE)
        {
          siblings[k].style.display = 'none';
        }
        else if (siblings[k].nodeType === Node.TEXT_NODE && siblings[k].textContent.trim())
        {
          var span = document.createElement('span');
          span.style.display = 'none';
          siblings[k].parentNode.insertBefore(span, siblings[k]);
          span.appendChild(siblings[k]);
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Viewer integration
  // ---------------------------------------------------------------------------

  /**
   * Create each GraphViewer instance directly via JS (rather than via
   * GraphViewer.createViewerForElement) so we can pass a toolbar-buttons
   * config with a handler function for the "Edit" button.
   *
   * The toolbar-buttons mechanism is the viewer's native way to add custom
   * buttons — the key name (e.g. "edit") is referenced from the toolbar
   * string (e.g. "zoom edit"), and the value provides {title, image, handler}.
   *
   * After the viewer creates the button, we wrap its DOM element in an
   * <a href="command:..."> so that the user's real (trusted) click bubbles
   * through the <a> and reaches VS Code's document-level link handler.
   * (Programmatic .click() won't work — VS Code ignores non-trusted events.)
   *
   * See drawio-dev/src/main/webapp/connect/office365/js/index.js for the
   * reference pattern.
   */
  function processViewerElements()
  {
    var pending = document.querySelectorAll(
      '.mxgraph[data-mxgraph]:not([data-drawio-failed])'
    );

    if (pending.length === 0) return;

    // All managed mxgraph divs in DOM order — their ordinal position matches
    // the block index from findDiagramBlocks (both sorted by source position).
    var allManaged = document.querySelectorAll('.mxgraph[data-drawio-managed]');

    for (var i = 0; i < pending.length; i++)
    {
      var el = pending[i];
      var srcLine = el.getAttribute('data-source-line');
      var isLocked = el.getAttribute('data-locked') === 'true';
      var docUri = el.getAttribute('data-doc-uri') || '';

      // Compute block index = position of this element among all managed divs.
      // This corresponds to the index in findDiagramBlocks() on the extension side.
      var blockIndex = -1;
      for (var bi = 0; bi < allManaged.length; bi++)
      {
        if (allManaged[bi] === el) { blockIndex = bi; break; }
      }

      try
      {
        var configStr = el.getAttribute('data-mxgraph');
        var config = JSON.parse(configStr);
        var xml = config.xml;

        if (!xml)
        {
          console.warn('[drawio-md]   [' + i + '] no xml in config');
          continue;
        }

        // Parse XML and create the viewer directly (like office365/js/index.js)
        var xmlDoc = mxUtils.parseXml(xml);
        el.innerText = '';
        new GraphViewer(el, xmlDoc.documentElement, config);

        // Prevent double-click from triggering VS Code's "go to source"
        el.addEventListener('dblclick', function (e) { e.stopPropagation(); });

      }
      catch (err)
      {
        console.error('[drawio-md]   [' + i + '] FAILED:', err.message || err);
        el.setAttribute('data-drawio-failed', 'true');
        el.innerHTML = '<div style="padding:0.5em 1em;color:#c33;background:#fff8f8;'
          + 'border:1px solid #fcc;border-radius:4px;font-size:13px;">'
          + 'Diagram render error: ' + (err.message || String(err)) + '</div>';
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Main render pass
  // ---------------------------------------------------------------------------

  /**
   * Called once on init and again when VS Code replaces the preview content
   * (e.g. user edits the markdown source).
   */
  function renderDiagrams()
  {
    if (rendering) return;
    rendering = true;

    // Pause observer so our own DOM changes don't re-trigger it
    if (observer) observer.disconnect();

    try
    {
      processPluginBlocks();
      processFencedBlocks();
      processCommentBlocks();
      processViewerElements();
    }
    catch (err)
    {
      console.error('[drawio-md] renderDiagrams error:', err);
    }
    finally
    {
      rendering = false;
      // Resume observer
      if (observer) observer.observe(document.body, { childList: true, subtree: true });
    }
  }

  // ---------------------------------------------------------------------------
  // Init + MutationObserver
  // ---------------------------------------------------------------------------

  function hasNewContent()
  {
    // Check for unprocessed markdown-it plugin blocks
    if (document.querySelectorAll('.drawio-diagram[data-drawio-xml]:not([data-drawio-processed])').length > 0)
    {
      return true;
    }

    // Check for unprocessed fenced code blocks
    var codes = document.querySelectorAll('code[class*="language-drawio"]');
    for (var i = 0; i < codes.length; i++)
    {
      var pre = codes[i].parentElement;
      if (pre && pre.tagName === 'PRE' && !pre.getAttribute('data-drawio-processed'))
      {
        return true;
      }
    }

    // Check for unprocessed comment blocks
    var walker = document.createTreeWalker(
      document.body, NodeFilter.SHOW_COMMENT, null, false
    );
    var node;
    while ((node = walker.nextNode()))
    {
      if (/^\s*drawio:start(\s|$)/.test(node.textContent))
      {
        var prev = node.previousSibling;
        if (!prev || prev.nodeType !== Node.ELEMENT_NODE
          || !prev.getAttribute || !prev.getAttribute('data-drawio-managed'))
        {
          return true;
        }
      }
    }

    return false;
  }

  function init()
  {
    if (typeof GraphViewer !== 'undefined')
    {
      // Use VS Code's editor background for dark mode so shapes don't get
      // the hardcoded #121212 fill that clashes with the preview background.
      GraphViewer.darkBackgroundColor = 'var(--vscode-editor-background)';
      document.documentElement.style.setProperty('--ge-dark-color',
        'var(--vscode-editor-background)');

      renderDiagrams();

      // Watch for VS Code replacing the preview content
      observer = new MutationObserver(function ()
      {
        if (rendering) return;
        if (hasNewContent())
        {
          renderDiagrams();
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }
    else
    {
      setTimeout(init, 50);
    }
  }

  if (document.readyState === 'loading')
  {
    document.addEventListener('DOMContentLoaded', init);
  }
  else
  {
    init();
  }
})();
