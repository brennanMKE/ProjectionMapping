#!/usr/bin/env bash
# Build projlight.apk without Gradle: javac + d8 + aapt2 + apksigner.
# Needs a JDK (17+) and the Android SDK with platforms;android-30 and
# build-tools;30.0.3 (ANDROID_HOME, default ~/Library/Android/sdk).
#
#   android/projlight/build.sh            -> android/projlight/out/projlight.apk
#   adb install -r android/projlight/out/projlight.apk
set -euo pipefail
cd "$(dirname "$0")"

SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
BT="$SDK/build-tools/${BUILD_TOOLS:-30.0.3}"
JAR="$SDK/platforms/android-30/android.jar"
[[ -f "$JAR" ]] || { echo "missing $JAR (sdkmanager 'platforms;android-30')" >&2; exit 1; }
[[ -x "$BT/aapt2" ]] || { echo "missing $BT (sdkmanager 'build-tools;30.0.3')" >&2; exit 1; }

rm -rf out && mkdir -p out/classes out/dex
"$BT/aapt2" link -o out/base.apk --manifest AndroidManifest.xml -I "$JAR" --min-sdk-version 30 --target-sdk-version 30
# (no mapfile: macOS ships bash 3.2; paths here have no spaces)
find src -name '*.java' > out/sources.txt
javac --release 11 -classpath "$JAR" -d out/classes @out/sources.txt
find out/classes -name '*.class' -print0 | xargs -0 "$BT/d8" --min-api 30 --lib "$JAR" --output out/dex
cp out/base.apk out/unsigned.apk
(cd out/dex && zip -q -j ../unsigned.apk classes.dex)
"$BT/zipalign" -f 4 out/unsigned.apk out/aligned.apk

KS="${KEYSTORE:-$HOME/.android/debug.keystore}"
if [[ ! -f "$KS" ]]; then
  mkdir -p "$(dirname "$KS")"
  keytool -genkeypair -keystore "$KS" -storepass android -keypass android -alias androiddebugkey \
    -dname "CN=Android Debug,O=Android,C=US" -keyalg RSA -keysize 2048 -validity 10000 >/dev/null
fi
"$BT/apksigner" sign --ks "$KS" --ks-pass pass:android --key-pass pass:android --out out/projlight.apk out/aligned.apk
echo "built $(pwd)/out/projlight.apk"
