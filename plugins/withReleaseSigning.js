/**
 * Signs the Android release build with this app's own key.
 *
 * Expo's generated `android/app/build.gradle` signs **release** with the
 * template's debug keystore — the line arrives with its own warning comment.
 * That produces an APK anyone could re-sign with the well-known
 * `androiddebugkey`, which is a debug artifact rather than a release one.
 *
 * This plugin wires the release buildType to the credentials in
 * `keystore.properties` (repo root, gitignored), which is the standard React
 * Native layout. It is a plugin rather than a hand edit because
 * `expo prebuild --clean` regenerates the whole native folder — a patch would
 * silently vanish on the next prebuild and the next APK would quietly be
 * debug-signed.
 *
 * The keystore lives *outside* `android/` for the same reason: `--clean`
 * deletes that folder, and losing a signing key is losing the ability to ship
 * an update users can install over the last one.
 *
 * It fails loudly if the template it is patching has changed, because a
 * silently debug-signed release is exactly the failure this exists to prevent.
 */
const fs = require('fs');
const path = require('path');
const { withAppBuildGradle } = require('expo/config-plugins');

const DEBUG_SIGNING_CONFIG = `    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }`;

const RELEASE_SIGNING_CONFIG = `    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
        release {
            if (keystorePropertiesFile.exists()) {
                storeFile new File(projectRoot, keystoreProperties['storeFile'])
                storePassword keystoreProperties['storePassword']
                keyAlias keystoreProperties['keyAlias']
                keyPassword keystoreProperties['keyPassword']
            } else {
                // No credentials supplied: keep the project buildable and say
                // so loudly instead of failing the build silently.
                logger.warn("keystore.properties not found - release APK is signed with the DEBUG key")
                storeFile file('debug.keystore')
                storePassword 'android'
                keyAlias 'androiddebugkey'
                keyPassword 'android'
            }
        }
    }`;

const CAUTION = `            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug`;

const RELEASE_USE = `            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.release`;

const LOADER = `// Release signing credentials, read from the project root so the keys survive
// a \`prebuild --clean\` (which deletes this folder). See plugins/withReleaseSigning.js.
def keystorePropertiesFile = new File(projectRoot, "keystore.properties")
def keystoreProperties = new Properties()
if (keystorePropertiesFile.exists()) {
    keystorePropertiesFile.withInputStream { keystoreProperties.load(it) }
}

android {`;

function withReleaseSigning(config) {
  return withAppBuildGradle(config, (modConfig) => {
    const { language, contents } = modConfig.modResults;
    if (language !== 'groovy') {
      throw new Error('withReleaseSigning: android/app/build.gradle is not groovy; refusing to ship an unsigned-by-default release.');
    }
    let src = contents;

    if (src.includes('keystorePropertiesFile')) {
      return modConfig; // already applied
    }
    if (!src.includes(DEBUG_SIGNING_CONFIG)) {
      throw new Error('withReleaseSigning: the generated signingConfigs block no longer matches the template this plugin patches. Refusing to continue so a release build cannot silently fall back to the debug key.');
    }
    if (!src.includes(CAUTION)) {
      throw new Error('withReleaseSigning: the release buildType block no longer matches the template this plugin patches. Refusing to continue so a release build cannot silently fall back to the debug key.');
    }
    if (!src.includes('\nandroid {')) {
      throw new Error('withReleaseSigning: could not find the android block to insert the keystore loader.');
    }

    src = src.replace(DEBUG_SIGNING_CONFIG, RELEASE_SIGNING_CONFIG);
    src = src.replace(CAUTION, RELEASE_USE);
    src = src.replace('\nandroid {', `\n${LOADER}`);

    // The credential file must exist at build time; warn early rather than
    // discovering it during the Gradle run.
    const projectRoot = path.resolve(__dirname, '..');
    if (!fs.existsSync(path.join(projectRoot, 'keystore.properties'))) {
      // eslint-disable-next-line no-console
      console.warn('[withReleaseSigning] keystore.properties is missing: the release APK will fall back to the debug key.');
    }

    modConfig.modResults.contents = src;
    return modConfig;
  });
}

module.exports = withReleaseSigning;
