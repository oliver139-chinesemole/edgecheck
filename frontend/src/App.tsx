import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import { ErrorBoundary } from './components/ErrorBoundary'
import SmartMoney from './pages/SmartMoney'
import Backtest from './pages/Backtest'
import Simulation from './pages/Simulation'
import ImprovementLog from './pages/ImprovementLog'
import HumanSimulator from './pages/HumanSimulator'
import LearningEnginePage from './pages/LearningEngine'
import SimulatorLanding from './pages/simulator/Landing'
import CreateGame from './pages/simulator/CreateGame'
import GameLayout from './pages/simulator/GameLayout'
import GameOverview from './pages/simulator/GameOverview'
import TradePage from './pages/simulator/TradePage'
import PortfolioPage from './pages/simulator/PortfolioPage'
import LeaderboardPage from './pages/simulator/LeaderboardPage'
import RulesPage from './pages/simulator/RulesPage'

function Nav() {
  return (
    <nav className="navbar" role="navigation" aria-label="Main navigation">
      <NavLink to="/" className="nav-brand" aria-label="EdgeCheck home">
        <div className="nav-brand-mark" aria-hidden="true">EC</div>
        <span className="nav-brand-text"><em>Edge</em>Check</span>
      </NavLink>
      {(
        [
          ['/', 'Smart Money'],
          ['/backtest', 'Backtest'],
          ['/simulation', 'Simulation'],
          ['/improvement', 'Improvement Log'],
          ['/market-sim', 'Market Sim'],
          ['/paper-trading', 'Paper Trading'],
          ['/learning', 'Learning Engine'],
        ] as [string, string][]
      ).map(([to, label]) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          className={({ isActive }) => `nav-tab${isActive ? ' active' : ''}`}
        >
          <span className="tab-label">{label}</span>
        </NavLink>
      ))}
      <div className="nav-spacer" />
      <a
        href="https://github.com/oliver139-chinesemole/edgecheck"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="View EdgeCheck source on GitHub"
        style={{ fontSize: '0.78rem', color: 'var(--text-lo)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>
        GitHub
      </a>
    </nav>
  )
}

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <div className="app-shell">
        <Nav />
        <div className="disclaimer-bar" role="banner" aria-label="Important disclaimer">
          <span className="disclaimer-icon" aria-hidden="true">⚠</span>
          <strong>NOT FINANCIAL ADVICE.</strong>
          <span>EdgeCheck is a research tool. Its most likely honest result is no durable edge. Do not trade real money based on anything shown here.</span>
        </div>
        <main className="main" role="main">
          <ErrorBoundary>
            <Routes>
              {/* Original EdgeCheck pages */}
              <Route path="/" element={<SmartMoney />} />
              <Route path="/backtest" element={<Backtest />} />
              <Route path="/simulation" element={<Simulation />} />
              <Route path="/improvement" element={<ImprovementLog />} />
              <Route path="/paper-trading" element={<HumanSimulator />} />
              <Route path="/learning" element={<LearningEnginePage />} />

              {/* Market Simulator */}
              <Route path="/market-sim" element={<SimulatorLanding />} />
              <Route path="/market-sim/create" element={<CreateGame />} />
              <Route path="/market-sim/game/:gameId" element={<GameLayout />}>
                <Route index element={<GameOverview />} />
                <Route path="trade"       element={<TradePage />} />
                <Route path="portfolio"   element={<PortfolioPage />} />
                <Route path="leaderboard" element={<LeaderboardPage />} />
                <Route path="rules"       element={<RulesPage />} />
              </Route>
            </Routes>
          </ErrorBoundary>
        </main>
      </div>
    </BrowserRouter>
  )
}
