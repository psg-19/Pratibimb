import { useEffect, useRef, type ReactNode } from 'react';

/** Modal sheet on the native <dialog> element (focus trap, Escape and backdrop handled by the browser). */
export function Sheet({ open, onClose, title, children, labelId }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; labelId: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    // Clicking the backdrop closes the sheet; keyboard users have Escape and the Close button.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
    <dialog
      ref={ref}
      className="sheet"
      aria-labelledby={labelId}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      {open ? (
        <div className="sheet__body">
          <div className="sheet__head">
            <h2 id={labelId} className="display sheet__title">
              {title}
            </h2>
            <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
              ×
            </button>
          </div>
          {children}
        </div>
      ) : null}
    </dialog>
  );
}
