import { useEffect, useId, useRef, useState } from 'react';
import { usePalette } from '../../theme/PaletteContext';
import { PALETTES, type PaletteId } from '../../theme/palettes.gen';

function Swatches({ colors }: { colors: readonly string[] }) {
  return (
    <span className="pal__swatches" aria-hidden="true">
      {colors.map((c, i) => (
        <span key={i} style={{ background: c }} />
      ))}
    </span>
  );
}

/** Global palette setting: a disclosure button with a radio list. Persisted by PaletteProvider. */
export function PaletteSwitcher() {
  const { palette, setPalette } = usePalette();
  const [open, setOpen] = useState(false);
  const [alignLeft, setAlignLeft] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const current = PALETTES.find((p) => p.id === palette) ?? PALETTES[0];

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggle = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    // Open towards whichever side has room (the header wraps on narrow screens).
    setAlignLeft(rect ? rect.right < 320 : false);
    setOpen((o) => !o);
  };

  return (
    <div className="pal" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="pal__btn"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={toggle}
      >
        <Swatches colors={current.swatch.slice(0, 3)} />
        <span>Palette</span>
        <span className="sr-only">: {current.name}</span>
      </button>
      <div id={panelId} className={`pal__panel${alignLeft ? ' pal__panel--left' : ''}`} hidden={!open}>
        <fieldset className="pal__set">
          <legend className="label">Colour palette</legend>
          {PALETTES.map((p) => (
            <label key={p.id} className="pal__opt">
              <input
                type="radio"
                name="palette"
                value={p.id}
                checked={p.id === palette}
                onChange={() => setPalette(p.id as PaletteId)}
              />
              <span className="pal__name">
                {p.name}
                {p.id === 'spectrum' ? <span className="pal__default"> · default</span> : null}
              </span>
              <Swatches colors={p.swatch} />
            </label>
          ))}
        </fieldset>
      </div>
    </div>
  );
}
