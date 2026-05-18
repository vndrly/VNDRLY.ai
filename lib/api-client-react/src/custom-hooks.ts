import { useMutation, useQuery } from "@tanstack/react-query";
import type {
  MutationFunction,
  QueryFunction,
  QueryKey,
  UseMutationOptions,
  UseMutationResult,
  UseQueryOptions,
  UseQueryResult,
} from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";
import type { ErrorType, BodyType } from "./custom-fetch";

type SecondParameter<T extends (...args: never) => unknown> = Parameters<T>[1];

interface PartnerContact {
  id: number;
  partnerId: number;
  jobTitle: string;
  name: string;
  email: string;
  phone: string | null;
  roles: string[];
  photoUrl?: string | null;
  createdAt: string;
  deletedAt?: string | null;
  deletedBy?: string | null;
}

interface VendorContact {
  id: number;
  vendorId: number;
  jobTitle: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  vendorRole?: string;
  pecCertification?: boolean;
  pecExpirationDate?: string | null;
  photoUrl?: string | null;
  createdAt: string;
}

interface NoteItem {
  id: number;
  content: string;
  createdAt: string;
}

interface CreatePartnerContactBody {
  jobTitle: string;
  name: string;
  email: string;
  phone?: string | null;
  roles?: string[];
  photoUrl?: string | null;
}

interface UpdatePartnerContactBody {
  jobTitle?: string;
  name?: string;
  email?: string;
  phone?: string | null;
  roles?: string[];
  photoUrl?: string | null;
}

interface CreateVendorContactBody {
  jobTitle: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string | null;
  vendorRole?: string;
  pecCertification?: boolean;
  pecExpirationDate?: string | null;
  photoUrl?: string | null;
}

interface UpdateVendorContactBody {
  jobTitle?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string | null;
  vendorRole?: string;
  pecCertification?: boolean;
  pecExpirationDate?: string | null;
  photoUrl?: string | null;
}

interface CreateNoteBody {
  content: string;
}

// `listPartnerContacts` / `getListPartnerContactsQueryKey` /
// `getListPartnerContactsQueryOptions` / `useListPartnerContacts` now
// come from the orval-generated client in `generated/api.ts` — the
// endpoint is documented in `lib/api-spec/openapi.yaml`. The remaining
// create/update/delete helpers below stay hand-rolled because their
// endpoints are not yet in the OpenAPI spec.
export const createPartnerContact = async (
  partnerId: number,
  body: CreatePartnerContactBody,
  options?: RequestInit,
): Promise<PartnerContact> => {
  return customFetch<PartnerContact>(`/api/partners/${partnerId}/contacts`, {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...options?.headers },
    body: JSON.stringify(body),
  });
};

export const useCreatePartnerContact = <TError = ErrorType<unknown>, TContext = unknown>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof createPartnerContact>>,
    TError,
    { partnerId: number; data: BodyType<CreatePartnerContactBody> },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationResult<
  Awaited<ReturnType<typeof createPartnerContact>>,
  TError,
  { partnerId: number; data: BodyType<CreatePartnerContactBody> },
  TContext
> => {
  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof createPartnerContact>>,
    { partnerId: number; data: BodyType<CreatePartnerContactBody> }
  > = (props) => createPartnerContact(props.partnerId, props.data, options?.request);
  return useMutation({ mutationFn, ...options?.mutation });
};

export const updatePartnerContact = async (
  partnerId: number,
  contactId: number,
  body: UpdatePartnerContactBody,
  options?: RequestInit,
): Promise<PartnerContact> => {
  return customFetch<PartnerContact>(`/api/partners/${partnerId}/contacts/${contactId}`, {
    ...options,
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...options?.headers },
    body: JSON.stringify(body),
  });
};

export const useUpdatePartnerContact = <TError = ErrorType<unknown>, TContext = unknown>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof updatePartnerContact>>,
    TError,
    { partnerId: number; contactId: number; data: BodyType<UpdatePartnerContactBody> },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationResult<
  Awaited<ReturnType<typeof updatePartnerContact>>,
  TError,
  { partnerId: number; contactId: number; data: BodyType<UpdatePartnerContactBody> },
  TContext
