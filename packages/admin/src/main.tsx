import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider, createHashRouter, Navigate } from 'react-router-dom'
import './theme/tokens.css'
import { Shell } from './components/Shell'
import { AdminGate } from './components/AdminGate'
import { SuperadminDoor } from './components/SuperadminDoor'
import { Billing } from './screens/Billing'
import { Bills } from './screens/Bills'
import { Reports } from './screens/Reports'
import { Dashboard } from './screens/Dashboard'
import { Devices } from './screens/Devices'
import { Expenses } from './screens/Expenses'
import { Floor } from './screens/Floor'
import { Licence } from './screens/Licence'
import { Masters } from './screens/Masters'
import { OrderEntry } from './screens/OrderEntry'
import { Settings } from './screens/Settings'
import { Shift } from './screens/Shift'

// Hash routing: Electron loads the built files from disk, where path routing
// would 404 on refresh.
const router = createHashRouter([
  {
    path: '/',
    element: <Shell />,
    children: [
      // The floor is home — see Login, which also lands there after every sign-in.
      { index: true, element: <Navigate to="/floor" replace /> },
      { path: 'billing', element: <Billing /> },
      { path: 'floor', element: <Floor /> },
      { path: 'order/new', element: <OrderEntry /> },
      { path: 'order/:id', element: <OrderEntry key="add" /> },
      { path: 'bills', element: <Bills /> },
      { path: 'expenses', element: <Expenses /> },
      { path: 'dashboard', element: <Dashboard /> },
      { path: 'reports', element: <Reports /> },
      { path: 'masters', element: <AdminGate area="setup"><Masters /></AdminGate> },
      { path: 'settings', element: <AdminGate area="settings"><Settings /></AdminGate> },
      { path: 'devices', element: <AdminGate area="devices"><Devices /></AdminGate> },
      { path: 'licence', element: <AdminGate area="licence"><Licence /></AdminGate> },
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
