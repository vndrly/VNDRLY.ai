import {
  ObjectAclPolicy,
  ObjectPermission,
  canAccessObject,
} from "./objectAcl";
import { getObjectStore, type StoredObject } from "./objectStore";

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

/** Thin facade over {@link getObjectStore} for route handlers. */
export class ObjectStorageService {
  getUploadDescriptor(): { uploadURL: string; objectPath: string } {
    return getObjectStore().getUploadDescriptor();
  }

  normalizeObjectEntityPath(rawPath: string): string {
    return getObjectStore().uploadUrlToObjectPath(rawPath);
  }

  async trySetObjectEntityAclPolicy(
    rawPath: string,
    aclPolicy: ObjectAclPolicy,
  ): Promise<string> {
    const objectPath = this.normalizeObjectEntityPath(rawPath);
    return getObjectStore().setAcl(objectPath, aclPolicy);
  }

  async getStoredObject(objectPath: string): Promise<StoredObject> {
    if (!objectPath.startsWith("/objects/")) {
      throw new ObjectNotFoundError();
    }
    const obj = await getObjectStore().getObject(objectPath);
    if (!obj) {
      throw new ObjectNotFoundError();
    }
    return obj;
  }

  async getPublicObject(relativePath: string): Promise<StoredObject | null> {
    return getObjectStore().getPublicObject(relativePath);
  }

  async canAccessStoredObject({
    userId,
    object,
    requestedPermission,
  }: {
    userId?: string;
    object: StoredObject;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    return canAccessObject({
      userId,
      aclPolicy: object.acl,
      requestedPermission: requestedPermission ?? ObjectPermission.READ,
    });
  }
}