> => {
  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof updatePartnerContact>>,
    { partnerId: number; contactId: number; data: BodyType<UpdatePartnerContactBody> }
  > = (props) => updatePartnerContact(props.partnerId, props.contactId, props.data, options?.request);
  return useMutation({ mutationFn, ...options?.mutation });
};

export const deletePartnerContact = async (
  partnerId: number,
  contactId: number,
  options?: RequestInit,
): Promise<void> => {
  return customFetch<void>(`/api/partners/${partnerId}/contacts/${contactId}`, {
    ...options,
    method: "DELETE",
  });
};

export const useDeletePartnerContact = <TError = ErrorType<unknown>, TContext = unknown>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof deletePartnerContact>>,
    TError,
    { partnerId: number; contactId: number },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationResult<
  Awaited<ReturnType<typeof deletePartnerContact>>,
  TError,
  { partnerId: number; contactId: number },
  TContext
> => {
  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof deletePartnerContact>>,
    { partnerId: number; contactId: number }
  > = (props) => deletePartnerContact(props.partnerId, props.contactId, options?.request);
  return useMutation({ mutationFn, ...options?.mutation });
};

export const listPartnerNotes = async (
  partnerId: number,
  options?: RequestInit,
): Promise<NoteItem[]> => {
  return customFetch<NoteItem[]>(`/api/partners/${partnerId}/notes`, {
    ...options,
    method: "GET",
  });
};

export const getListPartnerNotesQueryKey = (partnerId: number) => {
  return [`/api/partners/${partnerId}/notes`] as const;
};

export const getListPartnerNotesQueryOptions = <
  TData = Awaited<ReturnType<typeof listPartnerNotes>>,
  TError = ErrorType<unknown>,
>(
  partnerId: number,
  options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listPartnerNotes>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
  },
) => {
  const queryKey = getListPartnerNotesQueryKey(partnerId);
  const queryFn: QueryFunction<Awaited<ReturnType<typeof listPartnerNotes>>> = ({ signal }) =>
    listPartnerNotes(partnerId, { signal, ...options?.request });
  return { queryKey, queryFn, enabled: !!partnerId, ...options?.query } as UseQueryOptions<
    Awaited<ReturnType<typeof listPartnerNotes>>,
    TError,
    TData
  > & { queryKey: QueryKey };
};

export const useListPartnerNotes = <
  TData = Awaited<ReturnType<typeof listPartnerNotes>>,
  TError = ErrorType<unknown>,
>(
  partnerId: number,
  options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listPartnerNotes>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
  },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } => {
  const queryOptions = getListPartnerNotesQueryOptions(partnerId, options);
  const query = useQuery(queryOptions) as UseQueryResult<TData, TError> & { queryKey: QueryKey };
  return { ...query, queryKey: queryOptions.queryKey };
};

export const createPartnerNote = async (
  partnerId: number,
  body: CreateNoteBody,
  options?: RequestInit,
): Promise<NoteItem> => {
  return customFetch<NoteItem>(`/api/partners/${partnerId}/notes`, {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...options?.headers },
    body: JSON.stringify(body),
  });
};

export const useCreatePartnerNote = <TError = ErrorType<unknown>, TContext = unknown>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof createPartnerNote>>,
    TError,
    { partnerId: number; data: BodyType<CreateNoteBody> },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationResult<
  Awaited<ReturnType<typeof createPartnerNote>>,
  TError,
  { partnerId: number; data: BodyType<CreateNoteBody> },
  TContext
> => {
  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof createPartnerNote>>,
    { partnerId: number; data: BodyType<CreateNoteBody> }
  > = (props) => createPartnerNote(props.partnerId, props.data, options?.request);
  return useMutation({ mutationFn, ...options?.mutation });
};

