import { createFileRoute, Outlet } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import RouteErrorPanel from '#/components/RouteErrorPanel'
import { getTaskFile } from '#/lib/s3.server'
import { type Claims, parseClaims, parseTaskToml, type TaskToml } from '#/lib/tasks'

const fetchTaskIdentity = createServerFn({ method: 'GET' })
  .inputValidator((d: { slug: string }) => d)
  .handler(async ({ data }): Promise<{ slug: string; toml: TaskToml; claims: Claims }> => {
    const [tomlRaw, claimsRaw] = await Promise.all([
      getTaskFile(data.slug, 'task.toml'),
      getTaskFile(data.slug, 'tests/claims.json'),
    ])
    return {
      slug: data.slug,
      toml: parseTaskToml(tomlRaw),
      claims: parseClaims(claimsRaw),
    }
  })

export const Route = createFileRoute('/tasks/$slug')({
  loader: ({ params }) => fetchTaskIdentity({ data: { slug: params.slug } }),
  component: () => <Outlet />,
  errorComponent: ({ error }) => <RouteErrorPanel error={error} />,
})
