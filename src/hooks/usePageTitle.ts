import { useEffect } from 'react';
import { APP_NAME } from '../config';

export function usePageTitle(title: string) {
  useEffect(() => {
    document.title = `${APP_NAME} — ${title}`;
  }, [title]);
}
