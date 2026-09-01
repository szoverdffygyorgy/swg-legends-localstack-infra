import "./LoadingSpinner.css";

export default function LoadingSpinner({ message = "Loading..." }: { message?: string }) {
  return (
    <div className="loading">
      <div className="loading-spinner" />
      <span className="loading-message">{message}</span>
    </div>
  );
}
