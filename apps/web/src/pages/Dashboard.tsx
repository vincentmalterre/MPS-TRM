import { LayoutDashboard } from 'lucide-react'
import { PagePlaceholder } from '@/components/shared/PagePlaceholder'

export function Dashboard() {
  return (
    <PagePlaceholder
      title="Tableau de bord"
      description="Tableau de bord Tricotage Malterre — les widgets (production en cours, défauts récents, stock fil) seront ajoutés au fil de la migration."
      icon={LayoutDashboard}
    />
  )
}
