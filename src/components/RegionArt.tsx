/**
 * 지역 대표 그림 (외부 사진 대신 SVG). 하늘은 시간대 그라데이션, 앞은 지역을 떠올리게 하는 실루엣.
 * seed가 같으면 같은 그림이 나와 상품마다 조금씩 다르다.
 */
const SKIES = [
  ["#1f7fab", "#aad8eb"], // 낮
  ["#10425e", "#f57a3d"], // 노을
  ["#156690", "#ffd2b0"], // 해 질 녘
  ["#0c3249", "#3f9cc6"], // 저녁
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function Silhouette({ region }: { region: string }) {
  switch (region) {
    case "japan":
      return (
        <g>
          <path d="M60 170 L170 62 Q180 54 190 62 L300 170 Z" fill="#10425e" />
          <path d="M152 80 L170 62 Q180 54 190 62 L208 80 Q195 92 180 84 Q165 92 152 80 Z" fill="#ffffff" />
          <path d="M0 175 Q100 158 200 172 T400 168 L400 200 L0 200 Z" fill="#0c3249" />
          <g fill="#dc5f22">
            <rect x="300" y="120" width="6" height="56" />
            <rect x="334" y="120" width="6" height="56" />
            <rect x="292" y="114" width="56" height="7" rx="2" />
            <rect x="296" y="128" width="48" height="4" />
          </g>
        </g>
      );
    case "southeast-asia":
      return (
        <g>
          <path d="M0 170 Q120 150 260 166 T400 160 L400 200 L0 200 Z" fill="#aad8eb" opacity=".55" />
          <path d="M0 182 Q140 170 400 180 L400 200 L0 200 Z" fill="#0c3249" />
          <g stroke="#0c3249" strokeWidth="7" fill="none" strokeLinecap="round">
            <path d="M300 182 Q296 130 318 92" />
          </g>
          <g fill="#0c3249">
            <path d="M318 92 Q290 80 262 96 Q292 88 316 98 Z" />
            <path d="M318 92 Q346 76 372 92 Q344 86 320 98 Z" />
            <path d="M318 92 Q300 62 282 58 Q306 72 318 96 Z" />
            <path d="M318 92 Q338 60 360 58 Q334 74 320 96 Z" />
          </g>
          <circle cx="110" cy="120" r="22" fill="#ffd2b0" opacity=".9" />
        </g>
      );
    case "china":
      return (
        <g>
          <path d="M0 180 L60 120 L110 165 L170 95 L240 170 L300 110 L400 175 L400 200 L0 200 Z" fill="#10425e" opacity=".7" />
          <g fill="#0c3249">
            <rect x="180" y="150" width="70" height="40" />
            <path d="M166 152 L265 152 L246 136 L184 136 Z" />
            <rect x="192" y="118" width="46" height="18" />
            <path d="M178 122 L252 122 L236 106 L194 106 Z" />
            <path d="M196 106 L234 106 L215 88 Z" />
          </g>
          <path d="M0 188 L400 188 L400 200 L0 200 Z" fill="#0c3249" />
        </g>
      );
    case "europe":
      return (
        <g>
          <path d="M0 175 L80 90 L120 125 L190 50 L260 130 L310 100 L400 170 L400 200 L0 200 Z" fill="#10425e" />
          <path d="M170 72 L190 50 L210 72 L198 68 L190 76 L182 68 Z" fill="#ffffff" />
          <path d="M66 104 L80 90 L94 104 L84 100 L80 106 Z" fill="#ffffff" />
          <g fill="#0c3249">
            <path d="M0 200 L0 178 Q200 160 400 182 L400 200 Z" />
            <rect x="300" y="150" width="34" height="34" />
            <path d="M296 152 L317 130 L338 152 Z" fill="#dc5f22" />
            <rect x="326" y="120" width="8" height="30" />
          </g>
        </g>
      );
    case "americas":
      return (
        <g>
          <path d="M0 200 L0 140 L50 140 L50 120 L110 120 L110 150 L160 150 L160 128 L200 128 L200 200 Z" fill="#dc5f22" opacity=".85" />
          <path d="M200 200 L200 150 L240 150 L240 110 L300 110 L300 140 L350 140 L350 124 L400 124 L400 200 Z" fill="#c4521d" opacity=".9" />
          <path d="M0 186 Q200 176 400 188 L400 200 L0 200 Z" fill="#0c3249" />
        </g>
      );
    default: // oceania
      return (
        <g>
          <path d="M0 160 Q200 148 400 160 L400 200 L0 200 Z" fill="#3f9cc6" />
          <path d="M80 162 Q150 128 230 162 Z" fill="#0c3249" />
          <g fill="#0c3249">
            <path d="M160 140 Q158 116 168 96 L172 98 Q164 118 166 140 Z" />
            <path d="M168 96 Q150 88 136 98 Q154 94 168 100 Z" />
            <path d="M168 96 Q186 86 200 96 Q184 92 170 100 Z" />
          </g>
          <path d="M0 176 Q100 170 200 178 T400 174 L400 200 L0 200 Z" fill="#ffffff" opacity=".35" />
        </g>
      );
  }
}

export function RegionArt({ region, seed = region, className = "" }: { region: string; seed?: string; className?: string }) {
  const h = hash(seed);
  const [top, bottom] = SKIES[h % SKIES.length];
  const id = `sky-${region}-${h % 997}`;
  return (
    <svg viewBox="0 0 400 200" preserveAspectRatio="xMidYMax slice" className={className} role="img" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={top} />
          <stop offset="1" stopColor={bottom} />
        </linearGradient>
      </defs>
      <rect width="400" height="200" fill={`url(#${id})`} />
      <Silhouette region={region} />
    </svg>
  );
}
