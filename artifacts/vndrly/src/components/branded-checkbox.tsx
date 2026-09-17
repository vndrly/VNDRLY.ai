import * as React from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

export const BRANDED_CHECKBOX_CLASS_NAME =
  "border-[color:var(--brand-primary)] data-[state=checked]:border-[color:var(--brand-primary)] data-[state=checked]:bg-[color:var(--brand-primary)] data-[state=checked]:text-white";

const BrandedCheckbox = React.forwardRef<
  React.ElementRef<typeof Checkbox>,
  React.ComponentPropsWithoutRef<typeof Checkbox>
>(({ className, ...props }, ref) => (
  <Checkbox
    ref={ref}
    className={cn(BRANDED_CHECKBOX_CLASS_NAME, className)}
    {...props}
  />
));

BrandedCheckbox.displayName = "BrandedCheckbox";

export { BrandedCheckbox };