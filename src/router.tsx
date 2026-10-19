import { createBrowserRouter } from 'react-router-dom';
import { RequireAuth } from './auth/RequireAuth';
import { Layout } from './Layout';
import { Care } from './pages/Care';
import { Connect } from './pages/Connect';
import { Login } from './pages/Login';
import { Messages } from './pages/Messages';
import { NotFound } from './pages/NotFound';
import { Overview } from './pages/Overview';
import { Palettes } from './pages/Palettes';
import { Signup } from './pages/Signup';
import { Simulate } from './pages/Simulate';
import { Twin } from './pages/Twin';

/** One route per screen. Everything except the overview needs a signed-in user. */
export const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <Overview /> },
      { path: '/login', element: <Login /> },
      { path: '/signup', element: <Signup /> },
      { path: '/connect', element: <RequireAuth><Connect /></RequireAuth> },
      { path: '/twin', element: <RequireAuth><Twin /></RequireAuth> },
      { path: '/simulate', element: <RequireAuth><Simulate /></RequireAuth> },
      { path: '/care', element: <RequireAuth only="clinician"><Care /></RequireAuth> },
      { path: '/messages', element: <RequireAuth only="patient"><Messages /></RequireAuth> },
      { path: '/palettes', element: <Palettes /> },
      { path: '*', element: <NotFound /> },
    ],
  },
]);
