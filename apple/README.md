# DrawKit for iPad

DrawKit is the draw.io editor turned into an automation app. You draw a flow and give shapes actions; connectors set the order the steps run in. What a shape looks like doesn't matter.

## Install on the iPad (Swift Playgrounds)

1. Install **Swift Playgrounds** from the App Store (it's free).
2. Save `DrawKit.swiftpm.zip` to the **Files** app, then tap it once to unzip it.
3. Tap the **DrawKit.swiftpm** folder. It opens in Swift Playgrounds.
4. Tap **▶ Run** (top-left). The first build takes a minute.
5. If a red error appears, copy the error text and send it to Claude.

## Using it

- Tap **+** to create a flow, then draw shapes and connect them.
- Select a shape and tap **Action** (the ⚡ button). You can also long-press the shape and choose **Action**, or double-tap a shape that already has one. Pick what the step does.
- Tap **▶ Run**. The step that is running is outlined in green. Tap **Log** to see each step's output.

### Apple Pencil and the puck

- The round **puck** floats over the canvas. On its own, the Pencil only draws ink and never selects anything.
- **Hold the puck** with a finger of your other hand, and the Pencil selects, moves and connects shapes.
- Fingers work as usual (tap to select, two fingers to scroll and zoom).
- Drag the puck to move it. **Double-tap** it to switch the Pencil to always selecting, and double-tap again to switch back.

### Rules

- A flow starts at its **Start** shape. With no Start shape, it starts at every shape that has an action and no incoming connector.
- Each step receives the previous step's output as `{{input}}`. **Set Variable** stores a value, and you use it in later steps as `{{name}}`.
- For an **If** step, label its outgoing connectors `yes` and `no`. Connectors without a label always run.
- Connecting back to an earlier shape makes a loop. A flow stops after 10,000 steps.

### Actions

| Group | Actions |
|---|---|
| Flow | Start, If, Wait, Stop Flow |
| Data | Text, Set Variable, Get Variable, Calculate, Run JavaScript |
| Interaction | Ask for Input, Show Result, Show Notification, Copy to Clipboard, Get Clipboard |
| Apple | Run Shortcut, Open URL |
| Web | Web Request |

### Run Shortcut and getting results back

DrawKit opens the Shortcuts app and runs the shortcut you named. An app built in Swift Playgrounds can't register its own link, so the shortcut sends its result back through the clipboard:

1. At the end of your shortcut, add **Copy to Clipboard**.
2. After that, add **Open App** and choose **Swift Playgrounds**.
3. In DrawKit, set the step's Output to **Wait for clipboard**. The result becomes `{{input}}` for the next step. iPadOS may ask you to allow pasting.

Pick **Do not wait** if the shortcut doesn't need to return anything.

## For developers

- `web/flow.js`: the action registry, the flow runner and the editor UI (a draw.io plugin).
- `web/host.html`: hosts the editor in embed mode and connects it to Swift.
- `DrawKit.swiftpm`: the SwiftUI app, which also opens in Xcode on a Mac.
- `scripts/build-webapp.sh`: copies `src/main/webapp` and the `web` files into `DrawKit.swiftpm/Resources/webapp`. Run it after changing either.

Flows are saved as `.drawio` files in the app's Documents/Flows folder.
