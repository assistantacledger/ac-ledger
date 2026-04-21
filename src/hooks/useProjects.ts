'use client'

import { useState, useCallback } from 'react'
import type { Project, Entity, ProjectStatus } from '@/types'

const KEY = 'ledger_projects'

function loadProjects(): Project[] {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function save(projects: Project[]) {
  localStorage.setItem(KEY, JSON.stringify(projects))
}

export function useProjects() {
  const [projects, setProjects] = useState<Project[]>(() => {
    if (typeof window === 'undefined') return []
    return loadProjects()
  })

  const createProject = useCallback((data: Omit<Project, 'createdAt'>): Project => {
    const project: Project = { ...data, createdAt: new Date().toISOString() }
    const updated = [project, ...loadProjects()]
    save(updated)
    setProjects(updated)
    return project
  }, [])

  const updateProject = useCallback((code: string, data: Partial<Omit<Project, 'code' | 'createdAt'>>): void => {
    const updated = loadProjects().map(p => p.code === code ? { ...p, ...data } : p)
    save(updated)
    setProjects(updated)
  }, [])

  const renameProjectCode = useCallback((
    oldCode: string,
    newCode: string,
    data: Partial<Omit<Project, 'code' | 'createdAt'>>,
  ): Project | undefined => {
    const updated = loadProjects().map(p =>
      p.code === oldCode ? { ...p, ...data, code: newCode } : p
    )
    save(updated)
    setProjects(updated)
    // Move localStorage keys (notes, files, costs)
    for (const suffix of ['notes', 'files', 'costs']) {
      const val = localStorage.getItem(`project_${suffix}_${oldCode}`)
      if (val !== null) {
        localStorage.setItem(`project_${suffix}_${newCode}`, val)
        localStorage.removeItem(`project_${suffix}_${oldCode}`)
      }
    }
    return updated.find(p => p.code === newCode)
  }, [])

  const deleteProject = useCallback((code: string) => {
    const updated = loadProjects().filter(p => p.code !== code)
    save(updated)
    setProjects(updated)
  }, [])

  return { projects, createProject, updateProject, renameProjectCode, deleteProject }
}
