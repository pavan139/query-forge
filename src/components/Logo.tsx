import { useId } from 'react';

export function LogoMark({ size = 34 }: { size?: number }) {
  // Unique gradient id: a shared id breaks when another copy of the logo is hidden (display: none).
  const gid = useId().replace(/:/g, '');
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5856d6" />
          <stop offset="0.6" stopColor="#8e5bf0" />
          <stop offset="1" stopColor="#af52de" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="15" fill={`url(#${gid})`} />
      <ellipse cx="30" cy="20" rx="15" ry="6" fill="#fff" />
      <path d="M15 20v22c0 3.3 6.7 6 15 6s15-2.7 15-6V20c0 3.3-6.7 6-15 6s-15-2.7-15-6z" fill="#fff" fillOpacity="0.85" />
      <path d="M15 31c0 3.3 6.7 6 15 6s15-2.7 15-6" stroke="#a748f0" strokeWidth="2.5" fill="none" />
      <path d="M49 8l2.2 4.8L56 15l-4.8 2.2L49 22l-2.2-4.8L42 15l4.8-2.2z" fill="#fde68a" />
    </svg>
  );
}

export function Logo({ small }: { small?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <LogoMark size={small ? 26 : 30} />
      <div className={`font-semibold tracking-tight ${small ? 'text-[15px]' : 'text-[17px]'}`}>
        SQL <span className="text-primary">Quest</span>
      </div>
    </div>
  );
}
