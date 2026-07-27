import { Link } from 'wouter';
import { Mountain } from 'lucide-react';

export function Logo({ light = false }: { light?: boolean }) {
  return (
    <Link
      href="/"
      className={`flex items-center gap-2.5 ${light ? 'text-[#f5f0e6]' : 'text-[#203b47]'}`}
      data-testid="link-logo"
    >
      <span
        className={`flex h-8 w-8 items-center justify-center rounded-[10px] ${
          light ? 'bg-[#e8bc5a] text-[#203b47]' : 'bg-[#203b47] text-[#f5f0e6]'
        }`}
      >
        <Mountain size={17} strokeWidth={2.2} />
      </span>
      <span className="font-display text-[22px] tracking-[-.04em]">roamwise</span>
    </Link>
  );
}
