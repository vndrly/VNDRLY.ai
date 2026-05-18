import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"
import dialogAccent from "@assets/VNDRLY_Header_Blur_4_1776220762025.png"
import { useAuth } from "@/hooks/use-auth"
import { useGetPartner, useGetVendor, getGetPartnerQueryKey, getGetVendorQueryKey } from "@workspace/api-client-react"

type DialogLogoSpec = {
  src?: string | null
  alt?: string
  fallbackName?: string | null
  testId?: string
}

type DialogLogoContextValue = {
  setCustomLogo: (logo: DialogLogoSpec | null) => void
}

const DialogLogoContext = React.createContext<DialogLogoContextValue | null>(null)

function useAutoEntityLogo(): DialogLogoSpec | null {
  const { user } = useAuth()
  const partnerId = user?.role === "partner" ? user.partnerId ?? undefined : undefined
  const vendorId = user?.role === "vendor" ? user.vendorId ?? undefined : undefined
  const { data: partner } = useGetPartner(partnerId as number, {
    query: { enabled: !!partnerId, queryKey: getGetPartnerQueryKey(partnerId as number) },
  })
  const { data: vendor } = useGetVendor(vendorId as number, {
    query: { enabled: !!vendorId, queryKey: getGetVendorQueryKey(vendorId as number) },
  })
  const entity = partner ?? vendor
  if (!entity?.logoUrl) return null
  return { src: entity.logoUrl, alt: `${entity.name} logo`, fallbackName: entity.name }
}

/**
 * Shared logo area shown across the top of every dialog.
 *
 * Sizing rule:
 *  - Logo image keeps its original aspect ratio.
 *  - Image height is capped at 200px.
 *  - Image width can never exceed the modal's content width.
 *  - Smaller logos render at their natural size (never stretched).
 *  - The container always reserves the standard header strip height
 *    (calc(1.5in + 1rem)) so modals without a logo are unchanged,
 *    and grows to fit taller logos so body content is never overlapped.
 */
function DialogLogoArea({ customLogo }: { customLogo: DialogLogoSpec | null }) {
  const autoLogo = useAutoEntityLogo()
  const effective = customLogo ?? autoLogo
  return (
    <div
      className="relative z-20 flex shrink-0 items-center justify-center px-6 pointer-events-none"
      style={{ minHeight: "calc(1.5in + 1rem)" }}
      data-testid={effective?.testId ?? (effective ? "modal-logo-header" : undefined)}
    >
      {effective?.src ? (
        <img
          src={effective.src}
          alt={effective.alt ?? effective.fallbackName ?? "logo"}
          className="block h-auto w-auto max-h-[100px] max-w-[256px] object-contain drop-shadow-[0_2px_4px_rgba(0,0,0,0.25)]"
        />
      ) : effective?.fallbackName ? (
        <div className="text-sm font-medium text-muted-foreground">{effective.fallbackName}</div>
      ) : null}
    </div>
  )
}

const Dialog = DialogPrimitive.Root

const DialogTrigger = DialogPrimitive.Trigger

const DialogPortal = DialogPrimitive.Portal

const DialogClose = DialogPrimitive.Close

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/80  data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

type DialogContentProps = React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  /**
   * When true, renders children directly inside the Dialog frame without
   * the standard DialogLogoArea (which always reserves ~1.5in of header
   * height) and without the inner padded/scrolling grid wrapper. The
   * decorative top accent strip and the built-in Close button are still
   * rendered. Use this for chat-style or other custom-layout panels that
   * need to manage their own internal flex/scroll regions while still
   * matching the standard centered-modal chrome (border, shadow, animations).
   */
  bare?: boolean
  /**
   * When true, suppresses the built-in absolute-positioned Close button
   * in the top-right of the dialog. Use this when the consumer renders
   * its own close control inline (e.g. as part of a custom header
   * action row) so the two don't visually compete.
   */
  hideClose?: boolean
}

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(({ className, children, bare = false, hideClose = false, ...props }, ref) => {
  const [customLogo, setCustomLogo] = React.useState<DialogLogoSpec | null>(null)
  const ctxValue = React.useMemo<DialogLogoContextValue>(() => ({ setCustomLogo }), [])
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          "fixed left-[50%] top-[50%] z-50 flex max-h-[calc(100vh-2rem)] w-[600px] max-w-[calc(100vw-2rem)] translate-x-[-50%] translate-y-[-50%] flex-col overflow-hidden rounded-2xl border-2 bg-background shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]",
          className
        )}
        {...props}
        style={{ borderColor: "var(--brand-primary)", ...props.style }}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 z-0 h-[1.5in] bg-cover bg-top bg-no-repeat opacity-40"
          style={{
            backgroundImage: `url(${dialogAccent})`,
            WebkitMaskImage: "linear-gradient(to bottom, black 0%, transparent 100%)",
            maskImage: "linear-gradient(to bottom, black 0%, transparent 100%)",
          }}
        />
        {bare ? (
          children
        ) : (
          <DialogLogoContext.Provider value={ctxValue}>
            <DialogLogoArea customLogo={customLogo} />
            <div className="relative z-10 grid min-h-0 flex-1 gap-4 overflow-y-auto p-6 pt-0">
              {children}
            </div>
          </DialogLogoContext.Provider>
        )}
        {!hideClose && (
          <DialogPrimitive.Close className="absolute right-4 top-4 z-30 rounded-sm text-white opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
})
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col space-y-1.5 text-left",
      className
    )}
    {...props}
  />
)
DialogHeader.displayName = "DialogHeader"

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
      className
    )}
    {...props}
  />
)
DialogFooter.displayName = "DialogFooter"

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      "text-lg font-semibold leading-none tracking-tight",
      className
    )}
    {...props}
  />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

interface DialogLogoHeaderProps {
  src?: string | null
  alt?: string
  fallbackName?: string | null
  "data-testid"?: string
}

/**
 * Per-modal logo override. Place this anywhere inside <DialogContent>
 * (typically at the top of children) to display a specific logo across
 * the modal's shared logo area instead of the logged-in entity's logo.
 *
 * The actual rendering is performed by the shared DialogLogoArea inside
 * DialogContent — this component only registers the logo via context, so
 * the standard sizing/centering rules always apply.
 */
function DialogLogoHeader({ src, alt, fallbackName, ...props }: DialogLogoHeaderProps) {
  const ctx = React.useContext(DialogLogoContext)
  const testId = props["data-testid"]
  // useLayoutEffect so the custom logo is registered before the browser
  // paints — avoids a brief flicker where the auto-detected entity logo
  // would otherwise render for one frame before being replaced.
  React.useLayoutEffect(() => {
    if (!ctx) return
    if (!src && !fallbackName) {
      ctx.setCustomLogo(null)
      return
    }
    ctx.setCustomLogo({ src, alt, fallbackName, testId })
    return () => ctx.setCustomLogo(null)
  }, [ctx, src, alt, fallbackName, testId])
  return null
}

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  DialogLogoHeader,
}
