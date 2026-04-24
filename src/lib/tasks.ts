import { parse as parseToml } from 'smol-toml'

export type TaskEnvironment = {
  build_timeout_sec: number
  cpus: number
  memory_mb: number
  storage_mb: number
  gpus: number
  gpu_types: string[]
  allow_internet: boolean
}

export type RewardThreshold = {
  value: number
  reward: number
}

export type TaskToml = {
  schema_version: string
  task: {
    name: string
    description: string
  }
  metadata: {
    difficulty: string
    category: string
    tags: string[]
  }
  environment: TaskEnvironment
  agent: { timeout_sec: number }
  verifier: { timeout_sec: number }
}

export type Claims = {
  slug: string
  paper_id: string
  paper_title: string
  research_goal: string
  difficulty: string
  benchmark_name: string
  metric_name: string
  metric_direction: string
  baseline_value: number
  target_value: number
  paper_best_value: number
  reward_thresholds: RewardThreshold[]
  base_model_hf_id: string
  allowed_models: string[]
  allowed_datasets: string[]
  paper_github_url?: string
  _meta?: Record<string, string | number | boolean | null>
}

export type TaskSummary = {
  slug: string
  toml: TaskToml
  claims: Claims
}

export type FileNode = {
  name: string
  path: string
  size: number
  children?: FileNode[]
}

export function parseTaskToml(raw: string): TaskToml {
  return parseToml(raw) as unknown as TaskToml
}

export function parseClaims(raw: string): Claims {
  return JSON.parse(raw) as Claims
}

export function buildFileTree(files: { key: string; size: number }[]): FileNode[] {
  const root: FileNode[] = []

  for (const f of files) {
    const parts = f.key.split('/')
    let current = root

    for (let i = 0; i < parts.length; i++) {
      const name = parts[i]
      const isFile = i === parts.length - 1
      const path = parts.slice(0, i + 1).join('/')

      let existing = current.find((n) => n.name === name)
      if (!existing) {
        existing = { name, path, size: isFile ? f.size : 0 }
        if (!isFile) existing.children = []
        current.push(existing)
      }
      if (!isFile && existing.children) {
        current = existing.children
      }
    }
  }

  return root
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const val = bytes / 1024 ** i
  return `${val < 10 ? val.toFixed(1) : Math.round(val)} ${units[i]}`
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}
