export type InsightsReport = {
  snapshot: string[];
  themes: string[];
  positive: string[];
  concerns: string[];
  competitiveLosses: string[];
  programReception: string[];
  eContracting: string[];
  newProgram: string[];
  watchItems: string[];
};

export type DealerNoteRow = {
  id: string;
  dealer_id: string;
  author_username: string;
  created_at: string;
  category: string;
  text: string;
};

export type DealerInfo = {
  name: string;
  state: string;
  region: string;
};

export type EnrichedNote = DealerNoteRow & {
  dealer: DealerInfo | null;
};

export type InsightsResult = {
  noteCount: number;
  truncated: boolean;
  rangeLabel: string;
  model: string;
  report: InsightsReport | null;
  message?: string;
};

export type WeeklyReportingWindow = {
  timezone: string;
  startISO: string;
  endISO: string;
  rangeLabel: string;
  startLocal: string;
  endLocal: string;
};

export class HttpError extends Error {
  status: number;
  details?: Record<string, unknown>;
  constructor(status: number, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.details = details;
  }
}

export class InsightsTimeoutError extends Error {
  constructor(message = "Insights timed out. Try a smaller date range.") {
    super(message);
    this.name = "InsightsTimeoutError";
  }
}

export class InsightsModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InsightsModelError";
  }
}
