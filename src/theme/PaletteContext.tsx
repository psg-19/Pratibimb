import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { DEFAULT_PALETTE, PALETTES, type PaletteId } from './palettes.gen';

const STORAGE_KEY = 'pratibimb.palette';

const isPaletteId = (v: unknown): v is PaletteId => PALETTES.some((p) => p.id === v);

interface PaletteContextValue {
  palette: PaletteId;
  setPalette: (id: PaletteId) => void;
}

const PaletteContext = createContext<PaletteContextValue>({
  palette: DEFAULT_PALETTE,
  setPalette: () => {},
});

export function PaletteProvider({ children }: { children: ReactNode }) {
  const [palette, setPalette] = useLocalStorage<PaletteId>(STORAGE_KEY, DEFAULT_PALETTE, isPaletteId);

  // Mirror onto <html> so the page background and overscroll match the app root.
  useEffect(() => {
    document.documentElement.dataset.palette = palette;
  }, [palette]);

  return <PaletteContext.Provider value={{ palette, setPalette }}>{children}</PaletteContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export const usePalette = () => useContext(PaletteContext);
