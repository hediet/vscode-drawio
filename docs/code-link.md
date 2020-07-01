# VS Code Draw.io Integration - Code Links (Since 0.7.2)

The Code Link feature lets you link Draw.io nodes and edges to source code symbols.
Just name a node or edge `#MySymbol` where `MySymbol` is the name of the symbol you want to link to.
When code link is enabled (see the status bar) and you double click on a node or edge which such a label, you will jump to the symbol definition.

![](./demo-code-link.gif)

Disable Code Link or select a node and press F2 if you want to change the label.

## Link Screenshots with Symbols

Since you can directly paste images into Draw.io diagrams, you can use this feature to connect
screenshots of react components to their source:

![](./code-link-with-screenshots.gif)

## Applications

This feature can be used in many ways:

-   for documentation
-   for quick code navigation (like visual bookmarks)
-   for diagram based code tours
