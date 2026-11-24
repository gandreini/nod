import { join, resolve } from 'node:path';
import { getDefaultConfig } from 'expo/metro-config';

const root = import.meta.dirname;
const repo = resolve(root, '../..');
const base = getDefaultConfig(root);

export default {
  ...base,
  watchFolders: [
    join(repo, 'src/shared'),
    join(repo, 'src/web/lib'),
    join(repo, 'src/web/components'),
  ],
  resolver: {
    ...base.resolver,
    nodeModulesPaths: [join(root, 'node_modules')],
    disableHierarchicalLookup: true,
  },
};
