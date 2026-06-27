import { createRootRoute, createRoute, createRouter, Link, Outlet } from "@tanstack/react-router"
import { Approvals } from "./pages/Approvals"
import { Audit } from "./pages/Audit"
import { Board } from "./pages/Board"
import { Budgets } from "./pages/Budgets"
import { Roadmap } from "./pages/Roadmap"

const rootRoute = createRootRoute({
  component: () => (
    <div className="app">
      <nav className="nav">
        <span className="brand">engineering</span>
        <Link
          to="/"
          className="link"
          activeProps={{ className: "link active" }}
          activeOptions={{ exact: true }}
        >
          Board
        </Link>
        <Link to="/roadmap" className="link" activeProps={{ className: "link active" }}>
          Roadmap
        </Link>
        <Link to="/approvals" className="link" activeProps={{ className: "link active" }}>
          Approvals
        </Link>
        <Link to="/budgets" className="link" activeProps={{ className: "link active" }}>
          Budgets
        </Link>
        <Link to="/audit" className="link" activeProps={{ className: "link active" }}>
          Audit
        </Link>
      </nav>
      <main className="main">
        <Outlet />
      </main>
    </div>
  ),
})

const boardRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: Board })
const roadmapRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/roadmap",
  component: Roadmap,
})
const approvalsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/approvals",
  component: Approvals,
})
const budgetsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/budgets",
  component: Budgets,
})
const auditRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/audit",
  component: Audit,
})

const routeTree = rootRoute.addChildren([
  boardRoute,
  roadmapRoute,
  approvalsRoute,
  budgetsRoute,
  auditRoute,
])

export const router = createRouter({ routeTree })

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}
