import { useId } from 'react';

/** useId() without the colons, so it is safe inside url(#…) references. */
export function useSvgId(prefix: string) {
  return `${prefix}-${useId().replace(/:/g, '')}`;
}
