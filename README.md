# ddlc-html5

Open `index.html` in a browser. Keep the files and the `original` asset folder together. The compiled game runs from the folder without a web server or a Python installation.

Use **Game Files** to remove or restore a virtual character file. For example, select **Remove** beside `monika.chr`. The extracted files stay on disk. The browser stores game progress and virtual file changes when it allows storage for local pages.

At launch, the browser loads the startup artwork, shows the original first-run agreement when needed, then plays the Team Salvato splash and content reminder. The title art, animation tracks, music, and navigation come from the extracted Ren’Py data. Audio starts after a click or keypress. During dialogue, the quick menu provides history, skip, auto-forward, save, load, and settings. Use Settings to adjust text speed or let Skip include unread lines. During dialogue, click once to reveal the rest of the line and again to advance. Browser save slots replay your recorded inputs to restore the saved dialogue or choice. They are stored separately from native Ren’Py saves.

To start fresh, choose **Clear local storage…** in **Game Files** or **Settings** and type `CLEAR DDLC DATA`. This removes the browser port’s saves, progress, virtual character-file changes, dialogue settings, read history, and first-run acknowledgement. The extracted files stay on disk.

## Set up a fresh clone

You need a local installation of the original DDLC, Python 3.10 or newer, and Node.js with npm. From the cloned project, point the extractor at the DDLC folder that contains `game/` and `README.html`.

```sh
python3 tools/unpack.py "/path/to/Doki Doki Literature Club"
python3 tools/export_game.py . src
npx --yes --package typescript@6.0.3 tsc -p tsconfig.json
```

Open `index.html` after compiling. Extracted game data and generated files are excluded from Git.

The browser implements the exported story and screen features it uses. It approximates some Ren’Py animations, transitions, and visual effects. Native rollback, save-file compatibility, and some screen settings are outside the current browser implementation.
