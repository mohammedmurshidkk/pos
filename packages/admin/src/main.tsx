import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider, createHashRouter, Navigate } from 'react-router-dom'
import './theme/tokens.css'
import { Shell } from './components/Shell'
import { Billing } from './screens/Billing'
import { Dashboard } from './screens/Dashboard'
import { Masters } from './screens/Masters'
import { Printers } from './screens/Printers'
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
      { path: 'shift', element: <Shift /> },
    ],
  },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
