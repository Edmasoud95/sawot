const paths = {
  close: 'M6 6l12 12M6 18 18 6',
  plus: 'M5 12h14M12 5v14',
  minus: 'M5 12h14',
  previous: 'M19 12H5m7-7-7 7 7 7',
  next: 'M5 12h14m-7-7 7 7-7 7',
};

/** Symmetric view boxes keep icon-only controls independent of font baselines. */
export default function ControlIcon({ name, size = 18 }: { name: keyof typeof paths; size?: number }) {
  return <svg className="control-icon" width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d={paths[name]} />
  </svg>;
}
