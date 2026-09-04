import "./LoadingSpinner.css";

export default function LoadingSpinner({ message = "Loading..." }: { message?: string }) {
  return (
    <div className="loading" role="status" aria-live="polite">
      <div className="loading-spinner" />
      <span className="loading-message">{message}</span>
    </div>
  );
}
