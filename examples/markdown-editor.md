# Markdown Editor integration

Open this file with **Reopen Editor With... > Markdown Editor**, using the local
VS Code build that supports code-block editor contributions. Do not select
**Markdown with Diagrams**: that is the extension's separate editor.

https://test.de

The fence below opens the bundled Draw.io app. Edit a shape or its label, then
reopen this file as text to inspect the saved XML. The editor fits the diagram;
add `height=520` after `drawio` to give it a fixed height.

Set **Draw.io Appearance** to **automatic** to follow the Markdown editor theme.
Loading the diagram or changing its readonly state must not steal focus from
the surrounding document.

```drawio
<mxfile>
  <diagram id="LPaIzZ5yn2ptYaPh8wQi" name="Page-1">
    <mxGraphModel dx="2" dy="128" grid="0" gridSize="10" guides="1" tooltips="0" connect="1" arrows="1" fold="1" page="0" pageScale="1" pageWidth="850" pageHeight="1100" math="0" shadow="0">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
        <mxCell id="BmOgo1oCYmphAoBWguAm-2" edge="1" parent="1" source="1lwQK8w1CLprmOX_WymQ-1" style="edgeStyle=none;curved=1;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;exitX=1;exitY=0.5;exitDx=0;exitDy=0;fontSize=12;startSize=8;endSize=8;" target="BmOgo1oCYmphAoBWguAm-1">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
        <mxCell id="1lwQK8w1CLprmOX_WymQ-1" parent="1" value="Draw.io rendering check" vertex="1">
          <mxGeometry height="70" width="200" x="696" y="602" as="geometry" />
        </mxCell>
        <mxCell id="kbDNV8BhDggsa1WAG6eS-1" parent="1" style="whiteSpace=wrap;html=1;" value="uiae" vertex="1">
          <mxGeometry height="60" width="120" x="1025" y="786" as="geometry" />
        </mxCell>
        <mxCell id="AtAy81PZ9W_1pRI0i2EM-1" edge="1" parent="1" source="kbDNV8BhDggsa1WAG6eS-1" style="edgeStyle=none;curved=1;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;exitX=0.5;exitY=0;exitDx=0;exitDy=0;entryX=0.535;entryY=1.043;entryDx=0;entryDy=0;entryPerimeter=0;fontSize=12;startSize=8;endSize=8;" target="1lwQK8w1CLprmOX_WymQ-1">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
        <mxCell id="BmOgo1oCYmphAoBWguAm-1" parent="1" style="whiteSpace=wrap;html=1;" value="Foobar" vertex="1">
          <mxGeometry height="60" width="120" x="1145" y="607" as="geometry" />
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>

```


 # Task progress

# Task progress

# Task progress

# Task progress

The built-in widget tracks task-list items throughout this document:

```widget:task-progress
```

- [x] Open the Markdown Editor
- [x] Add a Draw.io shape
- [x] Resize the diagram
- [x] Save and reopen the document
