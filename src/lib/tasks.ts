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
  benchmark_hf_id?: string
  benchmark_split?: string
  benchmark_scope?: string
  eval_type?: string
  eval_protocol?: string
  eval_derivation?: string
  metric_name: string
  metric_description?: string
  metric_direction: string
  metric_lower_bound?: number
  metric_upper_bound?: number
  baseline_method?: string
  baseline_value: number
  target_value: number
  paper_best_value: number
  reward_thresholds: RewardThreshold[]
  base_model_hf_id: string
  base_model_architecture?: string
  allowed_models: string[]
  allowed_datasets: string[]
  allowed_benchmarks?: string[]
  paper_github_url?: string
  block_list?: { method_names?: string[]; arxiv_ids?: string[] }
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

