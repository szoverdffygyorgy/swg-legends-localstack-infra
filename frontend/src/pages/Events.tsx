import { useState } from "react";
import { useEvents } from "../api/hooks";
import StatusBadge from "../components/StatusBadge";
import LoadingSpinner from "../components/LoadingSpinner";
import ErrorMessage from "../components/ErrorMessage";
import "./Events.css";

const EVENT_TYPES = ["", "SPAWNED", "DESPAWNED", "DATA_ISSUE"] as const;

function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function Events() {
  const [date, setDate] = useState(todayString());
  const [typeFilter, setTypeFilter] = useState("");

  const { data: events = [], isLoading, error, refetch } = useEvents(
    date,
    typeFilter || undefined
  );

  function formatTime(iso: string): string {
    return iso.slice(11, 19);
  }

  function badgeVariant(type: string): "spawned" | "despawned" | "data_issue" {
    if (type === "SPAWNED") return "spawned";
    if (type === "DESPAWNED") return "despawned";
    return "data_issue";
  }

  return (
    <div className="events-page">
      {/* Filter bar */}
      <div className="filter-bar">
        <div className="filter-group">
          <label>Date</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div className="filter-group">
          <label>Type</label>
          <div className="type-buttons">
            {EVENT_TYPES.map((t) => (
              <button
                key={t || "all"}
                className={`type-btn ${typeFilter === t ? "type-btn--active" : ""}`}
                onClick={() => setTypeFilter(t)}
              >
                {t || "All"}
              </button>
            ))}
          </div>
        </div>
        <div className="filter-count">
          <span className="count-value">{events.length}</span> events
        </div>
      </div>

      {/* Content */}
      {isLoading && <LoadingSpinner message="Loading events..." />}
      {error && <ErrorMessage message={error instanceof Error ? error.message : "Failed to load events"} onRetry={() => refetch()} />}
      {!isLoading && !error && events.length === 0 && (
        <div className="empty-state">No events recorded for {date}.</div>
      )}
      {!isLoading && !error && events.length > 0 && (
        <div className="events-list">
          {events.map((evt) => (
            <div key={evt.sk} className="event-card">
              <div className="event-header">
                <span className="event-time">{formatTime(evt.detectedAt)}</span>
                <StatusBadge variant={badgeVariant(evt.eventType)}>
                  {evt.eventType}
                </StatusBadge>
                <span className="event-name">{evt.resourceName}</span>
                <span className="event-class">{evt.resourceClass}</span>
              </div>
              <div className="event-details">
                <span className="event-planets">{evt.planets}</span>
                {evt.statSummary && (
                  <span className="event-stats">{evt.statSummary}</span>
                )}
                {evt.issue && (
                  <span className="event-issue">{evt.issue}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
