#!/bin/sh
# Copies the draw.io editor (src/main/webapp) plus the DrawKit flow files
# into the Swift Playgrounds app package. Run again after changing either.
set -e
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SRC="$ROOT/src/main/webapp"
DEST="$ROOT/apple/DrawKit.swiftpm/Resources/webapp"

rm -rf "$DEST"
mkdir -p "$DEST"

# Copies everything, then removes server files, development sources,
# source maps and the service worker, which the app does not use.
cp -R "$SRC/." "$DEST/"
(cd "$DEST" && rm -rf WEB-INF META-INF js/diagramly js/grapheditor \
	js/integrate.min.js js/viewer-static.min.js connect onedrive3.html teams.html \
	service-worker.js workbox-*.js && find . -name '*.map' -delete)

# editor.html is index.html with the flow plugin added
sed 's#<script src="js/bootstrap.js"></script>#<script src="drawkit/flow.js"></script>\n\t<script src="js/bootstrap.js"></script>#' \
	"$SRC/index.html" > "$DEST/editor.html"
grep -q 'drawkit/flow.js' "$DEST/editor.html" || { echo "Could not add plugin to editor.html" >&2; exit 1; }

mkdir -p "$DEST/drawkit"
cp "$ROOT/apple/web/flow.js" "$DEST/drawkit/flow.js"
cp "$ROOT/apple/web/host.html" "$DEST/host.html"
du -sh "$DEST"
