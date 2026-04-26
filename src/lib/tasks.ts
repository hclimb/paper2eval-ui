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

export function parseTaskToml(raw: string): TaskToml {
  return parseToml(raw) as unknown as TaskToml
}

export function parseClaims(raw: string): Claims {
  return JSON.parse(raw) as Claims
}

