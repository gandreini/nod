const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const repo = path.resolve(__dirname, '../..');
const config = getDefaultConfig(__dirname);
config.watchFolders = [
  path.join(repo, 'src/shared'),
  path.join(repo, 'src/web/lib'),
  path.join(repo, 'src/web/components'),
];
config.resolver.nodeModulesPaths = [path.join(__dirname, 'node_modules')];
config.resolver.disableHierarchicalLookup = true;
module.exports = config;
