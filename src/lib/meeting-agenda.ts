// src/lib/meeting-agenda.ts
//
// Priority 12 — shared shape for the additive `agenda` field on meeting docs.
//
// agenda: Array<{ id, title, notes, order }>, user-editable, persisted via
// PATCH /api/meetings/[id]/agenda (zod-validated, capped). Sections are
// stored sorted by `order` with `order` normalized to the array index.

import { z } from "zod";

export const MAX_AGENDA_SECTIONS = 50;
export const MAX_AGENDA_TITLE_LENGTH = 300;
export const MAX_AGENDA_NOTES_LENGTH = 4000;

export const agendaSectionSchema = z.object({
  id: z.string().trim().min(1).max(64),
  title: z.string().trim().min(1).max(MAX_AGENDA_TITLE_LENGTH),
  notes: z.string().max(MAX_AGENDA_NOTES_LENGTH).optional().default(""),
  order: z.number().int().min(0).max(9999),
});

export const agendaPatchSchema = z
  .object({
    agenda: z.array(agendaSectionSchema).max(MAX_AGENDA_SECTIONS),
  })
  .strict();

export type MeetingAgendaSection = z.infer<typeof agendaSectionSchema>;

/**
 * Sort by `order` (stable for ties) and re-number `order` to the array index
 * so the stored document is always canonical.
 */
export const normalizeAgendaSections = (
  sections: MeetingAgendaSection[]
): MeetingAgendaSection[] =>
  sections
    .map((section, index) => ({ section, index }))
    .sort(
      (a, b) => a.section.order - b.section.order || a.index - b.index
    )
    .map(({ section }, index) => ({
      id: section.id,
      title: section.title,
      notes: section.notes ?? "",
      order: index,
    }));

/**
 * Defensive read of a meeting doc's `agenda` field (may be absent, or
 * malformed on legacy docs). Only well-formed sections are returned.
 */
export const readMeetingAgenda = (meeting: any): MeetingAgendaSection[] => {
  const raw = Array.isArray(meeting?.agenda) ? meeting.agenda : [];
  const sections: MeetingAgendaSection[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const id = typeof entry.id === "string" ? entry.id.trim() : "";
    const title = typeof entry.title === "string" ? entry.title.trim() : "";
    if (!id || !title) continue;
    sections.push({
      id,
      title,
      notes: typeof entry.notes === "string" ? entry.notes : "",
      order:
        typeof entry.order === "number" && Number.isFinite(entry.order)
          ? entry.order
          : sections.length,
    });
  }
  return normalizeAgendaSections(sections);
};

/** True when a meeting has no usable agenda sections yet. */
export const meetingNeedsAgenda = (meeting: any): boolean =>
  readMeetingAgenda(meeting).length === 0;
