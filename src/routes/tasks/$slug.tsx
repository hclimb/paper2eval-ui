import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/tasks/$slug')({
  component: () => <Outlet />,
})
