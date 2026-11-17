/** 누비투어 글자 로고: 실로 꿰매며 나아가는 바늘땀(누비) 선 위에 이름. */
export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <svg viewBox="0 0 36 24" className="h-6 w-9" aria-hidden="true">
        <path d="M2 16 Q10 4 18 12 T34 8" fill="none" stroke="#125275" strokeWidth="3" strokeLinecap="round" strokeDasharray="5 4" />
        <circle cx="34" cy="8" r="3" fill="#f57a3d" />
      </svg>
      <span className="text-xl font-extrabold tracking-tight text-sea-800">누비투어</span>
    </span>
  );
}