export const deletePartnerNote = async (
  partnerId: number,
  noteId: number,
  options?: RequestInit,
): Promise<void> => {
  return customFetch<void>(`/api/partners/${partnerId}/notes/${noteId}`, {
    ...options,
    method: "DELETE",
  });
};

export const useDeletePartnerNote = <TError = ErrorType<unknown>, TContext = unknown>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof deletePartnerNote>>,
    TError,
    { partnerId: number; noteId: number },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationResult<
  Awaited<ReturnType<typeof deletePartnerNote>>,
  TError,
  { partnerId: number; noteId: number },
  TContext
> => {
  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof deletePartnerNote>>,
    { partnerId: number; noteId: number }
  > = (props) => deletePartnerNote(props.partnerId, props.noteId, options?.request);
  return useMutation({ mutationFn, ...options?.mutation });
};

// `listVendorContacts` / `getListVendorContactsQueryKey` /
// `getListVendorContactsQueryOptions` / `useListVendorContacts` now
// come from the orval-generated client in `generated/api.ts` — the
// endpoint is documented in `lib/api-spec/openapi.yaml`.
export const createVendorContact = async (
  vendorId: number,
  body: CreateVendorContactBody,
  options?: RequestInit,
): Promise<VendorContact> => {
  return customFetch<VendorContact>(`/api/vendors/${vendorId}/contacts`, {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...options?.headers },
    body: JSON.stringify(body),
  });
};

export const useCreateVendorContact = <TError = ErrorType<unknown>, TContext = unknown>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof createVendorContact>>,
    TError,
    { vendorId: number; data: BodyType<CreateVendorContactBody> },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationResult<
  Awaited<ReturnType<typeof createVendorContact>>,
  TError,
  { vendorId: number; data: BodyType<CreateVendorContactBody> },
  TContext
> => {
  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof createVendorContact>>,
    { vendorId: number; data: BodyType<CreateVendorContactBody> }
  > = (props) => createVendorContact(props.vendorId, props.data, options?.request);
  return useMutation({ mutationFn, ...options?.mutation });
};

export const updateVendorContact = async (
  vendorId: number,
  contactId: number,
  body: UpdateVendorContactBody,
  options?: RequestInit,
): Promise<VendorContact> => {
  return customFetch<VendorContact>(`/api/vendors/${vendorId}/contacts/${contactId}`, {
    ...options,
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...options?.headers },
    body: JSON.stringify(body),
  });
};

export const useUpdateVendorContact = <TError = ErrorType<unknown>, TContext = unknown>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof updateVendorContact>>,
    TError,
    { vendorId: number; contactId: number; data: BodyType<UpdateVendorContactBody> },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationResult<
  Awaited<ReturnType<typeof updateVendorContact>>,
  TError,
  { vendorId: number; contactId: number; data: BodyType<UpdateVendorContactBody> },
  TContext
> => {
  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof updateVendorContact>>,
    { vendorId: number; contactId: number; data: BodyType<UpdateVendorContactBody> }
  > = (props) => updateVendorContact(props.vendorId, props.contactId, props.data, options?.request);
  return useMutation({ mutationFn, ...options?.mutation });
};

export const deleteVendorContact = async (
  vendorId: number,
  contactId: number,
  options?: RequestInit,
): Promise<void> => {
  return customFetch<void>(`/api/vendors/${vendorId}/contacts/${contactId}`, {
    ...options,
    method: "DELETE",
  });
};

export const useDeleteVendorContact = <TError = ErrorType<unknown>, TContext = unknown>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof deleteVendorContact>>,
    TError,
    { vendorId: number; contactId: number },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationResult<
  Awaited<ReturnType<typeof deleteVendorContact>>,
  TError,
  { vendorId: number; contactId: number },
  TContext
> => {
  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof deleteVendorContact>>,
    { vendorId: number; contactId: number }
  > = (props) => deleteVendorContact(props.vendorId, props.contactId, options?.request);
  return useMutation({ mutationFn, ...options?.mutation });
};

