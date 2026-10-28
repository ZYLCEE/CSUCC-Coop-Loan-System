export type MembershipType = "regular" | "associate" | null;
export type MembershipTypeFilter =
  | "All Members"
  | "Regular Member"
  | "Associate Member";

const membershipAssignmentsStorageKey = "coop.membershipTypeAssignments";

export const membershipTypeFilterOptions: MembershipTypeFilter[] = [
  "All Members",
  "Regular Member",
  "Associate Member",
];

export const membershipTypeOptions: {
  value: Exclude<MembershipType, null>;
  label: string;
}[] = [
  { value: "regular", label: "Regular Member" },
  { value: "associate", label: "Associate Member" },
];

export const getMembershipTypeLabel = (membershipType: MembershipType) => {
  if (membershipType === "regular") {
    return "Regular Member";
  }

  if (membershipType === "associate") {
    return "Associate Member";
  }

  return "Not Set";
};

export function normalizeMembershipType(value: unknown): MembershipType {
  if (typeof value !== "string") {
    return null;
  }

  const normalizedValue = value.trim().toLowerCase();
  return normalizedValue === "regular" || normalizedValue === "associate"
    ? normalizedValue
    : null;
}

export const normalizeMembershipMemberId = (memberId: string) =>
  memberId.trim().replace(/^CSUCC-/i, "").toLowerCase();

export function readMembershipTypeAssignments(): Record<
  string,
  Exclude<MembershipType, null>
> {
  if (typeof window === "undefined") {
    return {};
  }

  const storedAssignments = window.localStorage.getItem(
    membershipAssignmentsStorageKey
  );
  if (!storedAssignments) {
    return {};
  }

  let assignments: unknown;
  try {
    assignments = JSON.parse(storedAssignments);
  } catch (error) {
    console.error("Failed to read locally saved membership types:", error);
    return {};
  }

  if (
    typeof assignments !== "object" ||
    assignments === null ||
    Array.isArray(assignments)
  ) {
    console.error("Locally saved membership types have an invalid format.");
    return {};
  }

  return Object.fromEntries(
    Object.entries(assignments).filter(
      (entry): entry is [string, Exclude<MembershipType, null>] =>
        entry[1] === "regular" || entry[1] === "associate"
    )
  );
}

export function saveMembershipTypeAssignment(
  memberId: string,
  membershipType: MembershipType
) {
  const normalizedMemberId = normalizeMembershipMemberId(memberId);
  if (!normalizedMemberId) {
    return;
  }

  const assignments = readMembershipTypeAssignments();
  if (membershipType === null) {
    delete assignments[normalizedMemberId];
  } else {
    assignments[normalizedMemberId] = membershipType;
  }

  window.localStorage.setItem(
    membershipAssignmentsStorageKey,
    JSON.stringify(assignments)
  );
}
