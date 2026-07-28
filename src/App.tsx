import { Routes, Route } from 'react-router-dom'
import Layout from '@/components/layout/Layout'
import Home from '@/pages/Home'
import Detection from '@/pages/Detection'
import Router from '@/pages/Router'
import Weather from '@/pages/Weather'
import History from '@/pages/History'
import Docs from '@/pages/Docs'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Home />} />
        <Route path="/detection" element={<Detection />} />
        <Route path="/router" element={<Router />} />
        <Route path="/weather" element={<Weather />} />
        <Route path="/history" element={<History />} />
        <Route path="/docs" element={<Docs />} />
      </Route>
    </Routes>
  )
}
