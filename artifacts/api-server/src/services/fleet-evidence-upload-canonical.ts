import { createFleetWorkCanonicalService } from "./fleet-work-canonical";
import type { FleetWorkExecutionContext } from "./fleet-work-repository";
import type { FleetEvidenceUploadTransaction } from "./fleet-evidence-upload";
import { getObjectStore, type ObjectStore } from "../lib/objectStore";
import { FleetError } from "./fleet-repository";

/** The canonical private-document owner rechecks subject, current revision and
 * submitter permissions at begin AND association. Receiving bytes never adopts
 * a rule, verifies a source, or changes a compliance assessment to green. */
export function createFleetEvidenceCanonicalHandlers(
  options: {
    store?: () => ObjectStore;
    secret?: () => string;
    now?: () => Date;
  } = {},
) {
  const store = options.store ?? getObjectStore;
  const service = (context: FleetWorkExecutionContext) =>
    createFleetWorkCanonicalService(context, {
      compliance: {
        store,
        ...(options.secret ? { secret: options.secret } : {}),
        ...(options.now ? { now: options.now } : {}),
      },
    });
  return {
    async authorize(
      context: FleetWorkExecutionContext,
      ...[command]: Parameters<FleetEvidenceUploadTransaction["authorize"]>
    ) {
      if (command.kind !== "compliance.document.stage")
        throw new FleetError("fleet.work_kind_unavailable", 503);
      await service(context).authorizeFleetComplianceDocument(
        { ...context.actor },
        {
          recordId: command.payload.recordId,
          subject: command.payload.subject,
          expectedRecordVersion: command.payload.expectedRecordVersion,
        },
      );
    },
    async associate(
      context: FleetWorkExecutionContext,
      ...[session, bytes]: Parameters<
        FleetEvidenceUploadTransaction["associate"]
      >
    ) {
      if (session.binding.kind !== "compliance")
        throw new FleetError("fleet.work_kind_unavailable", 503);
      const owner = service(context),
        binding = session.binding;
      await owner.authorizeFleetComplianceDocument(
        { ...context.actor },
        {
          recordId: binding.recordId,
          subject: binding.subject,
          expectedRecordVersion: binding.expectedRecordVersion,
        },
      );
      const received = await owner.uploadComplianceDocument(
        { ...context.actor },
        {
          operationId: session.operationId,
          recordId: binding.recordId,
          subject: binding.subject,
          contentType: session.contentType,
          bodyBase64: bytes.toString("base64"),
        },
      );
      return {
        evidenceId: session.canonicalEvidenceId,
        objectPath: received.objectPath,
        fileUrl: null,
      };
    },
  };
}
