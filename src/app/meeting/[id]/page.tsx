import MeetingRoom from "@/components/MeetingRoom";

type Props = { params: { id: string } };

export default function MeetingPage({ params }: Props) {
  const sessionId = Number(params.id);
  if (Number.isNaN(sessionId)) {
    return <div className="start-page">Invalid session ID</div>;
  }
  return <MeetingRoom sessionId={sessionId} />;
}
