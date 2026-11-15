import { createContext, useContext } from 'react';
import type { Artifact } from '../connection/contracts';

interface Viewer {
  open(file: Artifact): void;
}

export const ViewerContext = createContext<Viewer>({ open: () => {} });

export const useFileViewer = () => useContext(ViewerContext);
