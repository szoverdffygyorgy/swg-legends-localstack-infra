import { NavLink, Outlet } from "react-router-dom";
import "./Layout.css";

export default function Layout() {
  return (
    <div className="layout">
      <header className="layout-header">
        <div className="header-title">
          <h1>SWG Legends</h1>
          <span className="header-subtitle">Resource Intelligence Terminal</span>
        </div>
        <nav className="header-nav">
          <NavLink to="/resources" className={navClass}>
            Resources
          </NavLink>
          <NavLink to="/events" className={navClass}>
            Events
          </NavLink>
          <NavLink to="/alerts" className={navClass}>
            Alerts
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
