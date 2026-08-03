import { useTranslation } from 'react-i18next'
import { Route, Routes } from 'react-router'
import { AppShell } from './components/layout/AppShell'

function HomePage() {
  const { t } = useTranslation()
  return <h1 className="px-7 py-8 text-2xl font-semibold text-text-ink">{t('app.name')}</h1>
}

function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<HomePage />} />
      </Routes>
    </AppShell>
  )
}

export default App
