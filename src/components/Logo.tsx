import Image from "next/image";

/** 누비투어 로고: 지구본 위로 나는 비행기 심볼 + 누비투어 글자 이미지 (public/brand). */
export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <Image src="/brand/nubi-symbol.png" alt="" width={256} height={174} unoptimized className="h-7 w-auto" aria-hidden="true" />
      <Image src="/brand/nubi-wordmark.png" alt="누비투어" width={325} height={96} unoptimized className="h-7 w-auto" />
    </span>
  );
}
