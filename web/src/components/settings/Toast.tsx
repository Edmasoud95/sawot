export default function Toast({ saved, error }) {
  if (!saved && !error) return null;
  if (error) {
    return (
      <div className="settings-toast" role="alert">
        <span className="settings-toast-inner border-red-400/20 bg-red-400/10 text-red-300">{error}</span>
      </div>
    );
  }
  return (
    <div className="settings-toast" role="status">
      <span className="settings-toast-inner border-aurora-teal/20 bg-ink-900 text-aurora-teal">
        <span className="h-1.5 w-1.5 rounded-full bg-aurora-teal" />
        Saved
      </span>
    </div>
  );
}
