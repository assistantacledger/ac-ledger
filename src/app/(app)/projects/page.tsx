'use client'

import { useState, useMemo, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { Modal } from '@/components/ui/Modal'
import { ProjectDetail } from '@/components/projects/ProjectDetail'
import { useProjects } from '@/hooks/useProjects'
import { useInvoices } from '@/hooks/useInvoices'
import { useExpenses } from '@/hooks/useExpenses'
import { sb } from '@/lib/supabase'
import { cn, fmt, fmtDate, todayISO } from '@/lib/format'
import { Plus, Pencil, Trash2, FolderOpen } from 'lucide-react'
import type { Project, Entity, ProjectStatus } from '@/types'
import { ENTITIES } from '@/types'

const STATUSES: ProjectStatus[] = ['active', 'completed', 'on-hold']

const STATUS_STYLES: Record<ProjectStatus, string> = {
  active: 'badge-approved',
  completed: 'badge-paid',
  'on-hold': 'badge-pending',
}

const blank = (): Omit<Project, 'createdAt'> => ({
  code: '', name: '', entity: 'Actually Creative', date: todayISO(),
  budget: 0, status: 'active', notes: '',
})

export default function ProjectsPage() {
  const router = useRouter()
  const { projects, createProject, updateProject, renameProjectCode, deleteProject } = useProjects()
  const { invoices } = useInvoices()
  const { expenses, createExpense } = useExpenses()

  const [selectedProject, setSelectedProject] = useState<Project | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Project | null>(null)
  const [form, setForm] = useState(blank())
  const [error, setError] = useState('')
  const [statusFilter, setStatusFilter] = useState<ProjectStatus | 'all'>('all')
  const [entityFilter, setEntityFilter] = useState<Entity | 'all'>('all')
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [codeChangeWarn, setCodeChangeWarn] = useState(false)

  // Handle ?open=CODE param from other pages
  useEffect(() => {
    if (projects.length === 0) return
    const params = new URLSearchParams(window.location.search)
    const code = params.get('open')
    if (code) {
      const proj = projects.find(p => p.code === code)
      if (proj) setSelectedProject(proj)
      // Clean the URL without a full navigation
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [projects])

  // Keep selectedProject in sync if project is updated
  useEffect(() => {
    if (selectedProject) {
      const updated = projects.find(p => p.code === selectedProject.code)
      if (updated) setSelectedProject(updated)
    }
  }, [projects]) // eslint-disable-line react-hooks/exhaustive-deps

  function openCreate() { setEditing(null); setForm(blank()); setError(''); setCodeChangeWarn(false); setModalOpen(true) }
  function openEdit(p: Project) {
    setEditing(p)
    setForm({ code: p.code, name: p.name, entity: p.entity, date: p.date, budget: p.budget, status: p.status, notes: p.notes })
    setError('')
    setCodeChangeWarn(false)
    setModalOpen(true)
  }

  function set<K extends keyof typeof form>(key: K, val: typeof form[K]) {
    setForm(f => ({ ...f, [key]: val }))
  }

  async function handleSave() {
    if (!form.code.trim()) { setError('Project code is required'); return }
    if (!form.name.trim()) { setError('Project name is required'); return }

    if (editing) {
      const codeChanged = form.code !== editing.code
      if (codeChanged && projects.find(p => p.code === form.code && p.code !== editing.code)) {
        setError('Project code already exists'); return
      }
      if (codeChanged && !codeChangeWarn) {
        setError(`Changing code from "${editing.code}" to "${form.code}" will update all linked invoices and expenses. Click Save again to confirm.`)
        setCodeChangeWarn(true)
        return
      }
      if (codeChanged) {
        const { code: _c, ...rest } = form
        const renamed = renameProjectCode(editing.code, form.code, rest)
        await Promise.all([
          sb.from('invoices').update({ project_code: form.code }).eq('project_code', editing.code),
          sb.from('expenses').update({ project_code: form.code }).eq('project_code', editing.code),
        ])
        if (selectedProject?.code === editing.code && renamed) setSelectedProject(renamed)
      } else {
        updateProject(editing.code, form)
      }
    } else {
      if (projects.find(p => p.code === form.code)) { setError('Project code already exists'); return }
      createProject(form)
    }
    setError('')
    setCodeChangeWarn(false)
    setModalOpen(false)
  }

  function deleteProjectAndCleanup(code: string) {
    localStorage.removeItem(`project_notes_${code}`)
    localStorage.removeItem(`project_files_${code}`)
    localStorage.removeItem(`project_costs_${code}`)
    deleteProject(code)
    setSelectedProject(null)
  }

  function handleDelete(code: string) {
    if (deleteConfirm === code) {
      deleteProjectAndCleanup(code)
      setDeleteConfirm(null)
    } else {
      setDeleteConfirm(code)
      setTimeout(() => setDeleteConfirm(null), 3000)
    }
  }

  const filtered = useMemo(() => {
    let rows = projects
    if (entityFilter !== 'all') rows = rows.filter(p => p.entity === entityFilter)
    if (statusFilter !== 'all') rows = rows.filter(p => p.status === statusFilter)
    return rows
  }, [projects, entityFilter, statusFilter])

  function projectStats(code: string) {
    const inv = invoices.filter(i => i.project_code === code)
    const receivable = inv.filter(i => i.type === 'receivable').reduce((t, i) => t + Number(i.amount), 0)
    const paid = inv.filter(i => i.type === 'receivable' && i.status === 'paid').reduce((t, i) => t + Number(i.amount), 0)
    return { receivable, paid, count: inv.length }
  }

  const footer = (
    <>
      {error && <p className="text-xs font-mono text-red-600 mr-auto">{error}</p>}
      <button onClick={() => setModalOpen(false)} className="px-4 py-2 text-xs font-mono uppercase tracking-wider border border-rule text-muted hover:text-ink hover:border-ink transition-colors">Cancel</button>
      <button onClick={handleSave} className="px-4 py-2 text-xs font-mono uppercase tracking-wider bg-ink text-white hover:bg-[#333] transition-colors">
        {editing ? 'Save Changes' : 'Create Project'}
      </button>
    </>
  )

  // ── Detail view ──────────────────────────────────────────────────────────────
  if (selectedProject) {
    return (
      <>
        <Header title="Projects" />
        <ProjectDetail
          project={selectedProject}
          invoices={invoices}
          expenses={expenses}
          onBack={() => setSelectedProject(null)}
          onEdit={() => openEdit(selectedProject)}
          onDelete={() => deleteProjectAndCleanup(selectedProject.code)}
          createExpense={createExpense}
        />
        <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={`Edit · ${editing?.code}`} size="lg" footer={footer}>
          <ProjectFormBody form={form} set={set} editing={editing} />
        </Modal>
      </>
    )
  }

  // ── Grid view ─────────────────────────────────────────────────────────────────
  return (
    <>
      <Header title="Projects" />
      <main className="flex-1 overflow-y-auto px-6 py-6">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3 mb-5">
          <select value={entityFilter} onChange={e => setEntityFilter(e.target.value as Entity | 'all')}
            className="text-xs border border-rule bg-white px-2 py-1.5 text-ink focus:outline-none font-mono">
            <option value="all">All entities</option>
            {ENTITIES.map(e => <option key={e} value={e}>{e}</option>)}
          </select>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as ProjectStatus | 'all')}
            className="text-xs border border-rule bg-white px-2 py-1.5 text-ink focus:outline-none font-mono uppercase">
            <option value="all">All statuses</option>
            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <div className="flex-1" />
          <button onClick={openCreate}
            className="flex items-center gap-1.5 bg-ink text-white px-3 py-1.5 text-xs font-mono uppercase tracking-wider hover:bg-[#333] transition-colors">
            <Plus size={11} /> New Project
          </button>
        </div>

        {filtered.length === 0 ? (
          <div className="tbl-card py-16 text-center">
            <FolderOpen size={24} className="text-muted mx-auto mb-3" />
            <p className="font-mono text-xs text-muted uppercase tracking-wider">No projects yet</p>
            <button onClick={openCreate} className="mt-3 font-mono text-xs text-ink underline underline-offset-2">Create your first project</button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map(project => {
              const stats = projectStats(project.code)
              const budgetUsed = project.budget > 0 ? Math.min((stats.receivable / project.budget) * 100, 100) : 0
              return (
                <div
                  key={project.code}
                  className="tbl-card group cursor-pointer hover:shadow-md transition-shadow"
                  onClick={() => setSelectedProject(project)}
                >
                  <div className="px-5 py-4 border-b border-rule">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="font-mono text-[10px] uppercase tracking-widest text-muted">{project.code}</span>
                          <span className={cn('badge', STATUS_STYLES[project.status])}>{project.status}</span>
                        </div>
                        <p className="text-sm font-semibold text-ink truncate">{project.name}</p>
                        <p className="font-mono text-[10px] text-muted mt-0.5 uppercase tracking-wider">
                          {project.entity === 'Actually Creative' ? 'AC' : project.entity} · {fmtDate(project.date)}
                        </p>
                      </div>
                      <div className="row-actions flex-shrink-0" onClick={e => e.stopPropagation()}>
                        <button onClick={() => openEdit(project)} className="p-1 text-muted hover:text-ink transition-colors"><Pencil size={13} /></button>
                        <button onClick={() => handleDelete(project.code)}
                          className={cn('p-1 transition-colors', deleteConfirm === project.code ? 'text-red-600' : 'text-muted hover:text-red-500')}>
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="px-5 py-3 space-y-2">
                    {project.budget > 0 && (
                      <div>
                        <div className="flex justify-between items-center mb-1">
                          <span className="font-mono text-[10px] uppercase tracking-wider text-muted">Budget</span>
                          <span className="font-mono text-xs text-ink">{fmt(stats.receivable)} / {fmt(project.budget)}</span>
                        </div>
                        <div className="h-1.5 bg-rule overflow-hidden">
                          <div className={cn('h-full transition-all', budgetUsed >= 100 ? 'bg-red-500' : 'bg-ac-green')}
                            style={{ width: `${budgetUsed}%` }} />
                        </div>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="font-mono text-xs text-muted">{stats.count} invoice{stats.count !== 1 ? 's' : ''}</span>
                      <span className="font-mono text-xs text-ac-green">{fmt(stats.paid)} paid</span>
                    </div>
                    {project.notes && (
                      <p className="text-xs text-muted line-clamp-2">{project.notes}</p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </main>

      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editing ? `Edit · ${editing.code}` : 'New Project'} size="lg" footer={footer}>
        <ProjectFormBody form={form} set={set} editing={editing} />
      </Modal>
    </>
  )
}

// ── Extracted form body (used in both grid and detail views) ─────────────────

function ProjectFormBody({
  form,
  set,
  editing,
}: {
  form: Omit<Project, 'createdAt'>
  set: <K extends keyof Omit<Project, 'createdAt'>>(key: K, val: Omit<Project, 'createdAt'>[K]) => void
  editing: Project | null
}) {
  return (
    <div className="px-5 py-5 space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="field-label">Project Code</label>
          <input type="text" value={form.code} onChange={e => set('code', e.target.value.toUpperCase())}
            placeholder="AC-24-001"
            className="w-full border border-rule bg-paper px-3 py-2 text-sm font-mono text-ink focus:outline-none focus:border-ink" />
        </div>
        <div>
          <label className="field-label">Status</label>
          <select value={form.status} onChange={e => set('status', e.target.value as ProjectStatus)}
            className="w-full border border-rule bg-paper px-3 py-2 text-sm text-ink focus:outline-none font-mono uppercase">
            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="col-span-2">
          <label className="field-label">Project Name</label>
          <input type="text" value={form.name} onChange={e => set('name', e.target.value)}
            className="w-full border border-rule bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:border-ink" />
        </div>
        <div>
          <label className="field-label">Entity</label>
          <select value={form.entity} onChange={e => set('entity', e.target.value as Entity)}
            className="w-full border border-rule bg-paper px-3 py-2 text-sm text-ink focus:outline-none">
            {ENTITIES.map(e => <option key={e} value={e}>{e}</option>)}
          </select>
        </div>
        <div>
          <label className="field-label">Start Date</label>
          <input type="date" value={form.date} onChange={e => set('date', e.target.value)}
            className="w-full border border-rule bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:border-ink" />
        </div>
        <div className="col-span-2">
          <label className="field-label">Budget</label>
          <input type="number" value={form.budget} onChange={e => set('budget', parseFloat(e.target.value) || 0)}
            min="0" step="100"
            className="w-full border border-rule bg-paper px-3 py-2 text-sm font-mono text-ink focus:outline-none focus:border-ink" />
        </div>
        <div className="col-span-2">
          <label className="field-label">Notes</label>
          <textarea value={form.notes} onChange={e => set('notes', e.target.value)}
            rows={3} className="w-full border border-rule bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:border-ink resize-none" />
        </div>
      </div>
    </div>
  )
}