export const listVendorNotes = async (
  vendorId: number,
  options?: RequestInit,
): Promise<NoteItem[]> => {
  return customFetch<NoteItem[]>(`/api/vendors/${vendorId}/notes`, {
    ...options,
    method: "GET",
  });
};

export const getListVendorNotesQueryKey = (vendorId: number) => {
  return [`/api/vendors/${vendorId}/notes`] as const;
};

export const getListVendorNotesQueryOptions = <
  TData = Awaited<ReturnType<typeof listVendorNotes>>,
  TError = ErrorType<unknown>,
>(
  vendorId: number,
  options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listVendorNotes>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
  },
) => {
  const queryKey = getListVendorNotesQueryKey(vendorId);
  const queryFn: QueryFunction<Awaited<ReturnType<typeof listVendorNotes>>> = ({ signal }) =>
    listVendorNotes(vendorId, { signal, ...options?.request });
  return { queryKey, queryFn, enabled: !!vendorId, ...options?.query } as UseQueryOptions<
    Awaited<ReturnType<typeof listVendorNotes>>,
    TError,
    TData
  > & { queryKey: QueryKey };
};

export const useListVendorNotes = <
  TData = Awaited<ReturnType<typeof listVendorNotes>>,
  TError = ErrorType<unknown>,
>(
  vendorId: number,
  options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listVendorNotes>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
  },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } => {
  const queryOptions = getListVendorNotesQueryOptions(vendorId, options);
  const query = useQuery(queryOptions) as UseQueryResult<TData, TError> & { queryKey: QueryKey };
  return { ...query, queryKey: queryOptions.queryKey };
};

export const createVendorNote = async (
  vendorId: number,
  body: CreateNoteBody,
  options?: RequestInit,
): Promise<NoteItem> => {
  return customFetch<NoteItem>(`/api/vendors/${vendorId}/notes`, {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...options?.headers },
    body: JSON.stringify(body),
  });
};

export const useCreateVendorNote = <TError = ErrorType<unknown>, TContext = unknown>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof createVendorNote>>,
    TError,
    { vendorId: number; data: BodyType<CreateNoteBody> },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationResult<
  Awaited<ReturnType<typeof createVendorNote>>,
  TError,
  { vendorId: number; data: BodyType<CreateNoteBody> },
  TContext
> => {
  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof createVendorNote>>,
    { vendorId: number; data: BodyType<CreateNoteBody> }
  > = (props) => createVendorNote(props.vendorId, props.data, options?.request);
  return useMutation({ mutationFn, ...options?.mutation });
};

export const deleteVendorNote = async (
  vendorId: number,
  noteId: number,
  options?: RequestInit,
): Promise<void> => {
  return customFetch<void>(`/api/vendors/${vendorId}/notes/${noteId}`, {
    ...options,
    method: "DELETE",
  });
};

export const useDeleteVendorNote = <TError = ErrorType<unknown>, TContext = unknown>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof deleteVendorNote>>,
    TError,
    { vendorId: number; noteId: number },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationResult<
  Awaited<ReturnType<typeof deleteVendorNote>>,
  TError,
  { vendorId: number; noteId: number },
  TContext
> => {
  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof deleteVendorNote>>,
    { vendorId: number; noteId: number }
  > = (props) => deleteVendorNote(props.vendorId, props.noteId, options?.request);
  return useMutation({ mutationFn, ...options?.mutation });
};

export const listFieldEmployeeNotes = async (
  employeeId: number,
  options?: RequestInit,
): Promise<NoteItem[]> => {
  return customFetch<NoteItem[]>(`/api/field-employees/${employeeId}/notes`, {
    ...options,
    method: "GET",
  });
};

export const getListFieldEmployeeNotesQueryKey = (employeeId: number) => {
  return [`/api/field-employees/${employeeId}/notes`] as const;
};

export const getListFieldEmployeeNotesQueryOptions = <
  TData = Awaited<ReturnType<typeof listFieldEmployeeNotes>>,
  TError = ErrorType<unknown>,
