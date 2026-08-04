import { Route, Routes } from 'react-router'
import { AppShell } from './components/layout/AppShell'
import { OverlayShowcase } from './components/dev/OverlayShowcase'
import { CatalogShowcase } from './components/dev/CatalogShowcase'
import { HomePage } from './pages/HomePage'
import { CatalogPage } from './pages/CatalogPage'

function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/catalog" element={<CatalogPage />} />
        {/*
          Dev-only. Vite substitutes `false` for import.meta.env.DEV in a
          production build, so this branch and the OverlayShowcase import
          above become dead code and are tree-shaken out — the route is not
          merely unreachable in production, the component is not shipped.
          Verified by grepping dist/.
        */}
        {import.meta.env.DEV && <Route path="/ui-showcase" element={<OverlayShowcase />} />}
        {import.meta.env.DEV && <Route path="/catalog-showcase" element={<CatalogShowcase />} />}
      </Routes>
    </AppShell>
  )
}

export default App
