#!/bin/bash
# Builds build/CamSnap.app (ad-hoc signed) with swiftc. No Xcode project needed.
set -euo pipefail
cd "$(dirname "$0")"

APP=build/CamSnap.app
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
cp Info.plist "$APP/Contents/Info.plist"

swiftc -O -swift-version 5 \
  -target "$(uname -m)-apple-macos14.0" \
  -framework AppKit -framework AVFoundation -framework CoreImage -framework Network \
  -o "$APP/Contents/MacOS/CamSnap" CamSnap.swift

# Ad-hoc signature. The camera grant is keyed to the bundle id plus this
# signature, so a rebuild may make macOS ask again.
codesign -s - --force --deep --identifier local.pimapper.camsnap "$APP"
codesign --verify --verbose=1 "$APP"
echo "built $(pwd)/$APP"
