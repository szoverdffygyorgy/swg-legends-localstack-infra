import { Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/Layout";
import Resources from "./pages/Resources";
import Events from "./pages/Events";
import Alerts from "./pages/Alerts";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/resources" element={<Resources />} />
        <Route path="/events" element={<Events />} />
        <Route path="/alerts" element={<Alerts />} />
        <Route path="*" element={<Navigate to="/resources" replace />} />
      </Route>
    </Routes>
  );
}
