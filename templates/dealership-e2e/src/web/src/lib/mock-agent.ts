import type { DealStage, MockScenario, Vehicle } from "@/lib/types";

const EMAIL_REGEX = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;

export const SHORTLISTED_VEHICLES: Vehicle[] = [
  {
    id: "ioniq-5-limited",
    year: 2023,
    make: "Hyundai",
    model: "IONIQ 5 Limited AWD",
    priceUsd: 37990,
    rangeMiles: 303,
    seats: 5
  },
  {
    id: "mach-e-select",
    year: 2022,
    make: "Ford",
    model: "Mustang Mach-E Select",
    priceUsd: 36450,
    rangeMiles: 312,
    seats: 5
  },
  {
    id: "tesla-model-3",
    year: 2022,
    make: "Tesla",
    model: "Model 3 Long Range",
    priceUsd: 37800,
    rangeMiles: 333,
    seats: 5
  }
];

function hasAny(input: string, terms: string[]): boolean {
  return terms.some((term) => input.includes(term));
}

export function buildMockScenario(input: {
  latestMessage: string;
  email?: string;
  stage?: DealStage;
}): MockScenario {
  const lower = input.latestMessage.toLowerCase();
  const extractedEmail = input.email ?? input.latestMessage.match(EMAIL_REGEX)?.[0];

  if (hasAny(lower, ["compare", "comparison", "side by side"])) {
    return {
      assistantReply:
        "Here's a quick comparison of the shortlist:\n\n" +
        "| Model | Price | Range |\n" +
        "| --- | --- | --- |\n" +
        "| IONIQ 5 Limited AWD | $37,990 | 303 mi |\n" +
        "| Mustang Mach-E Select | $36,450 | 312 mi |\n\n" +
        "**IONIQ 5** has the most cargo room if that matters for you.",
      vehicles: SHORTLISTED_VEHICLES,
      stage: input.stage ?? "shortlisted"
    };
  }

  if (hasAny(lower, ["payment", "monthly", "finance", "apr"])) {
    return {
      assistantReply:
        "Demo estimate only: $589/month for 72 months at up to 6.4% APR, with $2,500 down. No sandbox calculation was run.",
      stage: input.stage ?? "shortlisted"
    };
  }

  if (extractedEmail) {
    return {
      assistantReply: "Email noted for this demo. Application submission is not connected.",
      stage: input.stage ?? "shortlisted"
    };
  }

  if (
    hasAny(lower, [
      "ev",
      "electric",
      "car seat",
      "range",
      "under",
      "shortlist",
      "find car"
    ])
  ) {
    return {
      assistantReply:
        "Great constraints. I found three EVs under $38k with 250+ miles and rear-seat room for a car seat. Want me to estimate monthly payment next?",
      vehicles: SHORTLISTED_VEHICLES,
      stage: "shortlisted"
    };
  }

  return {
    assistantReply:
      "I can help with sample vehicle searches and payment estimates. Application submission is not connected. Try: “EV under $38k, 250+ miles, room for a car seat.”",
    stage: input.stage ?? "idle"
  };
}

