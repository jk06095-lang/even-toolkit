/**
 * Topic Registry — central data module for all conversation scenarios.
 * Each scenario includes practical fill-in expressions and Gem prompts.
 */

export type TopicCategory = 'daily' | 'travel' | 'business' | 'social' | 'academic';

export interface TopicScenario {
  id: string;
  category: TopicCategory;
  label: string;
  emoji: string;
  situation: string;
  partnerRole: string;
  userGoal: string;
  /** Practical expressions with placeholders users can immediately use */
  keyExpressions: string[];
  /** Context injected into Gemini chunk generation */
  geminiCoachContext: string;
  /** Gemini Gem handoff prompt (Korean) */
  gemPrompt: string;
}

export const CATEGORY_META: Record<TopicCategory, { label: string; emoji: string }> = {
  daily:    { label: 'Daily Life', emoji: '🏠' },
  travel:   { label: 'Travel',     emoji: '✈️' },
  business: { label: 'Business',   emoji: '💼' },
  social:   { label: 'Social',     emoji: '👋' },
  academic: { label: 'Academic',   emoji: '📚' },
};

export const SCENARIOS: TopicScenario[] = [
  // ── Daily Life ──
  {
    id: 'cafe_order',
    category: 'daily',
    label: 'Café Order',
    emoji: '☕',
    situation: "You're at a coffee shop. The barista asks what you'd like.",
    partnerRole: 'Barista',
    userGoal: 'Order a drink, customize it, ask about recommendations',
    keyExpressions: [
      "Can I get a (drink) please?",
      "I'd like it with (oat milk / no sugar / extra shot)",
      "What do you recommend?",
      "Make it a (size), please",
      "Is the (drink) sweet or bitter?",
    ],
    geminiCoachContext: 'User is ordering at a café. Help with ordering expressions, customization, and polite requests.',
    gemPrompt: `당신은 영어 회화 코칭 Gem입니다. 학습자는 "카페 주문" 시나리오를 연습했습니다.\n역할: 손님 → 바리스타\n중점 표현: "Can I get a...", "I'd like it with...", "What do you recommend?"\n주문 → 커스터마이징 → 추천 요청 흐름을 연습시켜 주세요.`,
  },
  {
    id: 'grocery_shopping',
    category: 'daily',
    label: 'Grocery Shopping',
    emoji: '🛒',
    situation: "You're at a supermarket looking for specific ingredients.",
    partnerRole: 'Store Clerk',
    userGoal: 'Ask where items are, compare products, check prices',
    keyExpressions: [
      "Excuse me, where can I find (item)?",
      "Do you have any (organic / gluten-free) options?",
      "How much is this per (pound / kilogram)?",
      "Is this on sale?",
      "Can you recommend a good (brand)?",
    ],
    geminiCoachContext: 'User is grocery shopping. Help with asking for items, comparing products, and price inquiries.',
    gemPrompt: `학습자는 "마트 쇼핑" 시나리오를 연습했습니다.\n역할: 손님 → 점원\n중점: 위치 질문 "Where can I find...", 비교 "Do you have any... options?", 가격 문의\n실용적 쇼핑 표현 중심으로 코칭해 주세요.`,
  },
  {
    id: 'doctor_visit',
    category: 'daily',
    label: 'Doctor Visit',
    emoji: '🏥',
    situation: "You're at a clinic explaining your symptoms to the doctor.",
    partnerRole: 'Doctor',
    userGoal: 'Describe symptoms, answer questions, understand instructions',
    keyExpressions: [
      "I've been having (headaches / a sore throat) for (days)",
      "It hurts when I (swallow / breathe / move)",
      "I'm allergic to (medication)",
      "How often should I take this?",
      "Is it serious?",
    ],
    geminiCoachContext: 'User is at a doctor appointment. Help with symptom descriptions, medical vocabulary, and understanding instructions.',
    gemPrompt: `학습자는 "병원 방문" 시나리오를 연습했습니다.\n역할: 환자 → 의사\n중점: 증상 표현 "I've been having...", 통증 위치/기간, 약 복용법 이해\n의료 상황 표현을 자연스럽게 쓸 수 있도록 코칭해 주세요.`,
  },
  {
    id: 'phone_repair',
    category: 'daily',
    label: 'Phone Repair',
    emoji: '📱',
    situation: "Your phone screen is cracked and you're at a repair shop.",
    partnerRole: 'Technician',
    userGoal: 'Explain the problem, ask about cost and time, decide on repair',
    keyExpressions: [
      "My (screen / battery / speaker) is (cracked / not working)",
      "How long will the repair take?",
      "How much would it cost to fix?",
      "Is it worth repairing or should I get a new one?",
      "Can you back up my data first?",
    ],
    geminiCoachContext: 'User is getting a phone repaired. Help with describing technical problems, cost negotiations, and decision expressions.',
    gemPrompt: `학습자는 "폰 수리" 시나리오를 연습했습니다.\n역할: 고객 → 수리 기사\n중점: 고장 설명 "My... is not working", 비용/시간 질문, 수리 결정\n기술 문제 설명과 비용 협상 표현을 코칭해 주세요.`,
  },
  {
    id: 'gym_registration',
    category: 'daily',
    label: 'Gym Registration',
    emoji: '🏋️',
    situation: "You're signing up at a fitness center.",
    partnerRole: 'Gym Staff',
    userGoal: 'Ask about memberships, schedules, and facilities',
    keyExpressions: [
      "What membership plans do you have?",
      "Does it include (classes / personal training)?",
      "What are the (opening hours / peak hours)?",
      "Can I try a (free trial) first?",
      "Is there a (locker room / shower)?",
    ],
    geminiCoachContext: 'User is joining a gym. Help with membership inquiries, facility questions, and schedule expressions.',
    gemPrompt: `학습자는 "헬스장 등록" 시나리오를 연습했습니다.\n역할: 회원 → 직원\n중점: 멤버십 문의, 시설 질문 "Does it include...", 체험 요청\n등록 절차 관련 표현을 코칭해 주세요.`,
  },

  // ── Travel ──
  {
    id: 'hotel_checkin',
    category: 'travel',
    label: 'Hotel Check-in',
    emoji: '🏨',
    situation: "You've just arrived at a hotel and need to check in.",
    partnerRole: 'Front Desk Agent',
    userGoal: 'Check in, make requests, ask about amenities',
    keyExpressions: [
      "I have a reservation under (name)",
      "Could I get a room with a (view / king bed)?",
      "What time is (check-out / breakfast)?",
      "Is there (Wi-Fi / parking) included?",
      "Could you recommend a good (restaurant) nearby?",
    ],
    geminiCoachContext: 'User is checking into a hotel. Help with reservation expressions, room requests, and amenity inquiries.',
    gemPrompt: `학습자는 "호텔 체크인" 시나리오를 연습했습니다.\n역할: 투숙객 → 프론트 직원\n중점: 예약 확인 "I have a reservation under...", 요청 "Could I get...", 시설 문의\n호텔 체크인 전체 흐름을 코칭해 주세요.`,
  },
  {
    id: 'airport_navigation',
    category: 'travel',
    label: 'Airport Navigation',
    emoji: '✈️',
    situation: "You're at an unfamiliar airport trying to find your gate.",
    partnerRole: 'Airport Staff',
    userGoal: 'Find your gate, ask about delays, handle boarding',
    keyExpressions: [
      "Which way to Gate (number)?",
      "Is the flight to (city) on time?",
      "Where is the (boarding pass / baggage claim)?",
      "Do I need to go through (security / customs) again?",
      "How long until boarding starts?",
    ],
    geminiCoachContext: 'User is navigating an airport. Help with direction-asking, flight status, and boarding expressions.',
    gemPrompt: `학습자는 "공항 이동" 시나리오를 연습했습니다.\n역할: 여행자 → 공항 직원\n중점: 게이트 찾기, 지연 확인, 탑승 절차 표현\n공항 상황별 필수 표현을 코칭해 주세요.`,
  },
  {
    id: 'local_tour',
    category: 'travel',
    label: 'Local Tour Guide',
    emoji: '🗺️',
    situation: "You're on a walking tour asking your guide about the area.",
    partnerRole: 'Tour Guide',
    userGoal: 'Ask about history, take recommendations, express interest',
    keyExpressions: [
      "What's the history behind (this place)?",
      "You should definitely visit (place)",
      "Is it worth going to (place)?",
      "How far is (place) from here?",
      "What's the best time to see (attraction)?",
    ],
    geminiCoachContext: 'User is on a local tour. Help with asking about places, expressing opinions about attractions, and getting recommendations.',
    gemPrompt: `학습자는 "현지 투어" 시나리오를 연습했습니다.\n역할: 관광객 → 가이드\n중점: 장소 질문 "What's the history behind...", 추천 "You should visit...", 거리/시간 표현\n관광 상황 대화 흐름을 코칭해 주세요.`,
  },
  {
    id: 'restaurant_order',
    category: 'travel',
    label: 'Restaurant Ordering',
    emoji: '🍽️',
    situation: "You're dining at a restaurant abroad and ready to order.",
    partnerRole: 'Waiter',
    userGoal: 'Order food, ask about menu items, handle special requests',
    keyExpressions: [
      "I'll have the (dish), please",
      "What's in the (dish name)?",
      "I'm (vegetarian / allergic to nuts)",
      "Could I get this without (ingredient)?",
      "Can we get the check, please?",
    ],
    geminiCoachContext: 'User is ordering at a restaurant. Help with menu questions, dietary restrictions, and polite ordering expressions.',
    gemPrompt: `학습자는 "레스토랑 주문" 시나리오를 연습했습니다.\n역할: 손님 → 웨이터\n중점: 주문 "I'll have the...", 메뉴 질문, 식이 제한 표현, 계산 요청\n레스토랑 전체 흐름을 코칭해 주세요.`,
  },
  {
    id: 'street_directions',
    category: 'travel',
    label: 'Street Directions',
    emoji: '🚶',
    situation: "You're lost and asking a local for directions.",
    partnerRole: 'Local Pedestrian',
    userGoal: 'Ask for directions, understand route instructions',
    keyExpressions: [
      "Excuse me, how do I get to (place)?",
      "Is it within walking distance?",
      "Should I turn (left / right) at (landmark)?",
      "How many blocks from here?",
      "Is there a (bus / subway) that goes there?",
    ],
    geminiCoachContext: 'User is asking for street directions. Help with direction vocabulary, distance expressions, and transportation options.',
    gemPrompt: `학습자는 "길 찾기" 시나리오를 연습했습니다.\n역할: 길 묻는 사람 → 현지인\n중점: "How do I get to...", 방향 이해 (turn left/right), 거리/교통 표현\n실제 길 안내 상황을 코칭해 주세요.`,
  },

  // ── Business ──
  {
    id: 'job_interview',
    category: 'business',
    label: 'Job Interview',
    emoji: '💼',
    situation: "You're in a job interview being asked about your experience.",
    partnerRole: 'Interviewer',
    userGoal: 'Introduce yourself, explain strengths, answer behavioral questions',
    keyExpressions: [
      "I have (number) years of experience in (field)",
      "My strength is (skill / quality)",
      "In my previous role, I (achievement)",
      "I'm passionate about (area)",
      "I'd bring (value) to your team",
    ],
    geminiCoachContext: 'User is in a job interview. Help with self-introduction, strength articulation, and professional experience descriptions.',
    gemPrompt: `학습자는 "영어 면접" 시나리오를 연습했습니다.\n역할: 지원자 → 면접관\n중점: 자기소개, 강점 "My strength is...", 경험 서술 "In my previous role..."\n면접 질문 유형별 답변 구조를 코칭해 주세요.`,
  },
  {
    id: 'team_meeting',
    category: 'business',
    label: 'Team Meeting',
    emoji: '📊',
    situation: "You're in a team meeting sharing your project update.",
    partnerRole: 'Team Members',
    userGoal: 'Present updates, suggest ideas, agree or disagree politely',
    keyExpressions: [
      "I'd like to share an update on (project)",
      "I think we should consider (approach)",
      "I agree with (name), and I'd add that",
      "That's a good point, but have we considered (alternative)?",
      "Let me follow up on that by (next meeting)",
    ],
    geminiCoachContext: 'User is in a team meeting. Help with update presentations, idea suggestions, and polite agreement/disagreement.',
    gemPrompt: `학습자는 "팀 회의" 시나리오를 연습했습니다.\n역할: 팀원 → 팀\n중점: 업데이트 보고, 의견 제시 "I think we should...", 정중한 동의/반대\n회의 발언 구조를 코칭해 주세요.`,
  },
  {
    id: 'client_presentation',
    category: 'business',
    label: 'Client Presentation',
    emoji: '🎤',
    situation: "You're presenting a proposal to a potential client.",
    partnerRole: 'Client',
    userGoal: 'Present value proposition, handle Q&A, close with next steps',
    keyExpressions: [
      "Today I'd like to walk you through (topic)",
      "What sets us apart is (differentiator)",
      "As you can see from (data/chart)",
      "That's a great question, and the answer is",
      "The next step would be to (action)",
    ],
    geminiCoachContext: 'User is giving a client presentation. Help with presentation flow, value propositions, and Q&A handling.',
    gemPrompt: `학습자는 "클라이언트 프레젠테이션" 시나리오를 연습했습니다.\n역할: 발표자 → 클라이언트\n중점: 도입 "I'd like to walk you through...", 차별화 표현, Q&A 대응\n프레젠테이션 흐름을 코칭해 주세요.`,
  },
  {
    id: 'email_followup',
    category: 'business',
    label: 'Email Follow-up',
    emoji: '📧',
    situation: "You're calling a colleague to discuss an email you sent.",
    partnerRole: 'Colleague',
    userGoal: 'Reference the email, clarify points, confirm action items',
    keyExpressions: [
      "I'm following up on the email I sent about (topic)",
      "Did you get a chance to look at (document)?",
      "What I meant in the email was (clarification)",
      "Could you (action) by (deadline)?",
      "Let me send you a (summary / updated version)",
    ],
    geminiCoachContext: 'User is doing an email follow-up call. Help with referencing written communication, clarification, and action items.',
    gemPrompt: `학습자는 "이메일 팔로업" 시나리오를 연습했습니다.\n역할: 발신자 → 동료\n중점: 이메일 참조 "I'm following up on...", 명확화, 액션 아이템 확인\n구두-서면 전환 표현을 코칭해 주세요.`,
  },
  {
    id: 'networking_event',
    category: 'business',
    label: 'Networking Event',
    emoji: '🤝',
    situation: "You're at a professional networking event introducing yourself.",
    partnerRole: 'Professional',
    userGoal: 'Introduce yourself, find common interests, exchange contacts',
    keyExpressions: [
      "Hi, I'm (name) and I work in (field)",
      "What brings you to (event)?",
      "That sounds interesting, tell me more about (topic)",
      "We should definitely connect on (platform)",
      "It was great meeting you",
    ],
    geminiCoachContext: 'User is at a networking event. Help with introductions, conversation starters, and professional small talk.',
    gemPrompt: `학습자는 "네트워킹 이벤트" 시나리오를 연습했습니다.\n역할: 참가자 → 전문가\n중점: 자기소개 "I work in...", 관심사 발굴, 연락처 교환 표현\n네트워킹 대화 흐름을 코칭해 주세요.`,
  },

  // ── Social ──
  {
    id: 'making_friends',
    category: 'social',
    label: 'Making Friends',
    emoji: '👋',
    situation: "You've just met someone new at a community event.",
    partnerRole: 'New Acquaintance',
    userGoal: 'Introduce yourself, find shared interests, suggest meeting again',
    keyExpressions: [
      "Hi, I'm (name). Nice to meet you!",
      "So what do you do for (fun / work)?",
      "Oh really? I'm also into (hobby)!",
      "We should hang out sometime",
      "Let me give you my (number / Instagram)",
    ],
    geminiCoachContext: 'User is making new friends. Help with casual introductions, finding common ground, and suggesting future meetups.',
    gemPrompt: `학습자는 "새 친구 사귀기" 시나리오를 연습했습니다.\n역할: 새로운 사람 → 새로운 사람\n중점: 캐주얼 소개, 공통 관심사 찾기, 다음 만남 제안\n자연스러운 친구 사귀기 대화를 코칭해 주세요.`,
  },
  {
    id: 'party_smalltalk',
    category: 'social',
    label: 'Party Small Talk',
    emoji: '🎉',
    situation: "You're at a house party chatting with other guests.",
    partnerRole: 'Party Guest',
    userGoal: 'Make light conversation, share opinions, keep it fun',
    keyExpressions: [
      "How do you know (host)?",
      "Have you tried the (food/drink)? It's amazing",
      "I've been meaning to watch (show). Is it good?",
      "What are you up to this weekend?",
      "This is such a great (vibe / playlist / place)",
    ],
    geminiCoachContext: 'User is at a party making small talk. Help with casual conversation starters, compliments, and light topic transitions.',
    gemPrompt: `학습자는 "파티 스몰톡" 시나리오를 연습했습니다.\n역할: 파티 참가자\n중점: 가벼운 대화 시작, 의견 공유, 화제 전환\n파티 상황 캐주얼 대화를 코칭해 주세요.`,
  },
  {
    id: 'debate_opinion',
    category: 'social',
    label: 'Debate & Opinion',
    emoji: '💬',
    situation: "You're having a friendly debate about a social topic.",
    partnerRole: 'Discussion Partner',
    userGoal: 'Express opinions, support arguments, respectfully disagree',
    keyExpressions: [
      "I think (topic) is important because (reason)",
      "I see your point, but on the other hand",
      "The way I see it, (opinion)",
      "That's a fair argument, however",
      "What if we looked at it from (perspective)?",
    ],
    geminiCoachContext: 'User is in a friendly debate. Help with opinion expressions, argument structure, and respectful disagreement.',
    gemPrompt: `학습자는 "의견 토론" 시나리오를 연습했습니다.\n역할: 토론자\n중점: 의견 표현 "I think... because...", 정중한 반박 "I see your point, but..."\n논리적 대화 구조를 코칭해 주세요.`,
  },
  {
    id: 'movie_review',
    category: 'social',
    label: 'Movie/Book Review',
    emoji: '🎬',
    situation: "You're recommending a movie or book to a friend.",
    partnerRole: 'Friend',
    userGoal: 'Describe the plot, share your opinion, recommend or warn',
    keyExpressions: [
      "Have you seen (title)? You'd love it",
      "It's about (brief plot) and it's really (adjective)",
      "The best part is when (scene/moment)",
      "I wouldn't recommend it if you don't like (genre)",
      "It reminded me of (similar work)",
    ],
    geminiCoachContext: 'User is reviewing a movie or book. Help with plot descriptions, opinion expressions, and recommendation language.',
    gemPrompt: `학습자는 "영화/책 리뷰" 시나리오를 연습했습니다.\n역할: 추천자 → 친구\n중점: 줄거리 설명 "It's about...", 감상 표현, 추천 "You'd love it"\n리뷰/추천 대화를 코칭해 주세요.`,
  },

  // ── Academic ──
  {
    id: 'class_discussion',
    category: 'academic',
    label: 'Class Discussion',
    emoji: '📚',
    situation: "You're participating in a university class discussion.",
    partnerRole: 'Professor & Classmates',
    userGoal: 'Share analysis, ask questions, build on others\' points',
    keyExpressions: [
      "Based on the reading, I think (analysis)",
      "To add to what (classmate) said,",
      "Could you clarify what you mean by (concept)?",
      "I'd argue that (position) because (evidence)",
      "That connects to (related topic) because",
    ],
    geminiCoachContext: 'User is in a class discussion. Help with academic vocabulary, building arguments, and engaging with others\' ideas.',
    gemPrompt: `학습자는 "수업 토론" 시나리오를 연습했습니다.\n역할: 학생 → 교수/동기\n중점: 분석 표현 "Based on... I think...", 의견 추가 "To add to...", 질문\n학술적 토론 표현을 코칭해 주세요.`,
  },
  {
    id: 'office_hours',
    category: 'academic',
    label: 'Office Hours',
    emoji: '✏️',
    situation: "You're visiting your professor during office hours.",
    partnerRole: 'Professor',
    userGoal: 'Ask about grades, clarify concepts, request feedback',
    keyExpressions: [
      "I was wondering about my grade on (assignment)",
      "Could you explain (concept) in a different way?",
      "I'm struggling with (topic). Any suggestions?",
      "What would you recommend I focus on for (exam)?",
      "Thank you for your time, Professor",
    ],
    geminiCoachContext: 'User is at office hours. Help with polite academic requests, asking for clarification, and feedback discussions.',
    gemPrompt: `학습자는 "교수 면담" 시나리오를 연습했습니다.\n역할: 학생 → 교수\n중점: 정중한 요청 "I was wondering...", 개념 질문, 피드백 요청\n학술 면담 표현을 코칭해 주세요.`,
  },
  {
    id: 'study_group',
    category: 'academic',
    label: 'Study Group',
    emoji: '👥',
    situation: "You're studying with classmates preparing for an exam.",
    partnerRole: 'Study Partners',
    userGoal: 'Explain concepts, quiz each other, plan study schedule',
    keyExpressions: [
      "Let me explain how (concept) works",
      "Do you remember what (term) means?",
      "I think the key takeaway is (summary)",
      "Should we focus on (chapter / topic) next?",
      "Can you quiz me on (section)?",
    ],
    geminiCoachContext: 'User is in a study group. Help with explaining concepts, collaborative studying expressions, and academic planning.',
    gemPrompt: `학습자는 "스터디 그룹" 시나리오를 연습했습니다.\n역할: 스터디원\n중점: 개념 설명 "Let me explain...", 요약 "The key takeaway is...", 학습 계획\n협력 학습 대화를 코칭해 주세요.`,
  },
  {
    id: 'conference_qa',
    category: 'academic',
    label: 'Conference Q&A',
    emoji: '🎓',
    situation: "You're asking a question after a conference presentation.",
    partnerRole: 'Presenter',
    userGoal: 'Ask thoughtful questions, reference the talk, seek elaboration',
    keyExpressions: [
      "Thank you for the presentation. I had a question about (topic)",
      "You mentioned (point). Could you elaborate on that?",
      "How does (finding) apply to (context)?",
      "Have you considered (alternative approach)?",
      "That's a fascinating finding. What are the implications?",
    ],
    geminiCoachContext: 'User is at a conference Q&A. Help with formulating academic questions, referencing presentations, and seeking elaboration.',
    gemPrompt: `학습자는 "학회 Q&A" 시나리오를 연습했습니다.\n역할: 청중 → 발표자\n중점: 질문 구성 "You mentioned... Could you elaborate?", 적용 질문, 정중한 표현\n학술 Q&A 표현을 코칭해 주세요.`,
  },
];

/**
 * Get all scenarios for a specific category.
 */
export function getScenariosByCategory(category: TopicCategory): TopicScenario[] {
  return SCENARIOS.filter((s) => s.category === category);
}

/**
 * Get a scenario by its ID.
 */
export function getScenarioById(id: string): TopicScenario | undefined {
  return SCENARIOS.find((s) => s.id === id);
}

/**
 * Get all categories that have scenarios.
 */
export function getCategories(): TopicCategory[] {
  return Object.keys(CATEGORY_META) as TopicCategory[];
}

/**
 * Map a scenario ID to a legacy ChunkCategory for fallback chunk compatibility.
 */
export function toLegacyCategory(scenarioId: string): string {
  const scenario = getScenarioById(scenarioId);
  if (!scenario) return 'general';
  switch (scenario.category) {
    case 'travel': return 'travel';
    case 'business': return 'business';
    case 'daily': {
      if (scenarioId === 'cafe_order' || scenarioId === 'grocery_shopping') return 'food';
      return 'general';
    }
    case 'social': return 'general';
    case 'academic': return 'general';
    default: return 'general';
  }
}
