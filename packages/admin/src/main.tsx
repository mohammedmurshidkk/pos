import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider, createHashRouter, Navigate } from 'react-router-dom'
import './theme/tokens.css'
import { Shell } from './components/Shell'
import { SuperadminDoor } from './components/SuperadminDoor'
import { Billing } from './screens/Billing'
import { Dashboard } from './screens/Dashboard'
import { Devices } from './screens/Devices'
import { Licence } from './screens/Licence'
import { Masters } from './screens/Masters'
import { Printers } from './screens/Printers'
import { Settings } from './screens/Settings'
import { Shift } from './screens/Shift'

// Hash routing: Electron loads the built files from disk, where path routing
// would 404 on refresh.
const router = createHashRouter([
  {
    path: '/',
    element: <Shell />,
    children: [
      { index: true, element: <Navigate to="/billing" replace /> },
      { path: 'billing', element: <Billing /> },
      { path: 'dashboard', element: <Dashboard /> },
      { path: 'printers', element: <Printers /> },
      { path: 'masters', element: <Masters /> },
      { path: 'settings', element: <Settings /> },
      { path: 'devices', element: <Devices /> },
      { path: 'licence', element: <Licence /> },
      { path: 'shift', element: <Shift /> },
    ],
  },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Above the router: it must work while the sign-in screen is showing. */}
    <SuperadminDoor />
    <RouterProvider router={router} />
  </StrictMode>,
)
