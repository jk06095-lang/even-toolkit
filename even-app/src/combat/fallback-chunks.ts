/**
 * Fallback Chunks — static chunk pool for offline / API failure scenarios.
 * Organized by category and difficulty level.
 */

export type ChunkCategory = 'general' | 'nampodong' | 'business' | 'travel' | 'food';

interface ChunkPool {
  week1: string[];  // full starter phrases
  week2: string[];  // template connectors
  week3: string[];  // keywords only
  week4: string[];  // single nudge words
}

const POOLS: Record<ChunkCategory, ChunkPool> = {
  general: {
    week1: [
      "I'd recommend",
      "What I mean is",
      "The thing about",
      "I'm planning to",
      "It depends on",
      "What stands out is",
      "I'd say that",
      "To be honest",
      "In my experience",
      "The reason is that",
      "What I enjoy most",
      "I've always thought",
    ],
    week2: [
      "Not only A but also B",
      "In terms of",
      "Rather than",
      "What makes it special",
      "Compared to",
      "On the other hand",
      "The way I see it",
      "Speaking of which",
    ],
    week3: [
      "authentic vibe",
      "worth exploring",
      "hidden gem",
      "local favorite",
      "unique experience",
      "highly recommend",
    ],
    week4: [
      "basically",
      "moreover",
      "honestly",
      "indeed",
      "actually",
      "specifically",
    ],
  },

  nampodong: {
    week1: [
      "I'd recommend visiting",
      "The best spot is",
      "You should definitely try",
      "If you like seafood",
      "It's famous for",
      "The atmosphere is",
      "You can find it near",
      "It's a local favorite",
      "What makes it special",
      "The best time to visit",
      "It's right next to",
      "I always go to",
    ],
    week2: [
      "Not only the food but",
      "In terms of atmosphere",
      "What sets it apart",
      "Compared to Haeundae",
      "The reason locals prefer",
      "Speaking of street food",
      "Rather than tourist spots",
      "What I love about it",
    ],
    week3: [
      "Gukje Market vibes",
      "street food paradise",
      "BIFF square culture",
      "Jagalchi fresh catch",
      "hidden alley gems",
      "Yongdusan sunset",
    ],
    week4: [
      "definitely",
      "absolutely",
      "personally",
      "essentially",
      "particularly",
      "genuinely",
    ],
  },

  business: {
    week1: [
      "I'd like to propose",
      "From our perspective",
      "The key advantage is",
      "What we've found is",
      "I'd suggest that",
      "The data shows that",
      "Moving forward we",
      "Our approach involves",
    ],
    week2: [
      "In terms of ROI",
      "Leveraging our resources",
      "Not only cost-effective but",
      "What differentiates us",
      "Compared to competitors",
      "The bottom line is",
    ],
    week3: [
      "scalable solution",
      "market opportunity",
      "value proposition",
      "competitive edge",
      "strategic alignment",
    ],
    week4: [
      "essentially",
      "fundamentally",
      "strategically",
      "precisely",
      "ultimately",
    ],
  },

  travel: {
    week1: [
      "I'd recommend taking",
      "The easiest way is",
      "You should check out",
      "It's about a",
      "The best route is",
      "Don't miss the",
      "I'd suggest starting",
      "It's located near",
    ],
    week2: [
      "In terms of distance",
      "Rather than taking a taxi",
      "What I'd suggest is",
      "Compared to other areas",
      "The most scenic route",
      "Speaking of transportation",
    ],
    week3: [
      "walkable distance",
      "scenic overlook",
      "must-see attraction",
      "local landmark",
      "worth the detour",
    ],
    week4: [
      "nearby",
      "basically",
      "roughly",
      "approximately",
      "actually",
    ],
  },

  food: {
    week1: [
      "You should definitely try",
      "It's known for its",
      "The specialty here is",
      "I'd recommend ordering",
      "It tastes amazing with",
      "The portion size is",
      "They're famous for their",
      "What I usually get is",
    ],
    week2: [
      "In terms of flavor",
      "What makes it unique",
      "Compared to regular",
      "Not only delicious but",
      "The secret ingredient is",
      "Speaking of local cuisine",
    ],
    week3: [
      "authentic flavor",
      "must-try dish",
      "fresh ingredients",
      "local specialty",
      "street food heaven",
    ],
    week4: [
      "delicious",
      "absolutely",
      "incredible",
      "basically",
      "honestly",
    ],
  },
};

/**
 * Get a random fallback chunk for the given category.
 * Week is selected randomly if not tracking state.
 */
export function getRandomFallbackChunk(
  category: ChunkCategory,
  week?: number,
): string {
  const pool = POOLS[category] ?? POOLS.general;
  const weekKey = `week${week ?? Math.ceil(Math.random() * 2)}` as keyof ChunkPool;
  const list = pool[weekKey];
  return list[Math.floor(Math.random() * list.length)]!;
}

/**
 * Get a chunk for a specific week level.
 */
export function getFallbackChunkForWeek(
  category: ChunkCategory,
  week: number,
): string {
  const pool = POOLS[category] ?? POOLS.general;
  const clamped = Math.max(1, Math.min(4, week));
  const weekKey = `week${clamped}` as keyof ChunkPool;
  const list = pool[weekKey];
  return list[Math.floor(Math.random() * list.length)]!;
}
