import { useTranslation } from 'react-i18next'
import { Route, Routes } from 'react-router'
import { AppShell } from './components/layout/AppShell'
import { OverlayShowcase } from './components/dev/OverlayShowcase'
import { CatalogShowcase } from './components/dev/CatalogShowcase'

function HomePage() {
  const { t } = useTranslation()
  return <h1 className="px-7 py-8 text-2xl font-semibold text-text-ink">{t('app.name')}</h1>
}

function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<HomePage />} />
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
