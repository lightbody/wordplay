export function Spinner({ full }: { full?: boolean }) {
  const dot = <span className="spinner-dot" />;
  const inner = (
    <div className="spinner" aria-label="Loading">
      {dot}
      {dot}
      {dot}
    </div>
  );
  return full ? <div className="spinner-full">{inner}</div> : inner;
}
