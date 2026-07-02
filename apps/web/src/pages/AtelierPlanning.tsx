import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Pencil,
  Plus,
  Printer,
  Repeat,
  Trash2,
  X,
} from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { PopoverSelect } from '@/components/ui/popover-select'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'

// Atelier › Planning — weekly bonnetier schedule grid (legacy FI_Planning_Atelier).
// Rows = active bonnetiers (archivé=0, regleur=0), columns = Dimanche → Samedi.
// One shift per bonnetier per day; the équipe is derived from the start hour.

// ── Types (mirror apps/api/src/routes/planning-atelier.ts) ──

interface Bonnetier {
  IDbonnetier: number
  prenom: string
  nom: string
  regleur: number
}

interface PlanningEntry {
  IDplanning_bonnetier: number
  IDbonnetier: number
  date: string // YYYY-MM-DD
  debut: string // HH:MM
  fin: string // HH:MM
}

interface Desiderata {
  IDdesiderata: number
  date: string // YYYY-MM-DD
  description: string
  IDbonnetier: number
  justifie: number
  declare: number
}

// ── Équipes (shift color language mirrors the legacy PDF legend) ──

interface Equipe {
  id: number
  label: string
  debut: string
  /** Solid pill classes — same solid-color rule as status pills (§29.8). */
  solid: string
}

const EQUIPES: Equipe[] = [
  { id: 1, label: 'Matin', debut: '06:00', solid: 'bg-blue-500 border-blue-500' },
  { id: 2, label: 'Après-Midi', debut: '13:00', solid: 'bg-amber-500 border-amber-500' },
  { id: 3, label: 'Nuit', debut: '21:00', solid: 'bg-violet-600 border-violet-600' },
]

const DUREES = [6, 7, 8]

/** Which équipe a stored entry belongs to, from its start hour. */
function equipeOf(debut: string): Equipe {
  const h = parseInt(debut.slice(0, 2), 10)
  if (h >= 4 && h < 12) return EQUIPES[0]
  if (h >= 12 && h < 20) return EQUIPES[1]
  return EQUIPES[2]
}

// ── Week / date helpers (local-time; the grid week starts on Sunday like legacy) ──

function fmtLocalDate(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

function sundayOf(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  x.setDate(x.getDate() - x.getDay())
  return x
}

function addDays(d: Date, days: number): Date {
  const x = new Date(d)
  x.setDate(x.getDate() + days)
  return x
}

/** ISO week number of the week containing `weekStart`'s Monday. */
function isoWeekNumber(weekStart: Date): number {
  const thursday = addDays(weekStart, 4) // Sunday-start week → its Thursday
  const target = new Date(thursday.getFullYear(), thursday.getMonth(), thursday.getDate())
  const jan4 = new Date(target.getFullYear(), 0, 4)
  const jan4Week = sundayOf(jan4)
  return Math.round((target.getTime() - addDays(jan4Week, 4).getTime()) / (7 * 86_400_000)) + 1
}

const DAY_NAMES = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi']
const MONTH_NAMES = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
]

/** '13:00' + 7h → '20:00' (wraps past midnight for night shifts). */
function addHours(time: string, hours: number): string {
  const h = (parseInt(time.slice(0, 2), 10) + hours) % 24
  return `${String(h).padStart(2, '0')}${time.slice(2)}`
}

