import { Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/Layout";
import Resources from "./pages/Resources";
import ResourceProfile from "./pages/ResourceProfile";
import History from "./pages/History";
import Events from "./pages/Events";
import Alerts from "./pages/Alerts";
import Ops from "./pages/Ops";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/resources" element={<Resources />} />
        <Route path="/resources/:id" element={<ResourceProfile />} />
        <Route path="/history" element={<History />} />
        <Route path="/events" element={<Events />} />
        <Route path="/alerts" element={<Alerts />} />
        <Route path="/ops" element={<Ops />} />
        <Route path="/pipeline" element={<Navigate to="/ops" replace />} />
        <Route path="*" element={<Navigate to="/resources" replace />} />
      </Route>
    </Routes>
  );
}
