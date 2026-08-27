import { redirect } from 'next/navigation';

// Everything about a mission is handled through the AI chat interface.
// This route exists only to forward old links and navigation to the chat page.
export default async function MissionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/dashboard/missions/${id}/chat`);
}
