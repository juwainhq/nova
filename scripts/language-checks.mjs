// Bangla and language-selection checks, run inside verify:speech.
import { LANGUAGE_RECOGNITION, languagePrompt, normalizeLanguage, NOVA_LANGUAGES } from '../src/personality.js';
import { parseWakeWord } from '../src/speech.js';

export function verifyLanguage(check) {
  check('the language list offers English (default), Bangla and Auto-detect',
    JSON.stringify(NOVA_LANGUAGES.map((language) => language.id)) === JSON.stringify(['en', 'bn', 'auto'])
    && NOVA_LANGUAGES[1].label === 'বাংলা (Bangla)' && NOVA_LANGUAGES[2].label === 'Auto-detect');
  check('an unknown or missing saved language falls back to English',
    normalizeLanguage(null) === 'en' && normalizeLanguage('fr') === 'en' && normalizeLanguage('bn') === 'bn');
  check('English adds no extra prompt text', languagePrompt('en') === '');
  check('Bangla adds the exact Bangla response instruction', languagePrompt('bn') === 'তুমি NOVA, একটি বাংলা ভয়েস অ্যাসিস্ট্যান্ট। সবসময় বাংলায় উত্তর দাও। উত্তর সংক্ষিপ্ত এবং স্বাভাবিক কথ্য ভাষায় রাখো। ইংরেজি শব্দ এড়িয়ে চলো যতটা সম্ভব।');
  check('Auto-detect replies in Bangla when the transcript has Bengali characters, otherwise English',
    languagePrompt('auto', 'আজ কেমন আছো') === languagePrompt('bn') && languagePrompt('auto', 'how are you') === 'The user speaks English. Respond in English.');
  check('recognition language follows the selection: en-US, bn-BD, or both',
    LANGUAGE_RECOGNITION.en === 'en-US' && LANGUAGE_RECOGNITION.bn === 'bn-BD' && LANGUAGE_RECOGNITION.auto === 'bn-BD,en-US');
  check('the Bangla wake phrase এই নোভা starts a request', parseWakeWord('এই নোভা, আজকের আবহাওয়া কেমন?')?.question === 'আজকের আবহাওয়া কেমন?');
  check('the Bangla wake phrase alone is recognized', parseWakeWord('এই নোভা') !== null);
  check('a Bengali word that begins with the wake phrase does not wake NOVA', parseWakeWord('এই নোভাকে বলো') === null);
  check('English "hey nova" still wakes NOVA', parseWakeWord('hey nova what time is it')?.question === 'what time is it');
}

// Voice list and speaking-rate checks.
import { isFastVoice, normalizeSpeechRate, SPEECH_RATE, voiceListLabel, voiceTiers } from '../src/speech.js';

export function verifyVoiceList(check) {
  check('speaking rate is limited to 0.8 to 1.6 in 0.1 steps, defaulting to 1.0',
    normalizeSpeechRate(undefined) === 1 && normalizeSpeechRate('0.5') === 0.8 && normalizeSpeechRate('3') === 1.6
    && normalizeSpeechRate('1.25') === 1.3 && SPEECH_RATE.step === 0.1);
  check('recommended and Online/Natural voices are marked fast', isFastVoice({ name: 'Google US English' })
    && isFastVoice({ name: 'Microsoft Jenny Online (Natural)' }) && !isFastVoice({ name: 'Samantha' }));
  const voices = [{ name: 'Samantha', lang: 'en-US' }, { name: 'Google US English', lang: 'en-US' }, { name: 'Bengali Hemanta', lang: 'bn-BD', localService: true }];
  const tiers = voiceTiers(voices);
  check('the voice list keeps every browser voice, split into Fast and Normal',
    tiers.fast.length === 1 && tiers.normal.length === 2 && tiers.fast[0].name === 'Google US English');
  check('Bangla voices are labelled 🇧🇩 Bangla in the list', voiceListLabel(voices[2]).includes('🇧🇩 Bangla') && voiceListLabel(voices[1]).startsWith('⚡ '));
}

// Bangla wake phrases, plus the English name spoken on its own.
export function verifyBanglaWake(check) {
  check('wake: হেই নোভা starts a request', parseWakeWord('হেই নোভা, সময় কত?')?.question === 'সময় কত?');
  check('wake: bare নোভা starts a request', parseWakeWord('নোভা, আজকের খবর বলো')?.question === 'আজকের খবর বলো');
  check('wake: bare nova starts a request', parseWakeWord('Nova, what time is it')?.question === 'what time is it');
  check('wake: a Bengali word containing নোভা does not wake NOVA', parseWakeWord('আনোভাবে কাজ করো') === null);
  check('wake: a longer Bengali word starting with নোভা does not wake NOVA', parseWakeWord('নোভাল কী') === null);
}

// Startup playlist parsing and the player's embed (the playback itself needs a browser).
import { getPlaylistId, playerEmbedUrl, PLAYER_DISMISS_MS } from '../src/startup-song.js';
export function verifyStartupSong(check) {
  check('playlist: the ID is read from playlist, watch and short YouTube links',
    getPlaylistId('https://www.youtube.com/playlist?list=PLabc123XYZ') === 'PLabc123XYZ'
    && getPlaylistId('https://youtube.com/watch?v=abcdefghijk&list=PLabc123XYZ&index=2') === 'PLabc123XYZ'
    && getPlaylistId('https://youtu.be/abcdefghijk?list=PLabc123XYZ') === 'PLabc123XYZ');
  check('playlist: a link without a list parameter gives no ID',
    getPlaylistId('https://www.youtube.com/watch?v=abcdefghijk') === null && getPlaylistId('') === null && getPlaylistId(null) === null);
  check('player: the embed uses autoplay with sound on',
    playerEmbedUrl('PLabc123XYZ') === 'https://www.youtube.com/embed/videoseries?list=PLabc123XYZ&autoplay=1&mute=0');
  check('player: fades out after 45 seconds', PLAYER_DISMISS_MS === 45000);
}
