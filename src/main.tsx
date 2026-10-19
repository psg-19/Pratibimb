import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { router } from './router';
import { PaletteProvider } from './theme/PaletteContext';
import './styles/global.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PaletteProvider>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </PaletteProvider>
  </StrictMode>,
);
