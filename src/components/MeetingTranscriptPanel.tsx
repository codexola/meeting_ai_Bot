"use client";

import type { LiveSession, Utterance, ResponseChunk } from "@/lib/api";

const LANG_LABEL: Record<string, string> = {
  en: "English",
  ja: "Japanese",
  es: "Spanish",
  pt: "Portuguese",
  zh: "Chinese",
  vi: "Vietnamese",
  fr: "French",
  de: "German",
};

function langLabel(code: string | null | undefined): string {
  if (!code) return "";
  return LANG_LABEL[code] || code.toUpperCase();
}

function buildQaBlocks(utterances: Utterance[], responses: ResponseChunk[]) {
  const blocks: {
    speaker: string;
    question: string;
    lang: string | null;
    answers: ResponseChunk[];
  }[] = [];

  for (const u of utterances) {
    const answers = responses.filter((r) => r.prompt_text === u.text);
    blocks.push({
      speaker: u.speaker,
      question: u.text,
      lang: u.detected_language ?? null,
      answers,
    });
  }

  const orphanResponses = responses.filter(
    (r) => !utterances.some((u) => u.text === r.prompt_text)
  );
  if (orphanResponses.length) {
    blocks.push({
      speaker: "AI",
      question: "(prior context)",
      lang: null,
      answers: orphanResponses,
    });
  }

  return blocks;
}

type Props = {
  live: LiveSession | null;
  emptyMessage?: string;
};

export default function MeetingTranscriptPanel({ live, emptyMessage }: Props) {
  if (!live || live.utterances.length === 0) {
    return (
      <div className="transcript">
        {emptyMessage || "Client speech appears here after you click Start Meeting…"}
      </div>
    );
  }

  const blocks = buildQaBlocks(live.utterances, live.responses);

  return (
    <div className="transcript qa-transcript">
      {blocks.map((block, i) => (
        <div key={`${block.speaker}-${i}`} className="qa-block">
          <div className="qa-question">
            <strong>{block.speaker}</strong>
            {block.lang && <span className="qa-lang"> · {langLabel(block.lang)}</span>}
            <div>{block.question}</div>
          </div>
          {block.answers.map((a) => (
            <div key={`${a.index}-${a.text.slice(0, 20)}`} className="qa-answer">
              <div className="qa-answer-label">Your answer</div>
              <div>{a.text}</div>
              {a.phonetic && <div className="qa-phonetic">{a.phonetic}</div>}
            </div>
          ))}
          {block.answers.length === 0 && (
            <div className="qa-pending muted tiny">Generating answer…</div>
          )}
        </div>
      ))}
    </div>
  );
}