>(
  employeeId: number,
  options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listFieldEmployeeNotes>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
  },
) => {
  const queryKey = getListFieldEmployeeNotesQueryKey(employeeId);
  const queryFn: QueryFunction<Awaited<ReturnType<typeof listFieldEmployeeNotes>>> = ({ signal }) =>
    listFieldEmployeeNotes(employeeId, { signal, ...options?.request });
  return { queryKey, queryFn, enabled: !!employeeId, ...options?.query } as UseQueryOptions<
    Awaited<ReturnType<typeof listFieldEmployeeNotes>>,
    TError,
    TData
  > & { queryKey: QueryKey };
};

export const useListFieldEmployeeNotes = <
  TData = Awaited<ReturnType<typeof listFieldEmployeeNotes>>,
  TError = ErrorType<unknown>,
>(
  employeeId: number,
  options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listFieldEmployeeNotes>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
  },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } => {
  const queryOptions = getListFieldEmployeeNotesQueryOptions(employeeId, options);
  const query = useQuery(queryOptions) as UseQueryResult<TData, TError> & { queryKey: QueryKey };
  return { ...query, queryKey: queryOptions.queryKey };
};

export const createFieldEmployeeNote = async (
  employeeId: number,
  body: CreateNoteBody,
  options?: RequestInit,
): Promise<NoteItem> => {
  return customFetch<NoteItem>(`/api/field-employees/${employeeId}/notes`, {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...options?.headers },
    body: JSON.stringify(body),
  });
};

export const useCreateFieldEmployeeNote = <TError = ErrorType<unknown>, TContext = unknown>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof createFieldEmployeeNote>>,
    TError,
    { employeeId: number; data: BodyType<CreateNoteBody> },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationResult<
  Awaited<ReturnType<typeof createFieldEmployeeNote>>,
  TError,
  { employeeId: number; data: BodyType<CreateNoteBody> },
  TContext
> => {
  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof createFieldEmployeeNote>>,
    { employeeId: number; data: BodyType<CreateNoteBody> }
  > = (props) => createFieldEmployeeNote(props.employeeId, props.data, options?.request);
  return useMutation({ mutationFn, ...options?.mutation });
};

export const deleteFieldEmployeeNote = async (
  employeeId: number,
  noteId: number,
  options?: RequestInit,
): Promise<void> => {
  return customFetch<void>(`/api/field-employees/${employeeId}/notes/${noteId}`, {
    ...options,
    method: "DELETE",
  });
};

export const useDeleteFieldEmployeeNote = <TError = ErrorType<unknown>, TContext = unknown>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof deleteFieldEmployeeNote>>,
    TError,
    { employeeId: number; noteId: number },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationResult<
  Awaited<ReturnType<typeof deleteFieldEmployeeNote>>,
  TError,
  { employeeId: number; noteId: number },
  TContext
> => {
  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof deleteFieldEmployeeNote>>,
    { employeeId: number; noteId: number }
  > = (props) => deleteFieldEmployeeNote(props.employeeId, props.noteId, options?.request);
  return useMutation({ mutationFn, ...options?.mutation });
};

export const updateFieldEmployee = async (
  id: number,
  body: {
    vendorRole?: string;
    jobTitle?: string | null;
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string | null;
    isActive?: boolean;
    pecCertification?: boolean;
    pecExpirationDate?: string | null;
    photoUrl?: string | null;
    profilePhotoPath?: string | null;
    // Task #831: admin-editable preferred UI/assistant language. Server
    // mirrors the value into `users.preferred_language` for the linked
    // login when one exists. `null` clears the preference.
    preferredLanguage?: "en" | "es" | null;
    roles?: string[];
  },
  options?: RequestInit,
): Promise<unknown> => {
  return customFetch<unknown>(`/api/field-employees/${id}`, {
    ...options,
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...options?.headers },
    body: JSON.stringify(body),
  });
};

