import { NavLink, Outlet } from "react-router-dom";
import { usePipelineStatus } from "../api/hooks";
import "./Layout.css";

function timeAgo(isoDate: string): string {
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  const diffMs = now - then;

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function Layout() {
  const { data } = usePipelineStatus();

  const syncTime = data?.lastSync?.syncedAt ?? null;
  const syncStatus = data?.lastSync?.status ?? null;

  const syncIndicatorClass = syncStatus === "SUCCEEDED"
    ? "sync-indicator--ok"
    : syncStatus === "FAILED"
      ? "sync-indicator--error"
      : "";

  return (
    <div className="layout">
      <header className="layout-header">
        <div className="header-title">
          <h1>SWG Legends</h1>
          <span className="header-subtitle">Resource Intelligence Terminal</span>
          {syncTime && (
            <span className={`sync-indicator ${syncIndicatorClass}`}>
              Synced: {timeAgo(syncTime)}
            </span>
          )}
        </div>
        <nav className="header-nav">
          <NavLink to="/resources" className={navClass}>
            Resources
          </NavLink>
          <NavLink to="/history" className={navClass}>
            History
          </NavLink>
          <NavLink to="/events" className={navClass}>
            Events
          </NavLink>
          <NavLink to="/alerts" className={navClass}>
            Alerts
          </NavLink>
          <NavLink to="/ops" className={navClass}>
            Ops
          </NavLink>
        </nav>
      </header>
      <main className="layout-main">
        <Outlet />
      </main>
      <footer className="layout-footer">
        SWG Legends Resource Intelligence &middot; Server 138 &middot; Data from
        swgaide.com
      </footer>
    </div>
  );
}

function navClass({ isActive }: { isActive: boolean }) {
  return `nav-link ${isActive ? "nav-link--active" : ""}`;
}
