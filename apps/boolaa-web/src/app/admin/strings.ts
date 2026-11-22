// Internal moderation tool: English only, deliberately outside next-intl (messages/*.json).

export const REASON_LABEL: Record<string, string> = {
  spam: "Spam",
  harassment: "Harassment",
  hate: "Hate",
  sexual: "Sexual content",
  violence: "Violence",
  self_harm: "Self-harm",
  other: "Other",
};

export const TARGET_LABEL: Record<string, string> = {
  user: "Profile",
  chat_message: "Chat message",
  event: "Event",
  food_post: "Food post",
  market_item: "Marketplace item",
  shared_link: "Shared link",
};

export const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  suspended: "Suspended",
  banned: "Banned",
};

export const A = {
  pageTitle: "Moderation",
  heading: "Moderation",
  sla: "Act on every report within 24 hours. Self-harm reports: immediately.",
  tabReports: "Reports",
  tabUsers: "Users",
  queue: { open: "Open", actioned: "Actioned", dismissed: "Dismissed" } as Record<string, string>,
  refresh: "Refresh",
  loading: "Loading…",
  empty: { open: "No open reports. All caught up.", actioned: "No actioned reports yet.", dismissed: "No dismissed reports yet." } as Record<string, string>,
  loadMore: "Load more",
  linked: "Linked from the alert email",
  urgent: "Urgent",
  contentDeleted: "Content deleted",
  profileReport: "Report about the person, not a post",
  reportedBy: "reported",
  in: "in",
  noBubble: "no bubble",
  deletedUser: "(deleted user)",
  openReports30d: (n: number) => `${n} open report${n === 1 ? "" : "s"} against this user (30 days)`,
  onTarget: (n: number) => `${n} open on this target`,
  details: "Reporter's note",
  context: "Context",
  showContext: "Show context",
  hideContext: "Hide context",
  noContext: "No surrounding messages.",
  related: "Other reports on this target",
  history: "Audit log",
  handled: (status: string, when: string) => `${status} ${when}`,
  note: "Note (optional, stays internal)",
  notePlaceholder: "Why you chose this action",
  actions: {
    dismiss: "Dismiss",
    delete_content: "Delete content",
    remove_from_bubble: "Remove from bubble",
    suspend1: "Suspend 1 day",
    suspend7: "Suspend 7 days",
    suspend30: "Suspend 30 days",
    ban: "Ban",
  },
  confirm: {
    title: "Confirm action",
    cancel: "Cancel",
    go: "Confirm",
    working: "Working…",
    dismiss: (who: string) => `Dismiss this report about ${who}? It and the other open reports on the same target are closed without action.`,
    delete_content: (what: string) => `Delete this ${what.toLowerCase()} for everyone? This can't be undone. Uploaded images stay in storage (see docs/moderation.md).`,
    remove_from_bubble: (who: string, bubble: string) =>
      `Remove ${who} from ${bubble}? If they own it, ownership passes to the longest-standing member. They can only come back by invite.`,
    suspend: (who: string, days: number) =>
      `Suspend ${who} for ${days} day${days === 1 ? "" : "s"}? They are signed out within the hour, can't sign in or see anything until then, and their posts stay visible.`,
    ban: (who: string) =>
      `Ban ${who}? They can't sign in again and are removed from every bubble. Their posts stay visible. You can lift a ban from the Users tab.`,
    unsuspend: (who: string) => `Lift the suspension or ban of ${who}? They can sign in again straight away.`,
  },
  done: {
    dismiss: "Report dismissed.",
    delete_content: "Content deleted.",
    remove_from_bubble: "Removed from the bubble.",
    suspend: "User suspended.",
    ban: "User banned.",
    unsuspend: "Access restored.",
  } as Record<string, string>,
  duplicatesClosed: (n: number) => (n > 0 ? ` ${n} duplicate report${n === 1 ? "" : "s"} closed too.` : ""),
  users: {
    search: "Search by name or user id",
    hint: "Type at least 2 characters.",
    none: "No users found.",
    name: "Name",
    id: "User id",
    status: "Status",
    until: "Until",
    reports: "Open reports (30 d) / total",
    bubbles: "Bubbles",
    unsuspend: "Lift suspension",
    unban: "Lift ban",
    ended: "ended",
  },
  errors: {
    notVerified: "This session hasn't passed the device check yet.",
    verifyLink: "Verify this device",
    generic: "Something went wrong.",
  },
  ago: (ms: number) => {
    const m = Math.max(0, Math.round(ms / 60000));
    if (m < 1) return "just now";
    if (m < 60) return `${m} min ago`;
    const h = Math.floor(m / 60);
    if (h < 48) return `${h} h ${m % 60} min ago`;
    return `${Math.floor(h / 24)} days ago`;
  },
};
