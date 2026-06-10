import type { ReactNode } from "react";
import ImagePill from "@/components/image-pill";
import { PILL_HEIGHT_PX } from "@/lib/pill-doctrine";
import { cn } from "@/lib/utils";

interface AfePillProps {
  children: ReactNode;
  className?: string;
  title?: string;
  "data-testid"?: string;
}

export default function AfePill({
  children,
  className,
  title,
  "data-testid": dataTestId,
}: AfePillProps) {
  return (
    <ImagePill
      color="blue"
      height={PILL_HEIGHT_PX}
      className={cn("min-w-[88px] pointer-events-none", className)}
      data-testid={dataTestId}
      title={title}
    >
      {children}
    </ImagePill>
  );
}