export const useUpdateFieldEmployee = <TError = ErrorType<unknown>, TContext = unknown>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof updateFieldEmployee>>,
    TError,
    { id: number; data: BodyType<Parameters<typeof updateFieldEmployee>[1]> },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationResult<
  Awaited<ReturnType<typeof updateFieldEmployee>>,
  TError,
  { id: number; data: BodyType<Parameters<typeof updateFieldEmployee>[1]> },
  TContext
> => {
  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof updateFieldEmployee>>,
    { id: number; data: BodyType<Parameters<typeof updateFieldEmployee>[1]> }
  > = (props) => updateFieldEmployee(props.id, props.data, options?.request);
  return useMutation({ mutationFn, ...options?.mutation });
};

export const deletePartner = async (
  id: number,
  options?: RequestInit,
): Promise<void> => {
  return customFetch<void>(`/api/partners/${id}`, {
    ...options,
    method: "DELETE",
  });
};

export const useDeletePartner = <TError = ErrorType<unknown>, TContext = unknown>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof deletePartner>>,
    TError,
    { id: number },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationResult<
  Awaited<ReturnType<typeof deletePartner>>,
  TError,
  { id: number },
  TContext
> => {
  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof deletePartner>>,
    { id: number }
  > = (props) => deletePartner(props.id, options?.request);
  return useMutation({ mutationFn, ...options?.mutation });
};

export const deleteVendor = async (
  id: number,
  options?: RequestInit,
): Promise<void> => {
  return customFetch<void>(`/api/vendors/${id}`, {
    ...options,
    method: "DELETE",
  });
};

export const useDeleteVendor = <TError = ErrorType<unknown>, TContext = unknown>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof deleteVendor>>,
    TError,
    { id: number },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationResult<
  Awaited<ReturnType<typeof deleteVendor>>,
  TError,
  { id: number },
  TContext
> => {
  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof deleteVendor>>,
    { id: number }
  > = (props) => deleteVendor(props.id, options?.request);
  return useMutation({ mutationFn, ...options?.mutation });
};

/**
 * Task #876: the office-app deactivation flow surfaces any open ticket
 * sessions still attached to the just-deactivated worker so the UI can
 * tell staff which foremen will see the row drop on the field side's
 * next 60s refresh (Task #524). The route used to return 204; it now
 * returns this shape so the dialog can render the affected list inline.
 */
export interface DeleteFieldEmployeeOpenSession {
  ticketId: number;
  ticketTrackingNumber: string;
  checkInAt: string;
}
export interface DeleteFieldEmployeeResponse {
  openSessions: DeleteFieldEmployeeOpenSession[];
}

export const deleteFieldEmployee = async (
  id: number,
  options?: RequestInit,
): Promise<DeleteFieldEmployeeResponse> => {
  return customFetch<DeleteFieldEmployeeResponse>(`/api/field-employees/${id}`, {
    ...options,
    method: "DELETE",
  });
};

export const useDeleteFieldEmployee = <TError = ErrorType<unknown>, TContext = unknown>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof deleteFieldEmployee>>,
    TError,
    { id: number },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationResult<
  Awaited<ReturnType<typeof deleteFieldEmployee>>,
  TError,
  { id: number },
  TContext
> => {
  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof deleteFieldEmployee>>,
    { id: number }
  > = (props) => deleteFieldEmployee(props.id, options?.request);
  return useMutation({ mutationFn, ...options?.mutation });
};

export interface VendorAnalytics {
  statusBreakdown: { status: string; count: number }[];
  revenueByType: { type: string; total: number }[];
  revenueByMonth: { month: string; total: number }[];
  revenueByYear: { year: string; total: number }[];
  totalRevenue: number;
  totalTickets: number;
  approvedTickets: number;
  kickedBackTickets: number;
  kickbackRate: number;
  gpsCompliance: { total: number; mismatches: number; rate: number };
  employeePerformance: { employeeId: number; name: string; jobTitle: string | null; ticketCount: number; approvedCount: number; revenue: number }[];
  topWorkTypes: { workType: string; count: number; revenue: number }[];
  bySite: { siteId: number; siteName: string; ticketCount: number; revenue: number }[];
}