/** Snap 'HH:MM' to the nearest quarter hour (planning granularity: 0/15/30/45). */
function snapQuarter(t: string): string {
  const m = t.match(/^(\d{2}):(\d{2})$/)
  if (!m) return t
  let h = parseInt(m[1], 10)
  let min = Math.round(parseInt(m[2], 10) / 15) * 15
  if (min === 60) {
    min = 0
    h = (h + 1) % 24
  }
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

function fmtFr(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString('fr-FR')
}

// ── Page ─────────────────────────────────────────────────

export function AtelierPlanning() {
  const queryClient = useQueryClient()

  const [weekStart, setWeekStart] = useState<Date>(() => sundayOf(new Date()))
  const [editTarget, setEditTarget] = useState<{ bonnetier: Bonnetier; date: string; entry?: PlanningEntry } | null>(null)
  const [fillTarget, setFillTarget] = useState<Bonnetier | null>(null)
  const [clearTarget, setClearTarget] = useState<Bonnetier | null>(null)
  const [desiderataOpen, setDesiderataOpen] = useState(false)
  const [printOpen, setPrintOpen] = useState(false)

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => fmtLocalDate(addDays(weekStart, i))),
    [weekStart],
  )
  const from = days[0]
  const to = days[6]
  const today = fmtLocalDate(new Date())

  const monthLabel = useMemo(() => {
    const thursday = addDays(weekStart, 4)
    return `${MONTH_NAMES[thursday.getMonth()]} ${thursday.getFullYear()}`
  }, [weekStart])

  const { data: bonnetiers, isLoading: loadingBonnetiers, error: bonnetiersError } = useQuery<Bonnetier[]>({
    queryKey: ['atelier-bonnetiers'],
    queryFn: () => apiFetch('/planning-atelier/bonnetiers'),
  })

  const { data: entries, isLoading: loadingEntries } = useQuery<PlanningEntry[]>({
    queryKey: ['atelier-planning', from, to],
    queryFn: () => apiFetch(`/planning-atelier/entries?from=${from}&to=${to}`),
  })

  // (IDbonnetier, date) → entry, for O(1) cell lookups.
  const entryByCell = useMemo(() => {
    const map = new Map<string, PlanningEntry>()
    for (const e of entries ?? []) map.set(`${e.IDbonnetier}|${e.date}`, e)
    return map
  }, [entries])

  const invalidatePlanning = () => queryClient.invalidateQueries({ queryKey: ['atelier-planning'] })

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiFetch(`/planning-atelier/entries/${id}`, { method: 'DELETE' }),
    onSuccess: invalidatePlanning,
  })

  const clearMut = useMutation({
    mutationFn: (bonnetierId: number) =>
      apiFetch('/planning-atelier/entries/clear', {
        method: 'POST',
        body: JSON.stringify({ IDbonnetier: bonnetierId, from, to }),
      }),
    onSuccess: () => {
      invalidatePlanning()
      setClearTarget(null)
    },
  })

  const repeatMut = useMutation({
    mutationFn: (bonnetierId: number) =>
      apiFetch('/planning-atelier/entries/repeat', {
        method: 'POST',
        body: JSON.stringify({ IDbonnetier: bonnetierId, weekStart: from }),
      }),
    onSuccess: invalidatePlanning,
  })

  return (
    <div className="h-full flex flex-col gap-3 min-h-0">
      {/* Toolbar */}
      <div className="flex-shrink-0 flex items-center gap-3 flex-wrap">
        {/* Week navigation */}
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9"
            title="Semaine précédente"
            onClick={() => setWeekStart((w) => addDays(w, -7))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9"
            title="Semaine suivante"
            onClick={() => setWeekStart((w) => addDays(w, 7))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="min-w-0">
          <p className="text-lg font-heading font-bold tracking-tight leading-tight">{monthLabel}</p>
          <p className="text-xs text-muted-foreground">Semaine {isoWeekNumber(weekStart)}</p>
        </div>

        <div className="flex-1" />

        {/* Screen actions — top right */}
        <Button
          variant="outline"
          size="icon"
          className="h-9 w-9"
          title="Desiderata"
          onClick={() => setDesiderataOpen(true)}
        >
          <CalendarClock className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="h-9 w-9"
          title="Imprimer"
          onClick={() => setPrintOpen(true)}
        >
          <Printer className="h-4 w-4" />
        </Button>
      </div>

      {/* Grid card */}
      <div className="flex-1 min-h-0 flex flex-col rounded-lg border border-border/60 bg-white shadow-sm overflow-hidden">
        {/* Header table — does NOT scroll */}
        <table className="w-full text-sm" style={{ tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: '15%' }} />
            {days.map((d) => (
              <col key={d} style={{ width: '11%' }} />
            ))}
            <col style={{ width: '8%' }} />
          </colgroup>
          <thead className="bg-zinc-200/60 border-b border-border/60">
            <tr className="text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2.5 text-left font-semibold">Bonnetier</th>
              {days.map((d, i) => (
                <th
                  key={d}
                  className={cn('px-2 py-2.5 text-center font-semibold whitespace-nowrap', d === today && 'text-accent')}
                >
                  {DAY_NAMES[i]} {parseInt(d.slice(8, 10), 10)}
                </th>
              ))}
              <th className="px-2 py-2.5"></th>
            </tr>
          </thead>
        </table>

        {/* Body table — scrolls */}
        <div className="flex-1 min-h-0 overflow-auto scrollbar-transparent">
          {loadingBonnetiers || loadingEntries ? (
            <div className="h-full flex items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-accent" />
            </div>
          ) : bonnetiersError ? (
            <div className="h-full flex items-center justify-center gap-2 text-destructive text-sm">
              <AlertCircle className="h-4 w-4" />
              Erreur de chargement des bonnetiers
            </div>
          ) : (
            <table className="w-full text-sm" style={{ tableLayout: 'fixed' }}>
              <colgroup>
                <col style={{ width: '15%' }} />
                {days.map((d) => (
                  <col key={d} style={{ width: '11%' }} />
                ))}
                <col style={{ width: '8%' }} />
              </colgroup>
              <tbody>
                {(bonnetiers ?? []).map((b) => {
                  const rowEntries = days
                    .map((d) => entryByCell.get(`${b.IDbonnetier}|${d}`))
                    .filter((e): e is PlanningEntry => e !== undefined)
                  return (
                    <tr key={b.IDbonnetier} className="border-b border-border/40">
                      <td className="px-3 py-2 font-medium truncate" title={`${b.prenom} ${b.nom}`}>
                        {b.prenom} {b.nom}
                      </td>
                      {days.map((d) => {
                        const entry = entryByCell.get(`${b.IDbonnetier}|${d}`)
                        return (
                          <td key={d} className={cn('p-1.5 text-center', d === today && 'bg-accent/[0.04]')}>
                            {entry ? (
                              <div
                                role="button"
                                tabIndex={0}
                                className={cn(
                                  'group relative w-full rounded-md border px-1 py-1.5 text-[11px] font-medium text-white tabular-nums whitespace-nowrap cursor-pointer transition-shadow hover:ring-1 hover:ring-accent',
                                  equipeOf(entry.debut).solid,
                                )}
                                title={`${equipeOf(entry.debut).label} · ${entry.debut} - ${entry.fin} — cliquer pour modifier`}
                                onClick={() => setEditTarget({ bonnetier: b, date: d, entry })}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') setEditTarget({ bonnetier: b, date: d, entry })
                                }}
                              >
                                {entry.debut} - {entry.fin}
                                <button
                                  type="button"
                                  title="Supprimer"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    deleteMut.mutate(entry.IDplanning_bonnetier)
                                  }}
                                  className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-white border border-border shadow-sm text-destructive opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                                >
                                  <X className="h-2.5 w-2.5" />
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                title="Ajouter un créneau"
                                onClick={() => setEditTarget({ bonnetier: b, date: d })}
                                className="group w-full h-7 rounded-md transition-colors hover:bg-accent/10"
                              >
                                <Plus className="h-3.5 w-3.5 mx-auto text-accent opacity-0 group-hover:opacity-100 transition-opacity" />
                              </button>
                            )}
                          </td>
                        )
                      })}
                      <td className="p-1.5">
                        <div className="flex items-center justify-end gap-0.5 pr-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-accent"
                            title="Planifier la semaine"
                            onClick={() => setFillTarget(b)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          {rowEntries.length > 0 && (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground hover:text-accent"
                                title="Dupliquer cette semaine sur la semaine suivante"
                                disabled={repeatMut.isPending}
                                onClick={() => repeatMut.mutate(b.IDbonnetier)}
                              >
                                <Repeat className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-destructive hover:text-destructive"
                                title="Vider la semaine"
                                onClick={() => setClearTarget(b)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Legend footer (mirrors the legacy PDF legend) */}
        <div className="flex-shrink-0 px-3 py-2 border-t border-border/60 bg-zinc-200/50 flex items-center gap-4 text-xs text-muted-foreground">
          {EQUIPES.map((e) => (
            <span key={e.id} className="flex items-center gap-1.5">
              <span className={cn('h-3 w-3 rounded-sm border', e.solid)} />
              {e.label}
            </span>
          ))}
          <span className="ml-auto">
            {(bonnetiers ?? []).length} bonnetier{(bonnetiers ?? []).length > 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* Clear-week confirmation */}
      <ConfirmDialog
        open={clearTarget !== null}
        title="Vider la semaine"
        description={
          clearTarget
            ? `Le planning de ${clearTarget.prenom} ${clearTarget.nom} du ${fmtFr(from)} au ${fmtFr(to)} sera supprimé.`
            : undefined
        }
        isPending={clearMut.isPending}
        onCancel={() => setClearTarget(null)}
        onConfirm={() => {
          if (clearTarget) clearMut.mutate(clearTarget.IDbonnetier)
        }}
      />

      <EditEntryDialog
        target={editTarget}
        onClose={() => setEditTarget(null)}
        onSaved={() => {
          invalidatePlanning()
          setEditTarget(null)
        }}
      />

      <WeekFillDialog
        bonnetier={fillTarget}
        days={days}
        onClose={() => setFillTarget(null)}
        onSaved={() => {
          invalidatePlanning()
          setFillTarget(null)
        }}
      />

      <DesiderataDialog open={desiderataOpen} onClose={() => setDesiderataOpen(false)} bonnetiers={bonnetiers ?? []} />

      {/* Print — placeholder (§18 A-bis) */}
      <Dialog open={printOpen} onOpenChange={setPrintOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Printer className="h-5 w-5 text-accent" />
              Imprimer le planning
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
            <Printer className="h-12 w-12 mb-3 opacity-40" />
            <p className="text-sm font-medium">En developpement</p>
            <p className="text-xs mt-1">Cette fonctionnalite sera disponible prochainement.</p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── Desiderata dialog (legacy FEN_Desiderata) ─────────────

const inputClass =
  'w-full h-9 px-2.5 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring'

// ── Week-fill dialog — per-row shift planning (row Pencil button) ──

const DAY_SHORT = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam']

function WeekFillDialog({
  bonnetier,
  days,
  onClose,
  onSaved,
}: {
  bonnetier: Bonnetier | null
  days: string[] // the visible week, Dimanche → Samedi
  onClose: () => void
  onSaved: () => void
}) {
  const [equipeId, setEquipeId] = useState(1)
  const [duree, setDuree] = useState(7)
  // Work-week default: Lundi → Vendredi pre-selected (legacy Ajouter behavior).
  const [selDays, setSelDays] = useState<Set<number>>(() => new Set([1, 2, 3, 4, 5]))
  // Re-seed when the dialog opens on a different bonnetier.
  const [seededId, setSeededId] = useState<number | null>(null)
  if (bonnetier && bonnetier.IDbonnetier !== seededId) {
    setEquipeId(1)
    setDuree(7)
    setSelDays(new Set([1, 2, 3, 4, 5]))
    setSeededId(bonnetier.IDbonnetier)
  }

  const equipe = EQUIPES.find((e) => e.id === equipeId) ?? EQUIPES[0]
  const fin = addHours(equipe.debut, duree)

  const createMut = useMutation({
    mutationFn: () =>
      apiFetch('/planning-atelier/entries', {
        method: 'POST',
        body: JSON.stringify({
          IDbonnetier: bonnetier!.IDbonnetier,
          entries: [...selDays].sort((a, b) => a - b).map((i) => ({ date: days[i], debut: equipe.debut, fin })),
        }),
      }),
    onSuccess: onSaved,
  })

  if (!bonnetier) return null

  const toggleDay = (i: number) => {
    setSelDays((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="max-w-md" onClose={onClose}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-5 w-5 text-accent" />
            Planifier la semaine
          </DialogTitle>
        </DialogHeader>

        <div className="mt-4 space-y-3">
          <p className="text-sm">
            <span className="font-medium">
              {bonnetier.prenom} {bonnetier.nom}
            </span>
            <span className="text-muted-foreground">
              {' '}— du {fmtFr(days[0])} au {fmtFr(days[6])}
            </span>
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Équipe</label>
              <PopoverSelect
                options={EQUIPES.map((e) => ({ id: e.id, primary: e.label, secondary: e.debut }))}
                value={equipeId}
                onChange={setEquipeId}
                hideEmpty
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Durée</label>
              <PopoverSelect
                options={DUREES.map((d) => ({ id: d, primary: `${d} H` }))}
                value={duree}
                onChange={setDuree}
                hideEmpty
              />
            </div>
          </div>

          {/* Day toggles — gold-pill segmented style, multi-select */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Jours</label>
            <div className="flex flex-wrap gap-1">
              {days.map((d, i) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => toggleDay(i)}
                  className={cn(
                    'px-2 py-1 text-xs rounded-md transition-colors flex-1',
                    selDays.has(i)
                      ? 'bg-accent text-accent-foreground shadow-sm font-medium'
                      : 'text-muted-foreground hover:bg-accent/10',
                  )}
                >
                  {DAY_SHORT[i]} {parseInt(d.slice(8, 10), 10)}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className={cn('h-3 w-3 rounded-sm border', equipe.solid)} />
            {equipe.label} · {equipe.debut} - {fin}
            {selDays.size > 0 && <span>· {selDays.size} jour{selDays.size > 1 ? 's' : ''}</span>}
          </div>
        </div>

        <DialogFooter className="mt-4">
          <Button variant="outline" size="sm" onClick={onClose}>
            Annuler
          </Button>
          <Button size="sm" disabled={selDays.size === 0 || createMut.isPending} onClick={() => createMut.mutate()}>
            {createMut.isPending ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <Plus className="h-3.5 w-3.5 mr-1.5" />
            )}
            Planifier
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Edit-entry dialog — manual per-cell times ─────────────

const QUARTER_MINUTES = [0, 15, 30, 45]

/** Hour + minute picker pair constrained to quarter hours. Native
 *  `<input type="time">` is not used because the Chromium picker ignores
 *  `step` and offers every minute — these styled dropdowns only offer
 *  00/15/30/45. PopoverSelect reserves id 0 as its "none" sentinel, so
 *  option ids are offset by +1. */
function QuarterTimeField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string // 'HH:MM', already quarter-snapped
  onChange: (t: string) => void
}) {
  const h = parseInt(value.slice(0, 2), 10) || 0
  const m = parseInt(value.slice(3, 5), 10) || 0
  const pad = (x: number) => String(x).padStart(2, '0')
  const minuteIdx = Math.max(0, QUARTER_MINUTES.indexOf(m))
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <div className="flex gap-1.5">
        <PopoverSelect
          options={Array.from({ length: 24 }, (_, i) => ({ id: i + 1, primary: `${pad(i)} h` }))}
          value={h + 1}
          onChange={(id) => onChange(`${pad(id - 1)}:${pad(QUARTER_MINUTES[minuteIdx])}`)}
          hideEmpty
        />
        <PopoverSelect
          options={QUARTER_MINUTES.map((min, i) => ({ id: i + 1, primary: pad(min) }))}
          value={minuteIdx + 1}
          onChange={(id) => onChange(`${pad(h)}:${pad(QUARTER_MINUTES[id - 1])}`)}
          hideEmpty
        />
      </div>
    </div>
  )
}

function EditEntryDialog({
  target,
  onClose,
  onSaved,
}: {
  /** `entry` present = edit an existing block; absent = create one on `date`. */
  target: { bonnetier: Bonnetier; date: string; entry?: PlanningEntry } | null
  onClose: () => void
  onSaved: () => void
}) {
  const [debut, setDebut] = useState('')
  const [fin, setFin] = useState('')
  // Re-seed the time inputs whenever a different cell is opened.
  const [seededKey, setSeededKey] = useState<string | null>(null)
  const targetKey = target ? `${target.bonnetier.IDbonnetier}|${target.date}` : null
  if (target && targetKey !== seededKey) {
    setDebut(snapQuarter(target.entry?.debut ?? EQUIPES[0].debut))
    setFin(snapQuarter(target.entry?.fin ?? addHours(EQUIPES[0].debut, 7)))
    setSeededKey(targetKey)
  }

  const saveMut = useMutation({
    mutationFn: () =>
      apiFetch('/planning-atelier/entries', {
        method: 'POST',
        // Replace-per-day semantics: re-POSTing the same day swaps the old row.
        body: JSON.stringify({
          IDbonnetier: target!.bonnetier.IDbonnetier,
          entries: [{ date: target!.date, debut: snapQuarter(debut), fin: snapQuarter(fin) }],
        }),
      }),
    onSuccess: onSaved,
  })

  if (!target) return null

  const isEdit = target.entry !== undefined
  const valid = /^\d{2}:\d{2}$/.test(debut) && /^\d{2}:\d{2}$/.test(fin)
  const overnight = valid && fin <= debut
  const dayLabel = `${DAY_NAMES[new Date(`${target.date}T00:00:00`).getDay()]} ${fmtFr(target.date)}`
  const preview = valid ? equipeOf(debut) : null
  const TitleIcon = isEdit ? Pencil : Plus

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="max-w-sm" onClose={onClose}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TitleIcon className="h-5 w-5 text-accent" />
            {isEdit ? 'Modifier le créneau' : 'Ajouter un créneau'}
          </DialogTitle>
        </DialogHeader>

        <div className="mt-4 space-y-3">
          <p className="text-sm">
            <span className="font-medium">
              {target.bonnetier.prenom} {target.bonnetier.nom}
            </span>
            <span className="text-muted-foreground"> — {dayLabel}</span>
          </p>

          <div className="grid grid-cols-2 gap-3">
            <QuarterTimeField label="Début" value={debut} onChange={setDebut} />
            <QuarterTimeField label="Fin" value={fin} onChange={setFin} />
          </div>

          <div className="flex items-center gap-2 text-xs text-muted-foreground min-h-5">
            {preview && (
              <>
                <span className={cn('h-3 w-3 rounded-sm border', preview.solid)} />
                {preview.label}
              </>
            )}
            {overnight && <span>· fin le lendemain (nuit)</span>}
          </div>
        </div>

        <DialogFooter className="mt-4">
          <Button variant="outline" size="sm" onClick={onClose}>
            Annuler
          </Button>
          <Button size="sm" disabled={!valid || saveMut.isPending} onClick={() => saveMut.mutate()}>
            {saveMut.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DesiderataDialog({
  open,
  onClose,
  bonnetiers,
}: {
  open: boolean
  onClose: () => void
  bonnetiers: Bonnetier[]
}) {
  const queryClient = useQueryClient()
  const [statut, setStatut] = useState<'encours' | 'termine'>('encours')
  const [formDate, setFormDate] = useState('')
  const [formBonnetier, setFormBonnetier] = useState(0)
  const [formDescription, setFormDescription] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<Desiderata | null>(null)

  const bonnetierName = useMemo(() => {
    const map = new Map<number, string>()
    for (const b of bonnetiers) map.set(b.IDbonnetier, `${b.prenom} ${b.nom}`)
    return map
  }, [bonnetiers])

  const { data: rows, isLoading } = useQuery<Desiderata[]>({
    queryKey: ['atelier-desiderata', statut],
    queryFn: () => apiFetch(`/planning-atelier/desiderata?statut=${statut}`),
    enabled: open,
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['atelier-desiderata'] })

  const createMut = useMutation({
    mutationFn: () =>
      apiFetch('/planning-atelier/desiderata', {
        method: 'POST',
        body: JSON.stringify({ date: formDate, IDbonnetier: formBonnetier, description: formDescription.trim() }),
      }),
    onSuccess: () => {
      invalidate()
      setFormDate('')
      setFormBonnetier(0)
      setFormDescription('')
    },
  })

  const flagMut = useMutation({
    mutationFn: (p: { id: number; field: 'justifie' | 'declare'; value: 0 | 1 }) =>
      apiFetch(`/planning-atelier/desiderata/${p.id}`, {
        method: 'PUT',
        body: JSON.stringify({ [p.field]: p.value }),
      }),
    onSuccess: invalidate,
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiFetch(`/planning-atelier/desiderata/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      invalidate()
      setDeleteTarget(null)
    },
  })

  const canSubmit = formDate !== '' && formBonnetier !== 0 && formDescription.trim() !== ''

  return (
    <>
      <Dialog open={open} onOpenChange={() => onClose()}>
        <DialogContent className="max-w-2xl h-[75vh] flex flex-col" onClose={onClose}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarClock className="h-5 w-5 text-accent" />
              Desiderata
            </DialogTitle>
          </DialogHeader>

          <div className="mt-4 flex-1 min-h-0 flex flex-col gap-3">
            {/* Statut filter — gold-pill segmented group (§5) */}
            <div className="flex gap-1 flex-shrink-0">
              {(
                [
                  { key: 'encours', label: 'En cours' },
                  { key: 'termine', label: 'Terminés' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setStatut(opt.key)}
                  className={cn(
                    'px-3 py-1 text-xs rounded-md transition-colors',
                    statut === opt.key
                      ? 'bg-accent text-accent-foreground shadow-sm font-medium'
                      : 'text-muted-foreground hover:bg-accent/10',
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* List */}
            <div className="flex-1 min-h-0 overflow-y-auto rounded-lg border bg-zinc-100/80 p-2 space-y-2 scrollbar-transparent">
              {isLoading ? (
                <div className="h-full flex items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-accent" />
                </div>
              ) : (rows ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground italic text-center py-8">Aucun desiderata</p>
              ) : (
                (rows ?? []).map((d) => (
                  <div key={d.IDdesiderata} className="group p-2.5 rounded-lg border bg-card shadow-sm">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium tabular-nums">{fmtFr(d.date)}</span>
                      <Badge variant="secondary" className="text-xs">
                        {bonnetierName.get(d.IDbonnetier) ?? `#${d.IDbonnetier}`}
                      </Badge>
                      <div className="ml-auto flex items-center gap-3">
                        <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
                          <Checkbox
                            checked={d.declare === 1}
                            onCheckedChange={(v) =>
                              flagMut.mutate({ id: d.IDdesiderata, field: 'declare', value: v ? 1 : 0 })
                            }
                          />
                          Déclaré
                        </label>
                        <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
                          <Checkbox
                            checked={d.justifie === 1}
                            onCheckedChange={(v) =>
                              flagMut.mutate({ id: d.IDdesiderata, field: 'justifie', value: v ? 1 : 0 })
                            }
                          />
                          Justifié
                        </label>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-destructive hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                          title="Supprimer"
                          onClick={() => setDeleteTarget(d)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">{d.description}</p>
                  </div>
                ))
              )}
            </div>

            {/* Add form (InlineForm pattern §9) */}
            <div className="flex-shrink-0 rounded-lg border border-accent/25 bg-accent/[0.03] p-3 space-y-2">
              <p className="text-xs font-semibold text-accent uppercase tracking-wide">Nouveau desiderata</p>
              <div className="flex gap-2">
                <input
                  type="date"
                  value={formDate}
                  onChange={(e) => setFormDate(e.target.value)}
                  className={cn(inputClass, 'w-40 flex-shrink-0')}
                />
                <PopoverSelect
                  options={bonnetiers.map((b) => ({ id: b.IDbonnetier, primary: `${b.prenom} ${b.nom}` }))}
                  value={formBonnetier}
                  onChange={setFormBonnetier}
                  emptyLabel="Bonnetier"
                />
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  placeholder="Description"
                  className={inputClass}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && canSubmit && !createMut.isPending) createMut.mutate()
                  }}
                />
                <Button
                  size="sm"
                  className="flex-shrink-0 h-9"
                  disabled={!canSubmit || createMut.isPending}
                  onClick={() => createMut.mutate()}
                >
                  {createMut.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                  ) : (
                    <Plus className="h-3.5 w-3.5 mr-1" />
                  )}
                  Ajouter
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Supprimer le desiderata"
        description={
          deleteTarget
            ? `Le desiderata de ${bonnetierName.get(deleteTarget.IDbonnetier) ?? ''} du ${fmtFr(deleteTarget.date)} sera supprimé.`
            : undefined
        }
        isPending={deleteMut.isPending}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) deleteMut.mutate(deleteTarget.IDdesiderata)
        }}
      />
    </>
  )
}
