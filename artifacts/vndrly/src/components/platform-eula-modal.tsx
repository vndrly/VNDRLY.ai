import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  PLATFORM_EULA_LAST_UPDATED,
  PLATFORM_EULA_PRIVACY_URL,
  PLATFORM_EULA_TEXT,
  PLATFORM_EULA_TITLE,
  PLATFORM_EULA_VERSION,
} from "@workspace/platform-eula";

interface PlatformEulaModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Read-only platform EULA for partner/vendor profile pages. */
export function PlatformEulaModal({
  open,
  onOpenChange,
}: PlatformEulaModalProps): React.ReactElement {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col" data-testid="modal-platform-eula">
        <DialogHeader>
          <DialogTitle>{PLATFORM_EULA_TITLE}</DialogTitle>
          <p className="text-xs text-muted-foreground">
            Version {PLATFORM_EULA_VERSION} · Last updated {PLATFORM_EULA_LAST_UPDATED}
          </p>
        </DialogHeader>
        <ScrollArea className="flex-1 min-h-0 max-h-[55vh] rounded-md border p-4 text-sm whitespace-pre-wrap">
          {PLATFORM_EULA_TEXT}
        </ScrollArea>
        <p className="text-xs text-muted-foreground pt-2">
          <a
            href={PLATFORM_EULA_PRIVACY_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            Privacy policy
          </a>
        </p>
      </DialogContent>
    </Dialog>
  );
}
