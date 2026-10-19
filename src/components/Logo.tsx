export function LogoMark({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id="lg-a" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6d5cff" />
          <stop offset="0.55" stopColor="#a748f0" />
          <stop offset="1" stopColor="#ec4899" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill="url(#lg-a)" />
      <ellipse cx="30" cy="20" rx="15" ry="6" fill="#fff" />
      <path d="M15 20v22c0 3.3 6.7 6 15 6s15-2.7 15-6V20c0 3.3-6.7 6-15 6s-15-2.7-15-6z" fill="#fff" fillOpacity="0.85" />
      <path d="M15 31c0 3.3 6.7 6 15 6s15-2.7 15-6" stroke="#a748f0" strokeWidth="2.5" fill="none" />
      <path d="M49 8l2.2 4.8L56 15l-4.8 2.2L49 22l-2.2-4.8L42 15l4.8-2.2z" fill="#fde68a" />
    </svg>
  );
}

export function Logo({ small }: { small?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark size={small ? 28 : 34} />
      <div className="leading-tight">
        <div className={`font-extrabold tracking-tight ${small ? 'text-base' : 'text-lg'}`}>
          SQL <span className="gradient-text">Quest</span>
        </div>
        {!small && <div className="text-[10px] font-semibold tracking-wide text-muted uppercase">Zero → Advanced</div>}
      </div>
    </div>
  );
}