export interface PartnerAnalytics {
  statusBreakdown: { status: string; count: number }[];
  totalTickets: number;
  approvedTickets: number;
  kickedBackTickets: number;
  submittedTickets: number;
  activeTickets: number;
  totalCost: number;
  costByVendor: { vendorId: number; vendorName: string; ticketCount: number; totalCost: number; approvedCount: number; kickedBackCount: number }[];
  costBySite: { siteId: number; siteName: string; ticketCount: number; totalCost: number }[];
  costByMonth: { month: string; total: number }[];
  costByYear: { year: string; total: number }[];
  costByType: { type: string; total: number }[];
  gpsCompliance: { total: number; mismatches: number; rate: number };
  topWorkTypes: { workType: string; count: number; cost: number }[];
}

export const getVendorAnalytics = async (
  vendorId: number,
  options?: RequestInit,
): Promise<VendorAnalytics> => {
  return customFetch<VendorAnalytics>(`/api/analytics/vendor/${vendorId}`, {
    ...options,
    method: "GET",
  });
};

export const getVendorAnalyticsQueryKey = (vendorId: number) => {
  return [`/api/analytics/vendor/${vendorId}`] as const;
};

export const useVendorAnalytics = <
  TData = VendorAnalytics,
  TError = ErrorType<unknown>,
>(
  vendorId: number,
  options?: {
    query?: UseQueryOptions<VendorAnalytics, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
  },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } => {
  const queryKey = getVendorAnalyticsQueryKey(vendorId);
  const queryFn: QueryFunction<VendorAnalytics> = ({ signal }) =>
    getVendorAnalytics(vendorId, { signal, ...options?.request });
  const queryOptions = { queryKey, queryFn, enabled: !!vendorId, ...options?.query } as UseQueryOptions<
    VendorAnalytics, TError, TData
  > & { queryKey: QueryKey };
  const query = useQuery(queryOptions) as UseQueryResult<TData, TError> & { queryKey: QueryKey };
  return { ...query, queryKey };
};

export const getPartnerAnalytics = async (
  partnerId: number,
  options?: RequestInit,
): Promise<PartnerAnalytics> => {
  return customFetch<PartnerAnalytics>(`/api/analytics/partner/${partnerId}`, {
    ...options,
    method: "GET",
  });
};

export const getPartnerAnalyticsQueryKey = (partnerId: number) => {
  return [`/api/analytics/partner/${partnerId}`] as const;
};

export const usePartnerAnalytics = <
  TData = PartnerAnalytics,
  TError = ErrorType<unknown>,
>(
  partnerId: number,
  options?: {
    query?: UseQueryOptions<PartnerAnalytics, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
  },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } => {
  const queryKey = getPartnerAnalyticsQueryKey(partnerId);
  const queryFn: QueryFunction<PartnerAnalytics> = ({ signal }) =>
    getPartnerAnalytics(partnerId, { signal, ...options?.request });
  const queryOptions = { queryKey, queryFn, enabled: !!partnerId, ...options?.query } as UseQueryOptions<
    PartnerAnalytics, TError, TData
  > & { queryKey: QueryKey };
  const query = useQuery(queryOptions) as UseQueryResult<TData, TError> & { queryKey: QueryKey };
  return { ...query, queryKey };
};

export const deleteSiteLocation = async (
  id: number,
  options?: RequestInit,
): Promise<void> => {
  return customFetch<void>(`/api/site-locations/${id}`, {
    ...options,
    method: "DELETE",
  });
};

export const useDeleteSiteLocation = <TError = ErrorType<unknown>, TContext = unknown>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof deleteSiteLocation>>,
    TError,
    { id: number },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationResult<
  Awaited<ReturnType<typeof deleteSiteLocation>>,
  TError,
  { id: number },
  TContext
> => {
  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof deleteSiteLocation>>,
    { id: number }
  > = (props) => deleteSiteLocation(props.id, options?.request);
  return useMutation({ mutationFn, ...options?.mutation });
};

