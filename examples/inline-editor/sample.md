# Draw.io Markdown Diagrams — VS Code Extension

This document demonstrates embedded draw.io diagrams in Markdown.

## Extension Architecture

The following diagram shows how the VS Code extension is structured. The extension host reads and writes the Markdown source via the VS Code API, parses diagram blocks with regex, and communicates with the webview panel via postMessage. Inside the webview, contenteditable text sections alternate with draw.io editor iframes that use the embed mode protocol.

```drawio width=855
<mxfile>
  <diagram id="ext-architecture" name="Extension Architecture">
    <mxGraphModel dx="71" dy="2" grid="0" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="0" pageScale="1" pageWidth="800" pageHeight="560" math="0" shadow="0">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
        <mxCell id="vscode" parent="1" style="swimlane;startSize=28;fillColor=#f5f5f5;strokeColor=#666666;fontColor=#333333;fontStyle=1;fontSize=14;rounded=1;arcSize=6;swimlaneLine=1;" value="VS Code Host" vertex="1">
          <mxGeometry height="520" width="770" y="20" as="geometry" />
        </mxCell>
        <mxCell id="md" parent="vscode" style="shape=document;whiteSpace=wrap;html=0;fillColor=#e1d5e7;strokeColor=#9673a6;fontSize=11;align=center;verticalAlign=middle;size=0.12;" value="Markdown Source&#xa;(.md file)&#xa;&#xa;```drawio height=N&#xa;  &lt;mxfile/&gt;&#xa;```" vertex="1">
          <mxGeometry height="120" width="160" x="30" y="100" as="geometry" />
        </mxCell>
        <mxCell id="extmod" parent="vscode" style="swimlane;startSize=24;fillColor=#dae8fc;strokeColor=#6c8ebf;fontStyle=1;fontSize=12;rounded=1;arcSize=8;" value="Extension Modules" vertex="1">
          <mxGeometry height="140" width="490" x="260" y="40" as="geometry" />
        </mxCell>
        <mxCell id="extjs" parent="extmod" style="rounded=1;whiteSpace=wrap;html=0;fillColor=#dae8fc;strokeColor=#6c8ebf;fontSize=11;verticalAlign=middle;" value="extension.js&#xa;commands · CodeLens · webview mgmt" vertex="1">
          <mxGeometry height="45" width="225" x="15" y="35" as="geometry" />
        </mxCell>
        <mxCell id="parser" parent="extmod" style="rounded=1;whiteSpace=wrap;html=0;fillColor=#dae8fc;strokeColor=#6c8ebf;fontSize=11;verticalAlign=middle;" value="diagramParser.js&#xa;regex block detection + height" vertex="1">
          <mxGeometry height="45" width="215" x="260" y="35" as="geometry" />
        </mxCell>
        <mxCell id="lockmod" parent="extmod" style="rounded=1;whiteSpace=wrap;html=0;fillColor=#dae8fc;strokeColor=#6c8ebf;fontSize=11;verticalAlign=middle;" value="diagramLock.js&#xa;lock / unlock toggle" vertex="1">
          <mxGeometry height="40" width="215" x="260" y="90" as="geometry" />
        </mxCell>
        <mxCell id="wv" parent="vscode" style="swimlane;startSize=24;fillColor=#fff2cc;strokeColor=#d6b656;fontStyle=1;fontSize=12;rounded=1;arcSize=8;" value="Webview Panel  (inlinePreview.html)" vertex="1">
          <mxGeometry height="180" width="730" x="20" y="310" as="geometry" />
        </mxCell>
        <mxCell id="toolbar" parent="wv" style="rounded=0;whiteSpace=wrap;html=0;fillColor=#fff2cc;strokeColor=#d6b656;fontSize=10;fontStyle=1;align=left;spacingLeft=8;" value="Toolbar:   [+ Diagram]                                                                                                 [Source]" vertex="1">
          <mxGeometry height="24" width="710" x="10" y="32" as="geometry" />
        </mxCell>
        <mxCell id="txt1" parent="wv" style="rounded=0;whiteSpace=wrap;html=0;fillColor=#FFFFFF;strokeColor=#B3B3B3;fontSize=10;fontColor=#999999;dashed=1;" value="contenteditable text section" vertex="1">
          <mxGeometry height="22" width="710" x="10" y="62" as="geometry" />
        </mxCell>
        <mxCell id="iframe" parent="wv" style="rounded=1;whiteSpace=wrap;html=0;fillColor=#d5e8d4;strokeColor=#82b366;fontSize=10;verticalAlign=middle;" value="draw.io iframe  (embed mode · postMessage protocol)&#xa;configure → load(xml, border, maxFitScale) → loaded / autosave / resize" vertex="1">
          <mxGeometry height="44" width="580" x="10" y="90" as="geometry" />
        </mxCell>
        <mxCell id="overlay" parent="wv" style="rounded=0;whiteSpace=wrap;html=0;fillColor=#f8cecc;strokeColor=#b85450;fontSize=9;fontColor=#b85450;dashed=1;opacity=60;" value="wheel&#xa;overlay" vertex="1">
          <mxGeometry height="44" width="50" x="600" y="90" as="geometry" />
        </mxCell>
        <mxCell id="resizer" parent="wv" style="rounded=0;whiteSpace=wrap;html=0;fillColor=#E6E6E6;strokeColor=#B3B3B3;fontSize=9;fontColor=#666666;" value="resize handle (drag)" vertex="1">
          <mxGeometry height="44" width="60" x="660" y="90" as="geometry" />
        </mxCell>
        <mxCell id="txt2" parent="wv" style="rounded=0;whiteSpace=wrap;html=0;fillColor=#FFFFFF;strokeColor=#B3B3B3;fontSize=10;fontColor=#999999;dashed=1;" value="contenteditable text section" vertex="1">
          <mxGeometry height="22" width="710" x="10" y="140" as="geometry" />
        </mxCell>
        <mxCell id="e1" edge="1" parent="vscode" source="md" style="endArrow=classic;startArrow=classic;html=0;fontSize=10;exitX=1;exitY=0.5;exitDx=0;exitDy=0;entryX=0;entryY=0.5;entryDx=0;entryDy=0;rounded=1;" target="extjs" value="VS Code API&#xa;(read / write)">
          <mxGeometry relative="1" x="0.04" as="geometry">
            <mxPoint as="offset" />
          </mxGeometry>
        </mxCell>
        <mxCell id="e2" edge="1" parent="vscode" source="extmod" style="endArrow=classic;startArrow=classic;html=0;fontSize=9;exitX=0.5;exitY=1;exitDx=0;exitDy=0;entryX=0.5;entryY=0;entryDx=0;entryDy=0;rounded=1;edgeStyle=orthogonalEdgeStyle;" target="wv" value="postMessage&#xa;(updateContent, diagramEdited&#xa; textEdited, diagramResized)">
          <mxGeometry relative="1" as="geometry">
            <mxPoint as="offset" />
          </mxGeometry>
        </mxCell>
        <mxCell id="cloud" parent="1" style="ellipse;shape=cloud;whiteSpace=wrap;html=0;fillColor=#d5e8d4;strokeColor=#82b366;fontSize=11;verticalAlign=middle;align=center;" value="embed.diagrams.net&#xa;(draw.io editor)" vertex="1">
          <mxGeometry height="80" width="230" x="270" y="570" as="geometry" />
        </mxCell>
        <mxCell id="e3" edge="1" parent="1" source="wv" style="endArrow=classic;html=0;fontSize=10;dashed=1;exitX=0.5;exitY=1;exitDx=0;exitDy=0;entryX=0.5;entryY=0;entryDx=0;entryDy=0;rounded=1;" target="cloud" value="iframe src">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
