#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
SHELL_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
HARNESS_ROOT=$(CDPATH= cd -- "$SHELL_ROOT/.." && pwd)
DEFAULT_PLUGIN_ROOT="$HARNESS_ROOT/../DeepSeek Plugin"
PLUGIN_ROOT=${DSH_PLUGIN_DIR:-$DEFAULT_PLUGIN_ROOT}
PLUGIN_ROOT=$(CDPATH= cd -- "$PLUGIN_ROOT" && pwd)
SOURCE_ROOT=${DSH_SOURCE_DIR:-$HARNESS_ROOT}
SOURCE_ROOT=$(CDPATH= cd -- "$SOURCE_ROOT" && pwd)
OUTPUT_ROOT="$SHELL_ROOT/dist"
APP_ROOT="$OUTPUT_ROOT/DeepSeek Harness.app"
ICON_SOURCE="$SHELL_ROOT/Resources/AppIcon.svg"
ICON_WORK=$(mktemp -d)
SNAPSHOT_WORK=""
copy_tracked_files() {
  ROOT=$1
  DESTINATION=$2
  shift 2
  (
    cd "$ROOT"
    git ls-files --cached -z -- "$@" \
      | LC_ALL=C sort -z \
      | COPYFILE_DISABLE=1 /usr/bin/tar --null -cf - -T -
  ) | COPYFILE_DISABLE=1 /usr/bin/tar -xf - -C "$DESTINATION"
}
cleanup() {
  rm -rf "$ICON_WORK"
  if [ -n "$SNAPSHOT_WORK" ]; then rm -rf "$SNAPSHOT_WORK"; fi
}
trap cleanup EXIT

if [ ! -f "$SOURCE_ROOT/apps/cli/package.json" ]; then
  echo "build-app: DSH source not found at $SOURCE_ROOT; set DSH_SOURCE_DIR" >&2
  exit 1
fi
if [ ! -f "$PLUGIN_ROOT/packages/client/ui-plugin-library/package.json" ]; then
  echo "build-app: self-developed plugin source not found at $PLUGIN_ROOT; set DSH_PLUGIN_DIR" >&2
  exit 1
fi

DISTRIBUTION=false
if [ "${1:-}" = "--distribution" ]; then
  DISTRIBUTION=true
elif [ "$#" -ne 0 ]; then
  echo "usage: $0 [--distribution]" >&2
  exit 2
fi

if ! command -v rsvg-convert >/dev/null 2>&1; then
  echo "build-app: rsvg-convert is required (brew install librsvg)" >&2
  exit 1
fi

swift build --package-path "$SHELL_ROOT" -c release

