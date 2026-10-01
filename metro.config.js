// expo-sqlite ships a WebAssembly build for the browser; Metro only treats a
// handful of extensions as assets, so `./wa-sqlite/wa-sqlite.wasm` failed to
// resolve and the whole bundle fell over. One extension is the entire change.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver.assetExts.push('wasm');

module.exports = config;