interface VendorRatingItem {
  id: number;
  vendorId: number;
  partnerId: number;
  partnerName: string;
  userId: number;
  userDisplayName: string;
  ticketId: number | null;
  rating: number;
  review: string | null;
  createdAt: string;
  updatedAt: string;
}

interface GetVendorRatingsResponse {
  average: number | null;
  count: number;
  myRating: VendorRatingItem | null;
  items: VendorRatingItem[];
}

interface UpsertVendorRatingBody {
  rating: number;
  review?: string | null;
  // When set, attaches the rating to a specific ticket. The server
  // inserts a NEW row (or updates that ticket's existing row),
  // contributing one more sample to the vendor's running average.
  // Omit for the standalone per-partner "Your Rating" panel on the
  // vendor page.
  ticketId?: number | null;
}

export const getVendorRatings = async (
  vendorId: number,
  options?: RequestInit,
): Promise<GetVendorRatingsResponse> => {
  return customFetch<GetVendorRatingsResponse>(`/api/vendors/${vendorId}/ratings`, {
    ...options,
    method: "GET",
  });
};

export const getGetVendorRatingsQueryKey = (vendorId: number) => {
  return [`/api/vendors/${vendorId}/ratings`] as const;
};

export const useGetVendorRatings = <
  TData = Awaited<ReturnType<typeof getVendorRatings>>,
  TError = ErrorType<unknown>,
>(
  vendorId: number,
  options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getVendorRatings>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
  },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } => {
  const queryKey = getGetVendorRatingsQueryKey(vendorId);
  const queryFn: QueryFunction<Awaited<ReturnType<typeof getVendorRatings>>> = ({ signal }) =>
    getVendorRatings(vendorId, { signal, ...options?.request });
  const queryOptions = { queryKey, queryFn, enabled: !!vendorId, ...options?.query } as UseQueryOptions<
    Awaited<ReturnType<typeof getVendorRatings>>,
    TError,
    TData
  > & { queryKey: QueryKey };
  const query = useQuery(queryOptions) as UseQueryResult<TData, TError> & { queryKey: QueryKey };
  return { ...query, queryKey };
};

export const upsertVendorRating = async (
  vendorId: number,
  body: UpsertVendorRatingBody,
  options?: RequestInit,
): Promise<VendorRatingItem> => {
  return customFetch<VendorRatingItem>(`/api/vendors/${vendorId}/ratings`, {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...options?.headers },
    body: JSON.stringify(body),
  });
};

export const useUpsertVendorRating = <TError = ErrorType<unknown>, TContext = unknown>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof upsertVendorRating>>,
    TError,
    { vendorId: number; data: BodyType<UpsertVendorRatingBody> },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationResult<
  Awaited<ReturnType<typeof upsertVendorRating>>,
  TError,
  { vendorId: number; data: BodyType<UpsertVendorRatingBody> },
  TContext
> => {
  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof upsertVendorRating>>,
    { vendorId: number; data: BodyType<UpsertVendorRatingBody> }
  > = (props) => upsertVendorRating(props.vendorId, props.data, options?.request);
  return useMutation({ mutationFn, ...options?.mutation });
};

export const deleteVendorRating = async (
  vendorId: number,
  options?: RequestInit,
): Promise<void> => {
  return customFetch<void>(`/api/vendors/${vendorId}/ratings`, {
    ...options,
    method: "DELETE",
  });
};

export const useDeleteVendorRating = <TError = ErrorType<unknown>, TContext = unknown>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof deleteVendorRating>>,
    TError,
    { vendorId: number },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationResult<
  Awaited<ReturnType<typeof deleteVendorRating>>,
  TError,
  { vendorId: number },
  TContext
> => {
  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof deleteVendorRating>>,
    { vendorId: number }
  > = (props) => deleteVendorRating(props.vendorId, options?.request);
  return useMutation({ mutationFn, ...options?.mutation });
};

