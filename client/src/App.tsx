import { useTranslation } from 'react-i18next'
import { Route, Routes } from 'react-router'
import { HealthCheck } from './HealthCheck'

function HomePage() {
  const { t } = useTranslation()
  return (
    <>
      <p>{t('app.name')}</p>
      <HealthCheck />
    </>
  )
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
    </Routes>
  )
}

export default App
