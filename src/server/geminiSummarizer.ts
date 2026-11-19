import { GoogleGenAI, Type } from '@google/genai';

const GEMINI_MODEL = 'gemini-4-hydrogen';
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 15;

const requestTimestampsByUid = new Map<string, number[]>();

export interface SummarizerEventInput {
  id: string;
  eventType: string;
  branch: string;
  commitSha: string;
  title: string;
  description: string;
  changedFiles: string[];
  occurredAt: string;
  sourceUrl: string;
  author?: string;
}

export interface SummarizerResult {
  ok: boolean;
  status: 'ready' | 'unavailable' | 'failed';
  summary?: string;
  evidence?: string[];
  inferences?: string[];
  suggestedNextSteps?: string[];
  areasInvolved?: string[];
  model?: string;
  reason?: string;
}

function checkRateLimit(uid: string): boolean {
  const now = Date.now();
  const timestamps = (requestTimestampsByUid.get(uid) ?? []).filter(
    (ts) => now - ts < RATE_LIMIT_WINDOW_MS
  );
  if (timestamps.length >= RATE_LIMIT_MAX_REQUESTS) {
    requestTimestampsByUid.set(uid, timestamps);
    return false;
  }
  timestamps.push(now);
  requestTimestampsByUid.set(uid, timestamps);
  return true;
}

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = (process.env.GEMINI_API_KEY ?? '').trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function summarizeRepositoryActivity(
  uid: string,
  repositoryFullName: string,
  events: SummarizerEventInput[]
): Promise<SummarizerResult> {
  if (events.length === 0) {
    return { ok: false, status: 'failed', reason: 'No activity events supplied.' };
  }

  const ai = getGeminiClient();
  if (!ai) {
    return {
      ok: false,
      status: 'unavailable',
      reason:
        'GEMINI_API_KEY is not configured on the server. Raw GitHub events were recorded without AI summaries.',
    };
  }

  if (!checkRateLimit(uid)) {
    return {
      ok: false,
      status: 'unavailable',
      reason:
        'Rate limit reached for automated summaries (15 requests/min). Raw events remain saved.',
    };
  }

  const trimmedEvents = events.slice(0, 12).map((ev) => ({
    eventType: ev.eventType,
    branch: ev.branch,
    commitSha: ev.commitSha ? ev.commitSha.slice(0, 12) : '',
    title: ev.title.slice(0, 240),
    description: ev.description.slice(0, 600),
    changedFiles: ev.changedFiles.slice(0, 25),
    occurredAt: ev.occurredAt,
    author: ev.author || 'unknown',
    sourceUrl: ev.sourceUrl,
  }));

  const prompt = [
    `Analyze the following GitHub activity metadata for repository "${repositoryFullName}".`,
    '',
    'STRICT GROUNDING RULES:',
    '1. Distinguish Verified GitHub Facts (commits, branches, changed file paths, PR/issue titles/states) from Inferences from Metadata (possible focus area) and AI-generated Suggested Next Steps.',
    '2. NEVER claim a feature or milestone was completed or verified simply because files were modified.',
    '3. NEVER invent technical decisions, test results, hours worked, or blockers not explicitly stated in the supplied metadata.',
    '4. If changedFiles or descriptions are sparse, clearly note that metadata is limited.',
    '5. Keep summary concise (2-4 sentences).',
    '',
    'EVENTS METADATA JSON:',
    JSON.stringify(trimmedEvents, null, 2),
  ].join('\n');

  let lastError: unknown = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: prompt,
        config: {
          systemInstruction:
            'You are a careful engineering activity summarizer. Report only verifiable facts from GitHub metadata, label inferences cautiously, and suggest practical verification next steps.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              summary: {
                type: Type.STRING,
                description:
                  'Concise 2-4 sentence summary grounded strictly in the provided GitHub events.',
              },
              evidence: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description:
                  'Verified facts directly observable in the commit messages, PRs, issues, or file paths.',
              },
              inferences: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description:
                  'Cautiously phrased inferences derived from metadata (never presented as certainty).',
              },
              suggestedNextSteps: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: 'Suggested next verification or development steps for the developer.',
              },
              areasInvolved: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: 'Code directories or areas touched based on changedFiles.',
              },
            },
            required: ['summary', 'evidence', 'inferences', 'suggestedNextSteps', 'areasInvolved'],
          },
        },
      });

      const rawText = response.text;
      if (!rawText) {
        throw new Error('Empty response returned from Gemini.');
      }

      const parsed = JSON.parse(rawText) as {
        summary?: string;
        evidence?: string[];
        inferences?: string[];
        suggestedNextSteps?: string[];
        areasInvolved?: string[];
      };

      const cleanList = (arr: unknown, max: number) =>
        Array.isArray(arr)
          ? arr.map((x) => String(x).trim().slice(0, 300)).filter(Boolean).slice(0, max)
          : [];

      const summaryText = String(parsed.summary ?? '').trim().slice(0, 3000);
      if (!summaryText) {
        throw new Error('Gemini response omitted summary field.');
      }

      return {
        ok: true,
        status: 'ready',
        summary: summaryText,
        evidence: cleanList(parsed.evidence, 20),
        inferences: cleanList(parsed.inferences, 15),
        suggestedNextSteps: cleanList(parsed.suggestedNextSteps, 12),
        areasInvolved: cleanList(parsed.areasInvolved, 20),
        model: GEMINI_MODEL,
      };
    } catch (err) {
      lastError = err;
      if (attempt === 0) {
        await sleep(600);
      }
    }
  }

  return {
    ok: false,
    status: 'failed',
    reason:
      lastError instanceof Error
        ? `Gemini summarization failed: ${lastError.message.slice(0, 200)}`
        : 'Gemini summarization failed. Raw events remain saved.',
  };
}