rm -rf "$APP_ROOT"
mkdir -p "$APP_ROOT/Contents/MacOS" "$APP_ROOT/Contents/Resources"
cp "$SHELL_ROOT/.build/release/DeepSeekHarnessDesktop" "$APP_ROOT/Contents/MacOS/DeepSeekHarnessDesktop"
/usr/bin/strip -S "$APP_ROOT/Contents/MacOS/DeepSeekHarnessDesktop"
cp "$SHELL_ROOT/Resources/Info.plist" "$APP_ROOT/Contents/Info.plist"
if [ "$DISTRIBUTION" = true ]; then
  /usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier ai.deepseek.harness.desktop" "$APP_ROOT/Contents/Info.plist"
  /usr/libexec/PlistBuddy -c "Delete :DSHSourceRoot" "$APP_ROOT/Contents/Info.plist"
  /usr/libexec/PlistBuddy -c "Set :DSHSourceRepository https://github.com/eiritsu/DeepSeek-Harness-Desktop.git" "$APP_ROOT/Contents/Info.plist"
  /usr/libexec/PlistBuddy -c "Set :DSHSourceBranch codex/upstream-alpha3-adaptation" "$APP_ROOT/Contents/Info.plist"
  SNAPSHOT_WORK=$(mktemp -d)
  SNAPSHOT_ROOT="$SNAPSHOT_WORK/source"
  mkdir -p "$SNAPSHOT_ROOT"
  copy_tracked_files "$SOURCE_ROOT" "$SNAPSHOT_ROOT" .
  rm -rf \
    "$SNAPSHOT_ROOT/packages/client/ui-plugin-library" \
    "$SNAPSHOT_ROOT/packages/client/ui-deepseek-files" \
    "$SNAPSHOT_ROOT/packages/attachment/file-recognizer-office" \
    "$SNAPSHOT_ROOT/packages/lark/lark" \
    "$SNAPSHOT_ROOT/packages/llm/model-catalog" \
    "$SNAPSHOT_ROOT/desktop-shell"
  copy_tracked_files "$PLUGIN_ROOT" "$SNAPSHOT_ROOT" \
    packages/client/ui-plugin-library \
    packages/client/ui-deepseek-files \
    packages/attachment/file-recognizer-office \
    packages/lark/lark \
    packages/llm/model-catalog
  for PACKAGE in \
    packages/client/ui-plugin-library \
    packages/client/ui-deepseek-files \
    packages/attachment/file-recognizer-office \
    packages/lark/lark \
    packages/llm/model-catalog
  do
    if [ ! -d "$PLUGIN_ROOT/$PACKAGE/lib" ]; then
      echo "build-app: built plugin artifacts are missing at $PLUGIN_ROOT/$PACKAGE/lib; run the plugin build first" >&2
      exit 1
    fi
    mkdir -p "$SNAPSHOT_ROOT/$PACKAGE"
    COPYFILE_DISABLE=1 /bin/cp -R "$PLUGIN_ROOT/$PACKAGE/lib" "$SNAPSHOT_ROOT/$PACKAGE/"
  done
  if [ ! -f "$SOURCE_ROOT/apps/cli/lib/bin.js" ] || [ ! -f "$SOURCE_ROOT/apps/web/dist/index.html" ]; then
    echo "build-app: built Harness artifacts are missing; run pnpm run build before packaging" >&2
    exit 1
  fi
  mkdir -p "$SNAPSHOT_ROOT/apps/cli" "$SNAPSHOT_ROOT/apps/web"
  COPYFILE_DISABLE=1 /bin/cp -R "$SOURCE_ROOT/apps/cli/lib" "$SNAPSHOT_ROOT/apps/cli/"
  COPYFILE_DISABLE=1 /bin/cp -R "$SOURCE_ROOT/apps/web/dist" "$SNAPSHOT_ROOT/apps/web/"
  find "$SOURCE_ROOT/packages" "$SOURCE_ROOT/vendor" \
    -type d -name node_modules -prune -o -type d -name lib -print \
    | while IFS= read -r LIBRARY
      do
        RELATIVE=${LIBRARY#"$SOURCE_ROOT/"}
        mkdir -p "$SNAPSHOT_ROOT/$(dirname "$RELATIVE")"
        COPYFILE_DISABLE=1 /bin/cp -R "$LIBRARY" "$SNAPSHOT_ROOT/$(dirname "$RELATIVE")/"
      done
  # Distribution needs the source and built package faces, not repository
  # governance files, test fixtures, snapshots, or development-only docs.
  # Keeping those out prevents local paths and fixture credentials from
  # crossing into the installed source tree.
  for DIRECTORY in .agents .github docs snapshots website python
  do
    /bin/rm -rf "$SNAPSHOT_ROOT/$DIRECTORY"
  done
  find "$SNAPSHOT_ROOT" -type d -name tests -prune -exec /bin/rm -rf '{}' +
  find "$SNAPSHOT_ROOT" -type f \( -name AGENTS.md -o -name CLAUDE.md \) -delete
  find "$SNAPSHOT_ROOT/scripts" -type f -name '*.spec.ts' -delete
  # These small helpers are imported by the checked-in stress harness and the
  # documentation projection during the ordinary TypeScript build.
  copy_tracked_files "$SOURCE_ROOT" "$SNAPSHOT_ROOT" \
    apps/web/tests/scaffold.ts \
    apps/web/tests/support.ts \
    website/docs.ts
  # Source maps are not needed by the packaged runtime and embed the absolute
  # checkout path of the plugin workspace in their sourcesContent metadata.
  find "$SNAPSHOT_ROOT" -type f -name '*.map' -delete
  node - "$SNAPSHOT_ROOT" "$PLUGIN_ROOT" "$SOURCE_ROOT" <<'NODE'
const fs = require('node:fs')
const path = require('node:path')
const [root, ...prefixes] = process.argv.slice(2)
function visit(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name)
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) visit(file)
    else {
      const before = fs.readFileSync(file)
      const text = before.toString('utf8')
      if (text.includes('\uFFFD')) continue
      const after = prefixes.reduce((value, prefix) => value.replaceAll(prefix, '<bundled-source>'), text)
      if (after !== text) fs.writeFileSync(file, after)
    }
  }
}
visit(root)
NODE
  PLUGIN_LIBRARY_VERSION=$(node -p "require('$PLUGIN_ROOT/packages/client/ui-plugin-library/package.json').version")
  node - "$SNAPSHOT_ROOT/packages/client/ui-plugin-library/package.json" "$PLUGIN_LIBRARY_VERSION" <<'NODE'
