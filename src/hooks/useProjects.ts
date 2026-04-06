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

  const deleteProject = useCallback((code: string) => {
    const updated = loadProjects().filter(p => p.code !== code)
    save(updated)
    setProjects(updated)
  }, [])

  return { projects, createProject, updateProject, deleteProject }
}
