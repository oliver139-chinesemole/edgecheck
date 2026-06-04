import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Disclaimer } from './components/Disclaimer'
import { BackendStatus } from './components/BackendStatus'
import SmartMoney from './pages/SmartMoney'
import Backtest from './pages/Backtest'
import Simulation from './pages/Simulation'
import ImprovementLog from './pages/ImprovementLog'

function Nav() {
  return (
    <nav className="navbar">
      <span className="navbar-brand">EdgeCheck</span>
      <NavLink to="/" end className={({ isActive }) => `nav-tab${isActive ? ' active' : ''}`}>
        Smart Money
      </NavLink>
      <NavLink to="/backtest" className={({ isActive }) => `nav-tab${isActive ? ' active' : ''}`}>
        Strategy &amp; Backtest
      </NavLink>
      <NavLink to="/simulation" className={({ isActive }) => `nav-tab${isActive ? ' active' : ''}`}>
        Live Paper Sim
      </NavLink>
      <NavLink to="/improvement" className={({ isActive }) => `nav-tab${isActive ? ' active' : ''}`}>
        Improvement Log
      </NavLink>
      <div className="navbar-spacer" />
      <BackendStatus />
    </nav>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <div className="app-shell">
        <Nav />
        <main className="main-content">
          <ErrorBoundary>
            <Routes>
              <Route path="/" element={<SmartMoney />} />
              <Route path="/backtest" element={<Backtest />} />
              <Route path="/simulation" element={<Simulation />} />
              <Route path="/improvement" element={<ImprovementLog />} />
            </Routes>
          </ErrorBoundary>
        </main>
        <Disclaimer />
      </div>
    </BrowserRouter>
  )
}
