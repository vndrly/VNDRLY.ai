import { LibraryMetadataSchema, SAFETY_LIBRARY_REQUIREMENTS, SAFETY_LIBRARY_RESOURCE_TYPES, SAFETY_LIBRARY_RESOURCE_LABELS } from "@workspace/api-zod";

/** Input must already be restricted to the authenticated company's Library. */
export function safetyRequirementLinks(categoryId: string, resources: { id: string; metadata: unknown }[]) {
  const published = resources.flatMap(resource => {
    const parsed = LibraryMetadataSchema.safeParse(resource.metadata);
    return parsed.success && parsed.data.state === "published" ? [{ id: resource.id, metadata: parsed.data }] : [];
  }).sort((a,b) => b.metadata.contentVersion - a.metadata.contentVersion);
  return SAFETY_LIBRARY_REQUIREMENTS.filter(requirement => requirement.category === categoryId).map(requirement => ({
    id: requirement.id, title: requirement.title, applicability: requirement.applicability,
    resources: SAFETY_LIBRARY_RESOURCE_TYPES.flatMap(type => {
      const resource = published.find(item => item.metadata.safetyResource?.familyId === requirement.id && item.metadata.safetyResource.categoryId === categoryId && item.metadata.safetyResource.resourceType === type);
      return resource ? [{ id: resource.id, title: SAFETY_LIBRARY_RESOURCE_LABELS[type], type }] : [];
    }),
  }));
}
