import OwnerAssignment from "@/components/work-hub/library/owner-assignment";
import React from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/use-auth";
import { isWorkHubAdmin } from "@/lib/work-hub-client";
import {
  WorkHubSurface,
  WorkHubPageHeading,
} from "@/components/work-hub/chrome";
import LibraryWorkspace from "@/components/work-hub/library";
import LibraryDetail from "@/components/work-hub/library/library-detail";
import BundleDetail from "@/components/work-hub/library/bundle-detail";
import EmployeeResponse from "@/components/work-hub/library/employee-response";
import { z } from "zod/v4";
export default function LibraryPage({
  kind = "library",
  id,
}: {
  kind?: "library" | "bundle" | "training" | "checklist" | "assignment";
  id?: string;
}) {
  const { t } = useTranslation(),
    { user } = useAuth(),
    valid =
      id === undefined ||
      z.uuid().safeParse(id).success ||
      (kind === "bundle" && id === "new");
  return (
    <WorkHubSurface>
      <div className="space-y-4">
        <WorkHubPageHeading
          module="tasks"
          title={t(
            id && ["training", "checklist"].includes(kind)
              ? "workHubLibrary.assignedWork"
              : "workHubLibrary.manage",
          )}
        />
        {!valid ? (
          <p>{t("workHubLibrary.invalidLink")}</p>
        ) : kind === "assignment" && id ? (
          <OwnerAssignment key={id} instanceId={id} />
        ) : kind === "bundle" && id ? (
          <BundleDetail key={id} itemId={id} />
        ) : id && ["training", "checklist"].includes(kind) ? (
          <EmployeeResponse key={id} instanceId={id} />
        ) : id ? (
          <LibraryDetail key={id} itemId={id} />
        ) : (
          <LibraryWorkspace canManage={isWorkHubAdmin(user)} />
        )}
      </div>
    </WorkHubSurface>
  );
}
