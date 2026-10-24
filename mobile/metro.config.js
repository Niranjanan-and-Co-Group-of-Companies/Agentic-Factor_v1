// The app shares the API's contracts with the website (../src/lib/contracts, imported as @contracts), so
// Metro must be able to read that folder.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);
config.watchFolders = [...(config.watchFolders ?? []), path.resolve(__dirname, '../src/lib/contracts')];

module.exports = config;
