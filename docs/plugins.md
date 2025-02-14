# VS Code Draw.io Integration - plugins

The plugins feature lets you load Draw.io plugins, just as you can by opening
the online version of Draw.io with the `?p=svgdata` query parameter:
<https://www.draw.io/?p=svgdata>.

Draw.io has a list of [sample plugins](https://www.drawio.com/doc/faq/plugins)
which can be copied, or you may create your own.

## Enabling a plugin in the Draw.io Integration

Plugins currently needs to be loaded from an absolute path in the Draw.io
Integration extension.  Thus for compatibility reasons (e.g., in a repository
shared between multiple people), the plugin likely needs to be added to the
workspace folder where your diagrams are located as well.  To facilitate this,
the path can be specified using the `${workspaceFolder}` variable, effectively
allowing you to specify a relative path within your workspace.

Plugins are added using the `hediet.vscode-drawio.plugins` configuration
property.  Adding this to the workspace settings makes sure that the plugin is
automatically loaded for anyone that edits Draw.io files inside this workspace.

Example:

1. Download the Draw.io sample plugin `svgdata.js`, and place it in the root of
   the workspace.

1. Add the following to the workspace settings:

    ```json
    "hediet.vscode-drawio.plugins": [
        {
            "file": "${workspaceFolder}/svgdata.js"
        }
    ],
    ```

1. Open any Draw.io file

1. Accept or deny loading of the plugin

    If this is the first time after adding the plugin definition, or if the
    plugin was changed, then the Draw.io Integration will show you a dialogue
    box, asking you to allow or disallow loading of the given plugin.

    What ever action you choose, is written to the
    `hediet.vscode-drawio.knownPlugins` property, in the user settings (scope)
    by the Draw.io Integration extension.

    Your decision is explicitly only read and written to the user scope, to
    ensure that a redistributed workspace can't load a plugin without you
    previously having accepted the specific version of a plugin (determined
    through the hash of the file).

    Example:

    ```json
    "hediet.vscode-drawio.knownPlugins": [
        {
            "pluginId": "file:///full/path/to/workspace/svgdata.js",
            "fingerprint": "<sha256>",
            "allowed": true // or false if you disallowed it
        }
    ],
    ```