import { Outlet } from 'react-router-dom'
import { ToastContainer } from 'react-toastify'
import 'react-toastify/dist/ReactToastify.css'
import Header from './Header'

export default function Layout() {
  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <main className="p-6 max-w-7xl mx-auto">
        <Outlet />
      </main>
      <ToastContainer position="bottom-right" autoClose={3000} />
    </div>
  )
}
