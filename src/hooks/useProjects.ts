'use client'

import { useState, useEffect, useCallback } from 'react'
import { sb } from '@/lib/supabase'
import type { Project } from '@/types'

// ─── Row shape from Supabase ──────────────────────────────────────────────────

interface ProjectRow {
  id: string
  code: string
  name: string
  entity: string
  status: string
  start_date: string | null
  budget: number
  notes: string | null
  created_at: string
}

function rowToProject(row: ProjectRow): Project {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    entity: row.entity as Project['entity'],
    status: row.status as Project['status'],
    start_date: row.start_date ?? '',
    budget: Number(row.budget ?? 0),
    notes: row.notes ?? '',
    created_at: row.created_at,
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    const { data, error } = await sb
      .from('projects')
      .select('*')
      .order('created_at', { ascending: false })
    if (!error && data) {
      setProjects((data as ProjectRow[]).map(rowToProject))
    }
    setLoading(false)
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const createProject = useCallback(async (data: Omit<Project, 'id' | 'created_at'>): Promise<Project> => {
    const { data: row, error } = await sb
      .from('projects')
      .insert({
        code: data.code,
        name: data.name,
        entity: data.entity,
        status: data.status,
        start_date: data.start_date || null,
        budget: data.budget,
        notes: data.notes || null,
      })
      .select()
      .single()
    if (error) throw error
    const project = rowToProject(row as ProjectRow)
    setProjects(prev => [project, ...prev])
    return project
  }, [])

  const updateProject = useCallback(async (code: string, data: Partial<Omit<Project, 'id' | 'code' | 'created_at'>>): Promise<void> => {
    const patch: Record<string, unknown> = {}
    if (data.name !== undefined) patch.name = data.name
    if (data.entity !== undefined) patch.entity = data.entity
    if (data.status !== undefined) patch.status = data.status
    if (data.start_date !== undefined) patch.start_date = data.start_date || null
    if (data.budget !== undefined) patch.budget = data.budget
    if (data.notes !== undefined) patch.notes = data.notes || null

    const { error } = await sb.from('projects').update(patch).eq('code', code)
    if (error) throw error
    setProjects(prev => prev.map(p => p.code === code ? { ...p, ...data } : p))
  }, [])

  const renameProjectCode = useCallback(async (
    oldCode: string,
    newCode: string,
    data: Partial<Omit<Project, 'id' | 'code' | 'created_at'>>,
  ): Promise<Project | undefined> => {
    const patch: Record<string, unknown> = { code: newCode }
    if (data.name !== undefined) patch.name = data.name
    if (data.entity !== undefined) patch.entity = data.entity
    if (data.status !== undefined) patch.status = data.status
    if (data.start_date !== undefined) patch.start_date = data.start_date || null
    if (data.budget !== undefined) patch.budget = data.budget
    if (data.notes !== undefined) patch.notes = data.notes || null

    const { error } = await sb.from('projects').update(patch).eq('code', oldCode)
    if (error) throw error

    // Cascade rename in project_costs, project_notes, project_files, project_whiteboards
    await Promise.all([
      sb.from('project_costs').update({ project_code: newCode }).eq('project_code', oldCode),
      sb.from('project_notes').update({ project_code: newCode }).eq('project_code', oldCode),
      sb.from('project_files').update({ project_code: newCode }).eq('project_code', oldCode),
      sb.from('project_whiteboards').update({ project_code: newCode }).eq('project_code', oldCode),
    ])

    setProjects(prev =>
      prev.map(p => p.code === oldCode ? { ...p, ...data, code: newCode } : p)
    )
    return projects.find(p => p.code === oldCode) ? { ...projects.find(p => p.code === oldCode)!, ...data, code: newCode } : undefined
  }, [projects])

  const deleteProject = useCallback(async (code: string): Promise<void> => {
    const { error } = await sb.from('projects').delete().eq('code', code)
    if (error) throw error
    setProjects(prev => prev.filter(p => p.code !== code))
  }, [])

  return { projects, loading, createProject, updateProject, renameProjectCode, deleteProject, refresh }
}