const fs = require('node:fs')
const [manifestPath, version] = process.argv.slice(2)
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
manifest.version = version
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
NODE
  node - \
    "$SNAPSHOT_ROOT/packages/boot/app-boot/src/profile.ts" \
    "$SNAPSHOT_ROOT/packages/boot/app-boot/lib/index.js" \
    "$SNAPSHOT_ROOT/packages/boot/app-boot/lib/types/profile.js" <<'NODE'
const fs = require('node:fs')
const paths = process.argv.slice(2)
const replacements = [
  ["bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'],", "bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@deepseek-ai/dsh-client-ui-plugin-library', '@deepseek-ai/dsh-file-recognizer-office', '@deepseek-ai/dsh-lark', '@deepseek-ai/dsh-model-catalog'],"],
  ['bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"],', 'bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@deepseek-ai/dsh-client-ui-plugin-library", "@deepseek-ai/dsh-file-recognizer-office", "@deepseek-ai/dsh-lark", "@deepseek-ai/dsh-model-catalog"],'],
]
for (const path of paths) {
  let source = fs.readFileSync(path, 'utf8')
  for (const [from, to] of replacements) source = source.replace(from, to)
  if (!source.includes('@deepseek-ai/dsh-file-recognizer-office')) {
    throw new Error(`build-app: Web profile template was not found in ${path}`)
  }
  fs.writeFileSync(path, source)
}
NODE
  node - "$SNAPSHOT_ROOT/apps/cli/package.json" <<'NODE'
const fs = require('node:fs')
const path = process.argv[2]
const manifest = JSON.parse(fs.readFileSync(path, 'utf8'))
const dependencies = {
  '@deepseek-ai/dsh-client-ui-plugin-library': 'workspace:^',
  '@deepseek-ai/dsh-client-ui-deepseek-files': 'workspace:^',
  '@deepseek-ai/dsh-file-recognizer-office': 'workspace:^',
  '@deepseek-ai/dsh-lark': 'workspace:^',
  '@deepseek-ai/dsh-model-catalog': 'workspace:^',
}
manifest.dependencies = { ...manifest.dependencies, ...dependencies }
fs.writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`)
NODE
  # The release snapshot has to install the workspace packages and their
  # external runtime dependencies on first launch. Regenerate the lockfile
  # after replacing the plugin workspaces and the release-only Web template.
  (
    cd "$SNAPSHOT_ROOT"
    npx --yes pnpm@11.7.0 install --lockfile-only --ignore-scripts --no-frozen-lockfile \
      --config.confirmModulesPurge=false
  )
  COPYFILE_DISABLE=1 /usr/bin/tar -czf \
    "$APP_ROOT/Contents/Resources/SourceBootstrap.tar.gz" \
    -C "$SNAPSHOT_ROOT" .
else
  /usr/libexec/PlistBuddy -c "Set :DSHSourceRoot $SOURCE_ROOT" "$APP_ROOT/Contents/Info.plist"
fi
# Launch Services caches icons by bundle id and build number. Give every local
# build a fresh numeric version so replacing the App refreshes its icon too.
BUILD_NUMBER=$(date -u +%Y%m%d%H%M%S)
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $BUILD_NUMBER" "$APP_ROOT/Contents/Info.plist"
chmod 755 "$APP_ROOT/Contents/MacOS/DeepSeekHarnessDesktop"

ICON_MASTER="$ICON_WORK/AppIcon.png"
# Quick Look flattens SVG thumbnails onto an opaque white square. Render with
# librsvg so the transparent canvas around the macOS-style rounded plate stays
# transparent all the way into the generated ICNS representations.
rsvg-convert --width 1024 --height 1024 --output "$ICON_MASTER" "$ICON_SOURCE"
ICONSET="$ICON_WORK/AppIcon.iconset"
mkdir -p "$ICONSET"
for SPEC in \
  "16 icon_16x16.png" \
  "32 icon_16x16@2x.png" \
  "32 icon_32x32.png" \
  "64 icon_32x32@2x.png" \
  "128 icon_128x128.png" \
  "256 icon_128x128@2x.png" \
  "256 icon_256x256.png" \
  "512 icon_256x256@2x.png" \
  "512 icon_512x512.png" \
  "1024 icon_512x512@2x.png"
do
  SIZE=${SPEC%% *}
  NAME=${SPEC#* }
  sips -z "$SIZE" "$SIZE" "$ICON_MASTER" --out "$ICONSET/$NAME" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP_ROOT/Contents/Resources/AppIcon.icns"
codesign --force --sign - --timestamp=none "$APP_ROOT"

echo "$APP_ROOT"
