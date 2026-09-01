import "./ErrorMessage.css";

interface ErrorMessageProps {
  message: string;
  onRetry?: () => void;
}

export default function ErrorMessage({ message, onRetry }: ErrorMessageProps) {
  return (
    <div className="error-box">
      <div className="error-icon">!</div>
      <div className="error-content">
        <div className="error-text">{message}</div>
        {onRetry && (
          <button className="error-retry" onClick={onRetry}>
            Retry
          </button>
        )}
      </div>
    </div>
  );
}