```
## System Overview

A simpler example showing a basic client-server architecture:

```drawio
<mxfile>
  <diagram id="arch-overview" name="Architecture">
    <mxGraphModel dx="321" dy="807" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1169" pageHeight="827" math="0" shadow="0">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
        <mxCell id="2" parent="1" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;" value="Client" vertex="1">
          <mxGeometry height="60" width="120" x="120" y="80" as="geometry" />
        </mxCell>
        <mxCell id="3" parent="1" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#f8cecc;strokeColor=#b85450;" value="API Server" vertex="1">
          <mxGeometry height="60" width="120" x="340" y="80" as="geometry" />
        </mxCell>
        <mxCell id="4" parent="1" style="shape=cylinder3;whiteSpace=wrap;html=1;boundedLbl=1;backgroundOutline=1;size=15;fillColor=#fff2cc;strokeColor=#d6b656;" value="Database" vertex="1">
          <mxGeometry height="90" width="100" x="560" y="65" as="geometry" />
        </mxCell>
        <mxCell id="5" edge="1" parent="1" source="2" style="endArrow=classic;html=1;" target="3" value="">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
        <mxCell id="6" edge="1" parent="1" source="3" style="endArrow=classic;html=1;" target="4" value="">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
```
## Locked Diagram Example

This diagram is locked to prevent accidental changes:

```drawio locked
<mxfile>
  <diagram id="locked-example" name="Locked">
    <mxGraphModel>
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
        <mxCell id="2" value="This diagram is locked" style="text;html=1;align=center;verticalAlign=middle;resizable=0;points=[];autosize=1;" vertex="1" parent="1">
          <mxGeometry x="100" y="100" width="160" height="30" as="geometry"/>
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
```

## HTML Comment Format

You can also use HTML comment syntax:

<!-- drawio:start -->
<mxfile>
  <diagram id="comment-format" name="Comment Style">
    <mxGraphModel>
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
        <mxCell id="2" value="Hello World" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="1">
          <mxGeometry x="100" y="100" width="120" height="60" as="geometry"/>
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
<!-- drawio:end -->

## Regular Content

This is just regular markdown content between diagrams. The extension only
activates on the diagram blocks above.
