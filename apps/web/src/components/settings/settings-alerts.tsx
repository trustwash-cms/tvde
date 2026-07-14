export function SettingsAlerts({
  error,
  success,
  onDismissError,
  onDismissSuccess,
}: {
  error?: string;
  success?: string;
  onDismissError?: () => void;
  onDismissSuccess?: () => void;
}) {
  if (!error && !success) return null;

  return (
    <div className="space-y-3">
      {error && (
        <div className="flex items-start justify-between gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          <span>{error}</span>
          {onDismissError && (
            <button type="button" className="text-red-500 hover:text-red-700" onClick={onDismissError}>
              ×
            </button>
          )}
        </div>
      )}
      {success && (
        <div className="flex items-start justify-between gap-2 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-700">
          <span>{success}</span>
          {onDismissSuccess && (
            <button type="button" className="text-green-600 hover:text-green-800" onClick={onDismissSuccess}>
              ×
            </button>
          )}
        </div>
      )}
    </div>
  );
}
