import { createFileRoute, Link } from '@tanstack/react-router'
import RouteErrorPanel from '#/components/RouteErrorPanel'
import { SITE } from '#/lib/constants'
import { fmtReward, formatDuration } from '#/lib/formatters'
import { fetchTaskList, type TaskListItem } from '#/lib/tasks.api'

export const Route = createFileRoute('/')({
  head: () => ({
    meta: [{ title: SITE.title }, { name: 'description', content: SITE.description }],
  }),
  loader: async () => {
    const tasks = await fetchTaskList()
    return { tasks }
  },
  component: TaskList,
  errorComponent: ({ error }) => <RouteErrorPanel error={error} />,
})

function TaskList() {
  const { tasks } = Route.useLoaderData()

  return (
    <main className="page-wrap py-8">
      <h1 className="font-mono text-base text-ink uppercase tracking-[0.08em] font-bold mb-1">
        /TASKS
      </h1>
      <p className="font-mono text-sm text-ink-soft mb-6">
        each task = one paper claim turned into a sandbox · agent has a budget · reward = how
        close it gets to the paper's number
      </p>

      <p className="font-mono text-xs text-ink-soft mb-4 uppercase tracking-wider">
        {tasks.length} {tasks.length === 1 ? 'environment' : 'environments'}
      </p>

      {tasks.length === 0 ? (
        <div className="border border-dashed border-rule p-8 text-center font-mono text-sm text-ink-soft">
          no tasks yet — once a paper claim is converted to an evaluation environment, it appears
          here.
        </div>
      ) : (
        <div className="border-t border-rule/50">
          {tasks.map((t) => (
            <TaskRow key={t.slug} task={t} />
          ))}
        </div>
      )}
    </main>
  )
}

function TaskRow({ task }: { task: TaskListItem }) {
  return (
    <Link
      to="/tasks/$slug"
      params={{ slug: task.slug }}
      className="task-row block border-b border-rule/50 py-3 px-2 text-inherit hover:bg-paper-deep/40 transition-colors group"
    >
      <div className="flex items-baseline justify-between gap-4 flex-wrap">
        <span className="font-mono text-base font-semibold text-ink group-hover:text-accent transition-colors">
          {task.slug}
        </span>
        <span className="font-mono text-xs text-ink-soft tabular-nums flex items-baseline gap-6">
          <span>
            <span className="text-ink">{task.runCount}</span>{' '}
            {task.runCount === 1 ? 'run' : 'runs'}
          </span>
          <span>
            avg <span className="text-ink">{fmtReward(task.avgReward)}</span>
          </span>
          <span className="text-ink">{formatDuration(task.agentTimeoutSec)}</span>
          <span className="text-ink">{task.baseModelShort}</span>
        </span>
      </div>
      <p className="font-mono text-xs text-ink-soft mt-1 max-w-[80ch] leading-relaxed">
        {task.paperTitle}
      </p>
    </Link>
  )
}
