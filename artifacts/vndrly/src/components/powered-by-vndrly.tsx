import { VNDRLY_LOGO_SQUARE } from "@/lib/vndrly-brand-assets";
import { cn } from "@/lib/utils";

type PoweredByVndrlyProps = {
  className?: string;
  textClassName?: string;
};

export function PoweredByVndrly({ className, textClassName }: PoweredByVndrlyProps) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-sm leading-relaxed", className)}>
      <span className={cn("italic", textClassName)}>…powered by</span>
      <img
        src={VNDRLY_LOGO_SQUARE}
        alt="VNDRLY.ai"
        className="w-6 h-6 shrink-0 rounded-[4px]"
        draggable={false}
      />
    </span>
  );
}
