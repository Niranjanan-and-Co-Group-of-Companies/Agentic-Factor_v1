import { redirect } from "next/navigation";

// Approvals now happen in the chat: each mission's chat shows its approval card, and the Command
// Center lists everything waiting on you. Old links and bookmarks land there.
export default function ApprovalsPage() {
  redirect("/dashboard");
}
