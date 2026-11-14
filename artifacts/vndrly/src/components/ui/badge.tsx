import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { STATUS_INDICATOR_CLASS } from "@/components/status-indicator";
import { cn } from "@/lib/utils"

const badgeVariants = cva(
  STATUS_INDICATOR_CLASS,
  {
    variants: {
      variant: {
        default:
          "text-blue-400",
        secondary:
          "text-slate-300",
        destructive:
          "text-red-400",
        outline: "text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, children, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props}><span aria-hidden="true" className="status-indicator-dot h-1.5 w-1.5 shrink-0 rounded-full !bg-current" />{children}</div>
  )
}

export { Badge, badgeVariants }
