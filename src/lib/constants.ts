export const CATEGORIES = [
  {
    name: 'Anime/Manga',
    slug: 'anime-manga',
  },
  {
    name: 'Books',
    slug: 'books',
  },
  {
    name: 'Cartoons',
    slug: 'cartoons',
  },
  {
    name: 'Comics',
    slug: 'comics',
  },
  {
    name: 'Video Games',
    slug: 'video-games',
  },
  {
    name: 'Movies/TV',
    slug: 'movies-tv',
  },
  {
    name: 'Music',
    slug: 'music',
  },
  {
    name: 'Plays',
    slug: 'plays',
  },
  {
    name: 'Podcasts',
    slug: 'podcasts',
  },
  {
    name: 'Others',
    slug: 'others',
  },
]

export const LINKS = [
  {
    href: 'faqs',
    label: 'FAQs',
  },
  {
    href: 'roadmap',
    label: 'Roadmap',
  },
  {
    href: 'privacy-policy',
    label: 'Privacy Policy',
  },
  {
    href: 'terms-and-conditions',
    label: 'Terms & Conditions',
  },
  {
    href: 'content-policy',
    label: 'Content Policy',
  },
  {
    href: 'licenses',
    label: 'Licenses',
  },
]

export const RESTRICTED_USERNAMES: readonly [string, ...string[]] = [
  'fancanon',
  'admin',
  'administrator',
  'admins',
  'user',
  'users',
  'superuser',
  'mod',
  'moderator',
  'mods',
  'moderators',
  'owner',
  'founder',
  'system',
  'help',
  'support',
  'staff',
  'root',
  'login',
  'logout',
  'signin',
  'signup',
  'register',
  'auth',
  'oauth',
  'session',
  'sessions',
  'account',
  'accounts',
  'password',
  'verify',
  'verification',
  'reset',
  'activate',
  'profile',
  'profiles',
  'me',
  'settings',
  'preferences',
  'notifications',
  'messages',
  'inbox',
  'mail',
  'dashboard',
  'billing',
  'payment',
  'payments',
  'invoice',
  'invoices',
  'subscription',
  'subscriptions',
  'donate',
  'wallet',
  'store',
  'shop',
  'guest',
]

export const CHARACTER_COUNTED_LANGUAGES = new Set(['chinese', 'japanese', 'korean', 'thai'])

export const OFFENSIVE_WORDS: readonly [string, ...string[]] = [
  'beaners',
  'chinks',
  'dindunuffin',
  'niggers',
  'gooks',
  'spics',
  'dickhead',
  'tranny',
  'wetback',
  'coons',
  '14/88',
  'dindu nuffins',
  'dindunuffins',
  'niglets',
  'porch monkeys',
  'gook',
  'spic',
  'niglet',
  'kike',
  'ragheads',
  'coon',
  'chink',
  'kikes',
  'dindu nuffin',
  'raghead',
  'jigaboos',
  'fags',
  'porch monkey',
  'pajeet',
  'pajeets',
  'nigger',
  'jigaboo',
  'faggot',
  'faggots',
  'beaner',
  'kneegrow',
  'niggar',
  'knee grow',
  'wetbacks',
  'nigg3r',
  'fag',
]

export const RESTRICTED_WORDS = new Set(OFFENSIVE_WORDS)

export const LEETSPEAK_MAP: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '2': 'z',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '6': 'g',
  '7': 't',
  '8': 'b',
  '9': 'g',
  '@': 'a',
  $: 's',
  '!': 'i',
  '+': 't',
}

export const RELATIONSHIP_SEPARATOR = /\/|&/

export const DEFAULT_LIMIT: number = 20

export const DEFAULT_PAGE: number = 1

export const LIKES_WEIGHT: number = 3

export const READ_LATER_WEIGHT: number = 1

export const TRENDING_GRAVITY = 1.8

export const MAX_THREAD_LIMIT: number = 6

export const TAG_LIMIT: number = 10

export enum Languages {
  english = 'english',
  espanol = 'espanol',
  french = 'french',
  other = 'other',
}

export enum ContentRating {
  GENERAL = 'GENERAL',
  TEEN = 'TEEN',
  MATURE = 'MATURE',
  EXPLICIT = 'EXPLICIT',
}

export const REASONS: readonly [string, ...string[]] = [
  'inappropriate content',
  'hate speech',
  'harrassment',
  'plagiarism',
  'spam',
  'misleading tags or description',
  'wrong language or category',
  'copyright infringement',
  'other',
]

export const COMMENT_REASONS: readonly [string, ...string[]] = [
  'inappropriate language',
  'hate speech',
  'harrassment',
  'spam',
  'spoilers without warning',
  'threats',
  'other',
]

export const USER_REASONS: readonly [string, ...string[]] = [
  'impersonation',
  'hate speech',
  'harrassment',
  'inappropriate username or profile',
  'spamming',
  'stolen content',
  'ban evasion',
  'other',
]

export const NO_WARNING_CHOSEN_TAG_NAME = 'author chose not to use warnings'

export const VIEW_DEDUP_WINDOW_SECONDS = 60 * 30 // 30 minutes

export const STORAGE_KEY = 'fc:v'

export const WORD_SIMILARITY_THRESHOLD = 0.35 // title/description/author, via <%
export const SIMILARITY_THRESHOLD = 0.3 // tag.name, via %, pg_trgm's own default
