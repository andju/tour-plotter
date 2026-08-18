/**
 * City-label languages offered in the UI. Every code here is looked up as a
 * `name:<code>` tag on OSM places (decode.ts) and a `name_<code>` column on
 * Natural Earth's populated-places layer (naturalEarth.ts). OSM tags cover
 * effectively all of these for any named place; Natural Earth only ships
 * translations for a subset (see fetch-basemap.ts's `keepProperties` for the
 * cities layer) — a code missing there falls back to the place's default
 * name, which is the intended "unsupported -> English" behavior since
 * Natural Earth's default `name` column is already English/conventional.
 */
export interface Language {
	code: string;
	label: string;
}

export const SUPPORTED_LANGUAGES: Language[] = [
	{ code: 'en', label: 'English' },
	{ code: 'de', label: 'German' },
	{ code: 'es', label: 'Spanish' },
	{ code: 'fr', label: 'French' },
	{ code: 'pt', label: 'Portuguese' },
	{ code: 'ru', label: 'Russian' },
	{ code: 'zh', label: 'Chinese' },
	{ code: 'it', label: 'Italian' },
	{ code: 'nl', label: 'Dutch' },
	{ code: 'pl', label: 'Polish' },
	{ code: 'ja', label: 'Japanese' },
	{ code: 'ar', label: 'Arabic' },
	{ code: 'tr', label: 'Turkish' },
	{ code: 'ko', label: 'Korean' }
];

export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number]['code'];

export const DEFAULT_LANGUAGE: LanguageCode = 'en';
